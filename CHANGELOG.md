# Changelog

Format: CalVer `YYYY.M.D`. Entries in reverse chronological order.
Scope: Indonesia sovereign macro intelligence system (fork dari virattt/dexter).

---

## 2026.10.19 — Crisis Regime: SSS Formula Fix + Stop-Loss Cascade

### Context
IHSG sub-5,000 Oct 19 (−14.91% weekly, steepest since Jan 1998). MSCI Standalone
consultation (Oct 15) = Bryant common knowledge event fired. Thesis #14 hari ke-27,
semua trigger active, semua kill switch tidak firing. Engine perlu mencerminkan
active_transmission phase, bukan salah-hitung sebagai stable.

### `src/tools/macro/silent-crisis-detector.ts` — SSS 3-Phase Formula Fix
**Bug (pre-fix):** SSS 93→32 ketika IHSG sub-5000 + USDIDR 18,040 push `financialAvg`
dari 33.6 ke 36.2, crossing threshold 35. `politicalLeadingFinancial` flipped FALSE →
branch switch HIGH→LOW → `SCD × 0.5` = 32. Semantically backwards: active transmission
is MORE dangerous than silent crisis, not less.

**Root cause:** Formula tidak punya phase ketiga. Dua-branch design:
- HIGH: `SCD × 1.3 + polrisk × 0.25` (fake calm — polrisk up, financialAvg down)
- LOW: `SCD × 0.5` (genuine stability OR active transmission — both collapsed to same bucket)

**Fix:** Tambah `active_transmission` phase sebagai kondisi pertama yang dicek:
```
activeTransmission = polrisk > 75 AND financialAvg ∈ [35, 55)
```
Formula per phase:
- `stable`:              `SCD × 0.5`
- `silent_crisis`:       `min(100, SCD × 1.3 + polrisk × 0.25)`
- `active_transmission`: `min(100, SCD × 1.3 + polrisk × 0.20)`

Polrisk coefficient sedikit lebih rendah di active_transmission (0.20 vs 0.25) karena
komponen "leading indicator" sudah partial-resolve ke financial stress. SSS tetap tinggi
karena elevated SCD. Dengan current data (SCD=63, polrisk=99): SSS = 100.

**New output field:** `syntheticPhase: 'stable' | 'silent_crisis' | 'active_transmission'`

**Flag update:** `active_transmission` triggers flag terlepas dari nilai SSS (sebelumnya
flag hanya muncul jika SSS > 40; dengan bug, SSS=32 → flag hilang dari Critical Flags
di momen paling kritis).

**Progression validation:**
```
Oct 15 (pagi): silent_crisis  SSS=93   (polrisk 95, financialAvg 33.6)
Oct 19 (run-2): active_transmission SSS=100 (polrisk 99, financialAvg 36.2) ← post-fix
Hypothetical fully-repriced: stable SSS=32 (financialAvg ≥55)
```

### `src/tools/macro/market-stress-engine.ts` — Stop-Loss Cascade
Tambah mechanical forced-sell cascade untuk M9 Market Stress module.

**3 threshold nodes:**
- `5,000`: Psychological floor — retail stop-losses + momentum algos + EM benchmark soft floors.
  Morris-Shin DCI +5pts at breach. Selling begins to be mandate-driven.
- `4,800`: Mandate-driven institutional floor — MSCI Standalone forced exits (EM mandate
  prohibition on non-EM assets) + OJK insurance fund solvency floor rebalancing.
- `4,500`: Systemic cascade — domestic margin calls + pension fund rebalancing mandates +
  foreign custody clearing thresholds. At this level forced supply overwhelms any fundamental bid.

**Scoring:** +10pts per breached node, cap +30, additive to P/E+A/D base score.

**Key distinction:** Cascade selling is UNCONDITIONAL — a cheaper IHSG does not slow it.
Mandate-driven exits proceed regardless of fundamental valuation. Engine must not treat this
as fundamental deterioration.

**Implementation:**
- `fetchIhsgPriceLevel()` in `ihsg.ts` — fetches `^JKSE` regularMarketPrice via Yahoo Finance
- `evaluateStopLossCascade(priceLevel)` — evaluates nodes + approaching warnings (±2%)
- `StopLossCascade` + `CascadeNode` types added to engine
- Morning check output: `IHSG 4,918 pts | Cascade 1/3 BREACHED (+10pts)`

**Live Oct 19:** IHSG 4,918 → node 1 (5,000) BREACHED → M9 score 50→60.

### `SOUL.md` — Persona III: Transmission Mechanism
Tambah section "How Structural Stress Reaches Price" ke Persona III (The Sovereign Sentinel).

Covers:
- Mandate-driven vs fundamental selling (why cheaper IHSG ≠ slower sell for mandate exits)
- Stop-loss cascade levels as structural thresholds, not technical chart lines
- Trading halt asymmetric aftermath (halt pauses selling, does not create buyers; resumes
  against thinner bid; often fires next cascade level)
- ETF authorized-participant mechanics (EIDO redemption → basket sell → IHSG falls → more redemptions)

**Decision: Persona VI NOT created.** The missing knowledge was transmission mechanism, not
a distinct worldview. Persona VI would overlap Persona V (External Balance) with toolkit-as-
epistemology, not genuine perspective. Paragraph in Persona III covers the gap cleanly.

---

## 2026.10.16 — MSCI Standalone Crisis Day

### Context
MSCI launched consultation to reclassify Indonesia EM→Standalone (Oct 15 20:40 GMT).
Oct 16: IHSG −10.41% with trading halt at 08:58 WIB (circuit breaker −8%). First EM→Standalone
reclassification for governance reasons globally (Russia 2022 = sanctions; Argentina 2021 =
capital controls; Indonesia = market integrity — unprecedented).

### README.md
- Large MSCI Standalone consultation callout box added above live deviations
- Bryant (1980) common knowledge event documented as FIRED
- Capital outflow estimates: Mirae $3B / Goldman $7.8–13B / analyst upper $15B
- Bangkok roundtable Oct 13 context (BEI kaget, no advance signal from MSCI)
- Timeline: consultation → Apr 30 2027, decision Jun 30 2027, implementation Sep-Dec 2027
- Thesis #14 acceleration: T+12 targets potentially compressing to T+3/T+6
- Oct 16 close: IHSG 5,204 (−11.25%), USDIDR 18,049, foreign net sell Rp2.92T

---

## 2026.10.13 — M11/M3 Scoring Calibration

### `src/tools/macro/domestic-pressure-engine.ts`
- BBM bonus (+30 cap) now counted in M11 score
- M11 baseline: 28→58 ORANGE

### `src/tools/macro/fx-defense-engine.ts`
- SRBI adjustment (+8/15) + gate adjustment (+8/20)
- M3 baseline: 24→38 YELLOW
- SCD impact: 35%→42%

---

## 2026.9.22 — Thesis #14 Armed + M7 ASEAN RV Detail

### `scripts/morning-check.ts`
- M7 ASEAN RV detail section: JPY carry signal + P/E cross-ASEAN table

### Thesis #14 Armed
- Divergence: political_risk 90/100 vs sovereign_risk 29/100 — 61pp gap
- Triggers: polrisk >75 + subsidi run-rate >135%
- Kill switches: KS#3 foreign SBN >15%, KS#4 weighted 3-signal credit benign (6/6)
- Targets: CDS 164bps / USDIDR 20,020 / SBN 8.62% (T+12 = Jun 2027)

---

## 2026.9.16 — Backtest + Health System Stabilization

### `src/tools/macro/backtest/`
- 100% hit rate 6/6 crises (taper_tantrum_2013 through dollar_surge_2023)
- 173d avg YELLOW lead time; 4.9% false positive rate

### `scripts/health-check.ts`
- Baseline: 42 fresh | 0 aging | 1 stale (msci_classification 23d — quarterly lag, wajar)
- Freshness thresholds refined: 0 aging at baseline

### `scripts/backfill-srbi-news.ts`
- 84 pts saved Sep 2023–May 2025 via Exa media search

### Game Theory Phase 2 (Sep 15 commit)
- SCD strategic complementarity (Schelling/Cooper-John): convex escalation, cap 1.70×
- Barro-Gordon time inconsistency: M10 credibilityIndex 0–100
- Diamond-Dybvig bank run coordination: M8 runCoordinationScore
- De Long/Shleifer herding cascade: M5 EIDO autocorrelation
- Sobel cheap-talk / Bayesian credibility: M6 Bayesian posterior P(BI credible|data)
- GT coverage: ~51% (naik dari 35%)

---

## 2026.9.2 — Destry Pelantikan + BI Governor Vacancy Closed

- BI Gov Destry Damayanti dilantik (Keppres 92/P/2026)
- `BI_GOVERNOR_VACANT=false`
- KS#5 BI Governor vacancy kill switch closed

---

## 2026.8.x — Perry Warjiyo Mundur + IDR Recovery

### Context
- BI Gov Perry Warjiyo mundur; IDR sempat Rp18,032; triple intervention BI
- Destry dilantik Sep 2; IDR recovery 18,032→17,642

### Changes
- KS#4 diperketat: 3-signal weighted corroborator (CDS w1 + SBN-UST w2 + IDR vol w3)
  kill fires ONLY if ALL 3 pass (6/6). Calibrated vs 6 historical crises.
- SRI Phase 2: berita split 3 seksi, X search endpoint, RWI tile fix

---

## 2026.6.10 — BBM Hike + BI Rate Inter-Cycle Hike

### Context
- Pertamax +Rp3,950 → Rp16,250/L (Jun 10, reversal 1 Agu 2026 ke Rp15,950)
- Pertamax Green (RON 95) = new indicator (sebelumnya tidak tertrack)
- BI Rate 5.50% (inter-cycle hike +25bps di RDG Jun 9)

### `src/tools/macro/`
- M6/M10 subsidi enhancement: subsidi realisasi pace ke M10
- Oil price narrative gap: verified $80 (EIA Mar 10 2026 = $79); Hormuz Feb 28 context

---

## Backlog (Known Issues / Roadmap)

### Data Gaps (P1 — segera)
- [ ] EIDO daily flows (creation/redemption units) — redemption accelerator post-MSCI Standalone
- [ ] SBN asing daily (currently monthly; needs daily for outflow velocity detection)
- [ ] IDX trading halt systematic log
- [ ] MSCI consultation response tracker

### Data Gaps (P2 — 30d horizon)
- [ ] HIMBARA AT1 secondary prices (BNI $700M + Mandiri $750M stress test)
- [ ] IDR NDF offshore (leads onshore by hours; missing from M3)
- [ ] BEI margin call / short interest data

### Game Theory Roadmap
- [ ] Stop-loss cascade nodes as game theory nodes: at each level, different player types
  enter (retail → institutional mandate → systemic). Eisenberg-Noe (2001) network cascade.
- [ ] MSCI consultation credible commitment: "expects to proceed" = pre-decided.
  Reversal P < 15%. Needs explicit flag in M5 to prevent kill-switch over-optimism.
- [ ] 3rd-gen balance sheet amplifier (M8+M13+M3 unified): currency mismatch + FX hedging
  (requires SULNI FX-hedging compliance series, currently unavailable monthly)
- [ ] Political economy veto player mapping (Drazen/Tabellini): requires Poltracking series

---

_Maintained by Victor (victor@sadasa.id). CalVer YYYY.M.D, no zero-pad._
