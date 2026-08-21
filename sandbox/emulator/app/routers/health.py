from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check(request: Request):
    if getattr(request.app.state, "backend_ready", True):
        return {"status": "ok"}

    detail = getattr(request.app.state, "backend_error", "emulator backend is not ready")
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "error", "detail": detail},
    )
