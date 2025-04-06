import cv2
import mediapipe as mp
import asyncio
import websockets
import json

async def send_pose():
    uri = "ws://localhost:8000/ws/user1"
    async with websockets.connect(uri) as websocket:
        cap = cv2.VideoCapture(1)
        mp_pose = mp.solutions.pose
        pose = mp_pose.Pose()
        mp_draw = mp.solutions.drawing_utils

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(frame_rgb)

            if results.pose_landmarks:
                landmarks = [{
                    "x": lm.x,
                    "y": lm.y,
                    "z": lm.z,
                    "visibility": lm.visibility
                } for lm in results.pose_landmarks.landmark]

                data = {
                    "user_id": "user1",
                    "landmarks": landmarks
                }

                await websocket.send(json.dumps(data))

            # Optional: draw landmarks
            mp_draw.draw_landmarks(frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
            cv2.imshow("Pose", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()

asyncio.run(send_pose())
