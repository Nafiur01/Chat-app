from fastapi import FastAPI, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os
import asyncio
import subprocess
from fastapi.middleware.cors import CORSMiddleware
from manager import ws_manager

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HLS_DIR = os.path.join(BASE_DIR, "hls_output")
if not os.path.exists(HLS_DIR):
    os.makedirs(HLS_DIR)

print(f"HLS files will be stored in: {HLS_DIR}")

# Custom StaticFiles to add no-cache headers for HLS
class NoCacheStaticFiles(StaticFiles):
    def is_not_modified(self, response_headers, request_headers) -> bool:
        return False
    
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

app.mount("/hls", NoCacheStaticFiles(directory=HLS_DIR), name="hls")

@app.get("/")
def service_health():
    return {"Health":"Server healthy"}


@app.get("/video-feed")
def video_feed():
    return {"playlist_url": "http://127.0.0.1:8000/hls/stream.m3u8"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await ws_manager.disconnect(websocket)
