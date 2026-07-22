# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
import pytest_asyncio
import pytest_mock
from agent_framework import ChatResponse, ChatResponseUpdate, Content, Message as AgentFrameworkMessage

from app.biz.chat import chat as chat_agent_module
from app.biz.chat import service as chat_service_module
from app.biz.chat.chat import ChatAgent, RunOptions, _extract_text_from_message
from app.biz.chat.conversation_history import complete_unfinished_tool_calls, discard_unfinished_tool_calls
from app.biz.chat.service import ChatService
from app.pb.common.common import Attachment
from app.pb.conversation.chat import ChatContent, ChatContentType
from app.pb.conversation.api import ChatRequest, GenerateOnboardRecommendationTasksRequest
from app.schemas.common.common import Attachment as SchemaAttachment
from app.schemas.conversation.chat import TopicMessage
from app.schemas.conversation import Message
from app.storage import redis
from app.tools.common import ToolContext
from app.tools.plan import PlanEditor
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


async def build_fake_agent(*args, **kwargs):
    return FakeChatAgent()


class FailingStreamingClient:
    _model = "gpt-test"

    def __init__(self):
        self.calls = 0

    async def get_response(self, *args, **kwargs):
        self.calls += 1
        raise RuntimeError("dns down")
        yield ChatResponseUpdate(role="assistant", contents=[Content.from_text("unreachable")])


class PausingToolStreamingClient:
    _model = "gpt-test"

    def __init__(self):
        self.call_processed = asyncio.Event()
        self.release_result = asyncio.Event()

    async def get_response(self, *args, **kwargs):
        yield ChatResponseUpdate(
            role="assistant",
            contents=[Content(type="function_call", call_id="call-1", name="read", arguments="{}")],
        )
        self.call_processed.set()
        await self.release_result.wait()
        yield ChatResponseUpdate(
            role="tool",
            contents=[Content(type="function_result", call_id="call-1", result="done")],
        )


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


@asynccontextmanager
async def _unlocked_plan(*_args, **_kwargs):
    yield


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
    async def test_hard_fast_route_skips_intent_check_and_uses_fast_model(
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
        intent_mock = mocker.patch("app.biz.chat.service.llm_intent_check")
        mocker.patch.object(ReverseConversationService, "get_instance", return_value=FakeConversationService.get_instance())
        mocker.patch.object(EventBus, "get_instance", return_value=MockEventBus())

        chat_service = ChatService.get_instance()
        chat_service._event_bus_topic_name = "test-topic"
        await chat_service.stream_chat(
            ChatRequest(username="alice@example.com", message=ChatContent(type=ChatContentType.TEXT, content="hello"))
        )

        intent_mock.assert_not_called()
        assert captured["model"] == "gpt-fast-test"

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


@pytest.mark.asyncio
async def test_chat_agent_persists_conversation_json_for_pre_stream_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(chat_agent_module.CHAT_FS, "_root", tmp_path)
    monkeypatch.setattr(chat_agent_module, "get_context_length", lambda _model: 128_000)
    client = FailingStreamingClient()
    agent = ChatAgent(
        client=client,
        username="alice@example.com",
        agent_instance_id=7,
        mem_runner=SimpleNamespace(),
        tool_context=ToolContext(
            username="alice@example.com",
            agent_id="agent-1",
            agent_instance_id=7,
            turn_id=33,
            project_id=1,
            conversation_id=44,
            response_queue=asyncio.Queue(),
            plan_editor=PlanEditor(7, "alice@example.com", 33, conversation_id=44),
        ),
    )
    queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None] = asyncio.Queue()

    with pytest.raises(RuntimeError, match="dns down"):
        await agent.run_stream(
            queue,
            AgentFrameworkMessage(role="user", contents=[Content.from_text("Help me run this demo case")]),
            "",
            options=RunOptions(turn_id=33, max_attempts=2, save_history=True),
        )

    responses = []
    while not queue.empty():
        responses.append(queue.get_nowait())

    assert client.calls == 2
    assert responses[-1] is None
    assert responses[0].content.content == "Error with chat agent attempt 1/2: dns down"
    assert responses[1].content.content == "Error with chat agent attempt 2/2: dns down"

    conversation_json = chat_agent_module.CHAT_FS.read_conversation(7, "alice@example.com", 33, conversation_id=44)
    assert conversation_json is not None
    messages = json.loads(conversation_json)
    assert [message["role"] for message in messages] == ["user", "assistant", "assistant"]
    assert messages[0]["contents"][0]["text"] == "Help me run this demo case"
    assert messages[1]["contents"][0]["text"] == "Error with chat agent attempt 1/2: dns down"
    assert messages[2]["contents"][0]["text"] == "Error with chat agent attempt 2/2: dns down"


@pytest.mark.asyncio
async def test_cancel_plan_leaves_tool_call_completion_to_chat_writer(tmp_path, mocker: pytest_mock.MockerFixture):
    from app.storage.fs import ChatFS
    from app.tools import plan as plan_module

    chat_fs = ChatFS(tmp_path)
    mocker.patch.object(chat_agent_module, "CHAT_FS", chat_fs)
    mocker.patch.object(plan_module, "CHAT_FS", chat_fs)
    mocker.patch.object(plan_module, "_plan_lock", _unlocked_plan)

    tool_call = AgentFrameworkMessage(
        role="assistant",
        contents=[Content(type="function_call", call_id="call-1", name="read", arguments="{}")],
    )
    agent = ChatAgent(
        client=FailingStreamingClient(),
        username="alice@example.com",
        agent_instance_id=7,
        mem_runner=SimpleNamespace(),
        tool_context=ToolContext(
            username="alice@example.com",
            agent_id="agent-1",
            agent_instance_id=7,
            turn_id=33,
            project_id=1,
            conversation_id=44,
            response_queue=asyncio.Queue(),
            plan_editor=PlanEditor(7, "alice@example.com", 33, conversation_id=44),
        ),
    )
    user_message = AgentFrameworkMessage(role="user", contents=[Content.from_text("read")])
    dangling_response = ChatResponse(messages=[tool_call])

    await agent.persist_turn(user_message, dangling_response, 33)
    before_cancel = chat_fs.read_conversation(7, "alice@example.com", 33, conversation_id=44)
    await plan_module.cancel_plan(7, "alice@example.com", 33, 44)
    after_cancel = chat_fs.read_conversation(7, "alice@example.com", 33, conversation_id=44)

    assert after_cancel == before_cancel
    assert not any(
        content.get("type") == "function_result"
        for message in json.loads(after_cancel)
        for content in message.get("contents", [])
    )

    await agent.persist_turn(user_message, dangling_response, 33)

    raw = chat_fs.read_conversation(7, "alice@example.com", 33, conversation_id=44)
    contents = [content for message in json.loads(raw) for content in message.get("contents", [])]
    matching_results = [
        content for content in contents if content.get("type") == "function_result" and content.get("call_id") == "call-1"
    ]
    assert matching_results == [{"type": "function_result", "call_id": "call-1", "result": "Cancelled by user"}]


@pytest.mark.asyncio
async def test_chat_stream_persists_and_completes_tool_call_after_cancel(tmp_path, mocker: pytest_mock.MockerFixture):
    from app.storage.fs import ChatFS
    from app.tools import plan as plan_module

    chat_fs = ChatFS(tmp_path)
    mocker.patch.object(chat_agent_module, "CHAT_FS", chat_fs)
    mocker.patch.object(plan_module, "CHAT_FS", chat_fs)
    mocker.patch.object(chat_agent_module, "CHECK_CANCELLED_PLAN_INTERVAL_SECONDS", -1)
    client = PausingToolStreamingClient()
    agent = ChatAgent(
        client=client,
        username="alice@example.com",
        agent_instance_id=7,
        mem_runner=SimpleNamespace(),
        tool_context=ToolContext(
            username="alice@example.com",
            agent_id="agent-1",
            agent_instance_id=7,
            turn_id=33,
            project_id=1,
            conversation_id=44,
            response_queue=asyncio.Queue(),
            plan_editor=PlanEditor(7, "alice@example.com", 33, conversation_id=44),
        ),
    )
    queue: asyncio.Queue[ChatResponse | ChatResponseUpdate | None] = asyncio.Queue()
    stream_task = asyncio.create_task(
        agent.run_stream(
            queue,
            AgentFrameworkMessage(role="user", contents=[Content.from_text("read")]),
            "",
            options=RunOptions(turn_id=33, save_history=True),
        )
    )

    await asyncio.wait_for(client.call_processed.wait(), timeout=1)
    raw = chat_fs.read_conversation(7, "alice@example.com", 33, conversation_id=44)
    contents = [content for message in json.loads(raw) for content in message.get("contents", [])]
    assert any(content.get("type") == "function_call" and content.get("call_id") == "call-1" for content in contents)
    assert not any(content.get("type") == "function_result" for content in contents)

    chat_fs.plan.write_cancelled_marker(7, "alice@example.com", 33, conversation_id=44)
    client.release_result.set()
    await stream_task

    raw = chat_fs.read_conversation(7, "alice@example.com", 33, conversation_id=44)
    contents = [content for message in json.loads(raw) for content in message.get("contents", [])]
    matching_results = [
        content for content in contents if content.get("type") == "function_result" and content.get("call_id") == "call-1"
    ]
    assert matching_results == [{"type": "function_result", "call_id": "call-1", "result": "Cancelled by user"}]


@pytest.mark.asyncio
async def test_chat_agent_loads_recent_history_from_conversation_id(tmp_path, monkeypatch):
    monkeypatch.setattr(chat_agent_module.CHAT_FS, "_root", tmp_path)
    monkeypatch.setattr(chat_agent_module, "get_context_length", lambda _model: 128_000)
    chat_agent_module.CHAT_FS.write_conversation(
        7,
        "alice@example.com",
        1,
        json.dumps(
            [
                {"role": "user", "contents": [{"type": "text", "text": "my favorite food is pizza"}]},
                {"role": "assistant", "contents": [{"type": "text", "text": "noted pizza"}]},
            ]
        ),
        conversation_id=44,
    )
    chat_agent_module.CHAT_FS.write_conversation(
        7,
        "alice@example.com",
        1,
        json.dumps(
            [
                {"role": "user", "contents": [{"type": "text", "text": "my favorite food is sushi"}]},
                {"role": "assistant", "contents": [{"type": "text", "text": "noted sushi"}]},
            ]
        ),
        conversation_id=0,
    )
    agent = ChatAgent(
        client=FailingStreamingClient(),
        username="alice@example.com",
        agent_instance_id=7,
        mem_runner=SimpleNamespace(),
        tool_context=ToolContext(
            username="alice@example.com",
            agent_id="agent-1",
            agent_instance_id=7,
            turn_id=2,
            project_id=1,
            conversation_id=44,
            response_queue=asyncio.Queue(),
            plan_editor=PlanEditor(7, "alice@example.com", 2, conversation_id=44),
        ),
    )

    history = await agent._load_recent_history()
    history_text = "\n".join(_extract_text_from_message(message) for message in history)

    assert "my favorite food is pizza" in history_text
    assert "noted pizza" in history_text
    assert "sushi" not in history_text


@pytest.mark.asyncio
async def test_chat_agent_discards_unfinished_tool_calls_from_history(tmp_path, mocker: pytest_mock.MockerFixture):
    from app.storage.fs import ChatFS

    chat_fs = ChatFS(tmp_path)
    mocker.patch.object(chat_agent_module, "CHAT_FS", chat_fs)
    mocker.patch.object(chat_agent_module, "get_context_length", return_value=128_000)
    chat_fs.write_conversation(
        7,
        "alice@example.com",
        1,
        json.dumps(
            [
                {"role": "user", "contents": [{"type": "text", "text": "run both"}]},
                {
                    "role": "assistant",
                    "contents": [
                        {"type": "text", "text": "starting"},
                        {"type": "function_call", "call_id": "call-1", "name": "read"},
                        {"type": "function_call", "call_id": "call-2", "name": "write"},
                    ],
                },
                {
                    "role": "tool",
                    "contents": [{"type": "function_result", "call_id": "call-1", "result": "done"}],
                },
            ]
        ),
        conversation_id=44,
    )
    agent = ChatAgent(
        client=FailingStreamingClient(),
        username="alice@example.com",
        agent_instance_id=7,
        mem_runner=SimpleNamespace(),
        tool_context=ToolContext(
            username="alice@example.com",
            agent_id="agent-1",
            agent_instance_id=7,
            turn_id=2,
            project_id=1,
            conversation_id=44,
            response_queue=asyncio.Queue(),
            plan_editor=PlanEditor(7, "alice@example.com", 2, conversation_id=44),
        ),
    )

    history = await agent._load_recent_history()
    contents = [content for message in history for content in message.contents or []]

    assert any(content.type == "text" and content.text == "starting" for content in contents)
    assert any(content.type == "function_call" and content.call_id == "call-1" for content in contents)
    assert not any(content.type == "function_call" and content.call_id == "call-2" for content in contents)


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
