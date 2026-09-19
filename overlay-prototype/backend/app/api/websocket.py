from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.runtime import runtime


router = APIRouter()


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        dead: list[WebSocket] = []
        for connection in self.connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for connection in dead:
            self.disconnect(connection)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    await websocket.send_json(
        {
            "type": "system_status",
            "payload": {"status": runtime.status, "model_version": runtime.model_config.version},
        }
    )
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

