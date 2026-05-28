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
import logging
import os
from contextlib import suppress
from pathlib import Path

import grpc

from dotenv import load_dotenv
from grpclib.client import Channel as GrpcLibChannel
from grpclib.config import Configuration
from grpclib.reflection.service import ServerReflection
from grpclib.server import Server

from app.biz.chat.service import ChatService
from app.biz.llm.service import LLMHubService
from app.biz.health.service import HealthService
from app.biz.knowledge import KnowledgeService
from app.biz.reverse_grpc.conversation import ReverseConversationService
from app.biz.reverse_grpc.knowledge import ReverseKnowledgeService
from app.biz.reverse_grpc.llmhubs import ReverseLLMHubService
from app.biz.reverse_grpc.sandbox import ReverseSandboxService
from app.biz.skill import SkillService
from app.memory.mem0 import init_shared_mem0
from app.schemas import consts
from app.storage.redis import init_shared_redis
from app.utils.cache import Cache
from app.utils.runner import AsyncJobRunner

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logging.basicConfig(
    level=os.getenv("LOGLEVEL", "INFO").upper(),
    force=True
)

_LOGGER = logging.getLogger(__name__)


async def serve():
    # Initialize and start job runner
    runner = AsyncJobRunner(workers=16, max_queue=200)

    # redis
    redis_host = os.getenv("REDIS_HOST", "localhost")
    redis_port = os.getenv("REDIS_PORT", "6379")
    redis_password = os.getenv("REDIS_PASSWORD", "")
    redis_url = f"redis://{redis_host}:{redis_port}"
    if redis_password:
        redis_url = f"redis://:{redis_password}@{redis_host}:{redis_port}"
    # Connect to backend's reverse gRPC server.
    reverse_grpc_address = os.getenv("REVERSE_GRPC_ADDRESS", "localhost:50054")
    reverse_channel = grpc.insecure_channel(reverse_grpc_address, options=[
        ("grpc.max_send_message_length", consts.GRPC_MAX_SEND_MESSAGE_LENGTH),
        ("grpc.max_receive_message_length", consts.GRPC_MAX_RECV_MESSAGE_LENGTH),
    ])

    # Initialize reverse gRPC services (core → backend callbacks).
    ReverseConversationService.get_instance().initialize(reverse_channel)
    ReverseKnowledgeService.get_instance().initialize(reverse_channel)
    ReverseLLMHubService.get_instance().initialize(reverse_channel)
    ReverseSandboxService.get_instance().initialize(reverse_channel)

    server = grpc.aio.server()

    await init_shared_redis(redis_url)
    await runner.start()
    mem0_filepath = Path(__file__).resolve().parent.parent / "config" / "mem0" / "mem0_config.yaml"
    await init_shared_mem0(mem0_filepath)

    # Initialize cache singleton
    _ = Cache(redis_url)

    # connect to reverse gRPC server
    reverse_grpc_address = os.getenv("REVERSE_GRPC_ADDRESS", "localhost:50054")
    reverse_channel = grpc.insecure_channel(reverse_grpc_address, options=[
        ("grpc.max_send_message_length", consts.GRPC_MAX_SEND_MESSAGE_LENGTH),
        ("grpc.max_receive_message_length", consts.GRPC_MAX_RECV_MESSAGE_LENGTH),
    ])

    # initialize reverse services
    ReverseKnowledgeService.get_instance().initialize(reverse_channel)
    ReverseLLMHubService.get_instance().initialize(reverse_channel)
    ReverseConversationService.get_instance().initialize(reverse_channel)

    # connect to shared gRPC service
    shared_grpc_address = os.getenv("SHARED_GRPC_ADDRESS", "localhost:50052")
    shared_host, shared_port = shared_grpc_address.split(":")
    # Configure grpclib for large message support
    # Increase window sizes to handle messages larger than default 4MB
    client_config = Configuration(
        http2_connection_window_size=consts.GRPC_HTTP2_CONNECTION_WINDOW_SIZE,
        http2_stream_window_size=consts.GRPC_HTTP2_CONNECTION_WINDOW_SIZE,
    )
    shared_channel = GrpcLibChannel(shared_host, int(shared_port), config=client_config)

    services = [
        HealthService(),
        ChatService(runner, runner, runner),
        LLMHubService(),
        KnowledgeService(),
        SkillService(),
    ]

    services = ServerReflection.extend(services)
    # Configure grpclib for large message support
    # Increase window sizes to handle messages larger than default 4MB
    server_config = Configuration(
        http2_connection_window_size=consts.GRPC_HTTP2_CONNECTION_WINDOW_SIZE,
        http2_stream_window_size=consts.GRPC_HTTP2_CONNECTION_WINDOW_SIZE,
    )
    server = Server(services, config=server_config)

    server_address = os.getenv("GRPC_SERVER_ADDRESS", "localhost:50053")
    host, port = server_address.split(":")
    _LOGGER.info("Starting gRPC server at %s...", server_address)

    await server.start(host, int(port))
    try:
        await server.wait_closed()
    except asyncio.CancelledError:
        _LOGGER.info("gRPC server cancelled, shutting down...")
    finally:
        server.close()
        with suppress(asyncio.CancelledError):
            await server.wait_closed()
        shared_channel.close()
        await runner.close()

if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        _LOGGER.info("Server interrupted by user, exiting...")
