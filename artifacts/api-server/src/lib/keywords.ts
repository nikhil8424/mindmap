// Simple keyword extraction with stopword removal + global frequency aggregation.

const STOPWORDS = new Set<string>([
  "the","a","an","and","or","but","if","then","else","when","while","of","at","by","for",
  "with","about","against","between","into","through","during","before","after","above",
  "below","to","from","up","down","in","out","on","off","over","under","again","further",
  "is","am","are","was","were","be","been","being","have","has","had","having","do","does",
  "did","doing","i","me","my","myself","we","our","ours","ourselves","you","your","yours",
  "yourself","yourselves","he","him","his","himself","she","her","hers","herself","it","its",
  "itself","they","them","their","theirs","themselves","what","which","who","whom","this",
  "that","these","those","this","that","there","here","just","like","really","very","so",
  "also","too","much","more","most","such","no","nor","not","only","own","same","than","then",
  "should","could","would","may","might","will","shall","can","cant","cannot","dont","didnt",
  "doesnt","wasnt","werent","isnt","arent","ill","im","ive","youre","theyre","weve","its",
  "as","because","since","while","feel","feeling","feels","felt","get","getting","got",
  "going","go","gone","one","two","three","four","five","day","days","today","yesterday",
  "tomorrow","time","times","thing","things","way","ways","still","keep","kept","another",
  "every","everything","something","nothing","anything","always","never","sometimes","often",
  "now","again","ever","maybe","probably",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface KeywordsResult {
  perEntry: Set<string>[]; // keywords found in each entry (deduped per entry)
  global: Map<string, number>; // keyword -> total occurrence count
}

export function extractKeywords(texts: string[]): KeywordsResult {
  const perEntry: Set<string>[] = [];
  const global = new Map<string, number>();
  for (const text of texts) {
    const tokens = tokenize(text);
    const set = new Set<string>();
    for (const t of tokens) {
      if (t.length < 4) continue;
      if (STOPWORDS.has(t)) continue;
      // strip simple plural / past-tense suffixes for grouping
      const norm = normalize(t);
      if (norm.length < 4) continue;
      if (STOPWORDS.has(norm)) continue;
      set.add(norm);
    }
    perEntry.push(set);
    for (const kw of set) {
      global.set(kw, (global.get(kw) ?? 0) + 1);
    }
  }
  return { perEntry, global };
}

function normalize(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 4) return word.slice(0, -1);
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  return word;
}

export function topKeywords(global: Map<string, number>, n = 8): { keyword: string; count: number }[] {
  return [...global.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([keyword, count]) => ({ keyword, count }));
}
