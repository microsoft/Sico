from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.tools import report, upload_assets


def test_upload_file_uses_azure_blob_when_selected(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "report.md"
    source.write_text("report body", encoding="utf-8")

    blob_client = MagicMock()
    container_client = MagicMock()
    container_client.get_blob_client.return_value = blob_client
    monkeypatch.setenv("STORAGE_TYPE", "azure_blob")
    monkeypatch.setenv("AZURE_BLOB_ENDPOINT", "https://dwpstorageeus2.blob.core.windows.net/")
    monkeypatch.setenv("AZURE_BLOB_CONTAINER", "test")
    monkeypatch.setenv("AZURE_BLOB_CDN_ENDPOINT", "https://cdn.example/")
    monkeypatch.setattr(upload_assets, "_get_azure_blob_client", lambda _endpoint, _container: container_client)
    monkeypatch.setattr(upload_assets.uuid, "uuid4", lambda: SimpleNamespace(hex="abc123"))

    result = upload_assets.upload_file(source, 42)

    container_client.get_blob_client.assert_called_once_with("default_space/42/abc123.md")
    upload_args, upload_kwargs = blob_client.upload_blob.call_args
    assert upload_args == (b"report body",)
    assert upload_kwargs["overwrite"] is True
    assert upload_kwargs["content_settings"].content_type == "text/markdown"
    assert result == {
        "cdn_url": "https://cdn.example/test/default_space/42/abc123.md",
        "blob_path": "default_space/42/abc123.md",
        "object_key": "abc123.md",
        "file_name": "report.md",
        "size_bytes": 11,
    }


def test_upload_file_uses_seaweedfs_when_selected(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "report.md"
    source.write_text("report body", encoding="utf-8")
    response = SimpleNamespace(status_code=201, text="")
    post_file = MagicMock(return_value=response)
    monkeypatch.setenv("STORAGE_TYPE", "seaweedfs")
    monkeypatch.setenv("SEAWEEDFS_ENDPOINT", "http://seaweedfs-filer:14003/")
    monkeypatch.setattr(upload_assets, "post_file", post_file)
    monkeypatch.setattr(upload_assets.uuid, "uuid4", lambda: SimpleNamespace(hex="abc123"))

    result = upload_assets.upload_file(source, 42)

    post_file.assert_called_once_with(
        "http://seaweedfs-filer:14003/default_space/42/abc123.md",
        file_name="abc123.md",
        data=b"report body",
        content_type="text/markdown",
        timeout=60,
    )
    assert result == {
        "cdn_url": "http://seaweedfs-filer:14003/default_space/42/abc123.md",
        "blob_path": "default_space/42/abc123.md",
        "object_key": "abc123.md",
        "file_name": "report.md",
        "size_bytes": 11,
    }


def test_upload_file_requires_azure_blob_cdn_endpoint(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "report.md"
    source.write_text("report body", encoding="utf-8")
    monkeypatch.setenv("STORAGE_TYPE", "azure_blob")
    monkeypatch.setenv("AZURE_BLOB_ENDPOINT", "https://storage.example/")
    monkeypatch.setenv("AZURE_BLOB_CONTAINER", "test")
    monkeypatch.delenv("AZURE_BLOB_CDN_ENDPOINT", raising=False)

    try:
        upload_assets.upload_file(source, 42)
    except RuntimeError as exc:
        assert str(exc) == "AZURE_BLOB_ENDPOINT, AZURE_BLOB_CONTAINER, and AZURE_BLOB_CDN_ENDPOINT must be set"
    else:
        raise AssertionError("Azure Blob upload accepted a missing CDN endpoint")


def test_upload_file_rejects_unknown_storage_type(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "report.md"
    source.write_text("report body", encoding="utf-8")
    monkeypatch.setenv("STORAGE_TYPE", "unknown")

    try:
        upload_assets.upload_file(source, 42)
    except RuntimeError as exc:
        assert str(exc) == "unknown STORAGE_TYPE: unknown"
    else:
        raise AssertionError("unknown storage type was accepted")


def test_report_uses_configured_storage_uploader() -> None:
    assert report.upload_file is upload_assets.upload_file
