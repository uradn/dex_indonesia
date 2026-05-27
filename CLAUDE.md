# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fork Identity

**Owner:** Victor (victor@sadasa.id)
**Forked from:** `virattt/dexter` (upstream — read-only reference, do NOT push there)
**Purpose:** Custom Indonesia sovereign macro intelligence system — "Big Short Mode" / Silent Crisis Detector for ASEAN/IDR/IDX monitoring. Not a general-purpose financial agent fork.
**Remote:** No `origin` configured intentionally. Add your own GitHub remote before pushing: `git remote add origin https://github.com/<your-username>/dexter.git`

## Commands

```bash
bun install          # install deps (also installs Playwright's Chromium via postinstall)
bun start            # run interactive CLI
bun dev              # watch mode
bun run typecheck    # tsc --noEmit
bun test             # run all tests
bun test --watch     # test watch mode
bun test src/gateway/utils.test.ts   # run single test file

# WhatsApp gateway
bun run gateway:login   # scan QR, link phone
bun run gateway         # start gateway server

# Evals
bun run src/evals/run.ts              # full eval suite
bun run src/evals/run.ts --sample 10  # random sample
```

CI runs `bun run typecheck` and `bun test` on every push/PR.

## Architecture

Dexter is a CLI-based autonomous financial research agent. Runtime is **Bun**. UI uses `@mariozechner/pi-tui` (not React/Ink as stated in AGENTS.md — that's outdated). LangChain wraps all LLM providers.

### Core layers

**`src/agent/`** — the agent loop (`agent.ts`). `Agent.run()` is an async generator that yields typed `AgentEvent`s consumed by the UI. Each turn: microcompact → strip old thinking → stream LLM → execute tools concurrently → check context threshold → drain queued messages. Loop exits on: no tool calls (final answer), tool denied, max iterations, or error.

**`src/model/llm.ts`** — multi-provider LLM abstraction. Provider is inferred from model name prefix (defined in `src/providers.ts`): `claude-` → Anthropic, `gemini-` → Google, `grok-` → xAI, `kimi-` → Moonshot, `deepseek-` → DeepSeek, `openrouter:` → OpenRouter, `ollama:` → Ollama. No prefix = OpenAI. Default model: `gpt-5.5`. Fast/lightweight variants per provider are in `FAST_MODELS` map in `src/model/llm.ts`. Anthropic provider applies explicit `cache_control` on the system prompt for prompt caching cost savings.

**`src/tools/registry.ts`** — tools are conditionally registered based on env vars. All tools must appear here to be available to the agent. Tools tagged `concurrencySafe: true` (finance, search, browser, memory tools) are executed in parallel by `src/agent/tool-executor.ts`; unsafe tools run serially.

**`src/tools/finance/`** — financial data tools: prices/news/insider trades (`get-market-data.ts`), income/balance/CF statements and metrics (`get-financials.ts`), SEC filings (`read-filings.ts`), stock screener (`screen-stocks.ts`), ASEAN market data for IDX/Bursa/SGX/SET/PSE via Yahoo Finance (`get-asean-data.ts`).

**`src/memory/`** — persistent memory backed by SQLite (`better-sqlite3`) + hybrid vector/BM25 search. `MemoryManager` is a singleton. Files live in `.dexter/memory/`. Embedding provider is auto-detected (OpenAI → Google → Ollama). Memory is injected into the system prompt at agent creation, and flushed to disk when context exceeds threshold.

**`src/gateway/`** — WhatsApp gateway using `@whiskeysockets/baileys`. Receives inbound messages, routes them to agent sessions, sends replies. Group chats: buffers messages until bot is @mentioned, then sends buffered history as context. Sessions persist across restarts via `src/gateway/sessions/store.ts`.

**`src/cron/`** — scheduled task runner (using `croner`). Heartbeat jobs probe the agent on a schedule. Cron jobs survive gateway restarts via SQLite store.

**`src/skills/`** — extensible workflows defined as `SKILL.md` files with YAML frontmatter (`name`, `description`). The LLM invokes skills via the `skill` tool. Each skill runs at most once per query. Add a new skill by dropping a `SKILL.md` anywhere under `src/skills/`.

### Context management (3 layers)

1. **Microcompact** (`src/agent/microcompact.ts`) — lightweight per-turn trim before each LLM call
2. **Full compaction** (`src/agent/compact.ts`) — LLM summarizes all tool results into a dense summary; replaces message array with `[SystemMessage, HumanMessage(query + summary)]`
3. **Hard truncation** — fallback: drop oldest AI+Tool message rounds

### Config & state

- User config: `.dexter/settings.json` (model, provider, memory settings) — gitignored
- Scratchpad (debug): `.dexter/scratchpad/*.jsonl` — one file per query, JSONL with `init`/`tool_result`/`thinking` entries
- Memory files: `.dexter/memory/` — markdown files + `index.sqlite`
- Gateway debug log: `.dexter/gateway-debug.log`

## Macro Intelligence System

Dexter has a sovereign macro monitoring system under `src/tools/macro/`. Currently implemented modules:

**Module 12 — Political Risk Engine** (`political_risk_engine` tool):
Tracks Indonesia's domestic political and social stability. Two channels: (A) social contract stress — sembako unaffordable + unemployment → Prabowo approval erosion → policy risk; (B) governance — authoritarian drift, investor confidence → CDS/IDR risk premium. Components: BPS unemployment rate (quarterly, TE scrape, normal 4.8%, stress 6.5%); Exa news sentiment across 3 signals (food_pressure, social_unrest, political_stability — keyword-scored, no LLM call); seasonal context detection (Iduladha, Lebaran windows apply 30% discount to food stress). Political Risk Index 0-100. Sources: `sources/political-risk.ts`. Requires EXASEARCH_API_KEY for news sentiment; degrades gracefully to unemployment-only scoring. Silent Crisis Detector weight: 0.06.

**Module 11 — Domestic Inflation Pressure Engine** (`domestic_pressure_engine` tool):
Tracks 10 PIHPS strategic food commodities (beras medium, cabai merah/rawit, bawang merah/putih, daging sapi/ayam, telur, minyak goreng curah, gula pasir). Food basket = ~30% of CPI — leading indicator for headline inflation and BI rate pressure. Computes Food Stress Index (0-100) via 90d z-score per commodity. Fires `DOMESTIC PRESSURE ALERT` when ≥2 commodities spike (z > 1.5) simultaneously. Also tracks aggregate food CPI YoY % vs APBN implied food CPI (~3.75% = 1.5× headline 2.5% target). Transmission chain: food spike → CPI overshoot → BI forced hike → SBN yield → foreign outflow. Sources: `hargapangan.id` Playwright scrape (primary, daily), Trading Economics food inflation meta scrape (fallback). Role in system: upstream early-warning feed for Regime Engine and Narrative Divergence Engine (food CPI check added as check #6). Silent Crisis Detector weight: 0.08.

**Module 8 — Banking Stress Engine** (`banking_stress_engine` tool):
Tracks NPL gross %, LDR, CAR, JIBOR-BI Rate spread, external debt, IHPR property price index (YoY), and sector NPL (real estat, konstruksi, perdagangan, konsumsi). Big Short early warning: detects credit cycle stress before it's visible in headline data. NPL data from OJK SPI Excel (Playwright + OJK cookies, ~11mo lag); JIBOR/external debt/IHPR from Trading Economics. IHPR added to detect collateral deflation risk in KPR portfolios. Sector NPL populated alongside aggregate when OJK Excel available. Sources: `src/tools/macro/sources/ojk.ts`, `src/tools/macro/sources/sovereign-scraper.ts`.

**Module 9 — Market Stress Engine** (`market_stress_engine` tool):
IHSG valuation + IDX breadth. Tracks IHSG P/E ratio (historical avg 14-16x; >22x = elevated) and advance/decline ratio. Detects valuation disconnect (elevated P/E while breadth collapses = narrow leadership before broad selloff). Sources: `src/tools/macro/sources/ihsg.ts` (Trading Economics P/E + IDX market summary breadth).

**Module 10 — Fiscal Engine** (`fiscal_engine` tool):
APBN 2026 realisasi vs annual targets. Revenue IDR 3,154T | Spending IDR 3,843T | Deficit IDR 689T (2.68% GDP) per UU No.17/2025 / Perpres No.118/2025. Post-efisiensi Prabowo (Feb 2026): spending ~3,534T. Tracks monthly realization from Trading Economics, accumulates YTD in DB, computes absorption rate vs pro-rata target. Flags revenue shortfall (<85% pace), spending overrun (>110% pace), deficit trajectory >3% GDP constitutional limit. Sources: `src/tools/macro/sources/kemenkeu.ts`.

**Module 1 — BoP Engine** (`bop_engine` tool):
Tracks trade balance, import growth, FX reserves, current account, external funding dependency. Detects synthetic CAD risk (trade surplus + falling reserves = hidden capital outflow).

**Module 3 — FX Defense Engine** (`fx_defense_engine` tool):
Tracks USDIDR spot + 30d realized vol, FX reserves trajectory, SRBI outstanding (sterilization proxy), BI intervention signal, reserve burn rate. Detects pseudo-stability (low vol surface while reserves deplete).

**Architecture:**
- `src/tools/macro/types.ts` — shared types (AlertLevel, ModuleScoreCard, etc.)
- `src/tools/macro/time-series-db.ts` — SQLite time series store at `.dexter/macro/macro.db`
- `src/tools/macro/scoring.ts` — rolling z-score, composite scoring, alert classification (GREEN/YELLOW/ORANGE/RED)
- `src/tools/macro/sources/` — data adapters: yahoo-macro (FX/ETF), bi (BI website scraper), bps (BPS API), imf (IMF Data API), bloomberg (REST proxy), refinitiv (RDP OAuth2)
- `src/skills/macro/bop/SKILL.md` — BoP analysis workflow
- `src/skills/macro/fx-defense/SKILL.md` — FX Defense workflow

**Alert levels:** GREEN (z<1.5) → YELLOW (z≥1.5) → ORANGE (z≥2.0) → RED (z≥2.5)

**Silent Crisis Detector** (`silent_crisis_detector` tool): aggregates all 10 modules with weighted scoring. fx_defense 0.18, bop 0.18, sovereign_risk 0.14, foreign_flow 0.14, banking 0.10, commodity 0.09, fiscal 0.08, market 0.07, regime 0.05, narrative 0.05. Non-linear amplification when 3+ modules stressed.

**Adding new modules:** create `src/tools/macro/{module}-engine.ts`, register in `registry.ts`, optionally add `src/skills/macro/{module}/SKILL.md`.

## Environment variables

```
# LLM providers (at least one required)
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
XAI_API_KEY
OPENROUTER_API_KEY
OLLAMA_BASE_URL          # default: http://127.0.0.1:11434

# Financial data
FINANCIAL_DATASETS_API_KEY

# Web search (Exa preferred, Tavily fallback, LangSearch last resort)
EXASEARCH_API_KEY
TAVILY_API_KEY

# LangSmith tracing (optional)
LANGSMITH_API_KEY
LANGSMITH_ENDPOINT
LANGSMITH_PROJECT
LANGSMITH_TRACING

# Macro intelligence (optional — free sources used as fallback)
BLOOMBERG_API_URL        # Bloomberg B-PIPE REST proxy URL
BLOOMBERG_API_KEY        # Bearer token for Bloomberg proxy
REFINITIV_APP_KEY        # LSEG/Refinitiv app key
REFINITIV_USERNAME       # Refinitiv username
REFINITIV_PASSWORD       # Refinitiv password
BPS_API_KEY              # BPS WebAPI key (free at webapi.bps.go.id)
```

See `env.example` for the full list.

## Conventions

- TypeScript ESM strict mode. No `any`.
- No logging unless explicitly requested.
- No README/docs files unless explicitly requested.
- CalVer versioning: `YYYY.M.D` (no zero-padding). Release via `bash scripts/release.sh [version]`.
- Tests colocated as `*.test.ts`, run with Bun's built-in runner. Jest config exists for legacy reasons only.
