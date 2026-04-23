// Time-series analysis: emotional trend, keyword/mood correlation,
// next-day mood prediction, mood time series.

export interface EnrichedEntry {
  text: string;
  date: string;
  timestamp: number;
  mood: number;
  energy: number;
  stress: number;
  sentiment: number;
  keywords: Set<string>;
}

export interface EmotionalTrend {
  slope: number; // mood units per day
  direction: "improving" | "declining" | "stable";
  recentAvgMood: number;
  overallAvgMood: number;
}

export interface Trigger {
  keyword: string;
  avgMoodWhen: number;
  avgMoodOverall: number;
  delta: number;
  occurrences: number;
}

export interface MoodPoint {
  date: string;
  timestamp: number;
  avgMood: number;
  avgEnergy: number;
  avgStress: number;
  avgSentiment: number;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Linear regression slope of mood vs day index
export function emotionalTrend(entries: EnrichedEntry[]): EmotionalTrend {
  if (entries.length === 0) {
    return { slope: 0, direction: "stable", recentAvgMood: 0, overallAvgMood: 0 };
  }
  const minTs = Math.min(...entries.map((e) => e.timestamp));
  const xs = entries.map((e) => (e.timestamp - minTs) / DAY_MS);
  const ys = entries.map((e) => e.mood);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  // Recent = last 1/3 of timeline (or last 5 entries minimum)
  const recentCount = Math.max(5, Math.ceil(n / 3));
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const recent = sorted.slice(-recentCount);
  const recentAvg = recent.reduce((a, e) => a + e.mood, 0) / recent.length;

  let direction: "improving" | "declining" | "stable" = "stable";
  if (slope > 0.05) direction = "improving";
  else if (slope < -0.05) direction = "declining";

  return {
    slope: round2(slope),
    direction,
    recentAvgMood: round2(recentAvg),
    overallAvgMood: round2(meanY),
  };
}

// For each top keyword, compute avgMood when it appears vs overall
export function computeTriggers(
  entries: EnrichedEntry[],
  topKw: { keyword: string; count: number }[],
): Trigger[] {
  const overall = entries.reduce((a, e) => a + e.mood, 0) / Math.max(entries.length, 1);
  const triggers: Trigger[] = [];
  for (const { keyword, count } of topKw) {
    const matches = entries.filter((e) => e.keywords.has(keyword));
    if (matches.length === 0) continue;
    const avg = matches.reduce((a, e) => a + e.mood, 0) / matches.length;
    triggers.push({
      keyword,
      avgMoodWhen: round2(avg),
      avgMoodOverall: round2(overall),
      delta: round2(avg - overall),
      occurrences: count,
    });
  }
  // Sort by absolute delta descending — strongest emotional pull first
  triggers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return triggers.slice(0, 6);
}

// Predict next-day mood: weighted average of last 5 days + slope projection
export function predictNextMood(entries: EnrichedEntry[], trend: EmotionalTrend): number {
  if (entries.length === 0) return 5;
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const last = sorted.slice(-5);
  // Newer entries weighted more
  let totalW = 0;
  let total = 0;
  last.forEach((e, i) => {
    const w = i + 1;
    total += e.mood * w;
    totalW += w;
  });
  const weighted = total / totalW;
  // Project one day ahead using slope
  const projected = weighted + trend.slope;
  return round2(Math.max(1, Math.min(10, projected)));
}

// Aggregate per-day means
export function moodSeries(entries: EnrichedEntry[]): MoodPoint[] {
  const byDate = new Map<string, EnrichedEntry[]>();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  const points: MoodPoint[] = [];
  for (const [date, items] of byDate.entries()) {
    const ts = Math.min(...items.map((i) => i.timestamp));
    const avg = (sel: (e: EnrichedEntry) => number) =>
      items.reduce((a, i) => a + sel(i), 0) / items.length;
    points.push({
      date,
      timestamp: ts,
      avgMood: round2(avg((e) => e.mood)),
      avgEnergy: round2(avg((e) => e.energy)),
      avgStress: round2(avg((e) => e.stress)),
      avgSentiment: round2(avg((e) => e.sentiment)),
      count: items.length,
    });
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

// Count per-text repeats (semantic, via similarity matrix). Caller passes sim matrix.
export function repeatedThoughts(
  entries: EnrichedEntry[],
  sim: number[][],
  simThreshold = 0.7,
): { text: string; count: number }[] {
  const n = entries.length;
  const visited = new Set<number>();
  const groups: { rep: number; members: number[] }[] = [];
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const members = [i];
    visited.add(i);
    for (let j = i + 1; j < n; j++) {
      if (visited.has(j)) continue;
      if ((sim[i]?.[j] ?? 0) >= simThreshold) {
        members.push(j);
        visited.add(j);
      }
    }
    if (members.length >= 2) groups.push({ rep: i, members });
  }
  return groups
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 5)
    .map((g) => ({ text: entries[g.rep]!.text, count: g.members.length }));
}

// Frequency = number of entries similar to entry i (including itself)
export function frequencyByEntry(sim: number[][], threshold = 0.6): number[] {
  const n = sim.length;
  const out = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    let c = 1;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if ((sim[i]?.[j] ?? 0) >= threshold) c++;
    }
    out[i] = c;
  }
  return out;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
