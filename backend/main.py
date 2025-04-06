from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import logging
import uuid
from typing import Dict, Set
from pose_comparison import calculate_pose_similarity

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # React's default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data models
class GameRoom(BaseModel):
    room_id: str
    player1_id: str = None
    player2_id: str = None
    is_active: bool = True

class PlayerData(BaseModel):
    user_id: str
    landmarks: list
    reference_landmarks: list = None

# Store game rooms and connections
game_rooms: Dict[str, GameRoom] = {}
active_connections: Dict[str, WebSocket] = {}
player_scores: Dict[str, float] = {}

@app.post("/create-room")
async def create_room():
    room_id = str(uuid.uuid4())[:6]  # Generate a 6-character room code
    game_rooms[room_id] = GameRoom(room_id=room_id)
    return {"room_id": room_id}

@app.post("/join-room/{room_id}")
async def join_room(room_id: str):
    if room_id not in game_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = game_rooms[room_id]
    if not room.player1_id:
        player_id = str(uuid.uuid4())
        room.player1_id = player_id
        return {"player_id": player_id, "player_number": 1}
    elif not room.player2_id:
        player_id = str(uuid.uuid4())
        room.player2_id = player_id
        return {"player_id": player_id, "player_number": 2}
    else:
        raise HTTPException(status_code=400, detail="Room is full")

@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()
    
    if room_id not in game_rooms:
        await websocket.close(code=4000, reason="Room not found")
        return
    
    room = game_rooms[room_id]
    if player_id not in [room.player1_id, room.player2_id]:
        await websocket.close(code=4001, reason="Invalid player ID")
        return
    
    active_connections[player_id] = websocket
    logger.debug(f"Player {player_id} connected to room {room_id}")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                pose_data = json.loads(data)
                
                # Store player's score
                if 'landmarks' in pose_data and 'reference_landmarks' in pose_data:
                    score = calculate_pose_similarity(
                        pose_data['landmarks'],
                        pose_data['reference_landmarks']
                    )
                    player_scores[player_id] = score
                    
                    # If both players have scores, determine winner
                    if (room.player1_id in player_scores and 
                        room.player2_id in player_scores):
                        winner_id = max(player_scores, key=player_scores.get)
                        winner_score = player_scores[winner_id]
                        
                        # Send results to both players
                        for pid in [room.player1_id, room.player2_id]:
                            if pid in active_connections:
                                await active_connections[pid].send_json({
                                    "type": "game_result",
                                    "winner_id": winner_id,
                                    "scores": {
                                        room.player1_id: player_scores.get(room.player1_id, 0),
                                        room.player2_id: player_scores.get(room.player2_id, 0)
                                    }
                                })
                
                # Forward pose data to opponent
                opponent_id = room.player2_id if player_id == room.player1_id else room.player1_id
                if opponent_id in active_connections:
                    await active_connections[opponent_id].send_json({
                        "type": "opponent_pose",
                        "landmarks": pose_data.get('landmarks', [])
                    })

            except json.JSONDecodeError:
                logger.debug("Invalid JSON received")
            except Exception as e:
                logger.debug(f"Error processing data: {str(e)}")

    except WebSocketDisconnect:
        if player_id in active_connections:
            del active_connections[player_id]
        if player_id in player_scores:
            del player_scores[player_id]
        logger.debug(f"Player {player_id} disconnected from room {room_id}")

@app.get("/room-status/{room_id}")
async def get_room_status(room_id: str):
    if room_id not in game_rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = game_rooms[room_id]
    return {
        "room_id": room.room_id,
        "player1_connected": room.player1_id is not None,
        "player2_connected": room.player2_id is not None,
        "is_active": room.is_active
    }
