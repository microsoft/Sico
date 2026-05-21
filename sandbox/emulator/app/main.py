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

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import devices, emulators, health, vnc
from app.deps import init_device_index_map, get_device_index_map, _make_mumu
from app.settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()

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

    # CORS — configurable via CORS_ORIGINS env var (default: allow all)
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
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
