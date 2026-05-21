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
from types import SimpleNamespace

import pytest
import pytest_asyncio
import pytest_mock
from agent_framework import ChatResponse, ChatResponseUpdate, Content

from app.biz.chat.service import ChatService
from app.pb.conversation.chat import ChatContent, ChatContentType
from app.pb.conversation.api import ChatRequest
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
        _ = await chat_service.stream_chat(ChatRequest(
            username="alice@example.com",
            message=ChatContent(
                type=ChatContentType.TEXT,
                content="Hello"
            )
        ))

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
