import asyncio
import logging
import os
import signal
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path

import grpc

from dotenv import load_dotenv
from grpclib.client import Channel as GrpcLibChannel
from grpclib.config import Configuration
from grpclib.reflection.service import ServerReflection
from grpclib.server import Server

from app.biz.chat.service import ChatService
from app.biz.task_runtime import default_agent_profile_resolver, run_task_runtime_startup_reconciler
from app.biz.task_runtime.events.subscribers import register_default_subscribers
from app.biz.llm.service import LLMHubService
from app.biz.health.service import HealthService
from app.biz.knowledge import KnowledgeService
from app.biz.reverse_grpc.auth_state import ReverseAuthStateService
from app.biz.reverse_grpc.case_replay import ReverseCaseReplayService
from app.biz.reverse_grpc.conversation import ReverseConversationService
from app.biz.reverse_grpc.knowledge import ReverseKnowledgeService
from app.biz.reverse_grpc.llmhubs import ReverseLLMHubService
from app.biz.reverse_grpc.sandbox import ReverseSandboxService
from app.biz.reverse_grpc.taskruntime import ReverseTaskRuntimeService
from app.biz.skill import SkillService
from app.memory.mem0 import init_shared_mem0
from app.schemas import consts
from app.storage.redis import init_shared_redis
from app.storage.sandbox_pod import delete_tracked_sandbox_pods, run_sandbox_pod_reaper
from app.utils.cache import Cache
from app.utils.otel import instrument_grpclib_services, setup_otel
from app.utils.redis_config import redis_url_from_environment
from app.utils.runner import AsyncJobRunner

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logging.basicConfig(level=os.getenv("LOGLEVEL", "INFO").upper(), force=True)

_LOGGER = logging.getLogger(__name__)


async def serve():
    # Validate the immutable profile catalog before initializing process resources.
    default_agent_profile_resolver()
    shutdown_event, otel_shutdown = _initialize_process_runtime()
    # Initialize and start job runner
    runner = AsyncJobRunner(workers=16, max_queue=200)
    task_runtime_stop = asyncio.Event()
    task_runtime_reconciler: asyncio.Task[None] | None = None
    sandbox_pod_reaper: asyncio.Task[None] | None = None

    # redis
    redis_url = redis_url_from_environment()
    server = grpc.aio.server()

    await init_shared_redis(redis_url)
    await runner.start()
    await init_shared_mem0(_resolve_mem0_config_path())

    # Register built-in task_runtime event-bus subscribers (audit log,
    # in-process metrics). Must happen before the reconciler / gRPC server
    # start so the first state transition is observed.
    register_default_subscribers()

    # Initialize cache singleton
    _ = Cache(redis_url)

    # connect to reverse gRPC server
    reverse_grpc_address = os.getenv("REVERSE_GRPC_ADDRESS", "localhost:50054")
    reverse_channel = grpc.insecure_channel(
        reverse_grpc_address,
        options=[
            ("grpc.max_send_message_length", consts.GRPC_MAX_SEND_MESSAGE_LENGTH),
            ("grpc.max_receive_message_length", consts.GRPC_MAX_RECV_MESSAGE_LENGTH),
        ],
    )

    # initialize reverse services
    ReverseKnowledgeService.get_instance().initialize(reverse_channel)
    ReverseLLMHubService.get_instance().initialize(reverse_channel)
    ReverseConversationService.get_instance().initialize(reverse_channel)
    ReverseSandboxService.get_instance().initialize(reverse_channel)
    ReverseTaskRuntimeService.get_instance().initialize(reverse_channel)
    ReverseAuthStateService.get_instance().initialize(reverse_channel)
    ReverseCaseReplayService.get_instance().initialize(reverse_channel)
    _initialize_private_sandbox(reverse_channel)

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

    services = instrument_grpclib_services(services)
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

    try:
        task_runtime_reconciler = asyncio.create_task(run_task_runtime_startup_reconciler(task_runtime_stop))
        sandbox_pod_reaper = asyncio.create_task(run_sandbox_pod_reaper(task_runtime_stop))
        await server.start(host, int(port))
        await _wait_for_server_shutdown(server, shutdown_event)
    except asyncio.CancelledError:
        _LOGGER.info("gRPC server cancelled, shutting down...")
    finally:
        await _stop_task_runtime_reconciler(task_runtime_stop, task_runtime_reconciler)
        await _stop_sandbox_pod_reaper(sandbox_pod_reaper)
        server.close()
        with suppress(asyncio.CancelledError):
            await server.wait_closed()
        reverse_channel.close()
        shared_channel.close()
        await runner.close()
        otel_shutdown()


def _initialize_process_runtime() -> tuple[asyncio.Event, Callable[[], None]]:
    shutdown_event = asyncio.Event()
    _install_shutdown_handlers(shutdown_event)
    return shutdown_event, setup_otel("sico-core")


def _resolve_mem0_config_path() -> Path:
    application_root = Path(__file__).resolve().parent.parent
    packaged = application_root / "config" / "mem0" / "mem0_config.yaml"
    if packaged.exists():
        return packaged
    return application_root.parent / "deploy" / "config" / "mem0" / "mem0_config.yaml"


def _initialize_private_sandbox(reverse_grpc_channel: grpc.Channel) -> None:
    try:
        from app.biz.private_sandbox.service import ReversePrivateSandboxService
    except ModuleNotFoundError as exc:
        if exc.name != "app.biz.private_sandbox":
            raise
    else:
        ReversePrivateSandboxService.get_instance().initialize(reverse_grpc_channel)


def _install_shutdown_handlers(shutdown_event: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, shutdown_event.set)
        except (NotImplementedError, RuntimeError, ValueError):
            pass


async def _wait_for_server_shutdown(server: Server, shutdown_event: asyncio.Event) -> None:
    wait_closed_task = asyncio.create_task(server.wait_closed())
    shutdown_task = asyncio.create_task(shutdown_event.wait())
    try:
        done, pending = await asyncio.wait(
            {wait_closed_task, shutdown_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if shutdown_task in done:
            _LOGGER.info("gRPC server shutdown requested")
            server.close()
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(wait_closed_task, timeout=30)
        for task in pending:
            task.cancel()
    finally:
        for task in (wait_closed_task, shutdown_task):
            if not task.done():
                task.cancel()
        with suppress(asyncio.CancelledError):
            await asyncio.gather(wait_closed_task, shutdown_task)


async def _stop_task_runtime_reconciler(
    task_runtime_stop: asyncio.Event,
    task_runtime_reconciler: asyncio.Task[None] | None,
) -> None:
    task_runtime_stop.set()
    if task_runtime_reconciler is None:
        return
    with suppress(asyncio.TimeoutError):
        await asyncio.wait_for(task_runtime_reconciler, timeout=5)


async def _stop_sandbox_pod_reaper(sandbox_pod_reaper: asyncio.Task[None] | None) -> None:
    # ``task_runtime_stop`` is shared and already set by the reconciler stop, so
    # the reaper loop is on its way out; just bound the wait. Then best-effort
    # delete the pods this process created so a rolling deploy reclaims them at
    # once instead of leaning on the activeDeadline / reaper backstops.
    if sandbox_pod_reaper is not None:
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(sandbox_pod_reaper, timeout=5)
    with suppress(Exception):
        deleted = await asyncio.wait_for(delete_tracked_sandbox_pods(), timeout=10)
        if deleted:
            _LOGGER.info("deleted %d in-flight sandbox pod(s) on shutdown", deleted)


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        _LOGGER.info("Server interrupted by user, exiting...")
