from pydantic import BaseModel, ConfigDict
from datetime import datetime

class DepartmentResponse(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
