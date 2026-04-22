import { useState, useEffect, useRef } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export type GestureState = "idle" | "tracking" | "grab";

export interface HandFrame {
  cursor: { x: number; y: number } | null; // normalized -1..1, mirrored
  pinching: boolean;
  pinchStrength: number; // 0 = wide, 1 = fully pinched
  gesture: GestureState;
}

export function useHandGesture(
  enabled: boolean,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const [gestureState, setGestureState] = useState<GestureState>("idle");
  const frameRef = useRef<HandFrame>({
    cursor: null,
    pinching: false,
    pinchStrength: 0,
    gesture: "idle",
  });

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Smoothed values (exponential moving average)
  const smoothedCursor = useRef<{ x: number; y: number } | null>(null);
  const smoothedPinch = useRef<number>(0);
  // Sticky pinch with hysteresis
  const pinchHeldRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) {
      // Reset state when disabled
      frameRef.current = { cursor: null, pinching: false, pinchStrength: 0, gesture: "idle" };
      setGestureState("idle");
      smoothedCursor.current = null;
      smoothedPinch.current = 0;
      pinchHeldRef.current = false;
      return;
    }

    let cancelled = false;
    let lastVideoTime = -1;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm",
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const tick = () => {
          if (cancelled) return;
          const lm = landmarkerRef.current;
          const v = videoRef.current;
          if (!lm || !v || v.readyState < 2) {
            requestRef.current = requestAnimationFrame(tick);
            return;
          }
          if (lastVideoTime !== v.currentTime) {
            lastVideoTime = v.currentTime;
            const results = lm.detectForVideo(v, performance.now());
            if (results.landmarks && results.landmarks.length > 0) {
              const landmarks = results.landmarks[0]!;
              const indexTip = landmarks[8]!;
              const thumbTip = landmarks[4]!;
              const wrist = landmarks[0]!;
              const middleMcp = landmarks[9]!;

              // Normalize hand size: distance wrist -> middle MCP gives a stable scale
              const handScale = Math.hypot(
                wrist.x - middleMcp.x,
                wrist.y - middleMcp.y,
              );

              const rawDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
              const normDist = handScale > 0 ? rawDist / handScale : rawDist;

              // Map normDist -> pinchStrength (1 closed, 0 open)
              // Typical normDist ~ 0.1 (closed) .. 1.2 (wide open)
              const minD = 0.15;
              const maxD = 1.0;
              const t = Math.max(0, Math.min(1, (maxD - normDist) / (maxD - minD)));
              const pinchStrength = t;

              // Hysteresis: enter pinch at >0.75, exit at <0.55
              if (pinchHeldRef.current) {
                if (pinchStrength < 0.55) pinchHeldRef.current = false;
              } else {
                if (pinchStrength > 0.75) pinchHeldRef.current = true;
              }

              // Mirror x because video is flipped horizontally for natural feel
              const cursorRaw = { x: 1 - indexTip.x, y: indexTip.y };
              // Convert to centered -1..1
              const cursorCentered = {
                x: cursorRaw.x * 2 - 1,
                y: -(cursorRaw.y * 2 - 1),
              };

              // Smooth (EMA)
              const alpha = 0.35;
              if (!smoothedCursor.current) {
                smoothedCursor.current = cursorCentered;
              } else {
                smoothedCursor.current = {
                  x: smoothedCursor.current.x + (cursorCentered.x - smoothedCursor.current.x) * alpha,
                  y: smoothedCursor.current.y + (cursorCentered.y - smoothedCursor.current.y) * alpha,
                };
              }
              const pAlpha = 0.4;
              smoothedPinch.current =
                smoothedPinch.current + (pinchStrength - smoothedPinch.current) * pAlpha;

              const gesture: GestureState = pinchHeldRef.current ? "grab" : "tracking";
              frameRef.current = {
                cursor: smoothedCursor.current,
                pinching: pinchHeldRef.current,
                pinchStrength: smoothedPinch.current,
                gesture,
              };
              if (gesture !== gestureState) setGestureState(gesture);
            } else {
              // No hand detected — fade cursor away
              smoothedCursor.current = null;
              smoothedPinch.current = 0;
              pinchHeldRef.current = false;
              if (frameRef.current.gesture !== "idle") {
                frameRef.current = { cursor: null, pinching: false, pinchStrength: 0, gesture: "idle" };
                setGestureState("idle");
              }
            }
          }
          requestRef.current = requestAnimationFrame(tick);
        };
        requestRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error("Hand gesture init failed", err);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
      frameRef.current = { cursor: null, pinching: false, pinchStrength: 0, gesture: "idle" };
      setGestureState("idle");
      smoothedCursor.current = null;
      smoothedPinch.current = 0;
      pinchHeldRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { gestureState, frameRef };
}
