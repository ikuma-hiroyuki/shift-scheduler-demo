from pydantic import BaseModel, Field


class EmployeePatternPriorityBase(BaseModel):
    employee_id: int
    pattern_id: int
    priority: int = Field(ge=0, le=10)


class EmployeePatternPriorityCreate(EmployeePatternPriorityBase):
    pass


class EmployeePatternPriorityUpdate(BaseModel):
    priority: int = Field(ge=0, le=10)


class EmployeePatternPriorityResponse(EmployeePatternPriorityBase):
    id: int

    model_config = {"from_attributes": True}


class EmployeePriorityImportResult(BaseModel):
    created: int
    updated: int
    deleted: int
    skipped: int
    errors: list[str]
