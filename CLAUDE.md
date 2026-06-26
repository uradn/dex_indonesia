# CLAUDE.md

Guide Claude Code (claude.ai/code) for this repo.

## Fork Identity

**Owner:** Victor (victor@sadasa.id)
**Forked from:** `virattt/dexter` (upstream — read-only ref, NO push there)
**Purpose:** Custom Indonesia sovereign macro intel — "Big Short Mode" / Silent Crisis Detector for ASEAN/IDR/IDX. Not general-purpose finance fork.
**Remote:** `origin` → `https://github.com/uradn/dex_indonesia.git`. Push via GITHUB_TOKEN in `.env` (never hardcode): `TOKEN=$(grep GITHUB_TOKEN .env | cut -d= -f2) && git remote set-url origin "https://uradn:${TOKEN}@github.com/uradn/dex_indonesia.git" && git push origin main; git remote set-url origin https://github.com/uradn/dex_indonesia.git`

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

# Macro scripts
bun scripts/morning-check.ts              # full 13-module morning brief (manual run)
bun scripts/check-m12-divergence.ts       # M12 divergence check (exit 0=ok, 1=stale, 2=keyword audit needed)
bun scripts/health-check.ts               # data freshness + env var audit (exit 1 if RED-tier gaps)
bun scripts/health-check.ts --all         # also list every fresh indicator

# Dashboard (localhost:6080)
bun scripts/dashboard.ts                  # start dashboard server (port 6080)
#   GET /          → main dashboard — all 13 module panels, charts, SCD gauge
#   GET /rr        → R&R / G-G framework page — Greenspan-Guidotti + 7 R&R live signals
#   GET /bs        → Big Short Thesis page — Burry-mode contrarian tracker
#     Panels: divergence scanner (5 ranked gaps), trigger monitor (live ARMED/TRIGGERED),
#     transmission chain (7 nodes colored by module stress), timeline T+0/3/6/12,
#     kill switch status, market expression table, EV calculator, historical analog,
#     contrarian validation (3-question Burry method), archive of past theses
#     Actions: ARM THESIS (saves to macro_theses DB), KILL THESIS (records kill switch)
#   POST /api/thesis/arm   → compute thesis from live module scores → save to macro_theses
#   POST /api/thesis/kill/:id → mark thesis killed (kill switch fired)
#   GET /api/thesis/compute → compute thesis JSON (no DB write, no LLM)
#   GET /api/thesis/all    → all theses from DB (for archive + backtest)
#   POST /api/run-scd → trigger SCD scan (saves module scores to macro_scores DB)
# Module scores: written to macro_scores table after every SCD/morning-check run via
#   saveModuleScore() in time-series-db.ts; read by dashboard to show real engine scores
#   (not proxy). Dashboard SCD gauge uses weighted sum of stored module scores.
# Thesis lifecycle: armed → triggered (trigger fires) → confirmed/killed/closed
#   macro_theses table stores predictions + actuals for walk-forward backtest accuracy.
#   morning-check.ts auto-updates thesis status (armed→triggered) after each run.
bun scripts/check-thesis.ts               # T+3/T+6/T+12 milestone check + kill switch auto-detect
#   Compares actual CDS/IDR/SBN vs predicted at each milestone, writes accuracy to notes.
#   Kill switches (auto: #1/#3/#4; candidate only: #2):
#     #1 — political_risk < 55 sustained 14d (social stress eased)
#     #2 — BI coordinated stabilization package (Exa/Tavily detect; manual confirm before kill)
#     #3 — SBN foreign ownership > 13% (capital return; inflows reversed crisis narrative)
#     #4 — CDS 5Y < 100bps sustained 7d (market stopped pricing crisis; thesis invalidated)

# Cron job registration (run once; idempotent)
bun scripts/add-morning-brief-cron.ts     # daily 08:00 WIB Mon-Fri — 13 modules + SCD via asean-morning-brief skill
bun scripts/add-weekly-deepdive-cron.ts   # Monday 07:00 WIB — 13 modules + sovereign memo + Hormuz shock (Brent $105 + IDR 19,000)
bun scripts/add-monthly-deepdive-cron.ts  # 1st of month 08:00 WIB — 13 modules + APBN realisasi + ULN/DSR + compound shock (Brent $120 + IDR 20,500 + VIX 45) + backtest analog
bun scripts/add-thesis-check-cron.ts      # Monday 07:30 WIB — T+3/6/12 milestone check + kill switch auto-detect for armed/triggered theses
```

CI runs `bun run typecheck` + `bun test` every push/PR.

## Architecture

Dexter = CLI autonomous finance research agent. Runtime **Bun**. UI use `@mariozechner/pi-tui` (not React/Ink — AGENTS.md outdated). LangChain wrap all LLM providers.

### Core layers

**`src/agent/`** — agent loop (`agent.ts`). `Agent.run()` = async generator yields typed `AgentEvent`s for UI. Each turn: microcompact → strip old thinking → stream LLM → execute tools concurrent → check context threshold → drain queued msgs. Loop exit on: no tool calls (final answer), tool denied, max iterations, error.

**`src/model/llm.ts`** — multi-provider LLM abstraction. Provider inferred from model name prefix (see `src/providers.ts`): `claude-` → Anthropic, `gemini-` → Google, `grok-` → xAI, `kimi-` → Moonshot, `deepseek-` → DeepSeek, `openrouter:` → OpenRouter, `ollama:` → Ollama. No prefix = OpenAI. Default model: `gpt-5.5`. Fast/light variants per provider in `FAST_MODELS` map in `src/model/llm.ts`. Anthropic provider apply explicit `cache_control` on system prompt for prompt cache cost savings.

**`src/tools/registry.ts`** — tools conditionally registered by env vars. All tools must appear here to be agent-available. Tools tagged `concurrencySafe: true` (finance, search, browser, memory) run parallel via `src/agent/tool-executor.ts`; unsafe run serial.

**`src/tools/finance/`** — finance data tools: prices/news/insider trades (`get-market-data.ts`), income/balance/CF stmts + metrics (`get-financials.ts`), SEC filings (`read-filings.ts`), stock screener (`screen-stocks.ts`), ASEAN market data for IDX/Bursa/SGX/SET/PSE via Yahoo Finance (`get-asean-data.ts`).

**`src/memory/`** — persistent memory backed by SQLite (`better-sqlite3`) + hybrid vector/BM25 search. `MemoryManager` singleton. Files in `.dexter/memory/`. Embed provider auto-detected (OpenAI → Google → Ollama). Memory injected into system prompt at agent creation, flushed to disk when context exceed threshold.

**`src/gateway/`** — WhatsApp gateway via `@whiskeysockets/baileys`. Receive inbound msgs, route to agent sessions, send replies. Group chats: buffer msgs until bot @mentioned, then send buffered history as context. Sessions persist across restarts via `src/gateway/sessions/store.ts`.

**`src/cron/`** — scheduled task runner (`croner`). Heartbeat jobs probe agent on schedule. Cron jobs survive gateway restarts via SQLite store `.dexter/cron/jobs.json` (gitignored — local runtime state). Active macro schedule: daily morning brief (08:00 WIB Mon-Fri, `asean-morning-brief` skill, all 13 modules), weekly deep dive (Monday 07:00 WIB, adds sovereign memo + Hormuz shock), monthly deep dive (1st of month 08:00 WIB, adds APBN realisasi + ULN/DSR + compound shock + backtest analog). Register/update via `scripts/add-*-cron.ts`.

**`src/skills/`** — extensible workflows as `SKILL.md` files w/ YAML frontmatter (`name`, `description`). LLM invokes skills via `skill` tool. Each skill runs at most once per query. Add new skill: drop `SKILL.md` anywhere under `src/skills/`.

### Context management (3 layers)

1. **Microcompact** (`src/agent/microcompact.ts`) — light per-turn trim before each LLM call
2. **Full compaction** (`src/agent/compact.ts`) — LLM summarizes all tool results to dense summary; replaces msg array with `[SystemMessage, HumanMessage(query + summary)]`
3. **Hard truncation** — fallback: drop oldest AI+Tool msg rounds

### Config & state

- User config: `.dexter/settings.json` (model, provider, memory) — gitignored
- Scratchpad (debug): `.dexter/scratchpad/*.jsonl` — one file per query, JSONL w/ `init`/`tool_result`/`thinking` entries
- Memory files: `.dexter/memory/` — markdown + `index.sqlite`
- Gateway debug log: `.dexter/gateway-debug.log`

## Macro Intelligence System

**Full ref: [`docs/MACRO.md`](docs/MACRO.md)** — read for 13-module specs, sources, thresholds, SCD weights, R&R framework map, APBN 2026 constants, Regime + Threshold Monitor.

Quick map: M1 BoP · M2 Sovereign Risk · M3 FX Defense · M4 Commodity · M5 Foreign Flow · M6 Narrative Divergence · M7 ASEAN RV · M8 Banking · M9 Market Stress · M10 Fiscal · M11 Domestic Pressure · M12 Political Risk · M13 ULN. **Silent Crisis Detector** (`silent_crisis_detector`) aggregates 13, weights sum 1.00 (fx_defense 0.16 heaviest). Top: `src/tools/macro/{module}-engine.ts`, registered in `registry.ts`.

**APBN 2026 macro constants** (UU No.17/2025): USDIDR 16,500 | ICP $70/bbl | GDP growth 5.4% | CPI 2.5% | SBN 10Y 6.9% | Revenue 3,153.6T | Spending 3,842.7T | Deficit 2.68% GDP | Post-efisiensi spending ~3,534.7T | GDP 25,714.2T. BI Rate (9 Jun 2026): 5.50%, DFR 4.50%, LF 6.25%. Term premium 1.90% (borderline ORANGE).

## Backtest System

Walk-forward historical validation vs 6 Indonesia crisis events (2013–2023). No lookahead bias — z-scores use only data up to date t.

**Run:** `bun scripts/run-backtest.ts [startDate] [endDate] [crisisId,...]`
Default range: 2012-01-01 → today. Crisis IDs: `taper_tantrum_2013`, `china_devaluation_2015`, `em_selloff_2018`, `covid_crash_2020`, `fed_tightening_2022`, `dollar_surge_2023`.

**Files under `src/tools/macro/backtest/`:**
- `crisis-calendar.ts` — 6 `CrisisEvent` records w/ startDate/peakDate/endDate/idrDepreciationPct
- `historical-loader.ts` — Yahoo Finance daily OHLCV for 11 indicators (7d cache) + WGB sovereign CDS (3d cache); both loaded parallel via `Promise.allSettled`
- `replay-engine.ts` — `computeSignals()` walk-forward z-score engine; produces `ModuleSignalAtDate[]`
- `signal-validator.ts` — `validateCrisis()` per crisis, 180d pre-crisis window; `formatBacktestReport()` markdown output
- `types.ts` — `CrisisEvent`, `BacktestPoint`, `ModuleSignalAtDate`, `CrisisValidation`, `BacktestResult`

**Replay engine composite weights (sum 1.0):**
FX Defense 0.30 | Commodity Cushion 0.25 | Foreign Flow 0.15 | Sovereign (CDS+SBN) 0.10 | VIX 0.10 | DXY 0.10

**Sovereign module (weight 0.10):** composite of 2 sources — CDS 5Y (60%) + SBN 10Y yield (40%). Both z-scored; z>0 = stress. When both avail (2018+): `round(cdsStress × 0.6 + sbnStress × 0.4)`. Pre-2018: SBN yield only. Neither: neutral 30.

**Sovereign data sources:**
- CDS 5Y: WorldGovernmentBonds.com (`fetchIndonesiaCdsHistoricalWgb`). Playwright intercepts POST to `wp-json/common/v1/historical`. ~2618 daily bars from 2018-09-20. Cache: `.dexter/cache/backtest/indonesia_cds_5y_bps_wgb` (3d TTL).
- SBN 10Y yield: WGB Playwright (`fetchSbn10yHistoricalWgb`, `bond-historical-data/indonesia/10-years/`), coverage from ~Sep 2016. Pre-2016 gap: no free API covers Indonesia 10Y history (Indonesia not OECD full member — FRED/World Bank lack series; Stooq/Investing.com need JS bot-protection bypass). Crises 2013/2015 pre-crisis use neutral sovereign baseline (30) — still caught via FX/commodity/flow modules. Cache: `.dexter/cache/backtest/indonesia_sbn10y_pct` (3d TTL).

**Alert thresholds in backtest:** composite ≥75 = RED, ≥55 = ORANGE, ≥35 = YELLOW. Pre-crisis validator window: 180d.

**Latest results (2026-06-17):** 100% hit rate (6/6 crises) | 173d avg YELLOW lead time | 4.9% false positive rate | Peak scores: 2013=81, 2015=75, 2018=91, 2020=96, 2022=91, 2023=89. Re-run (`bun scripts/run-backtest.ts`) only after changes to `backtest/historical-loader.ts`, `replay-engine.ts`, or `signal-validator.ts` — scores stable between engine changes.

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
EODHD_API_KEY              # EODHD — USDIDR tertiary fallback + IHSG price (IDR.FOREX, JKSE.INDX)

# Web search (Exa preferred, Tavily fallback, LangSearch last resort)
EXASEARCH_API_KEY
TAVILY_API_KEY

# Social media (X/Twitter API v2 — Module 12 real-time unrest signal)
X_BEARER_TOKEN             # X API v2 Bearer Token; requires Basic plan ($100/mo) for recent search

# BBM price overrides — update immediately when Kepmen ESDM announces hike (no redeploy)
PERTALITE_PRICE_IDR        # default 10000 (Kepmen ESDM 245.K/MG.01/MEM.M/2022)
SOLAR_PRICE_IDR            # default 6800
PERTAMAX_PRICE_IDR         # default 16250 (non-subsidi, +Rp3,950 Jun 10 2026)
PERTAMAX_GREEN_PRICE_IDR   # default 17000 (RON 95, +Rp4,100 Jun 10 2026)

# BI DNDF outstanding — annual manual update (no automated scrape path exists)
# DNDF NOT in SULNI (SULNI = external debt stats only). DNDF is on BI's OWN balance sheet.
# Source: BI Laporan Keuangan Tahunan (LKT) — neraca BI + catatan instrumen derivatif.
#   Published Mar–Apr each year for prior fiscal year. Note number varies year-to-year.
#   Satu-satunya sumber resmi; tidak ada publikasi bulanan/mingguan DNDF outstanding.
# Historical: 2018 peak ~$17bn; 2023 ~$5-10bn; 2026 H1 (active IDR defense) est. $8-12bn.
# Update when BI publishes LKT (Mar/Apr annually for prior year). Current: est. Jun 2026.
BI_DNDF_OUTSTANDING_BN     # USD billion — effectiveReserves = cadev − DNDF in FX Defense engine

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

See `env.example` for full list.

## Conventions

- TypeScript ESM strict mode. No `any`.
- No logging unless requested.
- No README/docs files unless requested.
- CalVer versioning: `YYYY.M.D` (no zero-pad). Release via `bash scripts/release.sh [version]`.
- Tests colocated as `*.test.ts`, run via Bun built-in runner. Jest config exists for legacy only.