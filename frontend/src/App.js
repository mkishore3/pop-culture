import React, { useRef, useEffect, useState } from "react";

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
  }, []);

  const onResults = (results) => {
    if (!canvasRef.current) return;
    
    const canvasElement = canvasRef.current;
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
    }
  };

  const onReferenceResults = (results) => {
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

  const handleReferenceVideoLoad = () => {
    if (referenceVideoRef.current) {
      setIsReferenceVideoReady(true);
    }
  };

  const togglePlayPause = () => {
    if (referenceVideoRef.current) {
      if (isPlaying) {
        referenceVideoRef.current.pause();
      } else {
        referenceVideoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const restartVideo = () => {
    if (referenceVideoRef.current) {
      referenceVideoRef.current.currentTime = 0;
      referenceVideoRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="App" style={{ textAlign: "center", padding: "20px" }}>
      <h1>Dance Battle App</h1>
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
                  backgroundColor: "#4CAF50",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "16px"
                }}
              >
                {isPlaying ? "Pause" : "Play"}
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
