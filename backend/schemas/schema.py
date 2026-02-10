from pydantic import BaseModel, Field
from uuid import UUID
import uuid
from pydantic import field_validator
from typing import List, Optional

class WebSocketMessage(BaseModel):
    client_id: UUID

    @field_validator("client_id")
    def validate_client_id(cls, value):
        if not isinstance(value, UUID):
            raise ValueError("client_id must be a UUID")
        return value
    
    message: str

class WebSocketConnection(BaseModel):
    client_id: UUID = Field(default_factory=uuid.uuid4)
    history: List[WebSocketMessage] = []