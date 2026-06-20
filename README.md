# ShareTeacher

Runway-first AI meeting teacher. Joins a meeting, speaks as a Runway Character,
shares a real browser, and teaches AI workflows (Lesson 1: build a PPT with
ChatGPT) step by step. See [`docs/runway-meeting-teacher-plan.md`](docs/runway-meeting-teacher-plan.md).

## Architecture (organ model)

| Organ | Dir | Factory | Real backend |
|---|---|---|---|
| Character (face/voice/narration) | `src/integrations/runway` | `createCharacterAgent` | Runway |
| Meeting bot | `src/integrations/recall` | `createMeetingBot` | Recall.ai |
| Browser runtime | `src/integrations/kernel` | `createBrowserRuntime` | Kernel |
| Browser control | `src/integrations/browser` | `createBrowserController` | Playwright/Browser Use over CDP |
| Lesson engine | `src/lessons` | `createLessonEngine` | — |
| Persistence | `src/db/repo.ts` | `createRepository` | Postgres (degrades to in-memory) |
| Memory | `src/memory` | `createMemoryHooks` | (stub) |
| Orchestrator + tools + SSE | `src/server` | `getOrchestrator` | — |
| Teaching UI | `src/app` | `/`, `/stage`, `/summary/[id]` | — |

`src/types/contracts.ts` is the single source of truth every organ implements.

**There is no mock mode.** Every adapter talks to its real service. A live
lesson legitimately requires live credentials **plus a human** (microphone,
first-time ChatGPT login via the Kernel live view, and a public tunnel for
Recall). The DB is the one exception that degrades on its own: it uses Postgres
whenever reachable and transparently falls back to an in-memory store if the DB
is unreachable — a resilience path, not a mock.

## Run it (real services)

```bash
pnpm install
cp .env.example .env.local      # then fill in the real keys
pnpm db:up                      # Postgres in Docker on host port 5433
pnpm db:push                    # create tables
set -a && . ./.env.local && set +a
uvicorn main:app --app-dir browser_agent --host 127.0.0.1 --port 8700 &  # browser-use sidecar
pnpm dev                        # http://localhost:3000  (use -p 3001 if 3000 is taken)
```

Open the app → pick **Create a PPT using ChatGPT** → **Start teaching session**.
The `/stage` classroom streams the whole lesson live over SSE: Character tile
(fed the Runway LiveKit join token), live browser viewport, step timeline,
prompt + model-output panels, transcript, checkpoint buttons (which **always**
wait for a real human answer, with a timeout fallback), and operator take-over /
stop. Artifacts (`.pptx` outline + prompt template) are saved to
`public/artifacts/` and persisted to Postgres.

Verify the two credential-only realtime paths headlessly (no ChatGPT login, no
mic needed):

```bash
set -a && . ./.env.local && set +a && pnpm verify
# (a) creates a real Kernel browser, prints its CDP + live-view url
# (b) starts a Runway realtime session for the configured avatar and reports
#     whether LiveKit creds came back
```

## Live prerequisites

Put keys in `.env.local` (copy from `.env.example`). Key validation status:

| Service | Status | Notes |
|---|---|---|
| OpenAI | ✅ live | `GET /v1/models` 200 |
| Kernel | ✅ live | `GET /browsers` 200 |
| Runway | ✅ live | `Bearer` + `X-Runway-Version: 2024-11-06`, 200 |
| Recall | ✅ live | region **ap-northeast-1**, `Token` auth, 200 |

Things a live lesson still needs from a human / the environment:

- **Recall**: `RECALL_OUTPUT_URL` must be a **public** URL (ngrok/cloudflared
  tunnel to `/stage`), not `localhost`, and you need a real Meet/Zoom/Teams link.
- **Kernel**: the SAME persistent profile (`KERNEL_PROFILE_NAME`) is reused every
  session so the ChatGPT login carries forward — first login is a human takeover
  via the Kernel live view. Named persistent profiles require a Kernel **paid
  plan**; profileless browsers work on the free plan.
- **Browser control**: the Python `browser_agent` FastAPI sidecar (browser-use
  over the Kernel CDP url) must be running at `BROWSER_AGENT_URL`.
- **Runway**: set `RUNWAY_CHARACTER_ID` / `RUNWAY_VOICE_ID` to the live preset
  Character + voice (`clara`).

## Scripts

`pnpm dev | build | start | typecheck | verify | db:up | db:down | db:push | db:studio`
