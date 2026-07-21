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

"""Tests for ToolDeliverableFile and ToolDeliverable schema round-trip serialization."""

import app.pb.conversation.plan as pb
from app.schemas.conversation.plan import (
    ToolDeliverable,
    ToolDeliverableFile,
    ToolDeliverableType,
)


class TestToolDeliverableFile:
    def test_from_pb(self):
        pb_obj = pb.ToolDeliverableFile()
        pb_obj.file_sas_url = "https://blob.example.com/sas/report.pdf"
        pb_obj.file_name = "report.pdf"
        pb_obj.file_uri = "assets/report.pdf"

        result = ToolDeliverableFile.from_pb(pb_obj)
        assert result.file_sas_url == "https://blob.example.com/sas/report.pdf"
        assert result.file_name == "report.pdf"
        assert result.file_uri == "assets/report.pdf"

    def test_to_pb(self):
        obj = ToolDeliverableFile(
            file_sas_url="https://blob.example.com/sas/report.pdf",
            file_name="report.pdf",
            file_uri="assets/report.pdf",
        )
        pb_obj = obj.to_pb()
        assert pb_obj.file_sas_url == "https://blob.example.com/sas/report.pdf"
        assert pb_obj.file_name == "report.pdf"
        assert pb_obj.file_uri == "assets/report.pdf"

    def test_round_trip(self):
        original = ToolDeliverableFile(
            file_sas_url="https://example.com/sas",
            file_name="data.csv",
            file_uri="assets/data.csv",
        )
        restored = ToolDeliverableFile.from_pb(original.to_pb())
        assert restored == original

    def test_defaults(self):
        obj = ToolDeliverableFile()
        assert obj.file_sas_url == ""
        assert obj.file_name == ""
        assert obj.file_uri == ""

    def test_alias_serialization(self):
        obj = ToolDeliverableFile(
            file_sas_url="https://example.com/sas",
            file_name="f.txt",
            file_uri="assets/f.txt",
        )
        data = obj.model_dump(by_alias=True)
        assert "fileSasUrl" in data
        assert "fileName" in data
        assert "fileUri" in data


class TestToolDeliverable:
    def test_file_deliverable_round_trip(self):
        original = ToolDeliverable(
            type=ToolDeliverableType.FILE,
            file=ToolDeliverableFile(
                file_sas_url="https://blob.example.com/sas/report.pdf",
                file_name="report.pdf",
                file_uri="assets/report.pdf",
            ),
        )
        pb_obj = original.to_pb()
        restored = ToolDeliverable.from_pb(pb_obj)

        assert restored.type == ToolDeliverableType.FILE
        assert restored.file is not None
        assert restored.file.file_sas_url == "https://blob.example.com/sas/report.pdf"
        assert restored.file.file_name == "report.pdf"
        assert restored.file.file_uri == "assets/report.pdf"

    def test_file_deliverable_none_when_absent(self):
        pb_obj = pb.ToolDeliverable()
        pb_obj.type = pb.ToolDeliverableType(ToolDeliverableType.MARKDOWN.value)
        pb_obj.markdown_content = "# Hello"

        result = ToolDeliverable.from_pb(pb_obj)
        assert result.file is None
        assert result.markdown_content == "# Hello"

    def test_markdown_deliverable_round_trip(self):
        original = ToolDeliverable(
            type=ToolDeliverableType.MARKDOWN,
            markdown_content="# Report",
            markdown_title="Summary",
        )
        restored = ToolDeliverable.from_pb(original.to_pb())
        assert restored.type == ToolDeliverableType.MARKDOWN
        assert restored.markdown_content == "# Report"
        assert restored.markdown_title == "Summary"
        assert restored.file is None

    def test_backward_compat_deprecated_file_fields(self):
        """Old data has file_url/file_name at top level instead of File submessage."""
        pb_obj = pb.ToolDeliverable()
        pb_obj.type = pb.ToolDeliverableType(ToolDeliverableType.FILE.value)
        pb_obj.file_url = "https://blob.example.com/old/report.pdf"
        pb_obj.file_name = "old_report.pdf"

        result = ToolDeliverable.from_pb(pb_obj)
        assert result.type == ToolDeliverableType.FILE
        assert result.file is not None
        assert result.file.file_sas_url == "https://blob.example.com/old/report.pdf"
        assert result.file.file_name == "old_report.pdf"
        assert result.file.file_uri == ""

    def test_backward_compat_prefers_file_submessage(self):
        """When both File and deprecated fields exist, File takes precedence."""
        pb_obj = pb.ToolDeliverable()
        pb_obj.type = pb.ToolDeliverableType(ToolDeliverableType.FILE.value)
        pb_obj.file_url = "https://old.example.com/report.pdf"
        pb_obj.file_name = "old.pdf"
        pb_obj.file = pb.ToolDeliverableFile(
            file_sas_url="https://new.example.com/report.pdf",
            file_name="new.pdf",
            file_uri="assets/new.pdf",
        )

        result = ToolDeliverable.from_pb(pb_obj)
        assert result.file.file_sas_url == "https://new.example.com/report.pdf"
        assert result.file.file_name == "new.pdf"
        assert result.file.file_uri == "assets/new.pdf"
