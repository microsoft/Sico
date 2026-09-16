from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import is_valid_sandbox_service_token, require_emulator_token
from app.deps import init_device_index_map, get_device_index_map, _make_mumu
from app.routers import devices, emulators, health, vnc
from app.settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    if not is_valid_sandbox_service_token(settings.sico_sandbox_service_token):
        raise RuntimeError(
            "SICO_SANDBOX_SERVICE_TOKEN must be exactly 64 lowercase hexadecimal characters"
        )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            mumu = _make_mumu(settings)
        except Exception as exc:
            _app.state.backend_ready = False
            _app.state.backend_error = str(exc)
            logging.getLogger(__name__).warning("Emulator backend is not ready: %s", exc)
        else:
            _app.state.backend_ready = True
            _app.state.backend_error = ""

            try:
                init_device_index_map(settings, mumu)
            except Exception as exc:
                logging.getLogger(__name__).warning("Failed to load device index map: %s", exc)

            # If port-forward rules exist from a prior session, re-sync them
            # with current device ADB ports (which may have changed on restart).
            try:
                emulators.sync_port_forwards_on_startup(mumu, get_device_index_map())
            except Exception as exc:
                logging.getLogger(__name__).warning("Failed to sync port forwards on startup: %s", exc)

        yield

    app = FastAPI(title="Emulator Remote API", version="0.2.0", lifespan=lifespan)
    app.state.backend_ready = False
    app.state.backend_error = "service starting"

    @app.middleware("http")
    async def authenticate_service(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        try:
            require_emulator_token(request, settings)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )
        return await call_next(request)

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type"],
        )

    app.include_router(health.router)
    app.include_router(
        emulators.router,
        prefix=settings.api_prefix,
    )

    app.include_router(
        devices.router,
        prefix=settings.api_prefix,
    )

    # VNC router for noVNC-style remote viewing
    app.include_router(vnc.router)

    return app


app = create_app()

_LOGGER = logging.getLogger(__name__)


async def serve() -> None:
    settings = get_settings()
    config = uvicorn.Config(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        _LOGGER.info("Server interrupted by user, exiting...")
