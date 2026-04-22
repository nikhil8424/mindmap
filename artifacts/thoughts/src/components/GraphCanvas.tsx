import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GraphNode, Topology } from '@workspace/api-zod/src/generated/types';
import type { HandFrame } from '../hooks/useHandGesture';

interface GraphCanvasProps {
  topology: Topology | null;
  gestureFrameRef?: React.RefObject<HandFrame>;
  gestureEnabled?: boolean;
  onNodeClick: (node: GraphNode | null) => void;
}

const CLUSTER_COLORS = [
  0x00f0ff, // Cyan
  0x7b2cbf, // Violet
  0xff007a, // Pink
  0x00ff9d, // Mint
  0xffb800, // Gold
];

const CURSOR_COLOR_IDLE = 0x00f0ff;
const CURSOR_COLOR_GRAB = 0xff3aa0;

export function GraphCanvas({ topology, gestureFrameRef, gestureEnabled, onNodeClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const nodesMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const edgesLineRef = useRef<THREE.LineSegments | null>(null);
  const cursorGroupRef = useRef<THREE.Group | null>(null);
  const cursorCoreRef = useRef<THREE.Mesh | null>(null);
  const cursorHaloRef = useRef<THREE.Mesh | null>(null);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2(-2, -2));

  const targetPositions = useRef<Float32Array | null>(null);
  const currentPositions = useRef<Float32Array | null>(null);

  const [hoveredNodeIndex, setHoveredNodeIndex] = useState<number | null>(null);
  const hoveredNodeIndexRef = useRef<number | null>(null);
  hoveredNodeIndexRef.current = hoveredNodeIndex;

  const topologyRef = useRef<Topology | null>(null);
  topologyRef.current = topology;

  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  const gestureRefLocal = useRef(gestureFrameRef);
  gestureRefLocal.current = gestureFrameRef;
  const gestureEnabledRef = useRef(!!gestureEnabled);
  gestureEnabledRef.current = !!gestureEnabled;

  // Init scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040a, 0.02);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 30);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x02040a, 1);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    // Fingertip cursor: glowing core + halo. Initially hidden.
    const cursorGroup = new THREE.Group();
    cursorGroup.visible = false;
    const coreGeo = new THREE.SphereGeometry(0.55, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({
      color: CURSOR_COLOR_IDLE,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.renderOrder = 999;
    cursorGroup.add(core);

    const haloGeo = new THREE.SphereGeometry(1.3, 24, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: CURSOR_COLOR_IDLE,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.renderOrder = 998;
    cursorGroup.add(halo);

    scene.add(cursorGroup);
    cursorGroupRef.current = cursorGroup;
    cursorCoreRef.current = core;
    cursorHaloRef.current = halo;

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (event: MouseEvent) => {
      mouse.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleClick = () => {
      if (hoveredNodeIndexRef.current !== null && topologyRef.current) {
        const node = topologyRef.current.nodes[hoveredNodeIndexRef.current];
        if (node) onNodeClickRef.current(node);
      } else {
        onNodeClickRef.current(null);
      }
    };
    window.addEventListener('click', handleClick);

    // Gesture state for delta tracking
    let lastCursor: { x: number; y: number } | null = null;
    let wasGrabbing = false;
    let grabAnchorPinch = 0;
    let cursorWorld = new THREE.Vector3();
    let smoothedCursorWorld = new THREE.Vector3();
    let cursorVisible = false;

    const animate = () => {
      requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();

      // ==== GESTURE INPUT ====
      const enabled = gestureEnabledRef.current;
      const frame = enabled ? gestureRefLocal.current?.current : null;

      if (controlsRef.current && cameraRef.current) {
        if (enabled && frame) {
          // While gesture mode is active, suppress idle auto-rotate
          controlsRef.current.autoRotate = false;
        } else {
          // Re-enable subtle drift when no gesture
          if (!controlsRef.current.autoRotate) controlsRef.current.autoRotate = true;
        }
      }

      if (enabled && frame && frame.cursor && cameraRef.current && controlsRef.current) {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const cursor = frame.cursor;

        // Project cursor onto a plane in front of the camera
        const ndc = new THREE.Vector3(cursor.x, cursor.y, 0.5);
        ndc.unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        // Place cursor at fixed distance from camera along ray
        const dist = camera.position.distanceTo(controls.target) * 0.6;
        cursorWorld.copy(camera.position).add(dir.multiplyScalar(dist));
        // Smooth cursor world position to reduce jitter
        if (!cursorVisible) {
          smoothedCursorWorld.copy(cursorWorld);
          cursorVisible = true;
        } else {
          smoothedCursorWorld.lerp(cursorWorld, 0.35);
        }

        if (cursorGroupRef.current) {
          cursorGroupRef.current.visible = true;
          cursorGroupRef.current.position.copy(smoothedCursorWorld);
          // Pulse halo
          const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.08;
          if (cursorHaloRef.current) cursorHaloRef.current.scale.setScalar(pulse);
        }

        // Cursor color/scale based on pinch
        const pinching = frame.pinching;
        const targetColor = new THREE.Color(pinching ? CURSOR_COLOR_GRAB : CURSOR_COLOR_IDLE);
        if (cursorCoreRef.current) {
          (cursorCoreRef.current.material as THREE.MeshBasicMaterial).color.lerp(targetColor, 0.2);
          const s = pinching ? 1.4 : 1.0;
          cursorCoreRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
        }
        if (cursorHaloRef.current) {
          (cursorHaloRef.current.material as THREE.MeshBasicMaterial).color.lerp(targetColor, 0.2);
          (cursorHaloRef.current.material as THREE.MeshBasicMaterial).opacity = pinching ? 0.45 : 0.22;
        }

        // Compute cursor delta for camera control
        if (lastCursor) {
          const dx = cursor.x - lastCursor.x;
          const dy = cursor.y - lastCursor.y;

          if (pinching) {
            if (!wasGrabbing) {
              // Just started grabbing — anchor the current pinch strength as zoom reference
              grabAnchorPinch = frame.pinchStrength;
              wasGrabbing = true;
            }
            // Grab mode: rotate orbit AND pan target proportional to hand movement
            const rotSpeed = 2.4;
            controls.target.add(new THREE.Vector3(dx * rotSpeed, -dy * rotSpeed, 0));
            const orbitOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
            orbitOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -dx * rotSpeed);
            orbitOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), -dy * rotSpeed);
            camera.position.copy(controls.target).add(orbitOffset);

            // Pan target slightly to give translation feel — perpendicular to view dir
            const panAmount = camera.position.distanceTo(controls.target) * 0.4;
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            camera.getWorldDirection(right);
            right.cross(camera.up).normalize();
            up.copy(camera.up);
            const pan = new THREE.Vector3()
              .addScaledVector(right, dx * panAmount * 0.3)
              .addScaledVector(up, dy * panAmount * 0.3);
            controls.target.add(pan);

            // Pinch-distance zoom: tighter pinch (relative to anchor) = zoom in
            const pinchDelta = frame.pinchStrength - grabAnchorPinch;
            // Apply continuous zoom while held: positive delta means we tightened => zoom in
            const zoomFactor = 1 - pinchDelta * 0.06;
            const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
            const newLen = Math.max(6, Math.min(120, offset.length() * zoomFactor));
            offset.setLength(newLen);
            camera.position.copy(controls.target).add(offset);
          } else {
            wasGrabbing = false;
            // Open hand: rotate the graph based on cursor movement
            const rotSpeed = 1.6;
            const move = new THREE.Vector3(dx * rotSpeed * 12, -dy * rotSpeed * 12, 0);
            controls.target.add(move);
            camera.position.add(move);
          }
        }
        lastCursor = { x: cursor.x, y: cursor.y };
      } else {
        // No active hand
        lastCursor = null;
        wasGrabbing = false;
        cursorVisible = false;
        if (cursorGroupRef.current) cursorGroupRef.current.visible = false;
      }

      // ==== RAYCAST HOVER ====
      if (cameraRef.current && nodesMeshRef.current && topologyRef.current) {
        raycaster.current.setFromCamera(mouse.current, cameraRef.current);
        const intersects = raycaster.current.intersectObject(nodesMeshRef.current);
        if (intersects.length > 0) {
          const instanceId = intersects[0]!.instanceId;
          if (instanceId !== undefined && instanceId !== hoveredNodeIndexRef.current) {
            setHoveredNodeIndex(instanceId);
            document.body.style.cursor = 'pointer';
          }
        } else {
          if (hoveredNodeIndexRef.current !== null) {
            setHoveredNodeIndex(null);
            document.body.style.cursor = 'default';
          }
        }
      }

      // ==== NODE LERP & RENDERING ====
      if (nodesMeshRef.current && currentPositions.current && targetPositions.current && topologyRef.current) {
        const dummy = new THREE.Object3D();
        let needsUpdate = false;

        const hId = hoveredNodeIndexRef.current;
        const connectedNodes = new Set<number>();
        if (hId !== null) {
          const hoveredNode = topologyRef.current.nodes[hId];
          if (hoveredNode) {
            connectedNodes.add(hoveredNode.id);
            topologyRef.current.edges.forEach((e: { source: number; target: number }) => {
              if (e.source === hoveredNode.id) connectedNodes.add(e.target);
              if (e.target === hoveredNode.id) connectedNodes.add(e.source);
            });
          }
        }

        for (let i = 0; i < currentPositions.current.length / 3; i++) {
          const cx = currentPositions.current[i * 3]!;
          const cy = currentPositions.current[i * 3 + 1]!;
          const cz = currentPositions.current[i * 3 + 2]!;

          const tx = targetPositions.current[i * 3]!;
          const ty = targetPositions.current[i * 3 + 1]!;
          const tz = targetPositions.current[i * 3 + 2]!;

          const nx = cx + (tx - cx) * 0.05;
          const ny = cy + (ty - cy) * 0.05;
          const nz = cz + (tz - cz) * 0.05;

          currentPositions.current[i * 3] = nx;
          currentPositions.current[i * 3 + 1] = ny;
          currentPositions.current[i * 3 + 2] = nz;

          dummy.position.set(nx, ny, nz);

          let scale = 1;
          if (hId !== null && topologyRef.current.nodes[i]) {
            const isConnected = connectedNodes.has(topologyRef.current.nodes[i]!.id);
            scale = isConnected ? (i === hId ? 1.5 : 1.2) : 0.5;
          } else {
            scale = 1 + Math.sin(Date.now() * 0.002 + i) * 0.1;
          }

          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();

          nodesMeshRef.current.setMatrixAt(i, dummy.matrix);
          needsUpdate = true;
        }

        if (needsUpdate) nodesMeshRef.current.instanceMatrix.needsUpdate = true;

        if (edgesLineRef.current && edgesLineRef.current.geometry) {
          const positions = edgesLineRef.current.geometry.attributes.position!.array as Float32Array;
          const colors = edgesLineRef.current.geometry.attributes.color!.array as Float32Array;

          const hoveredId = hId !== null ? topologyRef.current.nodes[hId]?.id : undefined;

          topologyRef.current.edges.forEach((edge: { source: number; target: number; weight: number }, i: number) => {
            const sIdx = topologyRef.current!.nodes.findIndex((n: { id: number }) => n.id === edge.source);
            const tIdx = topologyRef.current!.nodes.findIndex((n: { id: number }) => n.id === edge.target);
            if (sIdx === -1 || tIdx === -1) return;

            positions[i * 6] = currentPositions.current![sIdx * 3]!;
            positions[i * 6 + 1] = currentPositions.current![sIdx * 3 + 1]!;
            positions[i * 6 + 2] = currentPositions.current![sIdx * 3 + 2]!;

            positions[i * 6 + 3] = currentPositions.current![tIdx * 3]!;
            positions[i * 6 + 4] = currentPositions.current![tIdx * 3 + 1]!;
            positions[i * 6 + 5] = currentPositions.current![tIdx * 3 + 2]!;

            let opacity = edge.weight;
            if (hoveredId !== undefined) {
              const sourceConnected = edge.source === hoveredId;
              const targetConnected = edge.target === hoveredId;
              opacity = sourceConnected || targetConnected ? 1 : 0.05;
            }

            const color = new THREE.Color(0xffffff).multiplyScalar(opacity);
            colors[i * 6] = color.r;
            colors[i * 6 + 1] = color.g;
            colors[i * 6 + 2] = color.b;
            colors[i * 6 + 3] = color.r;
            colors[i * 6 + 4] = color.g;
            colors[i * 6 + 5] = color.b;
          });

          edgesLineRef.current.geometry.attributes.position!.needsUpdate = true;
          edgesLineRef.current.geometry.attributes.color!.needsUpdate = true;
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
      document.body.style.cursor = 'default';
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
    };
  }, []);

  // Update Topology
  useEffect(() => {
    if (!sceneRef.current || !topology) return;

    if (nodesMeshRef.current) sceneRef.current.remove(nodesMeshRef.current);
    if (edgesLineRef.current) sceneRef.current.remove(edgesLineRef.current);

    const { nodes, edges } = topology;

    const geometry = new THREE.SphereGeometry(0.4, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.9,
    });

    const instancedMesh = new THREE.InstancedMesh(geometry, material, nodes.length);
    const dummy = new THREE.Object3D();

    const curPos = new Float32Array(nodes.length * 3);
    const tarPos = new Float32Array(nodes.length * 3);

    nodes.forEach((node: { id: number; x: number; y: number; z: number; cluster: number }, i: number) => {
      const sameSize = currentPositions.current && currentPositions.current.length === nodes.length * 3;
      const startX = sameSize ? currentPositions.current![i * 3]! : (Math.random() - 0.5) * 50;
      const startY = sameSize ? currentPositions.current![i * 3 + 1]! : (Math.random() - 0.5) * 50;
      const startZ = sameSize ? currentPositions.current![i * 3 + 2]! : (Math.random() - 0.5) * 50;

      curPos[i * 3] = startX;
      curPos[i * 3 + 1] = startY;
      curPos[i * 3 + 2] = startZ;

      tarPos[i * 3] = node.x;
      tarPos[i * 3 + 1] = node.y;
      tarPos[i * 3 + 2] = node.z;

      dummy.position.set(startX, startY, startZ);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);

      const color = new THREE.Color(CLUSTER_COLORS[node.cluster % CLUSTER_COLORS.length]!);
      instancedMesh.setColorAt(i, color);
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    sceneRef.current.add(instancedMesh);
    nodesMeshRef.current = instancedMesh;

    currentPositions.current = curPos;
    targetPositions.current = tarPos;

    const lineGeo = new THREE.BufferGeometry();
    const linePositions = new Float32Array(edges.length * 2 * 3);
    const lineColors = new Float32Array(edges.length * 2 * 3);

    edges.forEach((edge: { source: number; target: number; weight: number }, i: number) => {
      const sIdx = nodes.findIndex((n: { id: number }) => n.id === edge.source);
      const tIdx = nodes.findIndex((n: { id: number }) => n.id === edge.target);
      if (sIdx === -1 || tIdx === -1) return;

      linePositions[i * 6] = curPos[sIdx * 3]!;
      linePositions[i * 6 + 1] = curPos[sIdx * 3 + 1]!;
      linePositions[i * 6 + 2] = curPos[sIdx * 3 + 2]!;
      linePositions[i * 6 + 3] = curPos[tIdx * 3]!;
      linePositions[i * 6 + 4] = curPos[tIdx * 3 + 1]!;
      linePositions[i * 6 + 5] = curPos[tIdx * 3 + 2]!;

      const color = new THREE.Color(0xffffff).multiplyScalar(edge.weight);
      lineColors[i * 6] = color.r;
      lineColors[i * 6 + 1] = color.g;
      lineColors[i * 6 + 2] = color.b;
      lineColors[i * 6 + 3] = color.r;
      lineColors[i * 6 + 4] = color.g;
      lineColors[i * 6 + 5] = color.b;
    });

    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.6,
    });

    const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
    sceneRef.current.add(lineMesh);
    edgesLineRef.current = lineMesh;
  }, [topology]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}
