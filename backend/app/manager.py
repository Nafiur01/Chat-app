from fastapi import WebSocket
from typing import List, Dict
from schemas.schema import WebSocketMessage, WebSocketConnection, WebSocketStreamConnection

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.active_streams: Dict[str, WebSocket] = {}
        self.broadcaster: str = None

    async def connect(self, websocket: WebSocket, history: List[dict] = []) -> str: 
        await websocket.accept()
        connection = WebSocketConnection(history=history)
        client_id = str(connection.client_id)
        self.active_connections[client_id] = websocket
        await websocket.send_json(connection.model_dump(mode='json'))
        return client_id

    async def connect_stream(self, websocket: WebSocket):
        await websocket.accept()
        connection = WebSocketStreamConnection()
        client_id = str(connection.client_id)
        
        # If no broadcaster, this one becomes it
        if self.broadcaster is None:
            self.broadcaster = client_id
            role = "broadcaster"
        else:
            role = "viewer"
            
        self.active_streams[client_id] = websocket
        
        # Notify the client of their ID and role
        await websocket.send_json({
            "client_id": client_id,
            "role": role,
            "broadcaster_id": self.broadcaster
        })
        
        return client_id, role

    async def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def disconnect_stream(self, client_id: str):
        if client_id in self.active_streams:
            del self.active_streams[client_id]
        if self.broadcaster == client_id:
            self.broadcaster = None
            # Optionally notify others that broadcast has ended
            await self.broadcast_stream_json({"type": "broadcast_ended"})

    def get_viewers(self):
        return [client_id for client_id in self.active_streams.keys() if client_id != self.broadcaster]

    async def send_personal_message(self, message: dict, client_id: str):
        if client_id in self.active_streams:
            await self.active_streams[client_id].send_json(message)

    async def broadcast(self, message: dict):
        for client_id, websocket in list(self.active_connections.items()):
            try:
                await websocket.send_json(message)
            except:
                await self.disconnect(client_id)

    async def broadcast_stream_json(self, message: dict, exclude_id: str = None):
        for client_id, websocket in list(self.active_streams.items()):
            if client_id != exclude_id:
                try:
                    await websocket.send_json(message)
                except:
                    await self.disconnect_stream(client_id)
    
    def active_streams_count(self):
        return len(self.active_streams)
