import datetime

from pydantic import BaseModel, Field, model_validator


def _ensure_max_ge_min(required_min: int | None, required_max: int | None) -> None:
    """required_max が指定されていれば required_min 以上であることを保証する。

    required_max=None は「ちょうど required_min 人」（厳格）を表す。
    """
    if (
        required_max is not None
        and required_min is not None
        and required_max < required_min
    ):
        raise ValueError("required_max は required_min 以上である必要があります")


class DayTemplateBase(BaseModel):
    department_id: int
    day_of_week: int = Field(ge=-1, le=7)
    pattern_id: int
    # 最小必要人数。required_max=None のとき「ちょうど required_min 人」（厳格）。
    required_min: int = Field(ge=0, default=1)
    # 上限必要人数。None=厳格、値あり=範囲 required_min〜required_max。
    required_max: int | None = Field(ge=0, default=None)

    @model_validator(mode="after")
    def _validate_range(self) -> "DayTemplateBase":
        _ensure_max_ge_min(self.required_min, self.required_max)
        return self


class DayTemplateCreate(DayTemplateBase):
    pass


class DayTemplateUpdate(BaseModel):
    day_of_week: int | None = Field(default=None, ge=-1, le=7)
    pattern_id: int | None = None
    required_min: int | None = Field(default=None, ge=0)
    required_max: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _validate_range(self) -> "DayTemplateUpdate":
        _ensure_max_ge_min(self.required_min, self.required_max)
        return self


class DayTemplateResponse(DayTemplateBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class DayTemplateReorderRequest(BaseModel):
    """並び替え対象の DayTemplate ID 配列を部門 ID とともに送るペイロード。"""

    department_id: int
    ids: list[int]


class DayOverrideBase(BaseModel):
    department_id: int
    specific_date: datetime.date
    pattern_id: int
    # 最小必要人数。required_max=None のとき「ちょうど required_min 人」（厳格）。
    required_min: int = Field(ge=0, default=1)
    # 上限必要人数。None=厳格、値あり=範囲 required_min〜required_max。
    required_max: int | None = Field(ge=0, default=None)

    @model_validator(mode="after")
    def _validate_range(self) -> "DayOverrideBase":
        _ensure_max_ge_min(self.required_min, self.required_max)
        return self


class DayOverrideCreate(DayOverrideBase):
    pass


class DayOverrideUpdate(BaseModel):
    specific_date: datetime.date | None = None
    pattern_id: int | None = None
    required_min: int | None = Field(default=None, ge=0)
    required_max: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _validate_range(self) -> "DayOverrideUpdate":
        _ensure_max_ge_min(self.required_min, self.required_max)
        return self


class DayOverrideResponse(DayOverrideBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class DayOverrideReorderRequest(BaseModel):
    """並び替え対象の DayOverride ID 配列を部門 ID とともに送るペイロード。"""

    department_id: int
    ids: list[int]
