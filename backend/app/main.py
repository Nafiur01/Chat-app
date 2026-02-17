from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
from .manager import ConnectionManager
from schemas.schema import WebSocketMessage
import json
import os
import redis
from dotenv import load_dotenv, find_dotenv
from datetime import datetime

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

    connected_notification = {"message": f"User {client_id} joined the stream | Time: {datetime.now().strftime('%H:%M:%S')}"}
    connected_notification_msg = WebSocketMessage(client_id=client_id, message=connected_notification["message"])

    await manager.broadcast(connected_notification_msg.model_dump(mode='json'))

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
            msg_type = data.get("type")

            if msg_type == "create-transport":
                try:
                    res = await manager._sfu_post("/create-transport", {"roomId": manager.room_id})
                    await websocket.send_json({"type": "transport-created", "params": res["params"]})
                except Exception as e:
                    print(f"SFU Error (create-transport): {e}")

            elif msg_type == "connect-transport":
                try:
                    await manager._sfu_post("/connect-transport", {
                        "transportId": data.get("transportId"),
                        "dtlsParameters": data.get("dtlsParameters")
                    })
                    await websocket.send_json({"type": "transport-connected"})
                except Exception as e:
                    print(f"SFU Error (connect-transport): {e}")

            elif msg_type == "produce":
                try:
                    res = await manager._sfu_post("/produce", {
                        "roomId": manager.room_id,
                        "transportId": data.get("transportId"),
                        "kind": data.get("kind"),
                        "rtpParameters": data.get("rtpParameters")
                    })
                    manager.producers[data.get("kind")] = res["id"]
                    await websocket.send_json({"type": "produced", "id": res["id"], "kind": data.get("kind")})
                    
                    if len(manager.producers) >= 1: 
                        try:
                            hls_res = await manager._sfu_post("/start-hls", {"roomId": manager.room_id})
                            await manager.broadcast_stream_json({
                                "type": "hls-url",
                                "url": hls_res["url"]
                            })
                        except Exception as e:
                            print(f"HLS Start failed: {e}")
                except Exception as e:
                    print(f"SFU Error (produce): {e}")

            elif msg_type == "consume":
                try:
                    res = await manager._sfu_post("/consume", {
                        "roomId": manager.room_id,
                        "transportId": data.get("transportId"),
                        "producerId": data.get("producerId"),
                        "rtpCapabilities": data.get("rtpCapabilities")
                    })
                    await websocket.send_json({
                        "type": "consumed",
                        "id": res["id"],
                        "producerId": res["producerId"],
                        "kind": res["kind"],
                        "rtpParameters": res["rtpParameters"]
                    })
                except Exception as e:
                    print(f"SFU Error (consume): {e}")

            elif msg_type == "resume":
                try:
                    await manager._sfu_post("/resume-consumer", {"consumerId": data.get("consumerId")})
                except Exception as e:
                    print(f"SFU Error (resume): {e}")

            elif msg_type == "request-producers":
                await websocket.send_json({"type": "producer-list", "producers": manager.producers})

    except WebSocketDisconnect:
        await manager.disconnect_stream(client_id)
        await manager.broadcast_stream_json({
            "type": "viewer_count",
            "count": manager.active_streams_count()
        })
    


    


