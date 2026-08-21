from app.pb.health.health import (
    HealthServiceBase,
    HealthCheckRequest,
    HealthCheckResponse
)

class HealthService(HealthServiceBase):
    _instance: "HealthService" = None

    def __init__(self):
        if HealthService._instance is not None:
            raise Exception("This class is a singleton!")
        else:
            HealthService._instance = self

    @staticmethod
    def get_instance():
        if HealthService._instance is None:
            HealthService()
        return HealthService._instance

    async def check(self, _: HealthCheckRequest) -> HealthCheckResponse:
        return HealthCheckResponse(message="ok")
