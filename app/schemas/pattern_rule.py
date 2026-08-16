from pydantic import BaseModel, Field


class PatternTriggerBase(BaseModel):
    department_id: int
    auxiliary_group_id: int
    required_group_ids: list[int]


class PatternTriggerCreate(PatternTriggerBase):
    pass


class PatternTriggerUpdate(BaseModel):
    auxiliary_group_id: int | None = None
    required_group_ids: list[int] | None = None


class PatternTriggerReorderRequest(BaseModel):
    department_id: int
    ids: list[int]


class PatternTriggerResponse(PatternTriggerBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class PatternTriggerImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]


class SpecialAssignmentRuleBase(BaseModel):
    department_id: int
    condition_type: str = Field(pattern="^(WEEKDAY|LAST_DAY)$")
    condition_value: int | None = None
    required_role: str = Field(pattern="^(CHIEF|DEPUTY)$")
    pattern_id: int


class SpecialAssignmentRuleCreate(SpecialAssignmentRuleBase):
    pass


class SpecialAssignmentRuleUpdate(BaseModel):
    condition_type: str | None = Field(default=None, pattern="^(WEEKDAY|LAST_DAY)$")
    condition_value: int | None = None
    required_role: str | None = None
    pattern_id: int | None = None


class SpecialAssignmentRuleResponse(SpecialAssignmentRuleBase):
    id: int

    model_config = {"from_attributes": True}
