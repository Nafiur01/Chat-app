from pydantic import BaseModel, Field
from uuid import uuid4
from datetime import datetime


def timestamp_clean():
    time = datetime.now().strftime("%H:%M:%S")
    return time

class Client(BaseModel):
    client_id: str = Field(default_factory=lambda: str(uuid4()))


class ChatMessage(BaseModel):
    client_id: str
    message: str
    timestamp: str = Field(default_factory=timestamp_clean)
        
    