import { Router, type IRouter } from "express";
import { BuildGraphBody, BuildGraphResponse } from "@workspace/api-zod";
import { embedTexts } from "../lib/embeddings";
import {
  similarityMatrix,
  buildEdges,
  kmeans,
  centralizedLayout,
  decentralizedLayout,
  distributedLayout,
  centralizedEdges,
  decentralizedEdges,
  distributedEdges,
  enrichNodes,
  makeTopology,
  type NodeEnrichment,
} from "../lib/graph";
import { sentimentScore } from "../lib/sentiment";
import { extractKeywords, topKeywords } from "../lib/keywords";
import {
  emotionalTrend,
  computeTriggers,
  predictNextMood,
  moodSeries,
  repeatedThoughts,
  frequencyByEntry,
  type EnrichedEntry,
} from "../lib/analysis";

const router: IRouter = Router();

router.post("/graph", async (req, res, next) => {
  try {
    const parsed = BuildGraphBody.parse(req.body);

    // Sort entries chronologically and re-index
    const entries = [...parsed.entries]
      .filter((e) => e.text.trim().length > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (entries.length < 2) {
      res.status(400).json({ error: "Need at least 2 non-empty entries" });
      return;
    }

    const threshold = parsed.threshold ?? 0.35;
    const k = Math.min(parsed.clusters ?? 3, entries.length);
    const texts = entries.map((e) => e.text.trim());

    req.log.info({ count: texts.length }, "Embedding entries");
    const vectors = await embedTexts(texts);

    const sim = similarityMatrix(vectors);
    const labels = kmeans(vectors, k);

    // ===== Enrichment signals =====
    const sentiments = texts.map((t) => sentimentScore(t));
    const { perEntry, global } = extractKeywords(texts);
    const freq = frequencyByEntry(sim, 0.6);
    const enriched: EnrichedEntry[] = entries.map((e, i) => ({
      text: e.text,
      date: e.date,
      timestamp: e.timestamp,
      mood: e.mood,
      energy: e.energy,
      stress: e.stress,
      sentiment: sentiments[i] ?? 0,
      keywords: perEntry[i] ?? new Set<string>(),
    }));

    const nodeEnrich: NodeEnrichment[] = entries.map((e, i) => ({
      mood: e.mood,
      energy: e.energy,
      stress: e.stress,
      sentiment: Math.round((sentiments[i] ?? 0) * 1000) / 1000,
      frequency: freq[i] ?? 1,
      timestamp: e.timestamp,
      date: e.date,
    }));

    // ===== Topologies =====
    const { edges: cEdges } = centralizedEdges(sim);
    const cNodes = enrichNodes(centralizedLayout(texts, sim, labels), nodeEnrich);
    const centralized = makeTopology("centralized", cNodes, cEdges);

    const dNodes = enrichNodes(decentralizedLayout(texts, labels, k), nodeEnrich);
    const dEdges = decentralizedEdges(sim, labels, threshold);
    const decentralized = makeTopology("decentralized", dNodes, dEdges);

    const distEdges = distributedEdges(sim, 3);
    const distNodes = enrichNodes(
      distributedLayout(texts, sim, labels, distEdges),
      nodeEnrich,
    );
    const thresholdEdges = buildEdges(sim, threshold);
    const mergedKeys = new Set(distEdges.map((e) => `${e.source}-${e.target}`));
    for (const e of thresholdEdges) {
      const key = `${e.source}-${e.target}`;
      if (!mergedKeys.has(key)) {
        distEdges.push(e);
        mergedKeys.add(key);
      }
    }
    const distributed = makeTopology("distributed", distNodes, distEdges);

    // ===== Insights =====
    const dominant = topKeywords(global, 8);
    const trend = emotionalTrend(enriched);
    const triggers = computeTriggers(enriched, dominant);
    const predicted = predictNextMood(enriched, trend);
    const series = moodSeries(enriched);
    const repeats = repeatedThoughts(enriched, sim, 0.7);
    const startTimestamp = entries[0]?.timestamp ?? 0;
    const endTimestamp = entries[entries.length - 1]?.timestamp ?? 0;

    const insights = {
      dominantThemes: dominant,
      repeatedThoughts: repeats,
      triggers,
      emotionalTrend: trend,
      predictedNextMood: predicted,
      moodSeries: series,
      timeRange: { startTimestamp, endTimestamp },
    };

    const payload = BuildGraphResponse.parse({
      centralized,
      decentralized,
      distributed,
      insights,
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
