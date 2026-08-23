# Bundleen AI assistant

"Ask Bundleen AI" is a server-side assistant grounded in real Bundleen data. It never runs
arbitrary SQL and never sees data outside the signed-in caller's own authorization boundary.

## Architecture

- **Model**: official [`openai`](https://www.npmjs.com/package/openai) Node SDK, Chat Completions
  API with `tools` (function calling) and `stream: true`. Client wrapper:
  `src/lib/server/ai/openai-client.ts`.
- **Transport**: `POST /api/ai/chat` streams newline-delimited JSON events
  (`{"type":"delta"|"tool"|"done"|"error", ...}`) — see `ChatStreamEvent` in
  `src/lib/server/ai/chat.ts`. The client hook (`src/hooks/useBundleenAi.ts`) parses this with
  `TextDecoder` and a shared `<BundleenAiPanel>` component (`src/components/ai/BundleenAiPanel.tsx`)
  renders loading/streaming/error/empty states. The same panel is reused on the homeowner, provider,
  HOA manager (`/app/hoa/assistant`), and admin (`/app/admin/assistant`) surfaces.
- **Persistence**: one `AiConversation` + a capped history of `AiMessage` rows per user
  (`contextKey: "general"`). Only the user's own text and the assistant's final text are stored —
  never raw tool arguments or tool result JSON. A separate `AiUsageLog` table records
  latency/model/tool names/success/coarse error class/token counts for cost and reliability
  observability, and deliberately has no content column at all.
- **Tools**: a fixed, closed set of seven predefined, small, structured, read-only queries
  (`src/lib/server/ai/tools/*.ts`) — no general-purpose SQL tool exists. Every tool independently
  re-derives authorization from the verified session (`src/lib/server/ai/scope.ts`), reusing the
  same manager/resident checks (`requireManagedHoa`/`requireActiveResident` in
  `src/lib/server/hoa.ts`) the rest of the product already uses — a tool never trusts an id the
  model supplies without checking it against the database.
- **Docs retrieval**: a small bundled markdown corpus (`src/content/help/articles.ts`) with
  in-memory keyword scoring (`src/lib/server/ai/help-content.ts`) — no vector store. Each article
  has a real page at `/help/<slug>`, so `search_bundleen_help` always returns a working link.

## Tools and authorization boundaries

| Tool | Who can call it | Scope |
| --- | --- | --- |
| `get_admin_operations_summary` | Admin only | Cross-community counts |
| `get_hoa_overview` | Admin, HOA manager, homeowner (of that community) | One community |
| `get_service_requests` | Admin, HOA manager, homeowner | One community; never providers |
| `get_request_bids` | Admin, HOA manager, homeowner (full list); provider (own bid only) | One request |
| `get_service_schedule` | All roles | Provider: own visits. Homeowner (non-manager): own unit only. Manager/admin: whole community |
| `get_provider_pipeline` | Provider only | Own bids/agreements/visits/reviews, always `scope.userId` |
| `search_bundleen_help` | All roles | Static docs, no account data |

Tool responses distinguish `sources` of type `"data"` (a database-backed fact, with an in-app link)
from `"doc"` (a Bundleen Help article link) — the client renders these as separate chips so an
answer never blurs "what Bundleen's records say" with "what the docs say."

**Deliberate simplifications**, to keep the surface small and auditable:
- `get_provider_pipeline`'s "eligible open requests" uses a relationship heuristic (communities the
  provider has already bid in or holds an agreement with), not a full geo/postal-code coverage
  match against `ProviderServiceArea`.
- A caller only ever has one assistant conversation (`contextKey: "general"`); there is no
  per-request or per-topic thread.

## Prompt-injection defense

The system prompt (`src/lib/server/ai/prompt.ts`) is built entirely from static server text plus
the caller's *verified* role — never from user input, conversation history, a tool result, or a
help document. Tool and document content is passed to the model as `tool`-role messages the prompt
explicitly labels as untrusted data that cannot change instructions, tool access, or who the
assistant is answering for. Authorization is enforced in code (`scope.ts`, each tool's `run`),
never inferred from anything the model outputs.

## Cost and abuse controls

- `RATE_LIMITS.aiChat` (`src/lib/server/rate-limit.ts`): 20 messages / 5 minutes per account,
  enforced by `guardAiChat` before any OpenAI call is made — this is the primary cost control.
- `max_tokens` cap per response, a bounded tool-call loop (max 3 rounds, the last forced to a
  text-only answer), and a 20s request timeout via `AbortController`.
- A missing `OPENAI_API_KEY` degrades to a fixed "not configured yet" message rather than an error.

## Environment variables

See `.env.example` — `OPENAI_API_KEY` (required to enable the assistant) and `AI_MODEL` (optional,
defaults to `gpt-4o-mini`).

## Running the tests

```
npm test -- ai
```

Covers role isolation (`tests/ai-scope.test.ts`), tool input validation and redaction
(`tests/ai-tools.test.ts`), the streaming chat route including rate limiting, model failure, and one
grounded answer per role (`tests/ai-chat-route.test.ts`), and help search
(`tests/ai-help-search.test.ts`).
