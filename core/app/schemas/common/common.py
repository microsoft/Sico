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
