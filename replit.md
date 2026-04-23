# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

- **thoughts** (`/`) — "Ideascape", a behavioural insight tool. Users log structured journal entries (text + date + mood/energy/stress 1–10). The server embeds entries with `Xenova/all-MiniLM-L6-v2`, runs sentiment scoring, keyword extraction, KMeans clustering, three topology layouts (centralized / decentralized / distributed), and computes insights (dominant themes, repeated thoughts, triggers, emotional trend, predicted next mood, mood time series). The frontend renders nodes in 3D (color = mood, size = frequency), with a timeline slider for temporal filtering, an insights panel, and optional MediaPipe Hands gesture controls (point/pinch/palm).
- **api-server** (`/api`) — shared Express API. `POST /api/graph` accepts structured entries and returns three topologies plus a behavioural insights bundle.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
