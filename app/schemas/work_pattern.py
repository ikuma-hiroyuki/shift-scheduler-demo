from pydantic import BaseModel, Field, field_validator

from app.constants.group_colors import DEFAULT_GROUP_COLOR

# `#RRGGBB` 形式の hex 色 (preset と custom picker の両方が同じ pattern で通る)
_HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


def _normalize_hex(value: str | None) -> str | None:
    """大文字 hex (`#ABC123`) を小文字 (`#abc123`) に統一。
    `<input type="color">` がブラウザ依存で大文字を返すケースで、DB に
    `#DCFCE7` と `#dcfce7` が並存するのを防ぐ。
    """
    return value.lower() if isinstance(value, str) else value


class WorkPatternGroupBase(BaseModel):
    department_id: int
    name: str
    is_auxiliary: bool = False
    color: str = Field(default=DEFAULT_GROUP_COLOR, pattern=_HEX_COLOR_PATTERN)

    @field_validator("color")
    @classmethod
    def _color_lowercase(cls, v: str) -> str:
        return _normalize_hex(v) or v


class WorkPatternGroupCreate(WorkPatternGroupBase):
    pass


class WorkPatternGroupUpdate(BaseModel):
    name: str | None = None
    is_auxiliary: bool | None = None
    color: str | None = Field(default=None, pattern=_HEX_COLOR_PATTERN)

    @field_validator("color")
    @classmethod
    def _color_lowercase(cls, v: str | None) -> str | None:
        return _normalize_hex(v)


class WorkPatternGroupResponse(WorkPatternGroupBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class WorkPatternBase(BaseModel):
    group_id: int
    pattern_name: str
    shift_type: int = Field(ge=1, le=3)
    shift_start: str = Field(pattern=r"^\d{2}:\d{2}$")
    shift_end: str = Field(pattern=r"^\d{2}:\d{2}$")


class WorkPatternCreate(WorkPatternBase):
    pass


class WorkPatternUpdate(BaseModel):
    pattern_name: str | None = None
    shift_type: int | None = None
    shift_start: str | None = None
    shift_end: str | None = None


class WorkPatternResponse(WorkPatternBase):
    id: int
    department_id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class GroupReorderRequest(BaseModel):
    """グループ並び替え (department スコープ)。"""

    department_id: int
    ids: list[int]


class PatternReorderRequest(BaseModel):
    """パターン並び替え (group スコープ)。"""

    group_id: int
    ids: list[int]
