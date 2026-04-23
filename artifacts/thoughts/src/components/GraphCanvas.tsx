import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GraphNode, Topology } from '@workspace/api-zod';
import type { HandFrame } from '../hooks/useHandGesture';

interface GraphCanvasProps {
  topology: Topology | null;
  gestureFrameRef?: React.RefObject<HandFrame>;
  gestureEnabled?: boolean;
  onNodeClick: (node: GraphNode | null) => void;
  /** Visibility window — only nodes whose timestamp falls inside are shown */
  timeRange?: [number, number] | null;
  /** 'mood' = HSL by mood; 'cluster' = original cluster palette */
  colorMode?: 'mood' | 'cluster';
}

const CLUSTER_COLORS = [
  0x00f0ff, 0x7b2cbf, 0xff007a, 0x00ff9d, 0xffb800,
];

const MODE_COLORS: Record<string, number> = {
  idle: 0x00f0ff,
  point: 0x00f0ff,
  pinch: 0xff3aa0,
  palm: 0xffb800,
};

function moodToColor(mood: number): THREE.Color {
  // mood 1 -> red (0deg), 5 -> yellow (60), 10 -> green (130)
  const m = Math.max(1, Math.min(10, mood));
  const hue = ((m - 1) / 9) * (130 / 360);
  return new THREE.Color().setHSL(hue, 0.8, 0.55);
}

function freqToScale(freq: number): number {
  // freq 1 -> 1.0, freq 2 -> 1.3, freq 4 -> 1.6, freq 8 -> 1.9
  return 1 + Math.log2(Math.max(1, freq)) * 0.3;
}

export function GraphCanvas({
  topology,
  gestureFrameRef,
  gestureEnabled,
  onNodeClick,
  timeRange,
  colorMode = 'mood',
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

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
  const baseScales = useRef<Float32Array | null>(null);

  const [hoveredNodeIndex, setHoveredNodeIndex] = useState<number | null>(null);
  const hoveredNodeIndexRef = useRef<number | null>(null);
  hoveredNodeIndexRef.current = hoveredNodeIndex;

  const topologyRef = useRef<Topology | null>(null);
  topologyRef.current = topology;

  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  const timeRangeRef = useRef<[number, number] | null>(timeRange ?? null);
  timeRangeRef.current = timeRange ?? null;

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

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    const graphGroup = new THREE.Group();
    scene.add(graphGroup);
    graphGroupRef.current = graphGroup;

    // Cursor visualization
    const cursorGroup = new THREE.Group();
    cursorGroup.visible = false;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 24),
      new THREE.MeshBasicMaterial({
        color: MODE_COLORS.idle,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthTest: false,
      }),
    );
    core.renderOrder = 999;
    cursorGroup.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 24, 24),
      new THREE.MeshBasicMaterial({
        color: MODE_COLORS.idle,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthTest: false,
      }),
    );
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

    // Gesture state
    let activeMode: HandFrame['mode'] = 'idle';
    let pointPrevCursor: { x: number; y: number } | null = null;
    let pinchAnchorDist = 0;
    let pinchAnchorScale = 1;
    let palmAnchorOffset: THREE.Quaternion | null = null;

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

      if (controls) {
        const hasHand = !!(frame && frame.cursor);
        controls.autoRotate = !hasHand;
      }

      // CURSOR
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

      // GESTURE -> GRAPH
      if (enabled && frame && graph) {
        if (frame.mode !== activeMode) {
          if (activeMode === 'point') pointPrevCursor = null;
          if (activeMode === 'palm') palmAnchorOffset = null;
          if (frame.mode === 'point') {
            pointPrevCursor = frame.cursor ? { x: frame.cursor.x, y: frame.cursor.y } : null;
          } else if (frame.mode === 'pinch') {
            pinchAnchorDist = Math.max(0.05, frame.pinchDistance);
            pinchAnchorScale = targetGraphScale;
          } else if (frame.mode === 'palm') {
            const palm = new THREE.Quaternion(frame.palmQuat[0], frame.palmQuat[1], frame.palmQuat[2], frame.palmQuat[3]);
            palmAnchorOffset = palm.clone().invert().multiply(targetGraphQuat.clone());
          }
          activeMode = frame.mode;
        }

        if (frame.mode === 'point' && frame.cursor) {
          if (pointPrevCursor) {
            const dx = frame.cursor.x - pointPrevCursor.x;
            const dy = frame.cursor.y - pointPrevCursor.y;
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
          const ratio = Math.max(0.1, frame.pinchDistance) / pinchAnchorDist;
          targetGraphScale = Math.max(0.15, Math.min(4.0, pinchAnchorScale * ratio));
        } else if (frame.mode === 'palm' && palmAnchorOffset) {
          const palm = new THREE.Quaternion(frame.palmQuat[0], frame.palmQuat[1], frame.palmQuat[2], frame.palmQuat[3]);
          targetGraphQuat.copy(palm).multiply(palmAnchorOffset);
        }

        graph.quaternion.slerp(targetGraphQuat, 0.18);
        const curS = graph.scale.x;
        const ns = curS + (targetGraphScale - curS) * 0.18;
        graph.scale.set(ns, ns, ns);
      }

      // RAYCAST HOVER
      if (camera && nodesMeshRef.current && topologyRef.current) {
        raycaster.current.setFromCamera(mouse.current, camera);
        const intersects = raycaster.current.intersectObject(nodesMeshRef.current);
        if (intersects.length > 0) {
          const instanceId = intersects[0]!.instanceId;
          if (instanceId !== undefined && instanceId !== hoveredNodeIndexRef.current) {
            setHoveredNodeIndex(instanceId);
            document.body.style.cursor = 'pointer';
          }
        } else if (hoveredNodeIndexRef.current !== null) {
          setHoveredNodeIndex(null);
          document.body.style.cursor = 'default';
        }
      }

      // NODE LERP & RENDERING
      if (
        nodesMeshRef.current &&
        currentPositions.current &&
        targetPositions.current &&
        baseScales.current &&
        topologyRef.current
      ) {
        const dummy = new THREE.Object3D();
        const hId = hoveredNodeIndexRef.current;
        const range = timeRangeRef.current;

        const connected = new Set<number>();
        if (hId !== null) {
          const hoveredNode = topologyRef.current.nodes[hId];
          if (hoveredNode) {
            connected.add(hoveredNode.id);
            topologyRef.current.edges.forEach((e) => {
              if (e.source === hoveredNode.id) connected.add(e.target);
              if (e.target === hoveredNode.id) connected.add(e.source);
            });
          }
        }

        const visibleSet = new Set<number>();
        const nodeCount = currentPositions.current.length / 3;
        for (let i = 0; i < nodeCount; i++) {
          const node = topologyRef.current.nodes[i];
          if (!node) continue;
          if (range && (node.timestamp < range[0] || node.timestamp > range[1])) continue;
          visibleSet.add(node.id);
        }

        for (let i = 0; i < nodeCount; i++) {
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

          const node = topologyRef.current.nodes[i];
          const inWindow = !node || (range ? visibleSet.has(node.id) : true);
          const base = baseScales.current[i] ?? 1;
          let scale: number;
          if (!inWindow) {
            scale = 0.0001;
          } else if (hId !== null) {
            const isConnected = node ? connected.has(node.id) : false;
            scale = isConnected ? base * (i === hId ? 1.5 : 1.2) : base * 0.5;
          } else {
            scale = base * (1 + Math.sin(Date.now() * 0.002 + i) * 0.06);
          }

          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          nodesMeshRef.current.setMatrixAt(i, dummy.matrix);
        }
        nodesMeshRef.current.instanceMatrix.needsUpdate = true;

        if (edgesLineRef.current && edgesLineRef.current.geometry) {
          const positions = edgesLineRef.current.geometry.attributes.position!.array as Float32Array;
          const colors = edgesLineRef.current.geometry.attributes.color!.array as Float32Array;
          const hoveredId = hId !== null ? topologyRef.current.nodes[hId]?.id : undefined;

          topologyRef.current.edges.forEach((edge, i) => {
            const sIdx = topologyRef.current!.nodes.findIndex((n) => n.id === edge.source);
            const tIdx = topologyRef.current!.nodes.findIndex((n) => n.id === edge.target);
            if (sIdx === -1 || tIdx === -1) return;

            positions[i * 6] = currentPositions.current![sIdx * 3]!;
            positions[i * 6 + 1] = currentPositions.current![sIdx * 3 + 1]!;
            positions[i * 6 + 2] = currentPositions.current![sIdx * 3 + 2]!;
            positions[i * 6 + 3] = currentPositions.current![tIdx * 3]!;
            positions[i * 6 + 4] = currentPositions.current![tIdx * 3 + 1]!;
            positions[i * 6 + 5] = currentPositions.current![tIdx * 3 + 2]!;

            const bothVisible = visibleSet.has(edge.source) && visibleSet.has(edge.target);
            let opacity = bothVisible ? edge.weight : 0;
            if (bothVisible && hoveredId !== undefined) {
              opacity = edge.source === hoveredId || edge.target === hoveredId ? 1 : 0.05;
            }
            const c = new THREE.Color(0xffffff).multiplyScalar(opacity);
            colors[i * 6] = c.r;
            colors[i * 6 + 1] = c.g;
            colors[i * 6 + 2] = c.b;
            colors[i * 6 + 3] = c.r;
            colors[i * 6 + 4] = c.g;
            colors[i * 6 + 5] = c.b;
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

  // Topology change → rebuild meshes
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
      opacity: 0.92,
    });

    const instancedMesh = new THREE.InstancedMesh(geometry, material, nodes.length);
    const dummy = new THREE.Object3D();

    const curPos = new Float32Array(nodes.length * 3);
    const tarPos = new Float32Array(nodes.length * 3);
    const baseSc = new Float32Array(nodes.length);

    nodes.forEach((node, i) => {
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

      const base = freqToScale(node.frequency ?? 1);
      baseSc[i] = base;

      dummy.position.set(startX, startY, startZ);
      dummy.scale.set(base, base, base);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);

      const color =
        colorMode === 'mood'
          ? moodToColor(node.mood ?? 5)
          : new THREE.Color(CLUSTER_COLORS[node.cluster % CLUSTER_COLORS.length]!);
      instancedMesh.setColorAt(i, color);
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    group.add(instancedMesh);
    nodesMeshRef.current = instancedMesh;

    currentPositions.current = curPos;
    targetPositions.current = tarPos;
    baseScales.current = baseSc;

    const lineGeo = new THREE.BufferGeometry();
    const linePositions = new Float32Array(edges.length * 2 * 3);
    const lineColors = new Float32Array(edges.length * 2 * 3);

    edges.forEach((edge, i) => {
      const sIdx = nodes.findIndex((n) => n.id === edge.source);
      const tIdx = nodes.findIndex((n) => n.id === edge.target);
      if (sIdx === -1 || tIdx === -1) return;

      linePositions[i * 6] = curPos[sIdx * 3]!;
      linePositions[i * 6 + 1] = curPos[sIdx * 3 + 1]!;
      linePositions[i * 6 + 2] = curPos[sIdx * 3 + 2]!;
      linePositions[i * 6 + 3] = curPos[tIdx * 3]!;
      linePositions[i * 6 + 4] = curPos[tIdx * 3 + 1]!;
      linePositions[i * 6 + 5] = curPos[tIdx * 3 + 2]!;

      const c = new THREE.Color(0xffffff).multiplyScalar(edge.weight);
      lineColors[i * 6] = c.r;
      lineColors[i * 6 + 1] = c.g;
      lineColors[i * 6 + 2] = c.b;
      lineColors[i * 6 + 3] = c.r;
      lineColors[i * 6 + 4] = c.g;
      lineColors[i * 6 + 5] = c.b;
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
    group.add(lineMesh);
    edgesLineRef.current = lineMesh;
  }, [topology, colorMode]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}
