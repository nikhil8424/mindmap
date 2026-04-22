import { useState, useEffect, useRef, useCallback } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';

export type GestureState = 'none' | 'rotate' | 'zoom' | 'pan';

export function useHandGesture(enabled: boolean, videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [gestureState, setGestureState] = useState<GestureState>('none');
  const [cameraMovement, setCameraMovement] = useState<{ type: GestureState; dx: number; dy: number; zoomDelta: number } | null>(null);
  
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const lastPinchDistance = useRef<number | null>(null);
  const lastIndexPos = useRef<{ x: number, y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    
    async function initMediaPipe() {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });

      if (isMounted) {
        landmarkerRef.current = landmarker;
      }
    }

    initMediaPipe();

    return () => {
      isMounted = false;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !videoRef.current || !landmarkerRef.current) return;

    const video = videoRef.current;
    
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (video) {
          video.srcObject = stream;
          video.addEventListener("loadeddata", predictWebcam);
        }
      } catch (err) {
        console.error("Error accessing webcam", err);
      }
    }

    let lastVideoTime = -1;

    const predictWebcam = () => {
      if (!video || !landmarkerRef.current) return;
      
      let startTimeMs = performance.now();
      if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const results = landmarkerRef.current.detectForVideo(video, startTimeMs);
        
        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];
          
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          
          const dist = Math.sqrt(
            Math.pow(thumbTip.x - indexTip.x, 2) + 
            Math.pow(thumbTip.y - indexTip.y, 2) + 
            Math.pow(thumbTip.z - indexTip.z, 2)
          );

          const isPinching = dist < 0.05;
          const currentPos = { x: indexTip.x, y: indexTip.y };

          if (isPinching) {
            setGestureState('zoom');
            if (lastPinchDistance.current !== null) {
              const zoomDelta = dist - lastPinchDistance.current;
              setCameraMovement({ type: 'zoom', dx: 0, dy: 0, zoomDelta: zoomDelta * 100 });
            }
            lastPinchDistance.current = dist;
            lastIndexPos.current = null;
          } else {
            setGestureState('rotate');
            if (lastIndexPos.current !== null) {
              const dx = currentPos.x - lastIndexPos.current.x;
              const dy = currentPos.y - lastIndexPos.current.y;
              setCameraMovement({ type: 'rotate', dx: -dx * 5, dy: dy * 5, zoomDelta: 0 });
            }
            lastIndexPos.current = currentPos;
            lastPinchDistance.current = null;
          }
        } else {
          setGestureState('none');
          setCameraMovement(null);
          lastIndexPos.current = null;
          lastPinchDistance.current = null;
        }
      }
      
      requestRef.current = requestAnimationFrame(predictWebcam);
    };

    startCamera();

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (video.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [enabled, videoRef.current, landmarkerRef.current]);

  return { gestureState, cameraMovement };
}
