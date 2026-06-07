# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fork Identity

**Owner:** Victor (victor@sadasa.id)
**Forked from:** `virattt/dexter` (upstream — read-only reference, do NOT push there)
**Purpose:** Custom Indonesia sovereign macro intelligence system — "Big Short Mode" / Silent Crisis Detector for ASEAN/IDR/IDX monitoring. Not a general-purpose financial agent fork.
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
Tracks Indonesia's domestic political and social stability. Two channels: (A) social contract stress — sembako unaffordable + unemployment → Prabowo approval erosion → policy risk; (B) governance — authoritarian drift, investor confidence → CDS/IDR risk premium. Components: BPS unemployment rate (quarterly, TE scrape, normal 4.8%, stress 6.5%); Exa news sentiment across 3 signals (food_pressure, social_unrest, political_stability — keyword-scored, no LLM call); seasonal context detection (Iduladha, Lebaran windows apply 30% discount to food stress). Political Risk Index 0-100. Sources: `sources/political-risk.ts`. Requires EXASEARCH_API_KEY for news sentiment; degrades gracefully to unemployment-only scoring. Silent Crisis Detector weight: 0.05.

**Module 11 — Domestic Inflation Pressure Engine** (`domestic_pressure_engine` tool):
Tracks 10 PIHPS strategic food commodities (beras medium, cabai merah/rawit, bawang merah/putih, daging sapi/ayam, telur, minyak goreng curah, gula pasir). Food basket = ~30% of CPI — leading indicator for headline inflation and BI rate pressure. Computes Food Stress Index (0-100) via 90d z-score per commodity. Fires `DOMESTIC PRESSURE ALERT` when ≥2 commodities spike (z > 1.5) simultaneously. Also tracks aggregate food CPI YoY % vs APBN implied food CPI (~3.75% = 1.5× headline 2.5% target). Transmission chain: food spike → CPI overshoot → BI forced hike → SBN yield → foreign outflow. Sources: `hargapangan.id` Playwright scrape (primary, daily), Trading Economics food inflation meta scrape (fallback). Role in system: upstream early-warning feed for Regime Engine and Narrative Divergence Engine (food CPI check added as check #6). Silent Crisis Detector weight: 0.06.

**Module 8 — Banking Stress Engine** (`banking_stress_engine` tool):
Tracks NPL gross %, LDR, CAR, IndONIA-BI Rate corridor spread, external debt, IHPR property price index (YoY), and sector NPL (real estat, konstruksi, perdagangan, konsumsi). Big Short early warning: detects credit cycle stress before it's visible in headline data. NPL tier hierarchy: OJK SPI Excel (Playwright, ~11mo lag) → World Bank API `FB.AST.NPER.ZS` (free, annual, no Playwright) → Trading Economics Playwright. 48h freshness gate: skips re-scrape if KPIs cached — prevents Playwright contention during 13-module parallel morning brief. FSAP nexus: `(sbn10y − 6.5%) × 6yr × 20% SBN/assets = implied CAR hit pp`. IndONIA corridor: DFR = BI Rate − 100bps, LF = BI Rate + 75bps; spread >30bps=YELLOW, >50bps=ORANGE, >75bps=RED. KLR signals: NPL >3% = early warning, >5% = acute; M2/FX reserves ratio >3x = watch, >5x = critical. Sources: `src/tools/macro/sources/ojk.ts`, `src/tools/macro/sources/sovereign-scraper.ts`.

**Module 9 — Market Stress Engine** (`market_stress_engine` tool):
IHSG valuation + IDX breadth. Tracks IHSG P/E ratio (historical avg 14-16x; >22x = elevated) and advance/decline ratio. Detects valuation disconnect (elevated P/E while breadth collapses = narrow leadership before broad selloff). Sources: `src/tools/macro/sources/ihsg.ts` (Trading Economics P/E + IDX market summary breadth).

**Module 10 — Fiscal Engine** (`fiscal_engine` tool):
APBN 2026 realisasi vs annual targets. Revenue IDR 3,154T | Spending IDR 3,843T | Deficit IDR 689T (2.68% GDP) per UU No.17/2025 / Perpres No.118/2025. Post-efisiensi Prabowo (Feb 2026): spending ~3,534T. Tracks monthly realization from Trading Economics, accumulates YTD in DB, computes absorption rate vs pro-rata target. Flags revenue shortfall (<85% pace), spending overrun (>110% pace), deficit trajectory >3% GDP constitutional limit. Sources: `src/tools/macro/sources/kemenkeu.ts`.

**Module 13 — ULN Engine** (`uln_engine` tool):
Tracks Utang Luar Negeri (ULN) across 3 policy domains: (A) Kemenkeu — government debt service vs APBN fiscal space; IDR depreciation → IDR-equivalent belanja bunga rises proportionally; (B) BI macro-prudential — Greenspan-Guidotti ratio (FX reserves / short-term ULN; <1.0 = CRITICAL) and hedging compliance rate (PBI 21/14/2019: min 25% hedge of net ULN maturing in 3mo); (C) OJK/banking — private sector USD exposure = NPL leading indicator 2-3Q lag. Implements 1997 transmission mechanism detection: low hedging compliance + ULN growth > GDP + IDR weakening → forced USD buying loop. Indicators in DB: `indonesia_external_debt_bn` (shared with banking engine, no double-fetch), `uln_shortterm_pct`, `uln_dsr_pct`, `greenspan_guidotti`, `uln_gdp_ratio_pct`, `uln_yoy_growth_pct`, `uln_hedging_compliance_pct`. Thresholds: ULN/GDP GREEN <35% YELLOW 35-40% ORANGE 40-45% RED >45%; DSR GREEN <20% YELLOW 20-25% ORANGE 25-30% RED >30%; GG GREEN >2.0 ORANGE <1.5 RED <1.0. Hedging amplifier: compliance >85% = ×1.00, 70-85% = ×1.15, 55-70% = ×1.30, <55% = ×1.50, unknown = ×1.10. Cross-feeds: `greenspan_guidotti` → BoP engine (replaces CA/reserves proxy); `uln_hedging_compliance_pct` + GG → FX Defense engine flags. Sources: `indonesia_external_debt_bn` from Banking/TE (quarterly, Playwright, shared indicator); DSR `DT.TDS.DECT.EX.ZS` + short-term% `DT.DOD.DSTC.ZS` from World Bank API (annual, free, no Playwright); hedging compliance from BI SULNI page (Playwright, quarterly, graceful degradation → null). 48h freshness gate. **Live data (2024, WB API):** DSR 24.69% — 31bps below YELLOW threshold (25%); ST% 15.47%; GG ratio 2.27 (GREEN); ULN total $433.38bn; ULN/GDP 27.8% (GREEN). DSR trend: 2022=23.3% → 2023=20.3% → 2024=24.7% — reversal upward, watch for 2025 data crossing 25%. Trigger: rising debt service (IDR depreciation + higher coupon rollover) or falling export earnings. Silent Crisis Detector weight: 0.09.

**Module 1 — BoP Engine** (`bop_engine` tool):
Tracks trade balance, import growth, FX reserves, current account, external funding dependency. Reads `greenspan_guidotti` from DB (written by ULN Engine) as reserve adequacy metric. Detects synthetic CAD risk (trade surplus + falling reserves = hidden capital outflow).

**Module 2 — Sovereign Risk Engine** (`sovereign_risk_engine` tool):
Tracks Indonesia sovereign credit and funding stress. Detects CDS acceleration (repricing before mainstream narrative), SBN yield spikes, EMBI spread widening, and foreign SBN ownership cliff (exit → yield spiral). Scores: Sovereign Risk Score (0-100), Fiscal Credibility Index (rating 50% + CDS 30% + debt/GDP 20%; falls back gracefully if components missing), Refinancing Stress Score. Key cross-signals: term premium (SBN 10Y − BI Rate; >3% = ORANGE), SBN-UST spread (<200bps = carry trade unwind risk, >300bps = high risk premium). Absolute CDS floor: each 1bps above 60bps adds to score baseline. Source priority: Bloomberg → Refinitiv → WorldGovernmentBonds.com Playwright scrape (CDS + rating); DJPPR PDF for foreign SBN ownership; Trading Economics scrape for SBN 10Y + BI Rate; IMF WEO `GG.D.ID.GD.G01.W0.S_1.S1.C.L.D.T.T.XDC_R.X1` for debt/GDP (annual, ~1yr lag). Silent Crisis Detector weight: 0.09.

**Module 3 — FX Defense Engine** (`fx_defense_engine` tool):
Tracks USDIDR spot + 30d realized vol, FX reserves trajectory, SRBI outstanding (sterilization proxy), BI intervention signal, reserve burn rate. Reads `uln_hedging_compliance_pct` and `greenspan_guidotti` from DB (ULN Engine cross-feeds) for unhedged corporate exposure flags. Detects pseudo-stability (low vol surface while reserves deplete).

**Module 4 — Commodity Engine** (`commodity_engine` tool):
Tracks Indonesia's export commodity cushion and oil import vulnerability. Export basket (8 commodities): coal via KOL ETF ($24.5bn), CPO via FCPO.KL ($24.4bn), ferro-alloys/NPI via SLX ETF ($15.9bn), nickel via NI=F ($8.4bn), LNG via NG=F Henry Hub proxy ($6.6bn), copper via HG=F ($5bn), gold via GC=F ($3bn), aluminum via ALI=F ($1.5bn). Oil: Brent via BZ=F; APBN $70/bbl baseline — deviation >20% above assumption → flags import bill overrun. Computes: Commodity Cushion Score (0-100; 0 = max cushion, prices above 90d trend), Oil Vulnerability Index (0-100; higher Brent = more BoP drain, implied annual import bill at ~245M bbl/yr). Flags ≥2 export commodities simultaneously at z < -2.5 (RED stress). Sources: Yahoo Finance futures/ETFs. Silent Crisis Detector weight: 0.07.

**Module 5 — Foreign Flow Engine** (`foreign_flow_engine` tool):
Detects silent foreign capital exit before it shows in headline data. Tracks: EIDO ETF (iShares MSCI Indonesia — daily foreign equity demand proxy), foreign SBN ownership % (DJPPR), IDX daily foreign net buy/sell (IDR bn via IDX API). Detects: dual exit (EIDO falling + SBN ownership falling simultaneously), domestic absorption masking (SBN foreign exit without yield spike = BI/banks buying what foreigners sell, hiding stress), heavy IDX net sell (>2T IDR bn). Silent exit probability 0–95% composite: EIDO z < −2.0 (+25%), SBN falling (+25%), heavy IDX net sell (+20%), domestic absorption (+10%), divergence flag (+10%). Sudden stop thresholds: SBN foreign ownership <12% = structural exit watch, <10% = sudden stop risk elevated, <8% = CRITICAL (+20pp to silent exit prob). Historical context: SBN ownership peaked ~25% in 2019, post-COVID ~15%. Silent Crisis Detector weight: 0.09.

**Module 6 — Narrative Divergence Engine** (`narrative_divergence_engine` tool):
Compares official guidance vs market pricing to detect credibility gaps. Checks 7 dimensions: (1) USDIDR vs APBN 16,500 assumption (flagged >10% gap); (2) Brent ICP vs APBN $70/bbl (flagged >10%); (3) CDS vs "stable macro" claim (flagged >150bps); (4) SBN 10Y term premium vs BI Rate stance (flagged term premium >2%); (5) FX reserves + SRBI vs "orderly market" claim; (6) food CPI vs APBN implied ~3.75% food CPI (flagged >6% or <0%); (7) compound IDR+oil double-whammy = real subsidy cost overshoot (flagged >20% combined). Narrative Credibility Score = 100 − avg_divergence (higher = more credible). Sources: DB cross-feeds (Brent, USDIDR, reserves, SRBI, SBN yield, BI rate, food CPI) — no Playwright fetch, reads cached values. Silent Crisis Detector weight: 0.02.

**Module 7 — ASEAN Relative Value Engine** (`asean_relative_value_engine` tool):
Decomposes IDR weakness into global DXY story vs Indonesia-specific repricing. Peers: Malaysia (USDMYR), Singapore (USDSGD), Thailand (USDTHB), Philippines (USDPHP). Computes ASEAN median 1M FX change; idiosyncratic component = IDR 1M change − ASEAN median. Alert: idiosyncratic >1% = YELLOW, >3% = ORANGE, >5% = RED. USD strength story flag: fires when all ASEAN FX depreciating together with idiosyncratic component <2% (global DXY, not ID-specific). Indonesia vulnerability rank: #1 = most depreciated among peers. Note: supplementary context module — not included in SCD weighted score, but called in morning brief for ASEAN FX context. Sources: Yahoo Finance FX spots (USDMYR, USDSGD, USDTHB, USDPHP, USDIDR from DB).

**Architecture:**
- `src/tools/macro/types.ts` — shared types (AlertLevel, ModuleScoreCard, etc.)
- `src/tools/macro/time-series-db.ts` — SQLite time series store at `.dexter/macro/macro.db`
- `src/tools/macro/scoring.ts` — rolling z-score, composite scoring, alert classification (GREEN/YELLOW/ORANGE/RED)
- `src/tools/macro/sources/` — data adapters: yahoo-macro (FX/ETF), bi (BI website scraper + hedging compliance), bps (BPS API), imf (IMF Data API), bloomberg (REST proxy), refinitiv (RDP OAuth2)
- `src/skills/macro/bop/SKILL.md` — BoP analysis workflow
- `src/skills/macro/fx-defense/SKILL.md` — FX Defense workflow
- `src/skills/macro/klr-ews/SKILL.md` — KLR EWS 21-indicator dual-crisis signal matrix (12 currency + 9 banking, includes Module 13 ULN signals)
- `src/skills/macro/shock-scenario/SKILL.md` — Forward-looking stress simulator (Before vs After per module)
- `src/skills/macro/rr-framework/SKILL.md` — Rivera-Batiz & Rivera-Batiz theoretical framework reference; invoke when user asks "why does this signal matter" or "theoretical basis for X"

**Alert levels (z-score based):** GREEN (z<1.5) → YELLOW (z≥1.5) → ORANGE (z≥2.0) → RED (z≥2.5). Score-based thresholds (for shock scenario / module scoring): GREEN <33, YELLOW 33–49, ORANGE 50–69, RED ≥70.

**Silent Crisis Detector** (`silent_crisis_detector` tool): aggregates all 13 modules, weights sum exactly 1.00. fx_defense 0.16, uln 0.09, bop 0.10, sovereign_risk 0.09, foreign_flow 0.09, banking 0.08, commodity 0.07, fiscal 0.09, market 0.05, domestic_pressure 0.06, political_risk 0.05, regime 0.05, narrative 0.02. Non-linear amplification when 3+ modules stressed (×1.2); 5+ modules (×1.4). Cap 95%.

**Research frameworks (embedded in Module 8 + skills):**
- **KLR EWS** — 21-indicator dual crisis matrix (12 currency + 9 banking); invoke via `klr-ews` skill
- **FSAP sovereign-bank nexus** — SBN yield → implied CAR erosion; live in `banking_stress_engine`
- **BI IndONIA corridor** — DFR = BI Rate −100bps, LF = BI Rate +75bps; breach = forced BI liquidity injection
- **Rivera-Batiz & Rivera-Batiz (R&R)** — 9 open-economy frameworks embedded across modules: PPP misalignment (M6), UIP carry (M7), Mundell-Fleming fiscal shock (stress-sim), Dornbusch overshoot (stress-sim), Trilemma/SRBI sterilization (M10), r-g debt dynamics (M13), 1st-gen shadow rate (M3), 2nd-gen confidence gate (M3), Sudden Stop SSVI (M5); invoke via `rr-framework` skill for theory → signal chain

**APBN 2026 macro constants** (UU No.17/2025): USDIDR 16,500 | ICP $70/bbl | GDP growth 5.4% | CPI 2.5% | SBN 10Y 6.9% | Revenue 3,153.6T | Spending 3,842.7T | Deficit 2.68% GDP | Post-efisiensi spending ~3,534.7T | GDP 25,714.2T. BI Rate as of 20 May 2026: 5.25% (+50bps from 4.75%).

**Regime Engine** (`regime_engine` tool, `regime-engine.ts`): Classifies Indonesia macro regime via Growth ROC × Inflation ROC quadrant framework. Regimes: Q1 Goldilocks (Growth↑ Inflation↓), Q2 Reflation (Growth↑ Inflation↑), Q3 Stagflation (Growth↓ Inflation↑ — worst for IDR), Q4 Contraction (Growth↓ Inflation↓). Inputs: IMF GDP growth rate-of-change, IMF/TE inflation ROC, PMI Manufacturing (TE scrape), IHSG/DXY/VIX from Yahoo. Computes shift probability + historical Indonesia analogs + asset implications per quadrant. SCD weight: 0.05. Feeds Domestic Pressure Engine as upstream signal.

**Macro Threshold Monitor** (`macro_threshold_monitor` tool, `macro-threshold-monitor.ts`): Fast fixed-threshold tripwire — no LLM call, no full engine runs. Fetches live spots (USDIDR, VIX, DXY, Brent, EIDO) and checks against static breach thresholds (VIX ≥35/45, DXY ≥108/112, Brent ±20% vs APBN $70, USDIDR daily move %). Returns breach list or "all clear" in seconds. Designed for intraday cron pre-screening before invoking `silent_crisis_detector`.

**Adding new modules:** create `src/tools/macro/{module}-engine.ts`, register in `registry.ts`, optionally add `src/skills/macro/{module}/SKILL.md`.

## Backtest System

Walk-forward historical validation against 6 Indonesia crisis events (2013–2023). No lookahead bias — z-scores computed using only data available up to each date t.

**Run:** `bun scripts/run-backtest.ts [startDate] [endDate] [crisisId,...]`
Default range: 2012-01-01 → today. Crisis IDs: `taper_tantrum_2013`, `china_devaluation_2015`, `em_selloff_2018`, `covid_crash_2020`, `fed_tightening_2022`, `dollar_surge_2023`.

**Files under `src/tools/macro/backtest/`:**
- `crisis-calendar.ts` — 6 `CrisisEvent` records with startDate/peakDate/endDate/idrDepreciationPct
- `historical-loader.ts` — Yahoo Finance daily OHLCV for 11 indicators (7d cache) + WGB sovereign CDS (3d cache); both loaded in parallel via `Promise.allSettled`
- `replay-engine.ts` — `computeSignals()` walk-forward z-score engine; produces `ModuleSignalAtDate[]`
- `signal-validator.ts` — `validateCrisis()` per crisis, 180d pre-crisis window; `formatBacktestReport()` markdown output
- `types.ts` — `CrisisEvent`, `BacktestPoint`, `ModuleSignalAtDate`, `CrisisValidation`, `BacktestResult`

**Replay engine composite weights (sum 1.0):**
FX Defense 0.30 | Commodity Cushion 0.25 | Foreign Flow 0.15 | Sovereign (CDS+SBN) 0.10 | VIX 0.10 | DXY 0.10

**Sovereign module (weight 0.10):** composite of two sources — CDS 5Y (60%) + SBN 10Y yield (40%). Both z-scored; z>0 = stress. When both available (2018+): `round(cdsStress × 0.6 + sbnStress × 0.4)`. Pre-2018: SBN yield only. Neither: neutral 30.

**Sovereign data sources:**
- CDS 5Y: WorldGovernmentBonds.com (`fetchIndonesiaCdsHistoricalWgb`). Playwright intercepts POST to `wp-json/common/v1/historical`. ~2618 daily bars from 2018-09-20. Cache: `.dexter/cache/backtest/indonesia_cds_5y_bps_wgb` (3d TTL).
- SBN 10Y yield: WGB Playwright (`fetchSbn10yHistoricalWgb`, `bond-historical-data/indonesia/10-years/`), coverage from ~Sep 2016. Pre-2016 gap: no free API covers Indonesia 10Y historical (Indonesia is not OECD full member — FRED/World Bank lack the series; Stooq/Investing.com require JS bot-protection bypass). Crises 2013/2015 pre-crisis periods use neutral sovereign baseline (30) — still caught via FX/commodity/flow modules. Cache: `.dexter/cache/backtest/indonesia_sbn10y_pct` (3d TTL).

**Alert thresholds in backtest:** composite ≥75 = RED, ≥55 = ORANGE, ≥35 = YELLOW. Pre-crisis validator window: 180d.

**Latest results (2026-06-07):** 100% hit rate (6/6 crises) | 165d avg YELLOW lead time | 4.8% false positive rate | Peak scores: 2013=81, 2015=75, 2018=84, 2020=96, 2022=90, 2023=89. (Pre-SBN yield enhancement; re-run to get updated scores.)

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
