from pydantic import BaseModel, Field


class LeaveRequestBase(BaseModel):
    employee_id: int
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    leave_type: str = Field(
        pattern="^(REQUESTED|TENTATIVE|MANDATORY)$", default="REQUESTED"
    )


class LeaveRequestCreate(LeaveRequestBase):
    pass


class LeaveRequestUpdate(BaseModel):
    leave_type: str | None = Field(
        default=None, pattern="^(REQUESTED|TENTATIVE|MANDATORY)$"
    )


class LeaveRequestResponse(LeaveRequestBase):
    id: int

    model_config = {"from_attributes": True}
