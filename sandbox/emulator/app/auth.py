from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, WebSocket, status

from app.settings import Settings


def is_valid_sandbox_service_token(token: str) -> bool:
    return len(token) == 64 and all(char in "0123456789abcdef" for char in token)


def _is_valid_bearer(authorization: str | None, token: str) -> bool:
    if not authorization or not token:
        return False
    scheme, separator, credential = authorization.partition(" ")
    return (
        separator == " "
        and scheme.lower() == "bearer"
        and secrets.compare_digest(credential.encode(), token.encode())
    )


def require_emulator_token(request: Request, settings: Settings) -> None:
    if not _is_valid_bearer(
        request.headers.get("Authorization"),
        settings.sico_sandbox_service_token,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid emulator service credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_emulator_websocket_token(
    websocket: WebSocket,
    settings: Settings,
) -> bool:
    if _is_valid_bearer(
        websocket.headers.get("Authorization"),
        settings.sico_sandbox_service_token,
    ):
        return True
    await websocket.close(code=4401, reason="invalid emulator service credentials")
    return False
