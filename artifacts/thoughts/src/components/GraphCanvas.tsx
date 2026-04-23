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

const MODE_COLORS: Record<string, number> = {
  idle: 0x00f0ff,
  point: 0x00f0ff,
  pinch: 0xff3aa0,
  palm: 0xffb800,
};

export function GraphCanvas({ topology, gestureFrameRef, gestureEnabled, onNodeClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Group containing the entire constellation — gestures transform this, mouse moves the camera.
  const graphGroupRef = useRef<THREE.Group | null>(null);
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

    // Graph group — gestures will rotate / scale this
    const graphGroup = new THREE.Group();
    scene.add(graphGroup);
    graphGroupRef.current = graphGroup;

    // Fingertip cursor: glowing core + halo
    const cursorGroup = new THREE.Group();
    cursorGroup.visible = false;
    const coreGeo = new THREE.SphereGeometry(0.55, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({
      color: MODE_COLORS.idle,
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
      color: MODE_COLORS.idle,
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

    // ===== Gesture-driven transform state (per-mode anchors) =====
    let activeMode: HandFrame['mode'] = 'idle';
    // POINT mode: track previous cursor for delta-based rotation
    let pointPrevCursor: { x: number; y: number } | null = null;
    // PINCH mode: anchor scale & pinch distance at mode entry
    let pinchAnchorDist = 0;
    let pinchAnchorScale = 1;
    // PALM mode: store offset = inverse(anchorPalmQuat) * graphQuatAtEntry
    let palmAnchorOffset: THREE.Quaternion | null = null;
    let palmAnchorQuat: THREE.Quaternion | null = null;

    // Smoothed targets for graph group
    const targetGraphQuat = new THREE.Quaternion();
    let targetGraphScale = 1;
    let smoothedCursorWorld = new THREE.Vector3();
    let cursorVisible = false;

    const animate = () => {
      requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();

      const enabled = gestureEnabledRef.current;
      const frame = enabled ? gestureRefLocal.current?.current : null;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const graph = graphGroupRef.current;

      // Disable autoRotate while gesture system has a hand; resume idle drift otherwise
      if (controls) {
        const hasHand = !!(frame && frame.cursor);
        controls.autoRotate = !hasHand;
      }

      // ===== CURSOR VISUAL =====
      if (enabled && frame && frame.cursor && camera && controls && cursorGroupRef.current) {
        const cursor = frame.cursor;
        const ndc = new THREE.Vector3(cursor.x, cursor.y, 0.5);
        ndc.unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        const dist = camera.position.distanceTo(controls.target) * 0.6;
        const cw = new THREE.Vector3().copy(camera.position).add(dir.multiplyScalar(dist));
        if (!cursorVisible) {
          smoothedCursorWorld.copy(cw);
          cursorVisible = true;
        } else {
          smoothedCursorWorld.lerp(cw, 0.35);
        }
        cursorGroupRef.current.visible = true;
        cursorGroupRef.current.position.copy(smoothedCursorWorld);
        const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.08;
        if (cursorHaloRef.current) cursorHaloRef.current.scale.setScalar(pulse);

        const modeColor = new THREE.Color(MODE_COLORS[frame.mode] ?? MODE_COLORS.idle);
        if (cursorCoreRef.current) {
          (cursorCoreRef.current.material as THREE.MeshBasicMaterial).color.lerp(modeColor, 0.2);
          const s = frame.mode === 'pinch' ? 1.4 : frame.mode === 'palm' ? 1.2 : 1.0;
          cursorCoreRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
        }
        if (cursorHaloRef.current) {
          (cursorHaloRef.current.material as THREE.MeshBasicMaterial).color.lerp(modeColor, 0.2);
          (cursorHaloRef.current.material as THREE.MeshBasicMaterial).opacity =
            frame.mode === 'pinch' ? 0.45 : frame.mode === 'palm' ? 0.4 : 0.22;
        }
      } else {
        cursorVisible = false;
        if (cursorGroupRef.current) cursorGroupRef.current.visible = false;
      }

      // ===== GESTURE -> GRAPH TRANSFORM =====
      if (enabled && frame && graph) {
        // Detect mode entry/exit
        if (frame.mode !== activeMode) {
          // EXIT old mode
          if (activeMode === 'point') pointPrevCursor = null;
          if (activeMode === 'palm') {
            palmAnchorOffset = null;
            palmAnchorQuat = null;
          }
          // ENTER new mode — capture anchors
          if (frame.mode === 'point') {
            pointPrevCursor = frame.cursor ? { x: frame.cursor.x, y: frame.cursor.y } : null;
          } else if (frame.mode === 'pinch') {
            pinchAnchorDist = Math.max(0.05, frame.pinchDistance);
            pinchAnchorScale = targetGraphScale;
          } else if (frame.mode === 'palm') {
            const palm = new THREE.Quaternion(frame.palmQuat[0], frame.palmQuat[1], frame.palmQuat[2], frame.palmQuat[3]);
            palmAnchorQuat = palm.clone();
            // offset = inverse(palmAtEntry) * currentGraphQuat
            // so that target = palm * offset = currentGraphQuat at entry frame
            palmAnchorOffset = palm.clone().invert().multiply(targetGraphQuat.clone());
          }
          activeMode = frame.mode;
        }

        // APPLY current mode
        if (frame.mode === 'point' && frame.cursor) {
          if (pointPrevCursor) {
            const dx = frame.cursor.x - pointPrevCursor.x;
            const dy = frame.cursor.y - pointPrevCursor.y;
            // Yaw (Y axis) from horizontal motion, pitch (X axis) from vertical motion.
            // Use camera-relative axes so rotation follows current view.
            const speed = 3.0;
            const camQuat = camera ? camera.quaternion : new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camQuat);
            const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
            const dq = new THREE.Quaternion()
              .setFromAxisAngle(yAxis, dx * speed)
              .multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, -dy * speed));
            targetGraphQuat.premultiply(dq);
          }
          pointPrevCursor = { x: frame.cursor.x, y: frame.cursor.y };
        } else if (frame.mode === 'pinch') {
          // Continuous scaling from current/anchor distance.
          // Spec: closer fingers (smaller pinchDistance) -> graph SHRINKS.
          const ratio = Math.max(0.1, frame.pinchDistance) / pinchAnchorDist;
          targetGraphScale = Math.max(0.15, Math.min(4.0, pinchAnchorScale * ratio));
        } else if (frame.mode === 'palm' && palmAnchorOffset) {
          const palm = new THREE.Quaternion(frame.palmQuat[0], frame.palmQuat[1], frame.palmQuat[2], frame.palmQuat[3]);
          targetGraphQuat.copy(palm).multiply(palmAnchorOffset);
        }

        // Smooth apply to actual graph group
        graph.quaternion.slerp(targetGraphQuat, 0.18);
        const curS = graph.scale.x;
        const ns = curS + (targetGraphScale - curS) * 0.18;
        graph.scale.set(ns, ns, ns);
      } else if (graph) {
        // Gesture mode off — gently relax to identity? Keep current orientation; just stop animating.
      }

      // ===== RAYCAST HOVER =====
      if (camera && nodesMeshRef.current && topologyRef.current) {
        raycaster.current.setFromCamera(mouse.current, camera);
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

      // ===== NODE LERP & RENDERING =====
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

  // Update Topology — rebuild meshes inside graphGroup so gestures rotate them together
  useEffect(() => {
    const group = graphGroupRef.current;
    if (!group || !topology) return;

    if (nodesMeshRef.current) group.remove(nodesMeshRef.current);
    if (edgesLineRef.current) group.remove(edgesLineRef.current);

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

    nodes.forEach(
      (
        node: { id: number; x: number; y: number; z: number; cluster: number },
        i: number,
      ) => {
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
      },
    );

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    group.add(instancedMesh);
    nodesMeshRef.current = instancedMesh;

    currentPositions.current = curPos;
    targetPositions.current = tarPos;

    const lineGeo = new THREE.BufferGeometry();
    const linePositions = new Float32Array(edges.length * 2 * 3);
    const lineColors = new Float32Array(edges.length * 2 * 3);

    edges.forEach(
      (edge: { source: number; target: number; weight: number }, i: number) => {
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
      },
    );

    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.6,
    });

    const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
    group.add(lineMesh);
    edgesLineRef.current = lineMesh;
  }, [topology]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}
