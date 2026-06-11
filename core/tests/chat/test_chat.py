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
from types import SimpleNamespace

import pytest
import pytest_asyncio
import pytest_mock
from agent_framework import ChatResponse, ChatResponseUpdate, Content

from app.biz.chat import service as chat_service_module
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
    async def test_experience_ingestion_skips_without_plan(self, mocker: pytest_mock.MockerFixture):
        mocker.patch("app.experiences.service.EXPERIENCES_ENABLED", True)
        read_plan_mock = mocker.patch("app.biz.chat.service.read_plan", return_value=None)
        read_conversation_mock = mocker.patch("app.biz.chat.service.CHAT_FS.read_conversation")

        chat_service = ChatService.get_instance()
        await chat_service._try_experience_playbook_ingestion(
            agent_instance_id=1,
            username="alice@example.com",
            turn_id=100,
            project_id=10,
            conversation_id=1000,
        )

        read_plan_mock.assert_awaited_once_with(
            agent_instance_id=1,
            turn_id=100,
            conversation_id=1000,
            username="alice@example.com",
        )
        read_conversation_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_experience_ingestion_runs_with_plan(self, mocker: pytest_mock.MockerFixture):
        trajectory = SimpleNamespace(task="Do the thing", total_steps=1, success=True)

        mocker.patch("app.experiences.service.EXPERIENCES_ENABLED", True)
        mocker.patch("app.biz.chat.service.read_plan", return_value=object())
        mocker.patch("app.biz.chat.service.CHAT_FS.read_conversation", return_value="{}")
        convert_mock = mocker.patch("app.experiences.adapter.convert_to_trajectory_data", return_value=trajectory)
        add_playbook_mock = mocker.patch("app.experiences.service.add_playbook", return_value={"skipped": False})

        chat_service = ChatService.get_instance()
        await chat_service._try_experience_playbook_ingestion(
            agent_instance_id=1,
            username="alice@example.com",
            turn_id=100,
            project_id=10,
            conversation_id=1000,
        )

        convert_mock.assert_awaited_once_with("{}")
        add_playbook_mock.assert_awaited_once_with(
            trajectory_data=trajectory,
            project_id=10,
            agent_instance_id=1,
            conversation_id=1000,
            turn_id=100,
        )

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
    monkeypatch.setattr(chat_service_module.CHAT_FS, "read_conversation", lambda _aid, _user, turn_id: conversations[turn_id])

    section = chat_service_module._build_prior_conversation_section(1, "alice", 5)

    assert "Turn 1" not in section
    assert "Turn 2" in section
    assert "Turn 4" in section
    assert "function_call" not in section
    assert "secret tool result" not in section
