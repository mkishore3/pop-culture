@echo off
echo Starting both frontend and backend servers...

:: Start backend server in a new window
start cmd /k "cd backend && uvicorn main:app --reload --port 8000"

:: Start frontend server in a new window
start cmd /k "cd frontend && npm start"

echo Servers started! Check the new windows for output. 