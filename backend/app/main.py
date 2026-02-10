from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
from .manager import ConnectionManager
from schemas.schema import WebSocketMessage
import json
import redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Redis Connection established")
    yield
    print("Redis Connection closing...")
    r.close()

app = FastAPI(lifespan=lifespan)
manager = ConnectionManager()
r = redis.Redis(host='localhost', port=6379, decode_responses=True)


@app.get("/")
async def health():
    return {"message": "Health is good"}

@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    # Fetch history from Redis
    try:
        history_raw = r.lrange("chat_history", 0, -1)
        history = [json.loads(msg) for msg in history_raw]
    except Exception as e:
        print(f"Redis error fetching history: {e}")
        history = []

    client_id = await manager.connect(websocket, history=history)
    try:
        while True:
            data = await websocket.receive_json()
            # Validate the message against the schema
            message = WebSocketMessage(**data)
            
            # Store in Redis
            message_json = message.model_dump_json()
            r.rpush("chat_history", message_json)
            r.ltrim("chat_history", -100, -1)
            
            await manager.broadcast(message.model_dump(mode='json'))
    except WebSocketDisconnect:
        await manager.disconnect(client_id)


