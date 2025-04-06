from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import json

app = FastAPI()

# Data model
class PoseData(BaseModel):
    user_id: str
    landmarks: list

# Store active connections
active_connections = {}

@app.get("/")
def read_root():
    return {"message": "FastAPI is up!"}

@app.post("/pose")
async def receive_pose(data: PoseData):
    print(f"Received pose data from {data.user_id}")
    return {"message": "Pose received"}

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await websocket.accept()
    active_connections[user_id] = websocket
    print(f"User {user_id} connected")

    try:
        while True:
            data = await websocket.receive_text()
            print(f"Pose from {user_id}: {data}")

            # Optionally send it to other users
            for user, conn in active_connections.items():
                if user != user_id:
                    await conn.send_text(f"Pose from {user_id}: {data}")

    except WebSocketDisconnect:
        del active_connections[user_id]
        print(f"User {user_id} disconnected")
