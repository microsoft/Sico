from unittest.mock import Mock

from app.biz.reverse_grpc.sandbox import (
    LinuxWorkstationSandboxHttpFormField,
    ReverseSandboxService,
)
from app.pb.sandbox import reverse_rpc as pb


def test_reverse_service_initializes_client() -> None:
    service = ReverseSandboxService()
    channel = Mock()

    service.initialize(channel)

    assert service.stub is not None


def test_linux_workstation_proxy_client_maps_request_and_response() -> None:
    service = ReverseSandboxService()
    service.stub = Mock()
    service.stub.rpc_proxy_linux_workstation_sandbox_http.return_value = pb.LinuxWorkstationSandboxHttpResponse(
        status_code=201,
        content_type="application/json",
        body_text='{"ok":true}',
        body_bytes=b'{"ok":true}',
        code=0,
        msg="success",
    )

    result = service.proxy_linux_workstation_http(
        agent_instance_id="instance-1",
        proxy_base_path="/api/sico/sandbox/resources/linux_workstation/resource-1/",
        method="POST",
        path="/v1/upload",
        query={"replace": True},
        form_fields=[LinuxWorkstationSandboxHttpFormField(name="file", bytes_value=b"data", file_name="data.txt")],
    )

    assert result.status_code == 201
    assert result.body_bytes == b'{"ok":true}'
    request = service.stub.rpc_proxy_linux_workstation_sandbox_http.call_args.args[0]
    assert request.agent_instance_id == "instance-1"
    assert request.form_fields[0].file_name == "data.txt"
