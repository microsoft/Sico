import asyncio
import json
from types import SimpleNamespace

import pytest
import pytest_asyncio
import pytest_mock
from agent_framework import ChatResponse, ChatResponseUpdate, Content

from app.biz.chat import service as chat_service_module
from app.biz.chat.conversation_history import complete_unfinished_tool_calls, discard_unfinished_tool_calls
from app.biz.chat.service import ChatService
from app.pb.common.common import Attachment
from app.pb.conversation.chat import ChatContent, ChatContentType
from app.pb.conversation.api import ChatRequest, GenerateOnboardRecommendationTasksRequest
from app.schemas.common.common import Attachment as SchemaAttachment
from app.schemas.conversation.chat import TopicMessage
from app.schemas.conversation import Message
from app.storage import redis
from app.utils.runner import AsyncJobRunner


class FakeChatAgent:
    def __init__(self, *args, **kwargs):
        pass

    async def run_stream(self, queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None], *args, **kwargs):
        await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text("Hello")]))
        await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text(" world")]))
        await queue.put(None)

    async def _enqueue_memories(self, *args, **kwargs):
        pass


class FakePlanAgent:
    async def run_stream(self, queue, *args, **kwargs):
        for content in ("first", "second"):
            await queue.put(
                chat_service_module.ChatResponse(
                    content=ChatContent(type=ChatContentType.PLAN, content=content),
                    is_internal=True,
                )
            )
        await queue.put(None)


async def build_fake_agent(*args, **kwargs):
    return FakeChatAgent()


class FakeConversationService:
    _instance = None

    def __init__(self):
        if not FakeConversationService._instance:
            FakeConversationService._instance = self
        self.created_messages = []

    @classmethod
    def get_instance(cls):
        if not cls._instance:
            cls._instance = cls()
        return cls._instance

    def create_message(self, message: Message):
        self.created_messages.append(message)
        return message


def test_conversation_history_normalizes_unfinished_tool_calls():
    messages = [
        {"role": "user", "contents": [{"type": "text", "text": "run both"}]},
        {
            "role": "assistant",
            "contents": [
                {"type": "text", "text": "starting"},
                {"type": "function_call", "call_id": "call-1", "name": "read"},
                {"type": "function_call", "call_id": "call-2", "name": "write"},
            ],
        },
        {"role": "tool", "contents": [{"type": "function_result", "call_id": "call-1", "result": "done"}]},
    ]

    completed, completed_count = complete_unfinished_tool_calls(messages)
    completed_again, completed_again_count = complete_unfinished_tool_calls(completed)
    discarded, discarded_count = discard_unfinished_tool_calls(messages)

    assert completed_count == 1
    assert completed[-1] == {
        "role": "tool",
        "contents": [{"type": "function_result", "call_id": "call-2", "result": "Cancelled by user"}],
    }
    assert completed_again_count == 0
    assert completed_again == completed
    assert discarded_count == 1
    assert discarded[1]["contents"] == [
        {"type": "text", "text": "starting"},
        {"type": "function_call", "call_id": "call-1", "name": "read"},
    ]


class TestChat:
    @pytest_asyncio.fixture(scope="function", autouse=True)
    async def _init_chat_service(self):
        runner = AsyncJobRunner(workers=4, max_queue=50)
        await runner.start()
        _ = ChatService(runner, runner, runner)

        yield

        ChatService._instance = None
        await runner.close()

    @pytest.mark.asyncio
    async def test_chat(self, mocker: pytest_mock.MockerFixture, fake_redis):
        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.utils.eventbus import EventBus
        from app.utils.eventbus.mock import MockEventBus, MockEventBusSender

        mocker.patch.object(redis, "get_shared_redis", return_value=fake_redis)
        mocker.patch("app.biz.chat.service.build_agent", build_fake_agent)
        mocker.patch("app.biz.chat.service.init_workspace", return_value=None)
        mocker.patch.object(ReverseConversationService, "get_instance", return_value=FakeConversationService.get_instance())
        mocker.patch.object(EventBus, "get_instance", return_value=MockEventBus())

        chat_service = ChatService.get_instance()
        chat_service._event_bus_topic_name = "test-topic"
        _ = await chat_service.stream_chat(
            ChatRequest(username="alice@example.com", message=ChatContent(type=ChatContentType.TEXT, content="Hello"))
        )

        sender: MockEventBusSender = chat_service._event_bus_sender
        sent_messages = sender.sent_messages
        for msg in sent_messages:
            print(msg)

        # expect to have 4 messages
        # 1) isInternal=False, type=1, content="Hello"
        # 2) isInternal=False, type=1, content=" world"
        # 3) isInternal=True, type=1, content="Hello world"
        # 4) isInternal=False, isFinal=True, type=5

        assert len(sent_messages) == 4
        unmarshalled = [TopicMessage.model_validate_json(msg) for msg in sent_messages]

        assert unmarshalled[0].chat_response.content.content == "Hello"
        assert unmarshalled[0].chat_response.content.type == ChatContentType.TEXT
        assert not unmarshalled[0].chat_response.is_final
        assert not unmarshalled[0].chat_response.is_internal

        assert unmarshalled[1].chat_response.content.content == " world"
        assert unmarshalled[1].chat_response.content.type == ChatContentType.TEXT
        assert not unmarshalled[1].chat_response.is_final
        assert not unmarshalled[1].chat_response.is_internal

        assert unmarshalled[2].chat_response.content.content == "Hello world"
        assert unmarshalled[2].chat_response.content.type == ChatContentType.TEXT
        assert not unmarshalled[2].chat_response.is_final
        assert unmarshalled[2].chat_response.is_internal

        assert unmarshalled[3].chat_response.content.content == ""
        assert unmarshalled[3].chat_response.content.type == ChatContentType.END
        assert unmarshalled[3].chat_response.is_final
        assert not unmarshalled[3].chat_response.is_internal

    @pytest.mark.asyncio
    async def test_chat_persists_only_one_plan_message_but_streams_every_update(
        self,
        mocker: pytest_mock.MockerFixture,
        fake_redis,
    ):
        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.utils.eventbus import EventBus
        from app.utils.eventbus.mock import MockEventBus, MockEventBusSender

        conversation_service = FakeConversationService.get_instance()
        conversation_service.created_messages.clear()
        mocker.patch.object(redis, "get_shared_redis", return_value=fake_redis)
        mocker.patch("app.biz.chat.service.build_agent", return_value=FakePlanAgent())
        mocker.patch("app.biz.chat.service.init_workspace", return_value=None)
        mocker.patch.object(ReverseConversationService, "get_instance", return_value=conversation_service)
        mocker.patch.object(EventBus, "get_instance", return_value=MockEventBus())

        chat_service = ChatService.get_instance()
        chat_service._event_bus_topic_name = "test-topic"
        await chat_service.stream_chat(
            ChatRequest(username="alice@example.com", message=ChatContent(type=ChatContentType.TEXT, content="work"))
        )

        stored_plans = [
            message for message in conversation_service.created_messages if message.content_type == ChatContentType.PLAN
        ]
        assert len(stored_plans) == 1
        sender: MockEventBusSender = chat_service._event_bus_sender
        streamed = [TopicMessage.model_validate_json(message) for message in sender.sent_messages]
        streamed_plans = [
            item.chat_response.content.content
            for item in streamed
            if item.chat_response.content.type == ChatContentType.PLAN
        ]
        assert streamed_plans == [
            "first",
            "second",
        ]

    @pytest.mark.asyncio
    async def test_drain_resets_accumulated_text_at_runtime_capability_boundary(self):
        queue = asyncio.Queue()
        await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text("before")]))
        await queue.put(
            chat_service_module.ChatResponse(
                content=ChatContent(type=ChatContentType.TEXT, content="before"),
                is_internal=True,
            )
        )
        await queue.put(ChatResponseUpdate(role="assistant", contents=[Content.from_text("after")]))
        await queue.put(None)
        yielded = []

        async def collect(response):
            yielded.append(response)

        await chat_service_module.ChatResponsePresenter(conversation_id=44, turn_id=2).drain(queue, collect)

        durable_segments = [
            response.content.content
            for response in yielded
            if response.is_internal and response.content.type == ChatContentType.TEXT
        ]
        assert durable_segments == ["before", "after"]

    @pytest.mark.asyncio
    async def test_agent_instance_ongoing_conversation_index(self, fake_redis):
        from app.biz.chat.service import _get_agent_instance_ongoing_conversations_cache_key

        request = ChatRequest(
            agent_instance_id=42,
            conversation_id=7,
            message=ChatContent(type=ChatContentType.TEXT, content="Hello"),
        )
        chat_service = ChatService.get_instance()

        await chat_service._add_agent_instance_ongoing_conversation(fake_redis, request)

        key = _get_agent_instance_ongoing_conversations_cache_key(42)
        assert "7" in fake_redis.store[key]

        await chat_service._remove_agent_instance_ongoing_conversation(fake_redis, request)

        assert "7" not in fake_redis.store[key]

    @pytest.mark.asyncio
    async def test_agent_instance_index_failure_does_not_fail_chat_status_update(self):
        class FailingRedis:
            async def zadd(self, *args, **kwargs):
                raise RuntimeError("redis unavailable")

        request = ChatRequest(agent_instance_id=42, conversation_id=7)

        await ChatService.get_instance()._add_agent_instance_ongoing_conversation(FailingRedis(), request)

    @pytest.mark.asyncio
    async def test_hard_fast_route_skips_classifier_work_and_uses_fast_model(
        self,
        mocker: pytest_mock.MockerFixture,
        fake_redis,
        monkeypatch: pytest.MonkeyPatch,
    ):
        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.utils.eventbus import EventBus
        from app.utils.eventbus.mock import MockEventBus

        captured: dict[str, object] = {}

        async def build_capturing_agent(*args, **kwargs):
            captured["model"] = kwargs.get("model")
            return FakeChatAgent()

        monkeypatch.setenv("FAST_MODEL", "gpt-fast-test")
        mocker.patch.object(redis, "get_shared_redis", return_value=fake_redis)
        mocker.patch("app.biz.chat.service.build_agent", build_capturing_agent)
        mocker.patch("app.biz.chat.service.init_workspace", return_value=None)
        intent_mock = mocker.patch("app.biz.chat.router.llm_intent_check")
        sections_mock = mocker.patch.object(ChatService, "_build_context_sections", return_value={})
        mocker.patch.object(ReverseConversationService, "get_instance", return_value=FakeConversationService.get_instance())
        mocker.patch.object(EventBus, "get_instance", return_value=MockEventBus())

        chat_service = ChatService.get_instance()
        chat_service._event_bus_topic_name = "test-topic"
        await chat_service.stream_chat(
            ChatRequest(username="alice@example.com", message=ChatContent(type=ChatContentType.TEXT, content="hello"))
        )

        intent_mock.assert_not_called()
        # Those sections exist only to feed the classifier, so a guarded turn must
        # not pay to scan the workspace for them.
        sections_mock.assert_not_called()
        assert captured["model"] == "gpt-fast-test"

    @pytest.mark.asyncio
    async def test_chat_uses_runtime_agent_builder(
        self,
        mocker: pytest_mock.MockerFixture,
        fake_redis,
    ):
        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.utils.eventbus import EventBus
        from app.utils.eventbus.mock import MockEventBus

        mocker.patch.object(redis, "get_shared_redis", return_value=fake_redis)
        runtime_builder = mocker.patch("app.biz.chat.service.build_agent", return_value=FakeChatAgent())
        mocker.patch("app.biz.chat.service.init_workspace", return_value=None)
        mocker.patch.object(ReverseConversationService, "get_instance", return_value=FakeConversationService.get_instance())
        mocker.patch.object(EventBus, "get_instance", return_value=MockEventBus())

        chat_service = ChatService.get_instance()
        chat_service._event_bus_topic_name = "test-topic"
        await chat_service.stream_chat(
            ChatRequest(username="alice@example.com", message=ChatContent(type=ChatContentType.TEXT, content="hello"))
        )

        runtime_builder.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_generate_onboard_recommendation_tasks_accepts_array_payload(self, mocker: pytest_mock.MockerFixture):
        payload = (
            "```json\n"
            '[{"message": "Run the smoke test", "icon": "build"}, '
            '{"message": "Review docs", "icon": 5}, '
            '{"message": "Draft plan", "icon": 4}]\n'
            "```"
        )
        generation = SimpleNamespace(outputs=[SimpleNamespace(text=payload)])

        mocker.patch("app.biz.chat.service.get_skill_knowledge_context", return_value={"skills": [], "knowledge": []})
        generate_mock = mocker.patch("app.llmhubs.generate", return_value=generation)

        chat_service = ChatService.get_instance()
        response = await chat_service.generate_onboard_recommendation_tasks(
            GenerateOnboardRecommendationTasksRequest(project_id=10, agent_id="agent-1")
        )

        generate_mock.assert_awaited_once()
        assert response.code == 0
        assert response.data is not None
        assert [task.message for task in response.data.tasks] == ["Run the smoke test", "Review docs", "Draft plan"]
        assert [task.icon.value for task in response.data.tasks] == [2, 5, 4]

    def test_build_intent_attachments_converts_pb_attachments(self):
        attachments = ChatService._build_intent_attachments(
            [
                Attachment(
                    name="smoke_test.md",
                    uri="seaweed://smoke_test.md",
                    sas_url="http://example.test/smoke_test.md",
                    type="text",
                    size=1490,
                )
            ]
        )

        assert attachments == [
            SchemaAttachment(
                name="smoke_test.md",
                uri="seaweed://smoke_test.md",
                sas_url="http://example.test/smoke_test.md",
                type="text",
                size=1490,
            )
        ]

    @pytest.mark.asyncio
    async def test_generate_onboard_recommendation_tasks_rejects_wrong_task_count(self, mocker: pytest_mock.MockerFixture):
        payload = {
            "tasks": [
                {"message": "Run the smoke test", "icon": 2},
                {"message": "Review docs", "icon": 5},
            ]
        }
        generation = SimpleNamespace(outputs=[SimpleNamespace(text=json.dumps(payload))])

        mocker.patch("app.biz.chat.service.get_skill_knowledge_context", return_value={"skills": [], "knowledge": []})
        mocker.patch("app.llmhubs.generate", return_value=generation)

        chat_service = ChatService.get_instance()
        response = await chat_service.generate_onboard_recommendation_tasks(
            GenerateOnboardRecommendationTasksRequest(project_id=10, agent_id="agent-1")
        )

        assert response.code == 1
        assert response.msg == "Failed to validate LLM response"

    @pytest.mark.asyncio
    async def test_generate_onboard_recommendation_tasks_rejects_empty_task_content(self, mocker: pytest_mock.MockerFixture):
        payload = {
            "tasks": [
                {"message": " ", "icon": 2},
                {"message": "Review docs", "icon": 0},
                {"message": "Draft plan", "icon": 4},
            ]
        }
        generation = SimpleNamespace(outputs=[SimpleNamespace(text=json.dumps(payload))])

        mocker.patch("app.biz.chat.service.get_skill_knowledge_context", return_value={"skills": [], "knowledge": []})
        mocker.patch("app.llmhubs.generate", return_value=generation)

        chat_service = ChatService.get_instance()
        response = await chat_service.generate_onboard_recommendation_tasks(
            GenerateOnboardRecommendationTasksRequest(project_id=10, agent_id="agent-1")
        )

        assert response.code == 1
        assert response.msg == "Failed to validate LLM response"


def test_normalize_generated_conversation_title():
    assert ChatService._normalize_generated_title('```json\n{"title": " Run Demo Case "}\n```') == "Run Demo Case"
    assert ChatService._normalize_generated_title('"   Multi step Android validation   "') == "Multi step Android validation"


@pytest.mark.asyncio
async def test_generate_conversation_title_uses_prompt_file(mocker):
    captured = {}

    async def fake_generate(request):
        captured["instructions"] = request.instructions
        return SimpleNamespace(outputs=[SimpleNamespace(json=None, text="Complete Edge Android Regression Testing")])

    mocker.patch("app.llmhubs.generate", side_effect=fake_generate)
    runner = AsyncJobRunner(workers=1, max_queue=1)
    chat_service = ChatService(runner, runner, runner)

    try:
        title = await chat_service._generate_conversation_title("[]", model="gpt-test")

        assert title == "Complete Edge Android Regression Testing"
        assert "Generate a concise and professional task title" in captured["instructions"]
    finally:
        ChatService._instance = None


@pytest.mark.asyncio
async def test_try_update_conversation_title_calls_reverse_service(tmp_path, mocker):
    class FakeReverseConversationService:
        def __init__(self):
            self.calls = []

        def update_conversation_title(self, conversation_id: int, title: str) -> None:
            self.calls.append((conversation_id, title))

    runner = AsyncJobRunner(workers=1, max_queue=1)
    chat_service = ChatService(runner, runner, runner)
    fake_reverse = FakeReverseConversationService()
    mocker.patch("app.biz.reverse_grpc.conversation.ReverseConversationService.get_instance", return_value=fake_reverse)
    generate_mock = mocker.patch.object(chat_service, "_generate_conversation_title", return_value="Generated Demo Title")

    try:
        await chat_service._try_update_conversation_title(
            conversation_id=44,
            turn_id=33,
            user_prompt="Run the demo",
            model="gpt-test",
        )

        generate_mock.assert_awaited_once()
        assert fake_reverse.calls == [(44, "Generated Demo Title")]
    finally:
        ChatService._instance = None


def test_build_prior_conversation_section_uses_last_three_text_only_turns(monkeypatch):
    conversations = {
        1: json.dumps(
            [
                {"role": "user", "contents": [{"type": "text", "text": "Please analyze first"}]},
                {"role": "assistant", "contents": [{"type": "function_call", "name": "delegate"}]},
                {"role": "tool", "contents": [{"type": "function_result", "result": "secret tool result"}]},
                {"role": "assistant", "contents": [{"type": "text", "text": "I recommend task mode"}]},
            ]
        ),
        2: json.dumps([{"role": "user", "contents": [{"type": "text", "text": "Analyze first"}]}]),
        3: json.dumps([{"role": "assistant", "contents": [{"type": "text", "text": "Ready to run"}]}]),
        4: json.dumps([{"role": "user", "contents": [{"type": "text", "text": "Run it"}]}]),
    }
    monkeypatch.setattr(chat_service_module.CHAT_FS, "list_turn_ids", lambda *_args: [1, 2, 3, 4, 5])
    monkeypatch.setattr(
        chat_service_module.CHAT_FS,
        "read_conversation",
        lambda _aid, _user, turn_id, **_kwargs: conversations[turn_id],
    )

    section = chat_service_module._build_prior_conversation_section(1, "alice", 5, conversation_id=22)

    assert "Turn 1" not in section
    assert "Turn 2" in section
    assert "Turn 4" in section
    assert "function_call" not in section
    assert "secret tool result" not in section
