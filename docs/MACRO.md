# Macro Intelligence System

Sovereign macro monitoring under `src/tools/macro/`. 13 modules + Regime + Threshold Monitor. SCD weights sum to 1.00 (see Silent Crisis Detector below).

**M1 — BoP Engine** (`bop_engine`): trade balance, import growth, FX reserves, CA, external funding dep. Reads `greenspan_guidotti` from DB (M13). Detects synthetic CAD (trade surplus + falling reserves). SCD 0.10.

**M2 — Sovereign Risk Engine** (`sovereign_risk_engine`): CDS 5Y, SBN 10Y, EMBI, foreign SBN ownership. **CDS velocity** `cds_velocity_bps_week` (21d window): GREEN ≤0, YELLOW 0–3, ORANGE 3–7, RED >7; `daysTo200` countdown. Fiscal Credibility = rating 50% + CDS 30% + debt/GDP 20%. Term premium (SBN 10Y − BI Rate) >3% = ORANGE; SBN-UST <200bps = carry unwind. CDS baseline floor: +1/bps above 60. Source: Bloomberg → Refinitiv → WGB Playwright; DJPPR PDF foreign SBN; TE SBN+BI Rate; IMF WEO debt/GDP. SCD 0.09.

**M3 — FX Defense Engine** (`fx_defense_engine`): USDIDR + 30d vol, reserves, SRBI, BI intervention, burn rate. Reads `uln_hedging_compliance_pct` + `greenspan_guidotti` (M13). Detects pseudo-stability (low vol + reserves deplete). **SRBI auction** (`sources/srbi-auction.ts`, Exa, 3d): `srbi_bid_cover_ratio` GREEN ≥2.5, YELLOW 1.5–2.5, ORANGE 1.0–1.5, RED <1.0. **DNDF tracker** (`sources/dndf.ts`, Exa/Tavily, 7d): off-balance-sheet USD; `effectiveReserves = cadev − DNDF`; ≥15% cadev = CRITICAL, 7–15% = note; shown on `/rr` as "GG Adjusted". SCD 0.16.

**M4 — Commodity Engine** (`commodity_engine`): export basket 8 commodities (coal KOL $24.5bn, CPO FCPO.KL $24.4bn, ferro/NPI SLX $15.9bn, nickel NI=F, LNG NG=F, copper HG=F, gold GC=F, aluminum ALI=F). Oil Brent BZ=F vs APBN $70/bbl (>20% = flag). Commodity Cushion + Oil Vulnerability (0–100). RED when ≥2 export commodities z<−2.5. **B50 biodiesel** (`sources/biodiesel.ts`, 14d): `b50_status_numeric` (40/45/50), `biodiesel_quota_kl_m`, `biodiesel_subsidy_ytd_idr_t`; Jul 1 2026 mandate; CPO diversion → BoP, BPDPKS → M10, shortage → M11. **Coal DMO + PLN** (`sources/coal-dmo.ts`, 14d): `coal_dmo_compliance_pct`, `hba_price_usd_ton`, `pln_coal_secured_pct`; DMO $70/ton fixed vs HBA $84–122 → producer disincentive → PLN gap → TDL hike. SCD 0.07.

**M5 — Foreign Flow Engine** (`foreign_flow_engine`): EIDO, foreign SBN %, IDX net flow. Silent exit prob 0–95% composite: EIDO z<−2 (+25), SBN falling (+25), heavy IDX sell >2T (+20), absorption (+10), divergence (+10). SBN ownership thresholds: <12% watch, <10% elevated, <8% CRITICAL (+20pp). **MSCI** (`sources/msci-classification.ts`, 7d/30d): `msci_classification_numeric` (0=EM, 1=review, 2=frontier); downgrade +20, under_review +8; Jun 23 2026 EM CONFIRMED, next review Nov 12 2026 — Nov-overhang flag + auto +3 when <60d. SCD 0.09.

**M6 — Narrative Divergence Engine** (`narrative_divergence_engine`): 13 checks comparing official guidance vs market: (1) USDIDR vs 16,500 >10%; (2) Brent vs $70 >10%; (3) CDS vs "stable" >150bps; (4) term premium >2%; (5) reserves+SRBI vs "orderly"; (6) food CPI vs 3.75% (>6% or <0%); (7) compound IDR+oil overshoot >20%; (8) PPP misalignment (R&R Ch.4-5, Dornbusch); (9) BBM gap >IDR 2k/L vs "terjangkau" narrative; (10) Pertamax Jun 10 hike (+Rp3,950 RON92 / +Rp4,100 RON95) vs "stable energy"; (11) Dubai/Oman spot vs APBN ICP + Brent-Dubai spread >$10 (Haye/Hormuz); (12) BPS migas import bill 2026 ~$38.8B annualized vs APBN $25-27B implied; subsidi Q1 Rp 118.7T vs full-year Rp 105.4T = blow-through; (13) Morris-Shin signal precision CV across 4 oil belief levels ($70 APBN / $80 stale / ICP / full delivered). Score = 100 − avg_divergence. Sources: DB cross-feeds + Dubai crude (`sources/dubai-crude.ts`) + BPS HS27 hardcoded. SCD 0.02.

**M7 — ASEAN Relative Value Engine** (`asean_relative_value_engine`): peers USDMYR/SGD/THB/PHP. Idiosyncratic = IDR 1M − ASEAN median: >1% YELLOW, >3% ORANGE, >5% RED. USD strength flag when all ASEAN depreciate with idio <2%. Supplementary context — NOT in SCD weights, called in morning brief.

**M8 — Banking Stress Engine** (`banking_stress_engine`): NPL, LDR, CAR, IndONIA-BI corridor, ULN (shared), IHPR YoY, sector NPL. NPL tier: OJK SPI (Playwright, ~11mo lag) → World Bank API `FB.AST.NPER.ZS` (free, annual) → TE. 48h freshness gate. FSAP: `(sbn10y − 6.5%) × 6yr × 20% = CAR hit pp`. IndONIA corridor: DFR=BI−100, LF=BI+75; spread >30=Y, >50=O, >75=R. KLR: NPL >3% early, >5% acute; M2/reserves >3x watch, >5x critical. **BNPL** (`sources/ojk-iknb.ts`, 30d): signals `inclusion`/`distress`/`credit_cycle_turn`/`watch`; amplifier +8/+10/+5 on distress/credit_cycle_turn/watch; fintech NPL ~5% vs bank 1.96% = 2.5× ratio = 2-3Q leading indicator. Sources: `ojk.ts`, `ojk-iknb.ts`, `sovereign-scraper.ts`. SCD 0.08.

**M9 — Market Stress Engine** (`market_stress_engine`): IHSG P/E (avg 14-16x, >22x elevated) + IDX advance/decline. Detects narrow leadership (elevated P/E + breadth collapse). Source: `sources/ihsg.ts` (TE). SCD 0.05.

**M10 — Fiscal Engine** (`fiscal_engine`): APBN 2026 realisasi vs targets (Revenue 3,154T | Spending 3,843T | Deficit 689T = 2.68% GDP per UU No.17/2025); post-efisiensi spending ~3,534T. Monthly realization from TE → YTD in DB → absorption rate. Flags: revenue <85% pace, spending >110% pace, deficit >3% GDP. **MBG tracker** (`sources/mbg.ts`, 30d): target Rp 335T (8.7% APBN); `mbgBurnRatePct = (YTD/months×12)/335×100`; ≥115% Y, ≥130% O+CRITICAL; weight 0.10 in fiscal stress. **B50 BPDPKS cross-feed** from M4 — Jul 1 2026 transition adds fiscal drag. Sources: `kemenkeu.ts` + `mbg.ts` + `biodiesel.ts`. SCD 0.09.

**M11 — Domestic Pressure Engine** (`domestic_pressure_engine`): 10 PIHPS food commodities (beras medium, cabai merah/rawit, bawang merah/putih, daging sapi/ayam, telur, minyak goreng curah, gula). Food = ~30% CPI. Food Stress Index 0-100 via 90d z-score. Alert when ≥2 commodities z>1.5. Food CPI vs APBN implied 3.75%. **BBM subsidy gap:** Pertalite IDR 10,000/L (Kepmen ESDM 245.K) vs cost recovery `(Brent/158.987)×USDIDR×1.40`; stores `bbm_cost_recovery_idr_liter`, `bbm_subsidy_gap_idr_liter`; >2k Y, >4k O, >7k R. **ICP threshold:** Brent vs $100/bbl (Bahlil Apr 2026); <$80 G, 80-90 Y, 90-100 O, >100 R. Hormuz flag at Brent >$90. Env override `PERTALITE_PRICE_IDR`. Chain: food+BBM → CPI → BI hike → SBN → outflow. Sources: hargapangan.id Playwright (daily) → TE meta scrape (fallback), `sources/pertamina.ts`. SCD 0.06.

**M12 — Political Risk Engine** (`political_risk_engine`): unemployment (BPS, TE, normal 4.8% / stress 6.5%) + 3-tier news signal: (1) Exa neural — food_pressure/social_unrest/political_stability, keyword-scored, no LLM; (2) Tavily fallback — Detik/Kompas/Tempo/Tribun/Antara/CNN ID portals; (3) X API v2 Bearer — 20 tweets/call. Blend: `max(exa, tavily, x×0.85)`. Stores `political_social_unrest_score`, `political_x_social_score`, `political_tavily_social_score`. Seasonal discount 30% (Iduladha/Lebaran). Two channels: (A) social contract — sembako + jobs → approval; (B) governance → CDS premium. **PHK + relokasi** (`sources/phk-relokasi.ts`, 3d): worker-count magnitude per event (regex "X.000 karyawan/ribu pekerja/PHK X"), 30d window, Detik/CNBC/Bisnis/Kompas via Exa+Tavily; `phk_workers_at_risk_30d` (max single-event) + `phk_events_30d_count`; ≥5,000 FDI exit signal, ≥1,000 watch. Requires EXASEARCH_API_KEY; degrades to unemployment-only if all news keys absent. SCD 0.05.

**M13 — ULN Engine** (`uln_engine`): 3 domains: (A) Kemenkeu debt service vs fiscal; (B) BI macro-prudential — Greenspan-Guidotti (reserves/short-term ULN; <1.0 CRITICAL) + hedging compliance (PBI 21/14/2019: min 25% net ULN <3mo); (C) OJK private USD = NPL leading 2-3Q. 1997 transmission: low hedging + ULN growth > GDP + IDR weakening → forced USD buying loop. Indicators: `indonesia_external_debt_bn` (shared M8), `uln_shortterm_pct`, `uln_dsr_pct`, `greenspan_guidotti`, `uln_gdp_ratio_pct`, `uln_yoy_growth_pct`, `uln_hedging_compliance_pct`. Thresholds: ULN/GDP G<35 Y35-40 O40-45 R>45; DSR G<20 Y20-25 O25-30 R>30; GG G>2 O<1.5 R<1. Hedging amplifier: >85%=×1.00, 70-85%=×1.15, 55-70%=×1.30, <55%=×1.50, unknown=×1.10. Cross-feeds: GG→M1, hedging+GG→M3. Sources: TE quarterly (shared M8), WB API `DT.TDS.DECT.EX.ZS` + `DT.DOD.DSTC.ZS` (annual, free), BI SULNI Playwright + `sources/hedging-news.ts` Exa/Tavily fallback (90d). 48h gate. SCD 0.09.

**Architecture:**
- `src/tools/macro/types.ts` — shared types (AlertLevel, ModuleScoreCard, etc.)
- `src/tools/macro/time-series-db.ts` — SQLite time series store at `.dexter/macro/macro.db`
- `src/tools/macro/scoring.ts` — rolling z-score, composite scoring, alert classification (GREEN/YELLOW/ORANGE/RED)
- `src/tools/macro/sources/` — data adapters:
  - `yahoo-macro` — USDIDR spot/history, FX/ETF prices, realized vol
  - `bi` — BI website scraper: FX reserves (3-tier: BI SEKI → WB GEM non-zero → Trading Economics), SRBI outstanding, hedging compliance (SULNI)
  - `srbi-auction` — Exa/Tavily: hasil lelang SRBI (bid-cover, demand, allotment, cutoff rate); 3d freshness
  - `bps` — BPS WebAPI: trade balance, CPI, unemployment
  - `imf` — IMF Data API: GDP growth, inflation, debt/GDP (annual)
  - `bloomberg` — Bloomberg B-PIPE REST proxy (optional, premium)
  - `refinitiv` — LSEG/Refinitiv RDP OAuth2 (optional, premium)
  - `pertamina` — Kepmen ESDM hardcoded fuel prices + env var overrides; BBM cost recovery formula
  - `dubai-crude` — Exa/Tavily: Dubai/Oman spot price + Brent-Dubai spread; 3d freshness; feeds M6 check #11
  - `ojk` — OJK SPI scraper: bank NPL, CAR, LDR (Playwright, ~11mo lag)
  - `ojk-iknb` — Exa/Tavily: OJK IKNB fintech/P2P lending stats (outstanding, NPL, growth); 30d freshness
  - `sovereign-scraper` — WorldGovernmentBonds.com Playwright: CDS 5Y, SBN 10Y yield + rating
  - `ihsg` — Trading Economics: IHSG P/E ratio, IDX advance/decline breadth
  - `idx` — IDX API: daily foreign net buy/sell flow
  - `political-risk` — Exa + Tavily: 3-query political/social sentiment scoring (food_pressure, social_unrest, political_stability)
  - `political-risk-terms` — shared keyword constants for Exa + X scoring (no network calls)
  - `x-social` — X API v2 Bearer Token: real-time social unrest feed (20 tweets/call)
  - `ghost-transit` — Exa/Tavily: Hormuz dark/AIS-off tanker flow; 3d freshness; feeds M4 commodity engine
  - `dndf` — Exa/Tavily: BI DNDF outstanding (USD bn, off-balance-sheet); 7d freshness; feeds M3 FX defense
  - `msci-classification` — Exa/Tavily: MSCI Indonesia EM/Frontier result (active post-Jun 23 2026); 7d/30d freshness; feeds M5 foreign flow. Result Jun 23 2026: EM CONFIRMED, review extended to Nov 12 2026 — M5 emits Nov-overhang flag + auto +3 score bump when <60d to next review
  - `mbg` — Exa/Tavily: Makan Bergizi Gratis YTD realisasi (Rp T) from Kemenkeu/news; 30d freshness; feeds M10 fiscal (8.7% APBN target Rp 335T)
  - `biodiesel` — Exa/Tavily: B50 mandate status (40/45/50), quota, BPDPKS insentif; 14d freshness; feeds M4 commodity + M10 fiscal
  - `coal-dmo` — Exa/Tavily: HBA, DMO compliance %, PLN coal secured %; 14d freshness; feeds M4 commodity (cross-feeds M10 TDL pressure, M11 input cost)
  - `phk-relokasi` — Exa/Tavily: worker-count extracted from PHK/relokasi events 30d window; 3d freshness; feeds M12 political risk
  - `hedging-news` — Exa/Tavily fallback for `uln_hedging_compliance_pct` when BI SULNI Playwright fails; 90d freshness; feeds M13 ULN
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

**APBN 2026 macro constants** (UU No.17/2025): USDIDR 16,500 | ICP $70/bbl | GDP growth 5.4% | CPI 2.5% | SBN 10Y 6.9% | Revenue 3,153.6T | Spending 3,842.7T | Deficit 2.68% GDP | Post-efisiensi spending ~3,534.7T | GDP 25,714.2T. BI Rate as of 9 June 2026: 5.50% (+25bps from 5.25%) — **inter-cycle hike via weekly RDG** (prev monthly RDG: 19-20 Mei); rationale: stabilisasi Rupiah (melemah sejak akhir Mei) + pre-emptive inflasi. DFR 4.50%, LF 6.25%. Term premium (SBN 10Y 7.40% − BI Rate 5.50%): 1.90% (borderline ORANGE, threshold 2%). Inter-cycle nature = sinyal kegentingan; reversal akan hancurkan kredibilitas lebih cepat dari normal-cycle cut.

**Regime Engine** (`regime_engine` tool, `regime-engine.ts`): Classifies Indonesia macro regime via Growth ROC × Inflation ROC quadrant framework. Regimes: Q1 Goldilocks (Growth↑ Inflation↓), Q2 Reflation (Growth↑ Inflation↑), Q3 Stagflation (Growth↓ Inflation↑ — worst for IDR), Q4 Contraction (Growth↓ Inflation↓). Inputs: IMF GDP growth rate-of-change, IMF/TE inflation ROC, PMI Manufacturing (TE scrape), IHSG/DXY/VIX from Yahoo. Computes shift probability + historical Indonesia analogs + asset implications per quadrant. SCD weight: 0.05. Feeds Domestic Pressure Engine as upstream signal.

**Macro Threshold Monitor** (`macro_threshold_monitor` tool, `macro-threshold-monitor.ts`): Fast fixed-threshold tripwire — no LLM call, no full engine runs. Fetches live spots (USDIDR, VIX, DXY, Brent, EIDO) and checks against static breach thresholds (VIX ≥35/45, DXY ≥108/112, Brent ±20% vs APBN $70, USDIDR daily move %). Returns breach list or "all clear" in seconds. Designed for intraday cron pre-screening before invoking `silent_crisis_detector`.

**Adding new modules:** create `src/tools/macro/{module}-engine.ts`, register in `registry.ts`, optionally add `src/skills/macro/{module}/SKILL.md`.
