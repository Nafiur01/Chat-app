from fastapi import WebSocket
from typing import List, Dict
from schemas.schema import WebSocketMessage, WebSocketConnection

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, history: List[dict] = []) -> str: 
        await websocket.accept()
        connection = WebSocketConnection(history=history)
        client_id = str(connection.client_id)
        self.active_connections[client_id] = websocket
        await websocket.send_json(connection.model_dump(mode='json'))
        return client_id

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def broadcast(self, message: dict):
        for websocket in self.active_connections.values():
            await websocket.send_json(message)