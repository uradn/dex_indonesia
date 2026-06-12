# Repository Guidelines

- Repo: https://github.com/uradn/dex_indonesia.git
- Dexter is a CLI-based AI agent for deep financial research, built with TypeScript, `@mariozechner/pi-tui` (terminal UI), and LangChain.

## Project Structure

- Source code: `src/`
  - Agent core: `src/agent/` (agent loop, prompts, compaction, microcompact, token counting, types)
  - CLI interface: `src/cli.ts`, entry point: `src/index.tsx`
  - Model/LLM: `src/model/llm.ts` (multi-provider LLM abstraction)
  - Tools: `src/tools/` (financial search, web search, browser, skill tool)
  - Tool descriptions: `src/tools/descriptions/` (rich descriptions injected into system prompt)
  - Finance tools: `src/tools/finance/` (prices, fundamentals, filings, insider trades, ASEAN markets)
  - Macro tools: `src/tools/macro/` (13-module Indonesia sovereign intelligence system)
  - Search tools: `src/tools/search/` (Exa preferred, Tavily fallback, LangSearch last resort)
  - Browser: `src/tools/browser/` (Playwright-based web scraping)
  - Skills: `src/skills/` (SKILL.md-based extensible workflows)
  - Memory: `src/memory/` (SQLite + hybrid vector/BM25, `.dexter/memory/`)
  - Gateway: `src/gateway/` (WhatsApp via Baileys, group + DM routing)
  - Cron: `src/cron/` (scheduled jobs via croner, SQLite-persisted)
  - Utils: `src/utils/` (env, config, caching, token estimation, markdown tables)
  - Evals: `src/evals/` (LangSmith evaluation runner)
- Config: `.dexter/settings.json` (persisted model/provider selection)
- Environment: `.env` (API keys; see `env.example`)
- Scripts: `scripts/` (release, morning check, cron registration, backtest, shock scenario)

## Build, Test, and Development Commands

- Runtime: Bun (primary). Use `bun` for all commands.
- Install deps: `bun install`
- Run: `bun start` or `bun run src/index.tsx`
- Dev (watch mode): `bun dev`
- Type-check: `bun run typecheck`
- Tests: `bun test`
- Evals: `bun run src/evals/run.ts` (full) or `bun run src/evals/run.ts --sample 10` (sampled)
- CI runs `bun run typecheck` and `bun test` on push/PR.

## Coding Style & Conventions

- Language: TypeScript (ESM, strict mode). No `any`.
- No logging unless explicitly requested.
- No README/docs files unless explicitly requested.
- CalVer versioning: `YYYY.M.D` (no zero-padding). Release via `bash scripts/release.sh [version]`.
- Tests colocated as `*.test.ts`, run with Bun's built-in runner. Jest config exists for legacy reasons only.
- Never add comments unless the WHY is non-obvious.

## LLM Providers

- Supported: OpenAI (default), Anthropic, Google, xAI (Grok), Moonshot (Kimi), DeepSeek, OpenRouter, Ollama (local).
- Default model: `gpt-5.5`. Provider detection is prefix-based (`claude-` → Anthropic, `gemini-` → Google, `grok-` → xAI, `kimi-` → Moonshot, `deepseek-` → DeepSeek, `openrouter:` → OpenRouter, `ollama:` → Ollama).
- Fast models for lightweight tasks: see `FAST_MODELS` map in `src/model/llm.ts`.
- Anthropic uses explicit `cache_control` on system prompt for prompt caching cost savings.
- Users switch providers/models via `/model` command in the CLI.

## Tools

- `financial_search`: primary tool for all financial data queries (prices, metrics, filings).
- `get_asean_data`: ASEAN market data — IDX/Bursa/SGX/SET/PSE via Yahoo Finance.
- `read_filings`: SEC filing reader for 10-K, 10-Q, 8-K documents.
- `web_search`: general web search (Exa → Tavily → LangSearch).
- `browser`: Playwright-based web scraping.
- `skill`: invokes SKILL.md-defined workflows. Each skill runs at most once per query.
- `arm_thesis`: saves a Big Short thesis to `macro_theses` DB (status: armed). Called automatically at end of `big-short-thesis` skill (Step 6). Enables walk-forward T+3/6/12 backtesting. `src/tools/macro/arm-thesis-tool.ts`.
- Tool registry: `src/tools/registry.ts`. Tools conditionally registered based on env vars.
- Tools tagged `concurrencySafe: true` run in parallel; others run serially.

## Macro Intelligence Tools (Indonesia Sovereign System)

13 modules aggregated into Silent Crisis Detector (SCD). Weights sum to 1.00.

| Tool | Module | Weight | Key Signals |
|------|--------|--------|-------------|
| `bop_engine` | M1 BoP | 0.10 | Trade balance, FX reserves, synthetic CAD risk, Greenspan-Guidotti cross-feed |
| `sovereign_risk_engine` | M2 Sovereign Risk | 0.09 | CDS 5Y + velocity (bps/week), SBN yield, term premium, foreign SBN %, BI yield policy flag, S&P proximity risk |
| `fx_defense_engine` | M3 FX Defense | 0.16 | USDIDR z-score, reserves burn, SRBI bid-cover ratio, 1st/2nd-gen crisis gates |
| `commodity_engine` | M4 Commodity | 0.07 | Export basket (coal/CPO/nickel/LNG), Brent import vulnerability, ICP threshold |
| `foreign_flow_engine` | M5 Foreign Flow | 0.09 | EIDO ETF, silent exit detection, SSVI, MSCI classification risk |
| `narrative_divergence_engine` | M6 Narrative | 0.02 | Official guidance vs market (APBN assumptions vs actuals), BBM narrative vs cost recovery |
| `asean_relative_value_engine` | M7 ASEAN RV | — | IDR idiosyncratic component vs ASEAN peers (supplementary, not in SCD weight) |
| `banking_stress_engine` | M8 Banking | 0.08 | NPL, LDR, CAR, IndONIA corridor, FSAP nexus, BNPL sub-indicator (OJK IKNB) |
| `market_stress_engine` | M9 Market | 0.05 | IHSG P/E, advance/decline breadth, valuation disconnect |
| `fiscal_engine` | M10 Fiscal | 0.09 | APBN realisasi, revenue shortfall, S&P interest/revenue threshold (>15% = negative watch) |
| `domestic_pressure_engine` | M11 Domestic | 0.06 | PIHPS 10 commodities, BBM subsidy gap, ICP watch |
| `political_risk_engine` | M12 Political | 0.05 | Unemployment, Exa news sentiment, X API v2 real-time social feed |
| `uln_engine` | M13 ULN | 0.09 | DSR, Greenspan-Guidotti, ULN/GDP, hedging compliance, 1997 transmission detection |
| `regime_engine` | Regime | 0.05 | Growth ROC × Inflation ROC quadrant (Q1–Q4) |
| `silent_crisis_detector` | Aggregator | — | Weighted composite; ×1.2 amplifier at 3+ stressed modules, ×1.4 at 5+ |
| `macro_threshold_monitor` | Tripwire | — | Fast fixed-threshold breach check (VIX, DXY, Brent, USDIDR) — no LLM call |

## Skills

- Skills live as `SKILL.md` files with YAML frontmatter (`name`, `description`) and markdown body (instructions).
- Discovery: `src/skills/registry.ts` scans for SKILL.md files at startup.
- Skills exposed to LLM via system prompt; invoked via `skill` tool.

Built-in skills:
- `src/skills/dcf/SKILL.md` — DCF valuation
- `src/skills/asean-monitor/SKILL.md` — ASEAN market monitor
- `src/skills/x-research/SKILL.md` — X/Twitter research workflow
- `src/skills/macro/bop/SKILL.md` — BoP analysis workflow
- `src/skills/macro/fx-defense/SKILL.md` — FX Defense workflow
- `src/skills/macro/klr-ews/SKILL.md` — KLR EWS 21-indicator dual-crisis matrix
- `src/skills/macro/shock-scenario/SKILL.md` — Forward-looking stress simulator
- `src/skills/macro/rr-framework/SKILL.md` — Rivera-Batiz theoretical framework reference
- `src/skills/macro/sovereign-stress/SKILL.md` — Sovereign stress deep dive (CDS trajectory, SBN ownership, APBN credibility)
- `src/skills/macro/positioning/SKILL.md` — Market positioning analysis
- `src/skills/macro/backtest/SKILL.md` — Walk-forward backtest against 6 Indonesia crisis events (2013–2023)
- `src/skills/macro/morning-brief/SKILL.md` — Morning brief workflow (13 modules + SCD)
- `src/skills/macro/cron-setup/SKILL.md` — Cron job management workflow
- `src/skills/macro/asean-morning-brief/SKILL.md` — Daily cron brief (13 modules + SCD) — used by daily 08:00 WIB cron
- `src/skills/macro/big-short-thesis/SKILL.md` — Burry-mode contrarian thesis: 6-tool parallel analysis → structured thesis → **auto-ARM to DB via `arm_thesis` tool** (Step 6)

## Dashboard (localhost:6080)

- Start: `bun scripts/dashboard.ts`
- Routes:
  - `GET /` — main dashboard: 13 module panels, time-series charts, SCD gauge, module scores from DB
  - `GET /rr` — R&R / Greenspan-Guidotti page: 7 live R&R framework signals
  - `GET /bs` — Big Short Thesis page: Burry-mode contrarian tracker
- `/bs` panels: divergence scanner (5 ranked gaps), trigger monitor (ARMED/TRIGGERED), transmission chain (7-node vertical stepper with hover tooltips), timeline T+0/3/6/12, kill switch status, EV calculator, Burry Method validation, thesis archive
- Thesis lifecycle: `armed` → `triggered` → `confirmed` / `killed` / `closed`
- `macro_theses` table in `.dexter/macro/macro.db` stores predictions at ARM time + actuals at T+3/6/12 for walk-forward accuracy
- ARM THESIS two ways: (1) CLI `big-short-thesis` skill → `arm_thesis` tool (LLM-powered); (2) dashboard ARM THESIS button (template-based, no LLM)
- API endpoints: `POST /api/thesis/arm`, `POST /api/thesis/kill/:id`, `GET /api/thesis/compute`, `GET /api/thesis/all`, `POST /api/run-scd`

## Agent Architecture

- Agent loop: `src/agent/agent.ts`. Async generator yielding typed `AgentEvent`s.
- Each turn: microcompact → strip old thinking → stream LLM → execute tools → check context threshold.
- Loop exits on: no tool calls (final answer), tool denied, max iterations, or error.
- Context management (3 layers): microcompact (per-turn) → full compaction (LLM summarizes) → hard truncation (drop oldest rounds).
- Scratchpad: `.dexter/scratchpad/*.jsonl` — one file per query, JSONL with `init`/`tool_result`/`thinking`.
- Events: `tool_start`, `tool_end`, `thinking`, `answer_start`, `done`, etc. for real-time UI.

## WhatsApp Gateway

- Location: `src/gateway/` — uses `@whiskeysockets/baileys`
- Start: `bun run gateway:login` (scan QR) → `bun run gateway` (run server)
- Self-chat mode: when `allowFrom` in `.dexter/gateway.json` contains the bot's own number — only allows messages from self.
- Group chats: buffers messages until bot is @mentioned, sends buffered history as context.
- Sessions persist across restarts via `src/gateway/sessions/store.ts`.

## Cron System

- Location: `src/cron/` — uses `croner` library
- Jobs stored in SQLite at `.dexter/cron/jobs.json` (gitignored — local runtime state)
- Active macro schedule:
  - Daily 08:00 WIB Mon-Fri: `asean-morning-brief` skill (all 13 modules)
  - Monday 07:00 WIB: deep dive + sovereign memo + Hormuz shock
  - Monday 07:30 WIB: Big Short thesis milestone check — T+3/6/12 accuracy vs predictions + kill switch auto-detect
  - 1st of month 08:00 WIB: APBN realisasi + ULN/DSR + compound shock + backtest analog
- Register/update: `bun scripts/add-*-cron.ts`

## Environment Variables

```
# LLM providers (at least one required)
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
XAI_API_KEY
OPENROUTER_API_KEY
MOONSHOT_API_KEY
DEEPSEEK_API_KEY
OLLAMA_BASE_URL          # default: http://127.0.0.1:11434

# Financial data
FINANCIAL_DATASETS_API_KEY
EODHD_API_KEY            # USDIDR tertiary fallback + IHSG price

# Web search (Exa preferred, Tavily fallback, LangSearch last resort)
EXASEARCH_API_KEY
TAVILY_API_KEY
LANGSEARCH_API_KEY

# Social media (X/Twitter API v2 — Module 12 real-time unrest signal)
X_BEARER_TOKEN

# LangSmith tracing (optional)
LANGSMITH_API_KEY
LANGSMITH_ENDPOINT
LANGSMITH_PROJECT
LANGSMITH_TRACING

# Macro — BBM price overrides (no redeploy needed, updated by operator)
PERTALITE_PRICE_IDR      # default 10000
SOLAR_PRICE_IDR          # default 6800
PERTAMAX_PRICE_IDR       # default 16250 (updated Jun 10 2026)
PERTAMAX_GREEN_PRICE_IDR # default 17000 (updated Jun 10 2026)

# Macro — policy/classification signals (operator-updated qualitative flags)
BI_BUYS_LONG_SBN         # 'false' when BI abstains from 10Y+ SBN purchases; default true
MSCI_CLASSIFICATION_STATUS        # 'confirmed' | 'under_review' | 'downgrade_risk'
MSCI_MAY2026_REBALANCING_OUTFLOW_USD_BN  # passive outflow estimate from rebalancing event

# Macro — premium data (optional; free sources used as fallback)
BLOOMBERG_API_URL
BLOOMBERG_API_KEY
REFINITIV_APP_KEY
REFINITIV_USERNAME
REFINITIV_PASSWORD
BPS_API_KEY              # BPS WebAPI key (free at webapi.bps.go.id)
```

## Version & Release

- Version format: CalVer `YYYY.M.D` (no zero-padding). Tag prefix: `v`.
- Release script: `bash scripts/release.sh [version]` (defaults to today's date).
- Release flow: bump version in `package.json`, create git tag, push tag, create GitHub release via `gh`.
- Do not push or publish without user confirmation.

## Testing

- Framework: Bun's built-in test runner (primary), Jest config exists for legacy compatibility.
- Tests colocated as `*.test.ts`.
- Run `bun test` before pushing when you touch logic.

## Security

- API keys stored in `.env` (gitignored). Users can also enter keys interactively via the CLI.
- Config stored in `.dexter/settings.json` (gitignored).
- Never commit or expose real API keys, tokens, or credentials.
