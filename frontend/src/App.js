import React, { useRef, useEffect, useState, useCallback } from "react";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const referenceVideoRef = useRef(null);
  const referenceCanvasRef = useRef(null);
  const poseRef = useRef(null);
  const referencePoseRef = useRef(null);
  const [isReferenceVideoReady, setIsReferenceVideoReady] = useState(false);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [similarityScore, setSimilarityScore] = useState(null);
  const [referencePoses, setReferencePoses] = useState([]);
  const [userPoses, setUserPoses] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [isReady, setIsReady] = useState(false);

  const onResults = useCallback((results) => {
    if (!canvasRef.current) return;
    
    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext("2d");

    // Clear the canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Draw the video frame mirrored
    canvasCtx.save();
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, -canvasElement.width, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();

    if (results.poseLandmarks) {
      // Mirror the landmarks
      const mirroredLandmarks = results.poseLandmarks.map(landmark => ({
        ...landmark,
        x: 1 - landmark.x // Mirror x coordinate
      }));

      // Draw the pose landmarks
      window.drawConnectors(canvasCtx, mirroredLandmarks, window.POSE_CONNECTIONS,
        { color: '#00FF00', lineWidth: 2 });
      window.drawLandmarks(canvasCtx, mirroredLandmarks,
        { color: '#FF0000', lineWidth: 1, radius: 3 });

      // Store user poses if recording
      if (isRecording && isPlaying) {
        setUserPoses(prev => [...prev, mirroredLandmarks]);
      }
    }
  }, [isRecording, isPlaying]);

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
        setReferencePoses(prev => [...prev, results.poseLandmarks]);
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
    if (referencePoses.length < 2 || userPoses.length < 2) return 0;

    // Calculate movement vectors for both sequences
    const refMovementVectors = [];
    const userMovementVectors = [];

    // Calculate vectors for reference video
    for (let i = 1; i < referencePoses.length; i++) {
      const vector = calculateMovementVector(referencePoses[i-1], referencePoses[i]);
      if (vector) refMovementVectors.push(vector);
    }

    // Calculate vectors for user video
    for (let i = 1; i < userPoses.length; i++) {
      const vector = calculateMovementVector(userPoses[i-1], userPoses[i]);
      if (vector) userMovementVectors.push(vector);
    }

    // Normalize the number of vectors to compare
    const minLength = Math.min(refMovementVectors.length, userMovementVectors.length);
    if (minLength === 0) return 0;

    let totalSimilarity = 0;
    let count = 0;

    // Compare corresponding movement vectors
    for (let i = 0; i < minLength; i++) {
      const similarity = calculateCosineSimilarity(refMovementVectors[i], userMovementVectors[i]);
      if (!isNaN(similarity)) {
        totalSimilarity += similarity;
        count++;
      }
    }

    return count > 0 ? (totalSimilarity / count) : 0;
  };

  const handleVideoEnd = () => {
    setIsPlaying(false);
    setIsRecording(false);
    const score = calculateSimilarity();
    setSimilarityScore(score);
    setReferencePoses([]);
    setUserPoses([]);
  };

  const startCountdown = () => {
    setCountdown(3);
    setIsReady(true);
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
        setIsRecording(true);
        setSimilarityScore(null);
        setReferencePoses([]);
        setUserPoses([]);
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
        setIsRecording(false);
        setIsReady(false);
      } else {
        startCountdown();
      }
    }
  };

  const restartVideo = () => {
    if (referenceVideoRef.current) {
      referenceVideoRef.current.currentTime = 0;
      setIsPlaying(false);
      setIsRecording(false);
      setIsReady(false);
      setCountdown(null);
      // Clear all stored data
      setSimilarityScore(null);
      setReferencePoses([]);
      setUserPoses([]);
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

  return (
    <div className="App" style={{ textAlign: "center", padding: "20px" }}>
      <h1>Dance Battle App</h1>
      {similarityScore !== null && (
        <div style={{
          fontSize: "24px",
          margin: "20px",
          padding: "15px",
          backgroundColor: "#f0f0f0",
          borderRadius: "10px",
          display: "inline-block"
        }}>
          Similarity Score: {similarityScore.toFixed(2)}%
        </div>
      )}
      {countdown !== null && (
        <div style={{
          fontSize: "72px",
          margin: "20px",
          padding: "15px",
          color: "#4CAF50",
          fontWeight: "bold"
        }}>
          {countdown}
        </div>
      )}
      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        gap: "40px",
        flexWrap: "wrap",
        maxWidth: "1400px",
        margin: "0 auto"
      }}>
        {/* Reference video container */}
        <div style={{ 
          position: "relative",
          width: "640px",
          marginBottom: "20px"
        }}>
          <h3>Reference Dance</h3>
          <div style={{ position: "relative" }}>
            <video
              ref={referenceVideoRef}
              src="/justdance1.mp4"
              playsInline
              onLoadedMetadata={handleReferenceVideoLoad}
              onEnded={handleVideoEnd}
              style={{ 
                width: "100%",
                height: "auto",
                borderRadius: "12px",
                boxShadow: "0 0 10px rgba(0,0,0,0.3)",
                display: "block"
              }}
            />
            <canvas
              ref={referenceCanvasRef}
              width="640"
              height="480"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                borderRadius: "12px",
                boxShadow: "0 0 10px rgba(0,0,0,0.3)"
              }}
            />
            <div style={{
              position: "absolute",
              bottom: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: "10px",
              zIndex: 10
            }}>
              <button
                onClick={togglePlayPause}
                style={{
                  padding: "8px 16px",
                  borderRadius: "20px",
                  border: "none",
                  backgroundColor: isReady ? "#FF5722" : "#4CAF50",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "16px"
                }}
              >
                {isReady ? "Cancel" : (isPlaying ? "Pause" : "Start")}
              </button>
              <button
                onClick={restartVideo}
                style={{
                  padding: "8px 16px",
                  borderRadius: "20px",
                  border: "none",
                  backgroundColor: "#2196F3",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "16px"
                }}
              >
                Restart
              </button>
            </div>
          </div>
        </div>

        {/* User's video container */}
        <div style={{ 
          position: "relative",
          width: "640px",
          marginBottom: "20px"
        }}>
          <h3>Your Dance</h3>
          <div style={{ position: "relative" }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              style={{ 
                width: "100%",
                height: "auto",
                borderRadius: "12px",
                boxShadow: "0 0 10px rgba(0,0,0,0.3)",
                display: "block"
              }}
            />
            <canvas
              ref={canvasRef}
              width="640"
              height="480"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                borderRadius: "12px",
                boxShadow: "0 0 10px rgba(0,0,0,0.3)"
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
