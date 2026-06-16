# open-sse/ — Core Routing Engine

SSE streaming engine that handles all AI provider communication. Translates between formats, executes requests, compresses output.

## STRUCTURE

```
open-sse/
├── config/         # Provider models, constants, runtime config (13 files)
├── executors/      # One-per-provider request executors (21 files)
├── handlers/       # HTTP route handlers (chat, embeddings, image, TTS, search)
├── rtk/            # Runtime Token Kompression (filters/ for agent output)
├── services/       # Provider resolution, token refresh, model parsing
├── transformer/    # Legacy response transformers
├── translator/     # Format bridge: source → openai → target
└── utils/          # Shared helpers (proxy fetch, protobuf, streaming)
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add provider | `config/providerModels.js` (models) + `config/providers.js` (endpoints) + `executors/{name}.js` |
| Add translation | `translator/request/{from}-to-{to}.js` + `translator/response/{from}-to-{to}.js` |
| Fix token refresh | `services/tokenRefresh.js` — unified `getAccessToken()` routes by provider |
| Add RTK filter | `rtk/filters/{name}.js` — must never return empty (R14 guard) |
| Image/TTS/Search | `handlers/imageProviders/`, `handlers/ttsProviders/`, `handlers/search/` |
| Chat core flow | `handlers/chatCore/` — request lifecycle |

## CONVENTIONS

- **`PROVIDER_MODELS` is the single source of truth** — all model metadata, capabilities, strip lists
- **Translator uses OpenAI as intermediate** — lossy for thinking, images, audio, tool IDs
- **Executors are standalone** — each handles its own URL building, headers, streaming
- **`FORMATS` enum** — openai, claude, gemini, gemini-cli, openai-responses, antigravity, kiro, cursor, commandcode, ollama, vertex
- **`register(from, to, requestFn, responseFn)`** — translator registration pattern
- **`dedupRefresh` cache** — 10s TTL prevents concurrent token refresh races

## ANTI-PATTERNS

- Never call `buildCursorRequest` twice (drops tool_results)
- Never pass string content to CommandCode (must be array)
- Never filter out tool messages in `openaiHelper.js`
- Never skip `message_start` for Claude streaming
- Never route latency-critical inline completion externally (MODEL_NO_MAP)
- RTK filters must never return empty output — fallback to raw passthrough

## KEY FILES

- `index.js` — barrel exports for the entire module
- `config/providerModels.js` (920 lines) — all model definitions, aliases, capabilities
- `services/tokenRefresh.js` (833 lines) — OAuth/JWT/SSO token lifecycle
- `utils/cursorProtobuf.js` (776 lines) — Cursor ConnectRPC protobuf codec
