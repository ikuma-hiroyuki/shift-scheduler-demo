from pydantic import BaseModel, ConfigDict, Field


# issue #235: 月日数バケツ別の max を別個に設定 (le=29/30/31)
# Plan finding B2: rest_days_28_29 に 30 を許すと月日数超過になるためバケツごとに制限。


class RoleResponse(BaseModel):
    code: str
    name: str
    order_index: int
    rest_days_28_29: int
    rest_days_30: int
    rest_days_31: int

    model_config = ConfigDict(from_attributes=True)


class RoleCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,19}$")
    name: str = Field(min_length=1, max_length=50)
    rest_days_28_29: int = Field(ge=0, le=29)
    rest_days_30: int = Field(ge=0, le=30)
    rest_days_31: int = Field(ge=0, le=31)


class RoleUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    rest_days_28_29: int = Field(ge=0, le=29)
    rest_days_30: int = Field(ge=0, le=30)
    rest_days_31: int = Field(ge=0, le=31)


class RoleReorderRequest(BaseModel):
    codes: list[str] = Field(min_length=1)
