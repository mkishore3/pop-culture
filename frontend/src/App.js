import React, { useRef, useEffect, useState, useCallback } from "react";

function App() {
  const [gameState, setGameState] = useState('lobby'); // 'lobby', 'waiting', 'playing', 'results'
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerNumber, setPlayerNumber] = useState(null);
  const [opponentScore, setOpponentScore] = useState(0);
  const [gameResults, setGameResults] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const referenceVideoRef = useRef(null);
  const referenceCanvasRef = useRef(null);
  const opponentCanvasRef = useRef(null);
  const poseRef = useRef(null);
  const referencePoseRef = useRef(null);
  const opponentPoseRef = useRef(null);
  const [isReferenceVideoReady, setIsReferenceVideoReady] = useState(false);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [similarityScore, setSimilarityScore] = useState(0);
  const [isVideoEnded, setIsVideoEnded] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(null);
  const scoreHistoryRef = useRef([]);
  const [showFinalScore, setShowFinalScore] = useState(false);
  const wsRef = useRef(null);

  const calculateAverageScore = (scores) => {
    if (!scores || scores.length === 0) return 0;
    const sum = scores.reduce((acc, score) => acc + score, 0);
    return (sum / scores.length) * 100; // Convert to percentage
  };

  const onResults = useCallback((results) => {
    if (!canvasRef.current) return;
    
    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext("2d");

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
      window.drawConnectors(canvasCtx, results.poseLandmarks, window.POSE_CONNECTIONS,
        { color: '#00FF00', lineWidth: 2 });
      window.drawLandmarks(canvasCtx, results.poseLandmarks,
        { color: '#FF0000', lineWidth: 1, radius: 3 });

      // Send pose data to server
      sendPoseData(results.poseLandmarks);

      if (isPlaying && !isVideoEnded) {
        const referenceLandmarks = referencePoseRef.current?.lastResults?.poseLandmarks;
        if (referenceLandmarks) {
          const score = calculateCosineSimilarity(results.poseLandmarks, referenceLandmarks);
          scoreHistoryRef.current.push(score);
          if (scoreHistoryRef.current.length % 5 === 0) {
            const averageScore = calculateAverageScore(scoreHistoryRef.current);
            setSimilarityScore(averageScore);
          }
        }
      }
    }
  }, [isPlaying, isVideoEnded]);

  const onReferenceResults = useCallback((results) => {
    if (!referenceCanvasRef.current) return;
    
    const canvasElement = referenceCanvasRef.current;
    const canvasCtx = canvasElement.getContext("2d");

    // Clear the canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Draw the video frame
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
      // Draw the pose landmarks
      window.drawConnectors(canvasCtx, results.poseLandmarks, window.POSE_CONNECTIONS,
        { color: '#00FF00', lineWidth: 2 });
      window.drawLandmarks(canvasCtx, results.poseLandmarks,
        { color: '#FF0000', lineWidth: 1, radius: 3 });

      // Store reference poses if playing
      if (isPlaying) {
        referencePoseRef.current.lastResults = results;
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    // Initialize MediaPipe Pose for user video
    const pose = new window.Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      }
    });

    // Initialize MediaPipe Pose for reference video
    const referencePose = new window.Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      }
    });

    // Set options after a small delay to ensure proper initialization
    setTimeout(() => {
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      referencePose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      pose.onResults(onResults);
      referencePose.onResults(onReferenceResults);
      poseRef.current = pose;
      referencePoseRef.current = referencePose;
    }, 100);

    // Access webcam
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
              .then(() => setIsWebcamReady(true))
              .catch(err => console.error("Error playing webcam:", err));
          };
        }
      })
      .catch((err) => {
        console.error("Error accessing webcam:", err);
      });

    return () => {
      // Cleanup
      if (poseRef.current) {
        poseRef.current.close();
      }
      if (referencePoseRef.current) {
        referencePoseRef.current.close();
      }
    };
  }, [onResults, onReferenceResults]);

  const calculateMovementVector = (pose1, pose2) => {
    if (!pose1 || !pose2) return null;
    
    const vector = [];
    for (let i = 0; i < pose1.length; i++) {
      if (pose1[i] && pose2[i]) {
        vector.push({
          x: pose2[i].x - pose1[i].x,
          y: pose2[i].y - pose1[i].y
        });
      }
    }
    return vector;
  };

  const calculateCosineSimilarity = (vec1, vec2) => {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      if (vec1[i] && vec2[i]) {
        dotProduct += vec1[i].x * vec2[i].x + vec1[i].y * vec2[i].y;
        magnitude1 += vec1[i].x * vec1[i].x + vec1[i].y * vec1[i].y;
        magnitude2 += vec2[i].x * vec2[i].x + vec2[i].y * vec2[i].y;
      }
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    
    // Convert cosine similarity from [-1, 1] to [0, 1] and add 50
    const similarity = (dotProduct / (magnitude1 * magnitude2) + 1) / 2;
    return (similarity * 50) + 50;
  };

  const calculateSimilarity = () => {
    if (referencePoseRef.current.lastResults && onResults.current) {
      const referenceLandmarks = referencePoseRef.current.lastResults.poseLandmarks;
      const userLandmarks = onResults.current.poseLandmarks;
      return calculateCosineSimilarity(userLandmarks, referenceLandmarks);
    }
    return 0;
  };

  const handleVideoEnd = () => {
    setIsPlaying(false);
    setIsVideoEnded(true);
    const score = calculateSimilarity();
    setSimilarityScore(score);
    referencePoseRef.current.lastResults = null;
  };

  const startCountdown = () => {
    setCountdown(3);
  };

  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
    } else if (countdown === 0) {
      // Start the video when countdown reaches 0
      if (referenceVideoRef.current) {
        referenceVideoRef.current.play();
        setIsPlaying(true);
        setIsVideoEnded(false);
        setSimilarityScore(null);
      }
      setCountdown(null);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [countdown]);

  const togglePlayPause = () => {
    if (referenceVideoRef.current) {
      if (isPlaying) {
        referenceVideoRef.current.pause();
        setIsPlaying(false);
        setIsVideoEnded(true);
      } else {
        startCountdown();
      }
    }
  };

  const restartVideo = () => {
    if (referenceVideoRef.current) {
      referenceVideoRef.current.currentTime = 0;
      setIsPlaying(false);
      setIsVideoEnded(true);
      setSimilarityScore(null);
    }
  };

  const handleReferenceVideoLoad = () => {
    if (referenceVideoRef.current) {
      setIsReferenceVideoReady(true);
    }
  };

  useEffect(() => {
    let animationFrameId;
    let lastProcessTime = 0;
    const processInterval = 1000 / 30; // Process at 30fps

    const processFrame = async (timestamp) => {
      if (timestamp - lastProcessTime >= processInterval) {
        try {
          if (videoRef.current && poseRef.current && isWebcamReady) {
            await poseRef.current.send({ image: videoRef.current });
          }
          if (referenceVideoRef.current && referencePoseRef.current && isReferenceVideoReady && isPlaying) {
            await referencePoseRef.current.send({ image: referenceVideoRef.current });
          }
          lastProcessTime = timestamp;
        } catch (error) {
          console.error("Error processing frame:", error);
        }
      }
      animationFrameId = requestAnimationFrame(processFrame);
    };

    processFrame(0);
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isWebcamReady, isReferenceVideoReady, isPlaying]);

  // Create a new game room
  const createRoom = async () => {
    try {
      console.log('Creating new game room...');
      const response = await fetch('http://localhost:8000/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Room created:', data);
      
      if (data.room_id) {
        setRoomId(data.room_id);
        setGameState('waiting');
      } else {
        throw new Error('No room_id received from server');
      }
    } catch (error) {
      console.error('Error creating room:', error);
      alert(`Failed to create game room: ${error.message}`);
    }
  };

  // Join an existing room
  const joinRoom = async () => {
    try {
      const response = await fetch(`http://localhost:8000/join-room/${roomId}`, {
        method: 'POST'
      });
      const data = await response.json();
      setPlayerId(data.player_id);
      setPlayerNumber(data.player_number);
      setGameState('playing');
      connectWebSocket();
    } catch (error) {
      console.error('Error joining room:', error);
    }
  };

  // Connect to WebSocket
  const connectWebSocket = () => {
    const ws = new WebSocket(`ws://localhost:8000/ws/${roomId}/${playerId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'opponent_pose') {
        // Update opponent's pose overlay
        if (opponentCanvasRef.current && opponentPoseRef.current) {
          const canvasCtx = opponentCanvasRef.current.getContext('2d');
          canvasCtx.clearRect(0, 0, opponentCanvasRef.current.width, opponentCanvasRef.current.height);
          if (data.landmarks) {
            window.drawConnectors(canvasCtx, data.landmarks, window.POSE_CONNECTIONS,
              { color: '#0000FF', lineWidth: 2 });
            window.drawLandmarks(canvasCtx, data.landmarks,
              { color: '#FF00FF', lineWidth: 1, radius: 3 });
          }
        }
      } else if (data.type === 'game_result') {
        setGameResults(data);
        setGameState('results');
      }
    };
  };

  // Send pose data to server
  const sendPoseData = (landmarks) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        landmarks: landmarks,
        reference_landmarks: referencePoseRef.current?.lastResults?.poseLandmarks
      }));
    }
  };

  return (
    <div className="App" style={{ textAlign: "center", padding: "20px" }}>
      <h1>Dance Battle App</h1>

      {gameState === 'lobby' && (
        <div>
          <button onClick={createRoom} style={buttonStyle}>
            Create New Game
          </button>
          <div style={{ marginTop: '20px' }}>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter Room Code"
              style={inputStyle}
            />
            <button onClick={joinRoom} style={buttonStyle}>
              Join Game
            </button>
          </div>
        </div>
      )}

      {gameState === 'waiting' && (
        <div>
          <h2>Room Code: {roomId}</h2>
          <div style={{
            backgroundColor: '#f0f0f0',
            padding: '20px',
            borderRadius: '10px',
            margin: '20px auto',
            maxWidth: '400px',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '18px', marginBottom: '10px' }}>Share this code with your friend:</p>
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '10px'
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '10px 20px',
                borderRadius: '5px',
                fontSize: '24px',
                fontWeight: 'bold',
                letterSpacing: '2px'
              }}>
                {roomId}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(roomId);
                  alert('Room code copied to clipboard!');
                }}
                style={{
                  ...buttonStyle,
                  backgroundColor: '#2196F3'
                }}
              >
                Copy
              </button>
            </div>
          </div>
          <p>Waiting for opponent to join...</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px' }}>
            <div style={videoContainerStyle}>
              <h3>Reference Dance</h3>
              <div style={{ position: 'relative' }}>
                <video
                  ref={referenceVideoRef}
                  src="/justdance1.mp4"
                  playsInline
                  onLoadedMetadata={handleReferenceVideoLoad}
                  style={videoStyle}
                />
                <canvas
                  ref={referenceCanvasRef}
                  style={canvasOverlayStyle}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center' }}>
          {/* Reference Video */}
          <div style={videoContainerStyle}>
            <h3>Reference Dance</h3>
            <div style={{ position: 'relative' }}>
              <video
                ref={referenceVideoRef}
                src="/justdance1.mp4"
                playsInline
                onLoadedMetadata={handleReferenceVideoLoad}
                style={videoStyle}
              />
              <canvas
                ref={referenceCanvasRef}
                style={canvasOverlayStyle}
              />
            </div>
          </div>

          {/* Your Webcam */}
          <div style={videoContainerStyle}>
            <h3>Your Performance</h3>
            <div style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{ ...videoStyle, transform: 'scaleX(-1)' }}
              />
              <canvas
                ref={canvasRef}
                style={{ ...canvasOverlayStyle, transform: 'scaleX(-1)' }}
              />
            </div>
          </div>

          {/* Opponent's Webcam */}
          <div style={videoContainerStyle}>
            <h3>Opponent's Performance</h3>
            <div style={{ position: 'relative' }}>
              <canvas
                ref={opponentCanvasRef}
                style={canvasOverlayStyle}
              />
            </div>
          </div>
        </div>
      )}

      {gameState === 'results' && gameResults && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '40px',
          borderRadius: '20px',
          textAlign: 'center',
          zIndex: 1000
        }}>
          <h2>Game Results</h2>
          <div style={{ fontSize: '24px', margin: '20px 0' }}>
            {gameResults.winner_id === playerId ? 'You Won!' : 'Opponent Won!'}
          </div>
          <div style={{ margin: '20px 0' }}>
            <p>Your Score: {gameResults.scores[playerId]}%</p>
            <p>Opponent's Score: {gameResults.scores[gameResults.winner_id === playerId ? 
              (gameResults.winner_id === gameResults.scores.player1_id ? gameResults.scores.player2_id : gameResults.scores.player1_id) 
              : gameResults.winner_id]}%</p>
          </div>
          <button
            onClick={() => {
              setGameState('lobby');
              setRoomId('');
              setPlayerId('');
              setPlayerNumber(null);
              setGameResults(null);
            }}
            style={buttonStyle}
          >
            Play Again
          </button>
        </div>
      )}

      {/* Countdown Display */}
      {countdown !== null && (
        <div style={countdownStyle}>
          {countdown}
        </div>
      )}

      {/* Similarity Score Display */}
      {isPlaying && !isVideoEnded && (
        <div style={scoreStyle}>
          Similarity Score: {similarityScore.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// Styles
const buttonStyle = {
  padding: '10px 20px',
  fontSize: '16px',
  backgroundColor: '#4CAF50',
  color: 'white',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  margin: '5px'
};

const inputStyle = {
  padding: '10px',
  fontSize: '16px',
  margin: '5px',
  width: '200px'
};

const videoContainerStyle = {
  position: 'relative',
  width: '400px',
  marginBottom: '20px'
};

const videoStyle = {
  width: '100%',
  height: 'auto',
  borderRadius: '12px',
  boxShadow: '0 0 10px rgba(0,0,0,0.3)',
  display: 'block'
};

const canvasOverlayStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  borderRadius: '12px'
};

const countdownStyle = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  color: 'white',
  padding: '40px',
  borderRadius: '50%',
  fontSize: '72px',
  fontWeight: 'bold',
  width: '150px',
  height: '150px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const scoreStyle = {
  position: 'fixed',
  top: '20px',
  right: '20px',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  color: 'white',
  padding: '20px',
  borderRadius: '10px',
  fontSize: '24px',
  fontWeight: 'bold'
};

export default App;
