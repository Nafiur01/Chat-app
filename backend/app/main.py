from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
from .manager import ConnectionManager
from schemas.schema import WebSocketMessage
import json
import os
import redis
from dotenv import load_dotenv, find_dotenv

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Redis Connection established")
    yield
    print("Redis Connection closing...")
    r.close()

load_dotenv(find_dotenv())

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development, allow all. Change to your frontend domain in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.websocket("/ws/stream")
async def video_endpoint(websocket: WebSocket):
    client_id, role = await manager.connect_stream(websocket)

    # If a new viewer joins, notify the broadcaster
    if role == "viewer" and manager.broadcaster:
        await manager.send_personal_message({
            "type": "new-viewer",
            "viewer_id": client_id
        }, manager.broadcaster)

    await manager.broadcast_stream_json({
        "type": "viewer_count",
        "count": manager.active_streams_count()
    })

    try:
        while True:
            data = await websocket.receive_json()
            # Handle signaling messages
            msg_type = data.get("type")
            target_id = data.get("to")

            if msg_type == "request-viewers" and client_id == manager.broadcaster:
                viewers = manager.get_viewers()
                await manager.send_personal_message({
                    "type": "viewer-list",
                    "viewers": viewers
                }, client_id)

            if msg_type in ["offer", "answer", "candidate"] and target_id:
                # Relay signaling message to specific target
                await manager.send_personal_message(data, target_id)
            
    except WebSocketDisconnect:
        await manager.disconnect_stream(client_id)
        await manager.broadcast_stream_json({
            "type": "viewer_count",
            "count": manager.active_streams_count()
        })
    


    


