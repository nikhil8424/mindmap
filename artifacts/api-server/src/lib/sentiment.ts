// Lightweight lexicon-based sentiment scoring. Returns a value in [-1, 1].
// No external services or models — just a hand-curated wordlist with intensifiers
// and negations, sufficient for short journal-style text.

const POSITIVE: Record<string, number> = {
  love: 1, loved: 1, loving: 0.9, like: 0.5, liked: 0.5, enjoy: 0.8, enjoyed: 0.8,
  happy: 1, happiness: 1, joy: 1, joyful: 1, excited: 0.9, excitement: 0.9,
  great: 0.8, good: 0.6, wonderful: 1, amazing: 1, awesome: 0.9, fantastic: 1,
  beautiful: 0.8, calm: 0.7, peace: 0.8, peaceful: 0.8, grateful: 1, gratitude: 1,
  proud: 0.8, hope: 0.7, hopeful: 0.7, inspired: 0.9, inspiring: 0.9, energised: 0.7,
  energized: 0.7, refreshed: 0.7, relaxed: 0.7, content: 0.6, smile: 0.6,
  laugh: 0.7, laughed: 0.7, fun: 0.7, success: 0.7, win: 0.7, won: 0.7,
  bright: 0.5, light: 0.4, free: 0.5, alive: 0.6, warm: 0.4, kind: 0.6,
  clear: 0.4, focused: 0.5, productive: 0.7, accomplished: 0.8, breakthrough: 0.9,
  delight: 0.9, cherish: 0.8, soothing: 0.7, gentle: 0.5, safe: 0.6,
};

const NEGATIVE: Record<string, number> = {
  hate: -1, hated: -1, dislike: -0.5, sad: -0.9, sadness: -0.9, depressed: -1,
  depression: -1, anxious: -0.9, anxiety: -0.9, worried: -0.7, worry: -0.7,
  scared: -0.8, fear: -0.8, afraid: -0.8, terrified: -1, panic: -1, angry: -0.9,
  anger: -0.9, frustrated: -0.7, frustration: -0.7, tired: -0.6, exhausted: -0.8,
  drained: -0.7, lonely: -0.9, alone: -0.4, isolated: -0.7, empty: -0.7,
  hopeless: -1, helpless: -0.9, overwhelmed: -0.9, stressed: -0.8, stress: -0.6,
  bad: -0.6, terrible: -1, awful: -1, horrible: -1, miserable: -1, broken: -0.7,
  pain: -0.8, painful: -0.8, hurt: -0.7, hurts: -0.7, lost: -0.6, dark: -0.5,
  cold: -0.3, heavy: -0.4, stuck: -0.6, trapped: -0.8, conflict: -0.5,
  fight: -0.5, fighting: -0.5, fail: -0.7, failed: -0.7, failure: -0.8,
  burnout: -0.9, restless: -0.5, irritable: -0.6, doubt: -0.5, regret: -0.7,
  ashamed: -0.8, guilt: -0.7, guilty: -0.7,
};

const INTENSIFIERS: Record<string, number> = {
  very: 1.5, really: 1.4, so: 1.3, extremely: 1.8, deeply: 1.6, totally: 1.4,
  incredibly: 1.7, absolutely: 1.6, completely: 1.5, super: 1.4,
};

const NEGATIONS = new Set([
  "not", "no", "never", "none", "n't", "cannot", "cant", "without", "barely", "hardly",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function sentimentScore(text: string): number {
  const tokens = tokenize(text);
  let total = 0;
  let hits = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    let s = 0;
    if (POSITIVE[t] !== undefined) s = POSITIVE[t]!;
    else if (NEGATIVE[t] !== undefined) s = NEGATIVE[t]!;
    if (s === 0) continue;
    // Look back two tokens for intensifiers / negations
    let mult = 1;
    let negate = false;
    for (let k = 1; k <= 2; k++) {
      const prev = tokens[i - k];
      if (!prev) break;
      if (NEGATIONS.has(prev)) negate = true;
      else if (INTENSIFIERS[prev] !== undefined) mult *= INTENSIFIERS[prev]!;
    }
    if (negate) s = -s * 0.8;
    s *= mult;
    total += s;
    hits++;
  }
  if (hits === 0) return 0;
  // Average and gently squash to [-1, 1]
  const avg = total / hits;
  return Math.max(-1, Math.min(1, avg));
}
