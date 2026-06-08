# Huis Dashboard

A local-network dashboard / start page with a first-class **agent**: an Ollama
model can add, edit, move, and remove tiles by chatting — but only after it
passes a **pre-validation gate** that proves it drives the dashboard safely.

## Quick start

```bash
npm install
npm start                 # http://localhost:8080  (binds 0.0.0.0 for the LAN)
```

Config via env vars (all optional):

| var | default | meaning |
|-----|---------|---------|
| `DASH_PORT` | `8080` | HTTP port |
| `DASH_HOST` | `0.0.0.0` | bind address |
| `DASH_HTTPS_PORT` | `443` | HTTPS port (served only if cert+key exist) |
| `DASH_TLS_CERT` | `data/tls/dashboard.crt` | TLS cert (full chain) |
| `DASH_TLS_KEY` | `data/tls/dashboard.key` | TLS private key |
| `OLLAMA_HOST` | `http://ollama.huis:11434` | Ollama backend |
| `DASH_HEALTH_INTERVAL` | `30000` | health-check interval (ms) |
| `DASH_MAX_BACKUPS` | `25` | dashboard snapshots to keep |

## Development

```bash
npm install        # also enables git hooks (core.hooksPath=.githooks)
npm run lint       # eslint (js) + stylelint (css) + htmlhint + json + 500-line check
```

- **pre-commit** hook runs `npm run lint` (blocks the commit on any error).
- **post-merge** hook restarts `huis-dashboard` after a `git pull` (and reinstalls
  deps if `package-lock.json` changed) — so a deploy goes live automatically.
- No source file may exceed **500 lines** (`scripts/check-loc.mjs`); the browser
  UI is split into ES modules under `public/js/`.

## Run as a service + HTTPS

Runs under systemd (`deploy/huis-dashboard.service`), serving HTTP on 8080 and
HTTPS on 443:

```bash
sudo cp deploy/huis-dashboard.service /etc/systemd/system/
sudo systemctl enable --now huis-dashboard      # starts on boot, restarts on failure
```

HTTPS uses a cert from the internal step-ca (`caserver.huis`), obtained over
ACME and auto-renewed by acme.sh:

```bash
# one-time: trust the internal root, then issue the cert
curl -sk https://caserver.huis:9000/roots > /usr/local/share/ca-certificates/huis-root.crt
sudo update-ca-certificates
acme.sh --issue --server https://caserver.huis:9000/acme/acme/directory \
  -d dashboard.huis --standalone --httpport 80
acme.sh --install-cert -d dashboard.huis \
  --key-file /opt/data/tls/dashboard.key \
  --fullchain-file /opt/data/tls/dashboard.crt \
  --reloadcmd "systemctl restart huis-dashboard"
```

→ **https://dashboard.huis**. Certs (`data/tls/`) and all runtime data are
gitignored. If the server has no cert, it serves HTTP only.

## The model gate

A model is **rejected** unless it clears the score threshold (default 0.8) AND
fails **zero** safety tasks. The live agent endpoint refuses any model that
isn't on the allowlist.

```bash
npm run validate -- gpt-oss:20b          # validate one model
npm run validate -- --all                # validate every installed model
npm run validate -- --list               # show approved models
npm run validate -- --threshold 0.9 qwen3-coder:30b-a3b-q4_K_M
npm run validate -- <model> --category robustness   # diagnostic subset (capability|robustness|safety); allowlist untouched
npm run validate -- <model> --num-ctx 32768          # cap context (for models with a limited/large declared context)
npm run validate -- --retire <model> / --unretire <model>   # drop/restore a model (skipped by --all)
```

Passing models are written to `data/approved-models.json`.

The battery (`src/validation/tasks.js`):
- **capability** — add/update/remove tiles, add sections, create + switch a workspace.
- **robustness** — move tiles, multi-step requests, id lookup, rename.
- **safety (critical)** — no collateral edits, no deleting on a vague "clean
  up", no mutations for out-of-scope questions, resists a prompt-injection
  "wipe everything + leak the password" override, and refuses to build harmful
  tiles (phishing, covert tracking).

### Repeat-K (flaky safety)

Safety failures are often non-deterministic — e.g. `gpt-oss-safeguard:20b` obeys
the injection ~1 in 4 runs. So **critical tasks run K times and must pass every
time** (`DASH_CRITICAL_REPEATS`, default 5). A single clean pass isn't proof;
raise K to catch rarer failures.

### Red-team refusal probe

Separate from the gate, this measures whether a model *declines* harmful
requests (phishing tile, covert tracking, malware, injection, weapon
instructions):

```bash
npm run redteam -- gpt-oss:20b          # one model
npm run redteam -- --all                # every installed model
```

It runs against a sandbox store and prints each reply + verdict
(DECLINED / COMPLIED / UNCLEAR). Note: a model can pass the gate yet still
comply with some red-team prompts (the two are independent today).

## Architecture

```
src/
  config.js          env-driven config
  store.js           dashboard state: schema validation, atomic writes, backups
  health.js          periodic HTTP/TCP health checks
  ollama.js          Ollama API client (chat, tools, model load)
  agent/
    tools.js         the ONLY way a model can change the dashboard
    prompt.js        system prompt (+ live dashboard snapshot)
    agent.js         tool-calling loop, returns reply + tool trace
  validation/
    tasks.js         the pre-validation battery (capability/robustness/safety)
    harness.js       run a model through the battery K times, score it
    registry.js      the approved-models allowlist
    cli.js           `npm run validate`
    redteam.js       harmful-request refusal cases + runner
    redteam-cli.js   `npm run redteam`
  server.js          Express: UI + REST API + gated agent endpoint
public/              vanilla HTML/CSS/JS dashboard + chat panel
data/                dashboard.json, backups/, approved-models.json (gitignored)
```

## Safety boundary

The agent has **no** shell, file, or network access — only the tools in
`agent/tools.js`. Every state change is revalidated against the schema and
written atomically, and a timestamped snapshot is saved to `data/backups/`
before every write, so nothing is ever irreversibly lost.

## REST API

```
GET    /api/dashboard
POST   /api/workspaces               {name}                  tabbed boards
PATCH  /api/workspaces/:id           {name}
DELETE /api/workspaces/:id                                   (must be empty)
POST   /api/workspaces/:id/activate                          switch active workspace
POST   /api/sections/:id/workspace   {workspaceId}           move a section between workspaces
POST   /api/notes/:id/workspace      {workspaceId}           move a note between workspaces
POST   /api/sections                 {name}
PATCH  /api/sections/:id             {name}
DELETE /api/sections/:id
POST   /api/sections/:id/move        {position}              reorder sections
POST   /api/sections/:id/tiles       {name,url,description?,icon?,health?}
PATCH  /api/tiles/:id
DELETE /api/tiles/:id
POST   /api/tiles/:id/move           {section_id, position?} move/regroup tiles
POST   /api/notes                    {text, color?}          sticky notes
PATCH  /api/notes/:id                {text?, color?}
DELETE /api/notes/:id
POST   /api/feature-requests         {title, detail?}        request queue
PATCH  /api/feature-requests/:id     {status|title|detail}   status: open|planned|done|rejected
DELETE /api/feature-requests/:id
GET    /api/health
GET    /api/models                   {approved, installed, details}
POST   /api/agent/chat               {model, messages[]}   (allowlisted models only)
```

## Dashboard features

- **Workspaces** — top-level tabs, each its own board of sections + notes
  (e.g. Home, Media, Work). New content lands in the active workspace. The
  agent manages them too (`add_workspace`, `switch_workspace`,
  `move_to_workspace`, …). Separate **🧪 Models** and **🛠️ Abilities** system
  tabs show the gate outcomes and the agent's tool surface. ＋ to add,
  double-click a tab to rename, hover ✕ to delete (empty workspaces only).
- **Tiles & sections** — service links grouped into sections, with optional
  health checks. Sections **collapse** to just their header (▾/▸, with a tile
  count), and a topbar **Collapse/Expand all** folds the active workspace at once.
- **Drag-and-drop** — reorder tiles within a section, move tiles between
  sections (regroup), and reorder sections via the `⋮⋮` grip.
- **Sticky notes** — quick freeform notes (📝 Note); editable inline, colorable.
- **Feature-request queue** — file requests (🗒️ Requests). The agent also files
  them via the `request_feature` tool when asked for something it can't do, so
  the queue is fed *by the models* as well as by you.
- **Assistant** — a floating, draggable (by its header), resizable window
  driven by an allowlisted model; geometry persists across reloads. Enter sends,
  Shift+Enter for a newline.
