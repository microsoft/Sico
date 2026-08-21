"""Strict JSON contract accepted by the single delegate tool."""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.biz.source import canonical_case_id
from app.biz.task_runtime.planning import JoinStrategy

from .models import Rejected

DELEGATE_REQUEST_MAX_CHARS = 1_000_000
MAX_DELEGATE_SOURCES = 20
MAX_DELEGATE_WORK_ITEMS = 500
MAX_SOURCE_DOCUMENTS = 20
MAX_SOURCE_CAPABILITY_IDS = 100
MAX_SOURCE_PROFILE_IDS = 50
MAX_DOCUMENT_SHEETS = 50
MAX_DOCUMENT_CASE_IDS = 500
MAX_PARAMETER_BINDINGS = 100


class InstructionSourceMaterializationSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ref: str = Field(min_length=1, max_length=1024)
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def source_ref_not_blank(self) -> "InstructionSourceMaterializationSpec":
        if not self.source_ref.strip():
            raise ValueError("source_materialization.source_ref must not be blank")
        return self


class InstructionItemSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=1, max_length=100_000)
    title: str = Field(default="", max_length=200)
    params: dict[str, Any] = Field(default_factory=dict)
    capability_id: str = Field(default="", max_length=512)
    profile_id: str = Field(default="", max_length=512)
    capability_grants: list[str] = Field(default_factory=list, max_length=MAX_SOURCE_CAPABILITY_IDS)
    max_model_turns: int | None = Field(default=None, ge=1)
    stage: int | None = Field(default=None, ge=0)
    source_materialization: InstructionSourceMaterializationSpec | None = None

    @model_validator(mode="after")
    def one_prebound_target(self) -> "InstructionItemSpec":
        if self.capability_id.strip() and self.profile_id.strip():
            raise ValueError("instruction item cannot prebind both capability_id and profile_id")
        if not self.profile_id.strip() and (self.capability_grants or self.max_model_turns is not None):
            raise ValueError("capability_grants and max_model_turns require profile_id")
        if self.source_materialization is not None and not self.capability_id.strip():
            raise ValueError("source_materialization requires capability_id")
        if not self.goal.strip():
            raise ValueError("instruction goal must not be blank")
        return self


class InstructionsSourceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["instructions"] = "instructions"
    items: list[InstructionItemSpec] = Field(min_length=1, max_length=MAX_DELEGATE_WORK_ITEMS)
    capability_ids: list[str] = Field(default_factory=list, max_length=MAX_SOURCE_CAPABILITY_IDS)
    profile_ids: list[str] = Field(default_factory=list, max_length=MAX_SOURCE_PROFILE_IDS)
    allow_sub_agent: bool = True

    @model_validator(mode="after")
    def valid_profile_scope(self) -> "InstructionsSourceSpec":
        if not self.allow_sub_agent and (self.profile_ids or any(item.profile_id.strip() for item in self.items)):
            raise ValueError("profile_ids and profile-bound items require allow_sub_agent=true")
        return self


class TabularDocumentSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ref: str = Field(min_length=1, max_length=1024)
    sheet_names: list[str] = Field(default_factory=list, max_length=MAX_DOCUMENT_SHEETS)
    row_start: int | None = Field(default=None, ge=1)
    row_end: int | None = Field(default=None, ge=1)
    case_ids: list[str] = Field(default_factory=list, max_length=MAX_DOCUMENT_CASE_IDS)

    @field_validator("case_ids")
    @classmethod
    def case_ids_not_blank(cls, values: list[str]) -> list[str]:
        if any(not case_id.strip() for case_id in values):
            raise ValueError("case_ids must not contain blank values")
        return values

    @model_validator(mode="after")
    def valid_row_range(self) -> "TabularDocumentSpec":
        if self.row_start is not None and self.row_end is not None and self.row_start > self.row_end:
            raise ValueError("row_start must not exceed row_end")
        return self


class ParameterBindingSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal[
        "column",
        "document_path",
        "sheet_name",
        "row_index",
        "source_row",
        "case_id",
        "goal",
        "title",
        "literal",
    ]
    column: str = ""
    value: Any = None
    transform: Literal["identity", "string_to_integer", "string_to_number", "json"] = "identity"


class TabularSourceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["tabular"] = "tabular"
    documents: list[TabularDocumentSpec] = Field(min_length=1, max_length=MAX_SOURCE_DOCUMENTS)
    capability_ids: list[str] = Field(default_factory=list, max_length=MAX_SOURCE_CAPABILITY_IDS)
    parameter_bindings: dict[str, ParameterBindingSpec] = Field(default_factory=dict, max_length=MAX_PARAMETER_BINDINGS)
    max_rows: int = Field(default=MAX_DELEGATE_WORK_ITEMS, ge=1, le=MAX_DELEGATE_WORK_ITEMS)
    stage: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def document_scopes_are_unique(self) -> "TabularSourceSpec":
        keys = [
            (
                document.source_ref.replace("\\", "/").strip().lstrip("/"),
                tuple(name.strip().casefold() for name in document.sheet_names),
                document.row_start,
                document.row_end,
                tuple(canonical_case_id(case_id) for case_id in document.case_ids),
            )
            for document in self.documents
        ]
        if len(keys) != len(set(keys)):
            raise ValueError("tabular source contains duplicate document scopes")
        return self


SourceSpec = Annotated[InstructionsSourceSpec | TabularSourceSpec, Field(discriminator="type")]


class DelegateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: list[SourceSpec] = Field(min_length=1, max_length=MAX_DELEGATE_SOURCES)
    batch_goal: str = Field(min_length=1, max_length=10_000)
    join_strategy: JoinStrategy = "partial_ok"
    max_concurrency: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def batch_goal_not_blank(self) -> "DelegateRequest":
        if not self.batch_goal.strip():
            raise ValueError("batch_goal must not be blank")
        return self


def parse_delegate_request(request_json: str) -> DelegateRequest | Rejected:
    if len(request_json) > DELEGATE_REQUEST_MAX_CHARS:
        return Rejected(
            f"delegate request_json exceeds {DELEGATE_REQUEST_MAX_CHARS} characters",
            code="delegate_request_limit",
            details={"max_chars": DELEGATE_REQUEST_MAX_CHARS},
        )
    try:
        decoded = json.loads(request_json)
    except json.JSONDecodeError as exc:
        return Rejected(
            f"delegate request_json is not valid JSON: {exc}",
            code="delegate_request_invalid",
        )
    try:
        request = DelegateRequest.model_validate(decoded)
    except ValidationError as exc:
        errors = exc.errors(include_url=False)
        exceeds_limit = any(error.get("type") == "too_long" for error in errors)
        code = "delegate_request_limit" if exceeds_limit else "delegate_request_invalid"
        return Rejected(
            "delegate request_json failed validation",
            code=code,
            details={"errors": errors},
        )
    instruction_count = sum(
        len(source.items) for source in request.sources if isinstance(source, InstructionsSourceSpec)
    )
    if instruction_count > MAX_DELEGATE_WORK_ITEMS:
        return Rejected(
            f"delegate request contains {instruction_count} instruction items; limit is {MAX_DELEGATE_WORK_ITEMS}",
            code="delegate_request_limit",
            details={"instruction_count": instruction_count, "max_work_items": MAX_DELEGATE_WORK_ITEMS},
        )
    return request
