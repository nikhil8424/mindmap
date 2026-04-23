// Seed journal entries spanning ~2 weeks with recurring themes and varying moods,
// designed to produce meaningful insights (trends, triggers, repeats) on first load.

export interface UIEntry {
  id: string;
  text: string;
  date: string; // yyyy-mm-dd
  timestamp: number;
  mood: number;
  energy: number;
  stress: number;
}

function dateNDaysAgo(n: number): { date: string; timestamp: number } {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, timestamp: d.getTime() };
}

interface Seed {
  daysAgo: number;
  text: string;
  mood: number;
  energy: number;
  stress: number;
}

const SEEDS: Seed[] = [
  { daysAgo: 13, text: "Work deadlines are crushing me, I feel completely overwhelmed and exhausted.", mood: 3, energy: 3, stress: 9 },
  { daysAgo: 13, text: "Couldn't sleep, my mind kept racing about the project review tomorrow.", mood: 3, energy: 2, stress: 8 },
  { daysAgo: 12, text: "Long walk by the ocean cleared my head, felt peaceful for the first time in days.", mood: 7, energy: 6, stress: 4 },
  { daysAgo: 11, text: "Another tough day at work, the meeting was draining and I left feeling defeated.", mood: 4, energy: 4, stress: 8 },
  { daysAgo: 10, text: "Sleep is awful again, woke up four times last night anxious about everything.", mood: 4, energy: 3, stress: 7 },
  { daysAgo: 9, text: "Tried meditation in the morning and a walk by the ocean after work, much calmer.", mood: 7, energy: 6, stress: 4 },
  { daysAgo: 8, text: "Work was lighter today, no surprise meetings. Ideas flowing again.", mood: 7, energy: 7, stress: 4 },
  { daysAgo: 7, text: "A memory of floating over a vast, dark ocean, dreams felt vivid and beautiful.", mood: 8, energy: 7, stress: 3 },
  { daysAgo: 6, text: "The way light fractures through a prism keeps appearing in my thoughts.", mood: 7, energy: 7, stress: 3 },
  { daysAgo: 5, text: "I keep returning to the idea of decentralization as a natural state of mind.", mood: 7, energy: 7, stress: 3 },
  { daysAgo: 4, text: "Slept badly again, work stress is creeping back in. Felt anxious all morning.", mood: 4, energy: 4, stress: 7 },
  { daysAgo: 3, text: "Ocean walk helped, also called an old friend. Felt grateful and lighter.", mood: 8, energy: 7, stress: 3 },
  { daysAgo: 2, text: "Ideas are not singular, they are constellations. Productive day, energized.", mood: 8, energy: 8, stress: 3 },
  { daysAgo: 1, text: "Neural pathways firing like city lights seen from space, feeling inspired.", mood: 9, energy: 8, stress: 2 },
  { daysAgo: 0, text: "Calm morning, slow coffee, gratitude. The architecture of a thought is not linear.", mood: 8, energy: 7, stress: 3 },
];

export function buildSeedEntries(): UIEntry[] {
  return SEEDS.map((s, i) => {
    const { date, timestamp } = dateNDaysAgo(s.daysAgo);
    return {
      id: `seed-${i}`,
      text: s.text,
      date,
      timestamp: timestamp + i * 60_000, // stagger so equal-day entries have stable order
      mood: s.mood,
      energy: s.energy,
      stress: s.stress,
    };
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function isoToTimestamp(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 9, 0, 0, 0).getTime();
}
