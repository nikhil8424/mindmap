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
  makeTopology,
} from "../lib/graph";

const router: IRouter = Router();

router.post("/graph", async (req, res, next) => {
  try {
    const parsed = BuildGraphBody.parse(req.body);
    const notes = parsed.notes
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    if (notes.length < 2) {
      res.status(400).json({ error: "Need at least 2 non-empty notes" });
      return;
    }

    const threshold = parsed.threshold ?? 0.35;
    const k = Math.min(parsed.clusters ?? 3, notes.length);

    req.log.info({ count: notes.length }, "Embedding notes");
    const vectors = await embedTexts(notes);

    const sim = similarityMatrix(vectors);
    const labels = kmeans(vectors, k);

    // Centralized
    const { edges: cEdges } = centralizedEdges(sim);
    const cNodes = centralizedLayout(notes, sim, labels);
    const centralized = makeTopology("centralized", cNodes, cEdges);

    // Decentralized
    const dNodes = decentralizedLayout(notes, labels, k);
    const dEdges = decentralizedEdges(sim, labels, threshold);
    const decentralized = makeTopology("decentralized", dNodes, dEdges);

    // Distributed
    const distEdges = distributedEdges(sim, 3);
    const distNodes = distributedLayout(notes, sim, labels, distEdges);
    // Also include any edges above threshold for visual richness
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

    const payload = BuildGraphResponse.parse({
      centralized,
      decentralized,
      distributed,
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
