import React, { useRef, useEffect, useState, useCallback } from "react";
import { db, auth, functions } from './firebase';
import { doc, setDoc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

function App() {
  const [gameState, setGameState] = useState('lobby'); // 'lobby', 'waiting', 'playing', 'results'
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [gameResults, setGameResults] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const referenceVideoRef = useRef(null);
  const referenceCanvasRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const poseRef = useRef(null);
  const referencePoseRef = useRef(null);
  const pcRef = useRef(null);
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

  // Firebase Functions
  const createRoomFunction = httpsCallable(functions, 'createRoom');
  const joinRoomFunction = httpsCallable(functions, 'joinRoom');
  const startGameFunction = httpsCallable(functions, 'startGame');
  const submitScoreFunction = httpsCallable(functions, 'submitScore');
  const handleOfferFunction = httpsCallable(functions, 'handleOffer');
  const handleAnswerFunction = httpsCallable(functions, 'handleAnswer');
  const handleIceCandidateFunction = httpsCallable(functions, 'handleIceCandidate');

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

  const handleVideoEnd = async () => {
    setIsPlaying(false);
    setIsVideoEnded(true);
    const score = calculateSimilarity();
    setSimilarityScore(score);
    referencePoseRef.current.lastResults = null;
    
    // Submit score
    await submitScore(score);
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

  // WebRTC configuration
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  // Initialize WebRTC
  const initializeWebRTC = async () => {
    try {
      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;

      // Handle incoming tracks
      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          handleIceCandidateFunction({
            roomId,
            playerId,
            candidate: event.candidate
          });
        }
      };

      // Get local stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      return pc;
    } catch (error) {
      console.error('Error initializing WebRTC:', error);
    }
  };

  // Handle signaling
  const handleSignaling = async (pc) => {
    if (isHost) {
      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await handleOfferFunction({
        roomId,
        playerId,
        offer
      });

      // Listen for answer
      const unsubscribe = onSnapshot(doc(db, 'rooms', roomId), async (doc) => {
        const data = doc.data();
        const answer = data.signaling?.answers?.[playerId];
        if (answer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      return unsubscribe;
    } else {
      // Listen for offer
      const unsubscribe = onSnapshot(doc(db, 'rooms', roomId), async (doc) => {
        const data = doc.data();
        const offer = data.signaling?.offers?.[data.hostId];
        if (offer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await handleAnswerFunction({
            roomId,
            playerId,
            answer
          });
        }
      });

      return unsubscribe;
    }
  };

  // Create a new game room
  const createRoom = async () => {
    try {
      console.log('Attempting to create room...');
      const result = await createRoomFunction();
      console.log('Room creation result:', result);
      
      if (!result || !result.data) {
        throw new Error('Invalid response from server');
      }

      const roomId = result.data.roomId;
      console.log('Created room with ID:', roomId);
      
      const pc = await initializeWebRTC();
      console.log('WebRTC initialized');
      
      setRoomId(roomId);
      setPlayerId(roomId);
      setIsHost(true);
      setGameState('waiting');

      // Handle signaling
      const unsubscribe = await handleSignaling(pc);
      console.log('Signaling setup complete');

      // Listen for room updates
      onSnapshot(doc(db, 'rooms', roomId), (doc) => {
        const data = doc.data();
        console.log('Room update:', data);
        if (data.gameStarted) {
          startGame();
        }
        if (data.status === 'completed') {
          setGameResults({
            winnerId: data.winnerId,
            scores: data.scores
          });
          setGameState('results');
          unsubscribe();
        }
      });
    } catch (error) {
      console.error('Error creating room:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      alert(`Failed to create game room: ${error.message}`);
    }
  };

  // Join an existing room
  const joinRoom = async () => {
    try {
      const playerId = Math.random().toString(36).substring(2, 8).toUpperCase();
      await joinRoomFunction({ roomId, playerId });
      const pc = await initializeWebRTC();
      
      setPlayerId(playerId);
      setGameState('waiting');

      // Handle signaling
      const unsubscribe = await handleSignaling(pc);

      // Listen for game start and results
      onSnapshot(doc(db, 'rooms', roomId), (doc) => {
        const data = doc.data();
        if (data.gameStarted) {
          startGame();
        }
        if (data.status === 'completed') {
          setGameResults({
            winnerId: data.winnerId,
            scores: data.scores
          });
          setGameState('results');
          unsubscribe();
        }
      });
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join game room');
    }
  };

  // Start the game
  const startGame = async () => {
    try {
      await startGameFunction({ roomId });
      setGameState('playing');
      startCountdown();
    } catch (error) {
      console.error('Error starting game:', error);
      alert('Failed to start game');
    }
  };

  // Submit score
  const submitScore = async (score) => {
    try {
      await submitScoreFunction({
        roomId,
        playerId,
        score
      });
    } catch (error) {
      console.error('Error submitting score:', error);
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
        if (remoteVideoRef.current) {
          const videoCtx = remoteVideoRef.current.getContext('2d');
          videoCtx.clearRect(0, 0, remoteVideoRef.current.width, remoteVideoRef.current.height);
          if (data.landmarks) {
            window.drawConnectors(videoCtx, data.landmarks, window.POSE_CONNECTIONS,
              { color: '#0000FF', lineWidth: 2 });
            window.drawLandmarks(videoCtx, data.landmarks,
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
        <div style={{
          maxWidth: '600px',
          margin: '0 auto',
          padding: '20px',
          textAlign: 'center'
        }}>
          <h1 style={{ fontSize: '48px', marginBottom: '40px' }}>Dance Battle</h1>
          
          <div style={{
            backgroundColor: '#f0f0f0',
            padding: '30px',
            borderRadius: '15px',
            marginBottom: '30px'
          }}>
            <h2 style={{ marginBottom: '20px' }}>Create Game</h2>
            <button 
              onClick={createRoom}
              style={{
                ...buttonStyle,
                fontSize: '24px',
                padding: '15px 30px',
                backgroundColor: '#4CAF50'
              }}
            >
              Create New Game
            </button>
          </div>

          <div style={{
            backgroundColor: '#f0f0f0',
            padding: '30px',
            borderRadius: '15px'
          }}>
            <h2 style={{ marginBottom: '20px' }}>Join Game</h2>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '15px'
            }}>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="Enter Game Code"
                style={{
                  ...inputStyle,
                  fontSize: '24px',
                  textAlign: 'center',
                  letterSpacing: '2px',
                  textTransform: 'uppercase'
                }}
                maxLength={6}
              />
              <button 
                onClick={joinRoom}
                style={{
                  ...buttonStyle,
                  fontSize: '24px',
                  padding: '15px 30px',
                  backgroundColor: '#2196F3'
                }}
              >
                Join Game
              </button>
            </div>
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
          {isHost && (
            <button
              onClick={() => {
                updateDoc(doc(db, 'rooms', roomId), {
                  gameStarted: true
                });
              }}
              style={buttonStyle}
            >
              Start Game
            </button>
          )}
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
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={videoStyle}
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
            {gameResults.winnerId === playerId ? 'You Won!' : 'Opponent Won!'}
          </div>
          <div style={{ margin: '20px 0' }}>
            <p>Your Score: {gameResults.scores[playerId]}%</p>
            <p>Opponent's Score: {gameResults.scores[gameResults.winnerId === playerId ? 
              (gameResults.winnerId === gameResults.scores.player1_id ? gameResults.scores.player2_id : gameResults.scores.player1_id) 
              : gameResults.winnerId]}%</p>
          </div>
          <button
            onClick={() => {
              setGameState('lobby');
              setRoomId('');
              setPlayerId('');
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
