# src/lib/ — Services Layer

Backend services: database, OAuth automation, tunneling, network, and utilities.

## STRUCTURE

```
src/lib/
├── auth/           # Session/auth helpers (3 files)
├── db/             # SQLite database layer
│   ├── adapters/   # better-sqlite3, sql.js, node:sqlite, bun:sqlite
│   ├── helpers/    # Query builders, migration runner
│   ├── migrations/ # Schema migrations
│   └── repos/      # Data access (connections, settings, usage, etc.)
├── mcp/            # MCP server integration
├── merge/          # Config merge utilities
├── network/        # Network detection, proxy config
├── oauth/          # Bulk automation engine
│   ├── constants/  # Provider-specific constants
│   ├── services/   # Import managers (23 files — Kiro, CodeBuddy, etc.)
│   └── utils/      # Browser helpers, Google login, region selection
├── qoder/          # Qoder preview/job management
├── tunnel/         # Tunnel providers
│   ├── cloudflare/ # Cloudflare tunnel integration
│   ├── shared/     # Common tunnel utilities
│   └── tailscale/  # Tailscale integration (710 lines)
├── updater/        # App auto-update logic
└── usage/          # Usage tracking service
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add DB table/repo | `db/repos/` — one file per entity |
| Change DB adapter | `db/adapters/` — 4 adapters with same interface |
| Add bulk automation | `oauth/services/` — extend base manager |
| Add tunnel provider | `tunnel/{name}/` — follow cloudflare/tailscale pattern |
| Token/quota tracking | `usage/` + `usageDb.js` (root of lib) |

## CONVENTIONS

- **Dual SQLite strategy** — `better-sqlite3` (native) preferred, `sql.js` (WASM) fallback
- **Singleton managers** — `globalThis.__*Singleton` pattern for import managers
- **Browser automation** — Playwright-based, cascades to manual assist on captcha
- **`onStep?.(step, message)`** — real-time UI reporting from automation workers
- **`persistJobSnapshot`** — immediate DB writes during automation for crash recovery
- **Access key naming** — `9router-${email_prefix}-${timestamp}` capped at 50 chars

## ANTI-PATTERNS

- Never deduplicate access tokens automatically (users manage)
- Never skip `registerAll.js` import when testing translators
- Automation must handle `failed_restricted` gracefully (replay with active session)
- DB adapters must expose identical interface regardless of backend
