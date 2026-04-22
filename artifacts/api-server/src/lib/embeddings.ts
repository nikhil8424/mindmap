import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = false;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

export function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: "fp32",
    }) as Promise<FeatureExtractionPipeline>;
  }
  return pipelinePromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  const dims = output.dims;
  const data = output.data as Float32Array;
  const n = dims[0]!;
  const d = dims[1]!;
  const vectors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const slice = Array.from(data.slice(i * d, (i + 1) * d));
    vectors.push(slice);
  }
  return vectors;
}
