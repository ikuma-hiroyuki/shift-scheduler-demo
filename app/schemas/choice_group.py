from pydantic import BaseModel, Field, model_validator


class PatternChoiceGroupBase(BaseModel):
    department_id: int
    day_of_week: int | None = None
    min_count: int = Field(ge=0, default=1)
    max_count: int = Field(ge=0, default=1)
    candidate_pattern_ids: list[int]


class PatternChoiceGroupCreate(PatternChoiceGroupBase):
    pass


class PatternChoiceGroupUpdate(BaseModel):
    # day_of_week は「未送信」と「null（毎日）」を区別するため、
    # router 側で `model_fields_set` に "day_of_week" が含まれる場合のみ更新を適用する。
    day_of_week: int | None = None
    min_count: int | None = None
    max_count: int | None = None
    candidate_pattern_ids: list[int] | None = None


class PatternChoiceGroupResponse(PatternChoiceGroupBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class PatternChoiceGroupReorderRequest(BaseModel):
    """並び替え対象の PatternChoiceGroup ID 配列を部門 ID とともに送るペイロード。"""

    department_id: int
    ids: list[int]


class PatternIncompatibilityBase(BaseModel):
    department_id: int
    pattern_id_a: int
    pattern_id_b: int

    @model_validator(mode="after")
    def _check_distinct_patterns(self) -> "PatternIncompatibilityBase":
        if self.pattern_id_a == self.pattern_id_b:
            raise ValueError("pattern_id_a と pattern_id_b は別々のパターンを指定してください")
        return self


class PatternIncompatibilityCreate(PatternIncompatibilityBase):
    pass


class PatternIncompatibilityUpdate(BaseModel):
    pattern_id_a: int | None = None
    pattern_id_b: int | None = None

    @model_validator(mode="after")
    def _check_distinct_patterns(self) -> "PatternIncompatibilityUpdate":
        if (
            self.pattern_id_a is not None
            and self.pattern_id_b is not None
            and self.pattern_id_a == self.pattern_id_b
        ):
            raise ValueError("pattern_id_a と pattern_id_b は別々のパターンを指定してください")
        return self


class PatternIncompatibilityResponse(PatternIncompatibilityBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class PatternIncompatibilityReorderRequest(BaseModel):
    """並び替え対象の PatternIncompatibility ID 配列を部門 ID とともに送るペイロード。"""

    department_id: int
    ids: list[int]
