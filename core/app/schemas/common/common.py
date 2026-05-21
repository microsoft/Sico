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

from typing import Self

from pydantic import BaseModel, Field

import app.pb.common.common as pb


class Attachment(BaseModel):
    name: str = Field("", description="Attachment name")
    uri: str = Field("", description="Attachment URI")
    sas_url: str = Field("", description="SAS URL for the attachment")
    type: str = Field("", description="Attachment type")
    size: int = Field(0, description="Attachment size in bytes")

    @classmethod
    def from_pb(cls, pb_obj: pb.Attachment) -> Self:
        return cls(
            name=pb_obj.name,
            uri=pb_obj.uri,
            sas_url=pb_obj.sas_url,
            type=pb_obj.type,
            size=pb_obj.size,
        )

    def to_pb(self) -> pb.Attachment:
        pb_obj = pb.Attachment()
        pb_obj.name = self.name
        pb_obj.uri = self.uri
        pb_obj.sas_url = self.sas_url
        pb_obj.type = self.type
        pb_obj.size = self.size
        return pb_obj
