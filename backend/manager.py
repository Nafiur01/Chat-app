import asyncio
import os
from cv_processing.cv_processing import video_processing_v2
from threading import Event as StopEvent
from typing import Dict
from fastapi import WebSocket
from schema import Client


# Stream Manager

class StreamManager:
    def __init__(self):
        self.process = None
        self.running = False
        self.viewers = 0
        self.lock = asyncio.Lock()
        self.stop_event = None
        self.url:str = None

    async def start(self, url: str):
        async with self.lock:
            if self.running:
                return 

            print("Starting stream...")
            self.stop_event = StopEvent()
            
            
            hls_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hls_output")
            os.makedirs(hls_dir, exist_ok=True)
            hls_path = os.path.join(hls_dir, "stream.m3u8")
            if os.path.exists(hls_path):
                try:
                    os.remove(hls_path)
                except:
                    pass

            # Start transcoding in a thread
            self.process = asyncio.create_task(asyncio.to_thread(video_processing_v2, url, self.stop_event, hls_dir))
            self.running = True

            # Wait for the stream to be ready (at least one segment)
            max_retries = 40
            for i in range(max_retries):
                if os.path.exists(hls_path) and os.path.getsize(hls_path) > 0:
                    with open(hls_path, "r") as f:
                        if ".ts" in f.read():
                            print(f"HLS stream ready after {i*0.5}s")
                            return True
                await asyncio.sleep(0.5)
            
            print("Timeout: HLS stream not ready in time.")
            return False

    async def stop(self):
        async with self.lock:
            if not self.running:
                return

            print("Stopping stream...")
            self.stop_event.set()
            await self.process 
            self.running = False
            self.process = None
            self.stop_event = None


stream_manager = StreamManager()

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.clients: Dict[str, Client] = {}

    async def connect(self, websocket: WebSocket, client: Client = None):
        if client is None:
            client = Client()
        
        await websocket.accept()
        # Store client_id in websocket state for later lookup
        websocket.scope["client_id"] = client.client_id
        
        self.active_connections[client.client_id] = websocket
        self.clients[client.client_id] = client
        stream_manager.viewers += 1
        print(f"Client {client.client_id} connected. Total viewers: {stream_manager.viewers}")
        
        # Broadcast viewer count to all
        await self.broadcast({"type": "viewer_count", "count": stream_manager.viewers})
        client_join_msg = {"type":"chat","client_id":"Server","message":f"Client {client.client_id.split('-')[0]} joined"}
        await self.broadcast(client_join_msg)
        
        # Always consume the first message (the stream URL) to clear the buffer
        try:
            stream_url = await websocket.receive_text()
            print(f"Received initial URL from client {client.client_id}")
        except Exception as e:
            print(f"Failed to receive initial URL: {e}")
            await self.disconnect(websocket)
            return

        if stream_manager.viewers == 1 and not stream_manager.running:
            try:
                stream_manager.url = stream_url
                is_ready = await stream_manager.start(stream_url)
                if is_ready:
                    await websocket.send_json({"type": "ready", "url": "http://127.0.0.1:8000/hls/stream.m3u8", "client_id": client.client_id})
                else:
                    await websocket.send_json({"type": "error", "message": "Stream startup timeout"})
            except Exception as e:
                print(f"Error starting stream: {e}")
                await self.disconnect(websocket)
        elif stream_manager.running:
            await websocket.send_json({"type": "ready", "url": "http://127.0.0.1:8000/hls/stream.m3u8", "client_id": client.client_id})

    async def disconnect(self, websocket: WebSocket):
        client_id = websocket.scope.get("client_id")
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            if client_id in self.clients:
                del self.clients[client_id]
            stream_manager.viewers -= 1
            print(f"Client {client_id} disconnected. Total viewers: {stream_manager.viewers}")
            await self.broadcast({"type": "viewer_count", "count": stream_manager.viewers})

            if stream_manager.viewers <= 0:
                print("No viewers left, stream will stop in 2 minutes if no one rejoins...")
                await asyncio.sleep(120)
                if stream_manager.viewers <= 0:
                    await stream_manager.stop()
                    print("Stream stopped due to no viewers.")
                    stream_manager.url = None
                else:
                    print("Viewer rejoined, cancelling stream stop.")

    async def broadcast(self, message: dict):
        disconnected_clients = []
        for client_id, connection in self.active_connections.items():
            try:
                await connection.send_json(message)
            except Exception:
                disconnected_clients.append(client_id)
        
        for client_id in disconnected_clients:
            if client_id in self.active_connections:
                del self.active_connections[client_id]
                if client_id in self.clients:
                    del self.clients[client_id]
                stream_manager.viewers -= 1
        
        if disconnected_clients:
            await self.broadcast({"type": "viewer_count", "count": stream_manager.viewers})

ws_manager = WebSocketManager()
