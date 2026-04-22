import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GraphNode, GraphEdge, Topology } from '@workspace/api-zod/src/generated/types';

interface GraphCanvasProps {
  topology: Topology | null;
  cameraMovement: { type: string; dx: number; dy: number; zoomDelta: number } | null;
  onNodeClick: (node: GraphNode | null) => void;
}

const CLUSTER_COLORS = [
  0x00F0FF, // Cyan
  0x7B2CBF, // Violet
  0xFF007A, // Pink
  0x00FF9D, // Mint
  0xFFB800, // Gold
];

export function GraphCanvas({ topology, cameraMovement, onNodeClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  
  const nodesMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const edgesLineRef = useRef<THREE.LineSegments | null>(null);
  
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

  // Init scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040A, 0.02);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 30);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x02040A, 1);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

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
        onNodeClickRef.current(node);
      } else {
        onNodeClickRef.current(null);
      }
    };
    window.addEventListener('click', handleClick);

    const animate = () => {
      requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();

      // Raycasting
      if (cameraRef.current && nodesMeshRef.current && topologyRef.current) {
        raycaster.current.setFromCamera(mouse.current, cameraRef.current);
        const intersects = raycaster.current.intersectObject(nodesMeshRef.current);
        if (intersects.length > 0) {
          const instanceId = intersects[0].instanceId;
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

      // Lerp node positions
      if (nodesMeshRef.current && currentPositions.current && targetPositions.current && topologyRef.current) {
        const dummy = new THREE.Object3D();
        let needsUpdate = false;
        
        const hId = hoveredNodeIndexRef.current;
        let connectedNodes = new Set<number>();
        if (hId !== null) {
          connectedNodes.add(topologyRef.current.nodes[hId].id);
          topologyRef.current.edges.forEach(e => {
            if (e.source === topologyRef.current?.nodes[hId].id) connectedNodes.add(e.target);
            if (e.target === topologyRef.current?.nodes[hId].id) connectedNodes.add(e.source);
          });
        }

        for (let i = 0; i < currentPositions.current.length / 3; i++) {
          const cx = currentPositions.current[i * 3];
          const cy = currentPositions.current[i * 3 + 1];
          const cz = currentPositions.current[i * 3 + 2];
          
          const tx = targetPositions.current[i * 3];
          const ty = targetPositions.current[i * 3 + 1];
          const tz = targetPositions.current[i * 3 + 2];

          // Lerp
          const nx = cx + (tx - cx) * 0.05;
          const ny = cy + (ty - cy) * 0.05;
          const nz = cz + (tz - cz) * 0.05;

          currentPositions.current[i * 3] = nx;
          currentPositions.current[i * 3 + 1] = ny;
          currentPositions.current[i * 3 + 2] = nz;

          dummy.position.set(nx, ny, nz);
          
          let scale = 1;
          if (hId !== null) {
             const isConnected = connectedNodes.has(topologyRef.current.nodes[i].id);
             scale = isConnected ? (i === hId ? 1.5 : 1.2) : 0.5;
          } else {
             scale = 1 + Math.sin(Date.now() * 0.002 + i) * 0.1; // idle pulse
          }

          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          
          nodesMeshRef.current.setMatrixAt(i, dummy.matrix);
          needsUpdate = true;
        }

        if (needsUpdate) {
          nodesMeshRef.current.instanceMatrix.needsUpdate = true;
        }

        // Update edges
        if (edgesLineRef.current && edgesLineRef.current.geometry) {
           const positions = edgesLineRef.current.geometry.attributes.position.array as Float32Array;
           const colors = edgesLineRef.current.geometry.attributes.color.array as Float32Array;
           
           topologyRef.current.edges.forEach((edge, i) => {
             const sIdx = topologyRef.current!.nodes.findIndex(n => n.id === edge.source);
             const tIdx = topologyRef.current!.nodes.findIndex(n => n.id === edge.target);
             if (sIdx === -1 || tIdx === -1) return;

             positions[i * 6] = currentPositions.current![sIdx * 3];
             positions[i * 6 + 1] = currentPositions.current![sIdx * 3 + 1];
             positions[i * 6 + 2] = currentPositions.current![sIdx * 3 + 2];

             positions[i * 6 + 3] = currentPositions.current![tIdx * 3];
             positions[i * 6 + 4] = currentPositions.current![tIdx * 3 + 1];
             positions[i * 6 + 5] = currentPositions.current![tIdx * 3 + 2];

             let opacity = edge.weight;
             if (hId !== null) {
               const sourceConnected = edge.source === topologyRef.current?.nodes[hId].id;
               const targetConnected = edge.target === topologyRef.current?.nodes[hId].id;
               opacity = (sourceConnected || targetConnected) ? 1 : 0.05;
             }

             const color = new THREE.Color(0xffffff).multiplyScalar(opacity);
             colors[i * 6] = color.r; colors[i * 6 + 1] = color.g; colors[i * 6 + 2] = color.b;
             colors[i * 6 + 3] = color.r; colors[i * 6 + 4] = color.g; colors[i * 6 + 5] = color.b;
           });

           edgesLineRef.current.geometry.attributes.position.needsUpdate = true;
           edgesLineRef.current.geometry.attributes.color.needsUpdate = true;
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

  // Handle Gesture Camera Movement
  useEffect(() => {
    if (!controlsRef.current || !cameraRef.current || !cameraMovement) return;

    if (cameraMovement.type === 'rotate') {
      controlsRef.current.autoRotate = false;
      const speed = 0.05;
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + cameraMovement.dx * speed);
      controlsRef.current.setPolarAngle(controlsRef.current.getPolarAngle() + cameraMovement.dy * speed);
    } else if (cameraMovement.type === 'zoom') {
      controlsRef.current.autoRotate = false;
      cameraRef.current.translateZ(cameraMovement.zoomDelta * 5);
    }
  }, [cameraMovement]);

  // Update Topology
  useEffect(() => {
    if (!sceneRef.current || !topology) return;
    
    if (nodesMeshRef.current) sceneRef.current.remove(nodesMeshRef.current);
    if (edgesLineRef.current) sceneRef.current.remove(edgesLineRef.current);

    const { nodes, edges } = topology;
    
    // Nodes
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
    
    nodes.forEach((node, i) => {
      const startX = currentPositions.current && (currentPositions.current.length === nodes.length * 3) ? currentPositions.current[i * 3] : (Math.random() - 0.5) * 50;
      const startY = currentPositions.current && (currentPositions.current.length === nodes.length * 3) ? currentPositions.current[i * 3 + 1] : (Math.random() - 0.5) * 50;
      const startZ = currentPositions.current && (currentPositions.current.length === nodes.length * 3) ? currentPositions.current[i * 3 + 2] : (Math.random() - 0.5) * 50;
      
      curPos[i * 3] = startX;
      curPos[i * 3 + 1] = startY;
      curPos[i * 3 + 2] = startZ;
      
      tarPos[i * 3] = node.x;
      tarPos[i * 3 + 1] = node.y;
      tarPos[i * 3 + 2] = node.z;

      dummy.position.set(startX, startY, startZ);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
      
      const color = new THREE.Color(CLUSTER_COLORS[node.cluster % CLUSTER_COLORS.length]);
      instancedMesh.setColorAt(i, color);
    });
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    
    sceneRef.current.add(instancedMesh);
    nodesMeshRef.current = instancedMesh;
    
    currentPositions.current = curPos;
    targetPositions.current = tarPos;
    
    // Edges
    const lineGeo = new THREE.BufferGeometry();
    const linePositions = new Float32Array(edges.length * 2 * 3);
    const lineColors = new Float32Array(edges.length * 2 * 3);
    
    edges.forEach((edge, i) => {
      // init with start positions
      const sIdx = nodes.findIndex(n => n.id === edge.source);
      const tIdx = nodes.findIndex(n => n.id === edge.target);
      if (sIdx === -1 || tIdx === -1) return;

      linePositions[i * 6] = curPos[sIdx * 3];
      linePositions[i * 6 + 1] = curPos[sIdx * 3 + 1];
      linePositions[i * 6 + 2] = curPos[sIdx * 3 + 2];
      linePositions[i * 6 + 3] = curPos[tIdx * 3];
      linePositions[i * 6 + 4] = curPos[tIdx * 3 + 1];
      linePositions[i * 6 + 5] = curPos[tIdx * 3 + 2];

      const color = new THREE.Color(0xffffff).multiplyScalar(edge.weight);
      lineColors[i * 6] = color.r; lineColors[i * 6 + 1] = color.g; lineColors[i * 6 + 2] = color.b;
      lineColors[i * 6 + 3] = color.r; lineColors[i * 6 + 4] = color.g; lineColors[i * 6 + 5] = color.b;
    });
    
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    
    const lineMat = new THREE.LineBasicMaterial({ 
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.6
    });
    
    const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
    sceneRef.current.add(lineMesh);
    edgesLineRef.current = lineMesh;

  }, [topology]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full" />
  );
}
