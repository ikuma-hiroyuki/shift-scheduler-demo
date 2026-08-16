from pydantic import BaseModel, Field


class UserBase(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    is_active: bool = True
    is_admin: bool = False


class UserCreate(UserBase):
    password: str = Field(min_length=1)


class UserUpdate(BaseModel):
    """部分更新用。password は空欄/未指定なら据え置き。"""

    email: str | None = Field(default=None, min_length=1, max_length=255)
    password: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None
    is_admin: bool | None = None


class UserResponse(UserBase):
    id: int

    model_config = {"from_attributes": True}
