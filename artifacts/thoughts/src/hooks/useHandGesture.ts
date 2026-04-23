import { useState, useEffect, useRef } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export type GestureMode = "idle" | "point" | "pinch" | "palm";

interface Vec3 { x: number; y: number; z: number }

export interface HandFrame {
  mode: GestureMode;
  // Index fingertip in normalized centered coords -1..1 (mirrored x), null when no hand.
  cursor: { x: number; y: number } | null;
  // Normalized pinch distance (thumb tip - index tip) divided by hand size.
  // Smaller value = fingers closer together.
  pinchDistance: number;
  // Palm orientation as a quaternion (xyzw). Identity when not detected.
  palmQuat: [number, number, number, number];
  // Debug info for HUD
  fingers: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
}

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

function isFingerExtended(
  mcp: Vec3,
  pip: Vec3,
  tip: Vec3,
): boolean {
  // Vectors mcp->pip and pip->tip; if roughly aligned, finger is extended.
  const v1x = pip.x - mcp.x, v1y = pip.y - mcp.y, v1z = pip.z - mcp.z;
  const v2x = tip.x - pip.x, v2y = tip.y - pip.y, v2z = tip.z - pip.z;
  const l1 = Math.hypot(v1x, v1y, v1z);
  const l2 = Math.hypot(v2x, v2y, v2z);
  if (l1 < 1e-6 || l2 < 1e-6) return false;
  const dot = (v1x * v2x + v1y * v2y + v1z * v2z) / (l1 * l2);
  return dot > 0.6;
}

// Build quaternion from 3 orthonormal axes (columns of rotation matrix)
function quatFromBasis(
  rx: Vec3, ry: Vec3, rz: Vec3,
): [number, number, number, number] {
  const m00 = rx.x, m01 = ry.x, m02 = rz.x;
  const m10 = rx.y, m11 = ry.y, m12 = rz.y;
  const m20 = rx.z, m21 = ry.z, m22 = rz.z;
  const trace = m00 + m11 + m22;
  let qw: number, qx: number, qy: number, qz: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

// Quaternion slerp (in-place style returning new array)
function slerpQuat(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let cosHalf = ax * bx + ay * by + az * bz + aw * bw;
  if (cosHalf < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw; cosHalf = -cosHalf;
  }
  if (cosHalf > 0.9995) {
    return [
      ax + (bx - ax) * t,
      ay + (by - ay) * t,
      az + (bz - az) * t,
      aw + (bw - aw) * t,
    ];
  }
  const sinHalf = Math.sqrt(1 - cosHalf * cosHalf);
  const halfTheta = Math.atan2(sinHalf, cosHalf);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalf;
  const ratioB = Math.sin(t * halfTheta) / sinHalf;
  return [ax * ratioA + bx * ratioB, ay * ratioA + by * ratioB, az * ratioA + bz * ratioB, aw * ratioA + bw * ratioB];
}

export function useHandGesture(
  enabled: boolean,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const [gestureMode, setGestureMode] = useState<GestureMode>("idle");
  const frameRef = useRef<HandFrame>({
    mode: "idle",
    cursor: null,
    pinchDistance: 1,
    palmQuat: IDENTITY_QUAT,
    fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
  });

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Smoothing state
  const smoothCursor = useRef<{ x: number; y: number } | null>(null);
  const smoothPinch = useRef<number>(1);
  const smoothQuat = useRef<[number, number, number, number]>(IDENTITY_QUAT);
  // Mode stability (frames in a row before switching)
  const candidateMode = useRef<GestureMode>("idle");
  const candidateFrames = useRef<number>(0);
  const currentMode = useRef<GestureMode>("idle");

  useEffect(() => {
    if (!enabled) {
      frameRef.current = {
        mode: "idle",
        cursor: null,
        pinchDistance: 1,
        palmQuat: IDENTITY_QUAT,
        fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      };
      setGestureMode("idle");
      smoothCursor.current = null;
      smoothPinch.current = 1;
      smoothQuat.current = IDENTITY_QUAT;
      candidateMode.current = "idle";
      candidateFrames.current = 0;
      currentMode.current = "idle";
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
              const lms = results.landmarks[0]!;
              processFrame(lms);
            } else {
              // No hand: drift back to idle
              decayToIdle();
            }
          }
          requestRef.current = requestAnimationFrame(tick);
        };
        requestRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error("Hand gesture init failed", err);
      }
    };

    const decayToIdle = () => {
      smoothCursor.current = null;
      smoothPinch.current = 1;
      smoothQuat.current = IDENTITY_QUAT;
      candidateMode.current = "idle";
      candidateFrames.current = 0;
      if (currentMode.current !== "idle") {
        currentMode.current = "idle";
        setGestureMode("idle");
      }
      frameRef.current = {
        mode: "idle",
        cursor: null,
        pinchDistance: 1,
        palmQuat: IDENTITY_QUAT,
        fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      };
    };

    const processFrame = (lms: Vec3[]) => {
      const wrist = lms[0]!;
      const indexMCP = lms[5]!;
      const middleMCP = lms[9]!;
      const ringMCP = lms[13]!;
      const pinkyMCP = lms[17]!;
      const indexTip = lms[8]!;
      const thumbTip = lms[4]!;

      const handScale = Math.hypot(
        wrist.x - middleMCP.x,
        wrist.y - middleMCP.y,
        wrist.z - middleMCP.z,
      ) || 1;

      // Finger extension detection
      const thumbExt = isFingerExtended(lms[1]!, lms[2]!, lms[4]!);
      const indexExt = isFingerExtended(lms[5]!, lms[6]!, lms[8]!);
      const middleExt = isFingerExtended(lms[9]!, lms[10]!, lms[12]!);
      const ringExt = isFingerExtended(lms[13]!, lms[14]!, lms[16]!);
      const pinkyExt = isFingerExtended(lms[17]!, lms[18]!, lms[20]!);

      // Pinch normalized distance
      const rawPinch = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y, thumbTip.z - indexTip.z);
      const normPinch = rawPinch / handScale;

      // Palm orientation: build basis from wrist, indexMCP, pinkyMCP.
      // Y axis = (indexMCP+pinkyMCP)/2 - wrist (along fingers)
      // X axis (across palm) = pinkyMCP - indexMCP
      // Z axis = X x Y (palm normal)
      const palmCenter: Vec3 = {
        x: (indexMCP.x + pinkyMCP.x) / 2,
        y: (indexMCP.y + pinkyMCP.y) / 2,
        z: (indexMCP.z + pinkyMCP.z) / 2,
      };
      const yAxisRaw = sub(palmCenter, wrist);
      const xAxisRaw = sub(pinkyMCP, indexMCP);
      // Mirror x for natural "user-facing" hand mapping
      const xAxisMirrored: Vec3 = { x: -xAxisRaw.x, y: xAxisRaw.y, z: xAxisRaw.z };
      const yAxisMirrored: Vec3 = { x: -yAxisRaw.x, y: -yAxisRaw.y, z: yAxisRaw.z };
      const yN = normalize(yAxisMirrored);
      let xN = normalize(xAxisMirrored);
      // Re-orthogonalize x against y
      const dotXY = xN.x * yN.x + xN.y * yN.y + xN.z * yN.z;
      xN = normalize({ x: xN.x - yN.x * dotXY, y: xN.y - yN.y * dotXY, z: xN.z - yN.z * dotXY });
      const zN = normalize(cross(xN, yN));
      const palmQuat = quatFromBasis(xN, yN, zN);

      // ===== Mode classification with hysteresis =====
      let proposed: GestureMode = "idle";
      // Pinch wins when index+thumb close together (regardless of others)
      const pinchActive = normPinch < 0.45 && indexExt; // index must be out for clean pinch
      // Palm: all 5 extended
      const palmActive = thumbExt && indexExt && middleExt && ringExt && pinkyExt;
      // Point: only index extended, others curled
      const pointActive = indexExt && !middleExt && !ringExt && !pinkyExt && !pinchActive;

      if (pinchActive) proposed = "pinch";
      else if (palmActive) proposed = "palm";
      else if (pointActive) proposed = "point";
      else proposed = "idle";

      if (proposed === candidateMode.current) {
        candidateFrames.current++;
      } else {
        candidateMode.current = proposed;
        candidateFrames.current = 1;
      }
      const REQ_FRAMES = 3;
      if (candidateFrames.current >= REQ_FRAMES && candidateMode.current !== currentMode.current) {
        currentMode.current = candidateMode.current;
        setGestureMode(currentMode.current);
        // Reset smoothing state on mode entry to avoid jumps
        smoothCursor.current = null;
        // Don't reset pinch/quat smoothing; canvas will anchor
      }

      // ===== Smooth values =====
      const cursorRaw = { x: 1 - indexTip.x, y: indexTip.y };
      const cursorCentered = { x: cursorRaw.x * 2 - 1, y: -(cursorRaw.y * 2 - 1) };
      const cAlpha = 0.4;
      if (!smoothCursor.current) smoothCursor.current = cursorCentered;
      else smoothCursor.current = {
        x: smoothCursor.current.x + (cursorCentered.x - smoothCursor.current.x) * cAlpha,
        y: smoothCursor.current.y + (cursorCentered.y - smoothCursor.current.y) * cAlpha,
      };

      const pAlpha = 0.45;
      smoothPinch.current = smoothPinch.current + (normPinch - smoothPinch.current) * pAlpha;

      // Slerp palm quaternion
      smoothQuat.current = slerpQuat(smoothQuat.current, palmQuat, 0.35);

      frameRef.current = {
        mode: currentMode.current,
        cursor: smoothCursor.current,
        pinchDistance: smoothPinch.current,
        palmQuat: smoothQuat.current,
        fingers: { thumb: thumbExt, index: indexExt, middle: middleExt, ring: ringExt, pinky: pinkyExt },
      };
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
      frameRef.current = {
        mode: "idle",
        cursor: null,
        pinchDistance: 1,
        palmQuat: IDENTITY_QUAT,
        fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      };
      setGestureMode("idle");
      smoothCursor.current = null;
      smoothPinch.current = 1;
      smoothQuat.current = IDENTITY_QUAT;
      candidateMode.current = "idle";
      candidateFrames.current = 0;
      currentMode.current = "idle";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { gestureMode, frameRef };
}
