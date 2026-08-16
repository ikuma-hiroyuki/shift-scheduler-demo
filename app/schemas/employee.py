from pydantic import BaseModel, Field


class EmployeeBase(BaseModel):
    employee_number: int
    department_id: int
    name: str
    # role は roles.code への FK。値の妥当性はサービス層で DB 参照によって検証する
    role: str = Field(min_length=1, max_length=20)
    available_days: str = "0,1,2,3,4,5,6"
    available_shift_types: str = "1,2,3"
    consecutive_workable: bool = True


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    available_days: str | None = None
    available_shift_types: str | None = None
    consecutive_workable: bool | None = None


class EmployeeResponse(EmployeeBase):
    id: int
    sort_order: int = 0

    model_config = {"from_attributes": True}


class ReorderRequest(BaseModel):
    """並び替え対象 ID をスコープ ID とともに送るペイロード。"""

    department_id: int
    ids: list[int]


class SortByRoleRequest(BaseModel):
    """役職並び順 → 社員番号 順で sort_order を再採番するペイロード。"""

    department_id: int
