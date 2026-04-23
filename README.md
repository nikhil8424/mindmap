# Ideascape

A meditative thinking tool that turns a stream of thoughts, dream fragments, or
journal entries into an interactive 3D knowledge graph. Notes are embedded with
a sentence-transformer model, clustered, and rendered as a glowing constellation
that you can explore with the mouse — or with your bare hands via webcam-driven
gesture controls.

---

## What it does

- Paste any free-form text (one thought per line) into the **Stream of
  Consciousness** panel.
- The backend embeds each line using a local `Xenova/all-MiniLM-L6-v2`
  transformer model, computes pairwise cosine similarity, and runs k-means
  clustering.
- Three different graph topologies are generated from the same data and you can
  switch between them live:
  - **Centralized** — one hub per cluster
  - **Decentralized** — clusters with internal hubs that interconnect
  - **Distributed** — peer-to-peer connections everywhere similarity passes the
    threshold
- The graph is rendered as a 3D constellation in Three.js with smooth node
  interpolation, hover highlighting, and click-to-inspect.
- Nodes and edges can be exported as CSV.

## Hand-gesture controls (optional)

When you toggle **Gesture Controls** on, the webcam activates and a single hand
is tracked with MediaPipe Hands. Three mutually exclusive poses each map to a
distinct interaction:

| Gesture                                | What happens                                                        |
| -------------------------------------- | ------------------------------------------------------------------- |
| **Point** — only index finger extended | Drag the constellation: left/right yaws, up/down pitches            |
| **Pinch** — index + thumb close        | Continuous scaling: closer fingers shrink the graph, opening grows it |
| **Palm** — all five fingers extended   | The graph follows your palm orientation in real time                |

Each gesture is detected with hysteresis so modes don't flicker. All values are
smoothed (EMA on positions, slerp on quaternions). The mouse and OrbitControls
remain a full fallback at all times.

---

## Tech stack

- **Monorepo:** pnpm workspaces, TypeScript project references
- **Frontend (`artifacts/thoughts`):** React 18, Vite, Tailwind CSS, shadcn/ui,
  Three.js, MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- **Backend (`artifacts/api-server`):** Node.js, Fastify, Pino, Zod
- **ML:** `@xenova/transformers` running `all-MiniLM-L6-v2` in-process (no
  Python, no GPU required)
- **Shared contracts:** OpenAPI spec in `lib/api-spec`, codegen client in
  `lib/api-client-react`, generated Zod types in `lib/api-zod`

## Project layout

```
artifacts/
  api-server/        Fastify server exposing POST /api/graph
  thoughts/          Vite + React frontend (the Ideascape UI)
  mockup-sandbox/    Component preview server (design scratch space)
lib/
  api-spec/          OpenAPI definition (source of truth for the API)
  api-client-react/  Generated TanStack Query client
  api-zod/           Generated Zod schemas / TypeScript types
```

## Requirements

- **Node.js 20+**
- **pnpm 9+** (this repo refuses to install with npm/yarn)
- A modern browser with **WebGL 2** support (Chrome, Edge, Firefox, Safari)
- A **webcam** — only required if you want to use gesture controls
- HTTPS or `localhost` — browsers will not grant camera access on plain HTTP

## Running locally

```bash
# install all workspace dependencies
pnpm install

# start everything in dev mode (api server + frontend + mockup sandbox)
pnpm -r --parallel run dev
```

Or start the two services individually:

```bash
pnpm --filter @workspace/api-server run dev   # http://localhost:8080
pnpm --filter @workspace/thoughts    run dev  # frontend dev server
```

The frontend is configured to proxy `/api/*` calls to the API server.

On Replit, three workflows are pre-configured and start automatically:
`artifacts/api-server: API Server`, `artifacts/thoughts: web`, and
`artifacts/mockup-sandbox: Component Preview Server`.

## Building for production

```bash
pnpm run build
```

This runs typecheck across all packages and then `pnpm -r run build` for every
artifact that has a build script.

## How to use the app

1. Open the frontend in your browser.
2. Edit the seed text in the **Stream of Consciousness** panel — one thought per
   line. Use at least 2 lines.
3. Click **Generate Constellation**. The first run downloads the embedding model
   to local cache (a few seconds); subsequent runs are instant.
4. Switch between **Centralized / Decentralized / Distributed** topologies from
   the dropdown.
5. Drag with the mouse to orbit, scroll to zoom, click any node to read its
   text.
6. Optionally flip on **Gesture Controls**, allow camera access, and use the
   point / pinch / palm gestures described above. The webcam preview shows
   which mode is currently active.
7. Use the **Nodes** and **Edges** buttons to download the current topology as
   CSV.

## API

The backend exposes a single endpoint:

```
POST /api/graph
Content-Type: application/json

{
  "notes":     ["...", "...", ...],   // 2+ strings
  "threshold": 0.35,                  // similarity cutoff for edges
  "clusters":  4                       // k for k-means
}
```

Response contains three topologies (`centralized`, `decentralized`,
`distributed`), each with `nodes`, `edges`, `nodesCsv`, and `edgesCsv`. The
canonical schema lives in `lib/api-spec/openapi.yaml`.

## Privacy

- The webcam stream stays entirely in your browser; only landmark coordinates
  are used and nothing is uploaded.
- Embeddings are computed in the local Node process — no third-party AI service
  is called.

## Troubleshooting

- **"Camera not allowed"** — grant the browser camera permission and reload.
  Camera APIs require `https://` or `http://localhost`.
- **Blank 3D scene** — make sure your browser supports WebGL 2 and hardware
  acceleration is enabled.
- **`Use pnpm instead` error on install** — this repo enforces pnpm; install it
  with `npm i -g pnpm` or `corepack enable` and re-run `pnpm install`.
- **Gesture mode flips between poses** — keep your hand fully visible to the
  camera, well lit, and a comfortable distance away (~30–60 cm).

## License

MIT
"# IdeaScape" 
"# IdeaScape" 
