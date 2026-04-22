export type Vec = number[];

export interface GraphNode {
  id: number;
  text: string;
  x: number;
  y: number;
  z: number;
  cluster: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
}

export interface Topology {
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodesCsv: string;
  edgesCsv: string;
}

export function cosineSim(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function similarityMatrix(vectors: Vec[]): number[][] {
  const n = vectors.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    m[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = cosineSim(vectors[i]!, vectors[j]!);
      m[i]![j] = s;
      m[j]![i] = s;
    }
  }
  return m;
}

export function buildEdges(sim: number[][], threshold: number): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const n = sim.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = sim[i]![j]!;
      if (w >= threshold) edges.push({ source: i, target: j, weight: w });
    }
  }
  return edges;
}

// ---- KMeans (lightweight, deterministic seeding) ----
export function kmeans(vectors: Vec[], k: number, maxIter = 50): number[] {
  const n = vectors.length;
  const dim = vectors[0]!.length;
  const kk = Math.max(2, Math.min(k, n));

  // k-means++ init with seeded RNG
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const centers: Vec[] = [];
  centers.push(vectors[Math.floor(rand() * n)]!.slice());
  while (centers.length < kk) {
    const d2 = vectors.map((v) => {
      let best = Infinity;
      for (const c of centers) {
        const d = sqDist(v, c);
        if (d < best) best = d;
      }
      return best;
    });
    const sum = d2.reduce((a, b) => a + b, 0);
    let r = rand() * sum;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      r -= d2[i]!;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centers.push(vectors[idx]!.slice());
  }

  const labels = new Array(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = sqDist(vectors[i]!, centers[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
    const sums: Vec[] = Array.from({ length: kk }, () => new Array(dim).fill(0));
    const counts = new Array(kk).fill(0);
    for (let i = 0; i < n; i++) {
      const lab = labels[i]!;
      counts[lab]++;
      const v = vectors[i]!;
      const s = sums[lab]!;
      for (let d = 0; d < dim; d++) s[d]! += v[d]!;
    }
    for (let c = 0; c < kk; c++) {
      if (counts[c] === 0) continue;
      const s = sums[c]!;
      for (let d = 0; d < dim; d++) s[d]! /= counts[c]!;
      centers[c] = s;
    }
  }
  return labels;
}

function sqDist(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

// ---- Layouts ----

// Centralized: pick the most "central" node (highest mean similarity), place at origin,
// arrange others on a sphere around it; radius depends on (1 - similarity to core).
export function centralizedLayout(
  texts: string[],
  sim: number[][],
  labels: number[],
): GraphNode[] {
  const n = texts.length;
  const meanSim = sim.map((row) => row.reduce((a, b) => a + b, 0) / row.length);
  let core = 0;
  for (let i = 1; i < n; i++) if (meanSim[i]! > meanSim[core]!) core = i;

  const nodes: GraphNode[] = [];
  const others: number[] = [];
  for (let i = 0; i < n; i++) if (i !== core) others.push(i);

  // Fibonacci sphere distribution
  const phi = Math.PI * (3 - Math.sqrt(5));
  others.forEach((idx, k) => {
    const sCount = others.length;
    const y = 1 - (k / Math.max(sCount - 1, 1)) * 2;
    const radiusOnSphere = Math.sqrt(1 - y * y);
    const theta = phi * k;
    const distToCore = 1 - sim[core]![idx]!;
    const r = 4 + distToCore * 9; // 4..13
    nodes[idx] = {
      id: idx,
      text: texts[idx]!,
      x: Math.cos(theta) * radiusOnSphere * r,
      y: y * r,
      z: Math.sin(theta) * radiusOnSphere * r,
      cluster: labels[idx]!,
    };
  });
  nodes[core] = {
    id: core,
    text: texts[core]!,
    x: 0,
    y: 0,
    z: 0,
    cluster: labels[core]!,
  };
  return nodes;
}

// Decentralized: KMeans clusters arranged as hubs in 3D; each cluster's nodes
// arranged in a small sphere around its hub center.
export function decentralizedLayout(
  texts: string[],
  labels: number[],
  k: number,
): GraphNode[] {
  const n = texts.length;
  const kk = Math.max(2, Math.min(k, n));
  const hubRadius = 12;

  // Hub centers on a sphere
  const hubs: Array<{ x: number; y: number; z: number }> = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < kk; i++) {
    const y = 1 - (i / Math.max(kk - 1, 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    hubs.push({
      x: Math.cos(theta) * r * hubRadius,
      y: y * hubRadius,
      z: Math.sin(theta) * r * hubRadius,
    });
  }

  // Group node indices by cluster
  const groups: number[][] = Array.from({ length: kk }, () => []);
  for (let i = 0; i < n; i++) groups[labels[i]! % kk]!.push(i);

  const nodes: GraphNode[] = new Array(n);
  groups.forEach((group, c) => {
    const hub = hubs[c]!;
    group.forEach((idx, j) => {
      const angle = (j / Math.max(group.length, 1)) * Math.PI * 2;
      const elev = ((j % 5) - 2) * 0.6;
      const r = 3 + (j % 3) * 0.6;
      nodes[idx] = {
        id: idx,
        text: texts[idx]!,
        x: hub.x + Math.cos(angle) * r,
        y: hub.y + elev,
        z: hub.z + Math.sin(angle) * r,
        cluster: labels[idx]!,
      };
    });
  });
  return nodes;
}

// Distributed: force-directed layout (peer-to-peer nearest neighbours connected).
export function distributedLayout(
  texts: string[],
  sim: number[][],
  labels: number[],
  edges: GraphEdge[],
): GraphNode[] {
  const n = texts.length;
  // Initial random positions in a cube
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const pos: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    pos.push([(rand() - 0.5) * 14, (rand() - 0.5) * 14, (rand() - 0.5) * 14]);
  }

  // Use top-3 nearest neighbours as the attraction set
  const knn: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ranked = sim[i]!
      .map((s, j) => ({ j, s }))
      .filter((x) => x.j !== i)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.j);
    knn.push(ranked);
  }

  const k_attr = 0.04;
  const k_rep = 1.5;
  const damping = 0.85;
  const iter = 220;

  const vel: Array<[number, number, number]> = pos.map(() => [0, 0, 0]);

  for (let it = 0; it < iter; it++) {
    const force: Array<[number, number, number]> = pos.map(() => [0, 0, 0]);

    // Repulsion: O(n^2) but n is small (<200 expected)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]![0] - pos[j]![0];
        const dy = pos[i]![1] - pos[j]![1];
        const dz = pos[i]![2] - pos[j]![2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const f = k_rep / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        const fz = (dz / d) * f;
        force[i]![0] += fx;
        force[i]![1] += fy;
        force[i]![2] += fz;
        force[j]![0] -= fx;
        force[j]![1] -= fy;
        force[j]![2] -= fz;
      }
    }

    // Attraction along knn edges (peer-to-peer)
    for (let i = 0; i < n; i++) {
      for (const j of knn[i]!) {
        const dx = pos[j]![0] - pos[i]![0];
        const dy = pos[j]![1] - pos[i]![1];
        const dz = pos[j]![2] - pos[i]![2];
        const w = Math.max(sim[i]![j]!, 0.05);
        force[i]![0] += dx * k_attr * w;
        force[i]![1] += dy * k_attr * w;
        force[i]![2] += dz * k_attr * w;
      }
    }

    // Gentle pull to origin
    for (let i = 0; i < n; i++) {
      force[i]![0] -= pos[i]![0] * 0.002;
      force[i]![1] -= pos[i]![1] * 0.002;
      force[i]![2] -= pos[i]![2] * 0.002;
    }

    // Integrate
    for (let i = 0; i < n; i++) {
      vel[i]![0] = (vel[i]![0] + force[i]![0]) * damping;
      vel[i]![1] = (vel[i]![1] + force[i]![1]) * damping;
      vel[i]![2] = (vel[i]![2] + force[i]![2]) * damping;
      const maxV = 0.6;
      vel[i]![0] = Math.max(-maxV, Math.min(maxV, vel[i]![0]));
      vel[i]![1] = Math.max(-maxV, Math.min(maxV, vel[i]![1]));
      vel[i]![2] = Math.max(-maxV, Math.min(maxV, vel[i]![2]));
      pos[i]![0] += vel[i]![0];
      pos[i]![1] += vel[i]![1];
      pos[i]![2] += vel[i]![2];
    }
  }

  // Use distributed edges (knn unioned), but main response uses threshold edges from sim
  const _useEdges = edges;
  void _useEdges;

  return pos.map((p, i) => ({
    id: i,
    text: texts[i]!,
    x: p[0],
    y: p[1],
    z: p[2],
    cluster: labels[i]!,
  }));
}

// Build distributed (peer) edges = union of mutual top-k nearest neighbours
export function distributedEdges(sim: number[][], k = 3): GraphEdge[] {
  const n = sim.length;
  const edges = new Map<string, GraphEdge>();
  for (let i = 0; i < n; i++) {
    const ranked = sim[i]!
      .map((s, j) => ({ j, s }))
      .filter((x) => x.j !== i)
      .sort((a, b) => b.s - a.s)
      .slice(0, k);
    for (const r of ranked) {
      const a = Math.min(i, r.j);
      const b = Math.max(i, r.j);
      const key = `${a}-${b}`;
      if (!edges.has(key)) edges.set(key, { source: a, target: b, weight: r.s });
    }
  }
  return Array.from(edges.values());
}

// Build centralized edges: connect every node to the central node, weight=sim
export function centralizedEdges(sim: number[][]): { edges: GraphEdge[]; core: number } {
  const n = sim.length;
  const meanSim = sim.map((row) => row.reduce((a, b) => a + b, 0) / row.length);
  let core = 0;
  for (let i = 1; i < n; i++) if (meanSim[i]! > meanSim[core]!) core = i;
  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    if (i === core) continue;
    edges.push({ source: Math.min(core, i), target: Math.max(core, i), weight: sim[core]![i]! });
  }
  return { edges, core };
}

// Build decentralized edges: intra-cluster all-pairs above threshold, plus weak hub-to-hub link
export function decentralizedEdges(
  sim: number[][],
  labels: number[],
  threshold: number,
): GraphEdge[] {
  const n = sim.length;
  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (labels[i] === labels[j] && sim[i]![j]! >= threshold * 0.7) {
        edges.push({ source: i, target: j, weight: sim[i]![j]! });
      }
    }
  }
  // Add one cross-cluster bridge per cluster pair (highest similarity pair)
  const byPair = new Map<string, GraphEdge>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (labels[i] === labels[j]) continue;
      const key =
        labels[i]! < labels[j]!
          ? `${labels[i]}-${labels[j]}`
          : `${labels[j]}-${labels[i]}`;
      const cand: GraphEdge = { source: i, target: j, weight: sim[i]![j]! };
      const existing = byPair.get(key);
      if (!existing || existing.weight < cand.weight) byPair.set(key, cand);
    }
  }
  for (const e of byPair.values()) edges.push(e);
  return edges;
}

// ---- CSV ----
function csvEscape(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function nodesToCsv(nodes: GraphNode[]): string {
  const header = "id,cluster,x,y,z,text";
  const rows = nodes.map(
    (n) =>
      `${n.id},${n.cluster},${n.x.toFixed(4)},${n.y.toFixed(4)},${n.z.toFixed(4)},${csvEscape(n.text)}`,
  );
  return [header, ...rows].join("\n");
}

export function edgesToCsv(edges: GraphEdge[]): string {
  const header = "source,target,weight";
  const rows = edges.map((e) => `${e.source},${e.target},${e.weight.toFixed(4)}`);
  return [header, ...rows].join("\n");
}

export function makeTopology(
  name: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Topology {
  return {
    name,
    nodes,
    edges,
    nodesCsv: nodesToCsv(nodes),
    edgesCsv: edgesToCsv(edges),
  };
}
