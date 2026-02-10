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
last_frame = None



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
    global last_frame
    client_id = await manager.connect_stream(websocket)

    await manager.broadcast_stream_json({"type":"viewer_count","count":manager.active_streams_count()})
    
    # Send last frame to new subscriber
    if last_frame:
        await websocket.send_bytes(last_frame)

    try:
        while True:
            data = await websocket.receive_bytes()
            last_frame = data  # Update last frame cache
            await manager.broadcast_stream(data, exclude_id=client_id)
    except WebSocketDisconnect:
        await manager.disconnect_stream(client_id)
        await manager.broadcast_stream_json({"type": "viewer_count", "count": manager.active_streams_count()})
    


    


