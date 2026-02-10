from fastapi import WebSocket
from typing import List, Dict
from schemas.schema import WebSocketMessage, WebSocketConnection, WebSocketStreamConnection

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.active_streams: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, history: List[dict] = []) -> str: 
        await websocket.accept()
        connection = WebSocketConnection(history=history)
        client_id = str(connection.client_id)
        self.active_connections[client_id] = websocket
        await websocket.send_json(connection.model_dump(mode='json'))
        return client_id

    async def connect_stream(self,websocket:WebSocket):
        await websocket.accept()
        connection = WebSocketStreamConnection()
        client_id = str(connection.client_id)
        self.active_streams[client_id] = websocket
        await websocket.send_json(connection.model_dump(mode='json'))
        return client_id

    async def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def broadcast(self, message: dict):
        for client_id, websocket in list(self.active_connections.items()):
            try:
                await websocket.send_json(message)
            except:
                await self.disconnect(client_id)

    async def broadcast_stream(self,data:bytes,exclude_id:str=None):
        for client_id,websocket in list(self.active_streams.items()):
            if client_id != exclude_id:
                try:
                    await websocket.send_bytes(data)
                except:
                    await self.disconnect_stream(client_id)

    async def broadcast_stream_json(self, message: dict):
        for client_id, websocket in list(self.active_streams.items()):
            try:
                await websocket.send_json(message)
            except:
                await self.disconnect_stream(client_id)
    
    async def disconnect_stream(self,client_id:str):
        if client_id in self.active_streams:
            del self.active_streams[client_id]
    
    def active_streams_count(self):
        return len(self.active_streams)-1
