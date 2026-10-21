# Dexter Indonesia — Technical Audit Report
**Oct 21, 2026 | Victor @ Sadasa Intelligence**

> Scope: cross-check `docs/GAME_THEORY_KAJIAN.md`, `README.md`, `SOUL.md` vs live codebase state.
> Find: stale docs, unfinished homework, implementation gaps, data gaps.
> Rating: P1 = urgent / P2 = important / P3 = long-term / DOC = doc-only fix.

---

## 1. Stale Documentation

### 1.1 README.md — GT Coverage Stuck at 51%

**File:** `README.md` lines 494, 500, 634
**Current:** "GT coverage ~51%" everywhere in the Game Theory section.
**Actual:** ~65% after Oct 19 additions (SSS 3-phase, stop-loss cascade, MSCI credible commitment) + Oct 20 PolEcon payoff matrix in M12.

Oct 19 GAME_THEORY_KAJIAN.md already updates to ~63% internally. PolEcon M12 (Oct 20) adds another ~2pp. README has not been updated from the pre-Oct-19 text.

**Fix:** Update Game Theory section header + coverage bar from `~51%` → `~65%`. Update roadmap bar:
```
Oct 2026  ████████████████░░░░  ~65%  (selesai: + SSS 3-phase + stop-loss cascade + PolEcon M12)
```
**Priority:** DOC

---

### 1.2 README.md — MSCI Status Env Vars Stale

**File:** `README.md` lines 422 and 940.

- **Line 422** (env example near BBM section):
  ```
  MSCI_CLASSIFICATION_STATUS=under_review   # Nov 2026 re-review overhang
  ```
  Stale. MSCI launched Standalone consultation Oct 15 2026. Status is now `downgrade_risk`. Comment is wrong ("Nov 2026 re-review" was the old framing before out-of-cycle announcement).

- **Line 940** (Install section):
  ```
  MSCI_CLASSIFICATION_STATUS=confirmed         # Jun 23 2026 EM CONFIRMED; next review Nov 12 2026
  ```
  Stale. `confirmed` is from before the Oct 15 Standalone consultation. Should be `downgrade_risk`. Comment still references pre-Oct-15 state.

Both lines conflict with `CLAUDE.md` which correctly documents:
```
# current: downgrade_risk (Oct 15 2026 Standalone consultation)
```

**Fix:** Update both lines to `downgrade_risk` with correct comment (Standalone consultation, decision Jun 30 2027).
**Priority:** DOC (misleads anyone copy-pasting env setup)

---

### 1.3 GAME_THEORY_KAJIAN.md — PolEcon Still Listed as ⏳ Open

**File:** `docs/GAME_THEORY_KAJIAN.md` — Coverage table and Summary table.

The Coverage table at the end (Oct 19 section) still shows:
```
| Political economy veto player | ⏳ Open | M12 | Tsebelis 2002 |
```

The Priorities table also lists:
```
| Political economy veto player | 8 bulan | Poltracking time series | M12 structural | P3 |
```

**What happened:** PolEcon payoff matrix (Barro-Gordon/Kydland-Prescott) was implemented Oct 20 in `political-risk-engine.ts` — `polEconState`, `polEconAdj` (0–8pts), `polEconPResist`, and dashboard badge in M12 card.

**Important distinction to document:** What was implemented is the **Kemenkeu × Masyarakat payoff matrix** (BBM hike decision game). What remains P3 open is the **veto player mapping** (Tsebelis 2002: Prabowo × DPR factions × cabinet coalition — requires Poltracking time series). These are two different GT concepts under the "Political economy" umbrella.

**Fix:** Update GAME_THEORY_KAJIAN.md coverage table:
```
| Barro-Gordon PolEcon payoff matrix | ✅ Oct 20 | M12 Political Risk | BBM hike EV game: Kemenkeu×Masyarakat |
| Veto player mapping (Tsebelis 2002) | ⏳ P3 | M12 | Requires Poltracking time series |
```
Also update coverage estimate from `~63%` to `~65%`.
**Priority:** DOC

---

### 1.4 `msci-countdown.ts` — Tracking Wrong Milestone

**File:** `scripts/msci-countdown.ts` lines 2–4, 26.

Current default: `REVIEW_DATE = '2026-11-12'` (Nov 12 November Index Review).

The Nov 12 review still exists and is 22 days away — it will likely confirm Standalone consultation parameters. But the critical new milestones are:
- **Apr 30 2027** — consultation closes
- **Jun 30 2027** — MSCI final decision
- **Sep–Dec 2027** — implementation if downgrade proceeds

The script has a single milestone date with T-60/T-30/T-7/T-0 alerts. It will fire T-0 on Nov 12 and then go silent for 7 months until the actual decision. The operator needs reminders at T-60 before Apr 30 (Mar 1 2027) and T-60 before Jun 30 (May 1 2027).

Current workaround: set `MSCI_REVIEW_DATE` env var to override. But this isn't documented in CLAUDE.md.

**Fix needed:**
1. Add `MSCI_REVIEW_DATE` to CLAUDE.md env vars.
2. Either update script to support multiple dates, or document operator action: after Nov 12, reset `MSCI_REVIEW_DATE=2027-04-30` then `2027-06-30`.
3. Update README cron comment from "MSCI Nov 12 2026 countdown" to "MSCI milestone countdown (Nov 12 → Apr 30 2027 → Jun 30 2027)".
**Priority:** P2 (Nov 12 fires in 22 days; need plan before then)

---

### 1.5 README.md — `health-check.sh` vs `scripts/health-check.ts`

**File:** `README.md` lines 970–978 (Health Checks section).

README shows:
```bash
bash health-check.sh
bash health-check.sh --verbose
bash health-check.sh --timeout 60
```

The actual tool is `bun scripts/health-check.ts` (TypeScript, full indicator freshness + env var audit). `health-check.sh` exists but is a lighter shell-level infrastructure check (different scope).

README presents them as equivalent alternatives. They are not — `bun scripts/health-check.ts` is the authoritative health check per CLAUDE.md. README section is misleadingly ordered (shell script listed first).

**Fix:** Reorder section — put `bun scripts/health-check.ts` prominently, note `health-check.sh` is infrastructure-only (Playwright, SQLite, scrapers). Matches CLAUDE.md command reference.
**Priority:** DOC

---

## 2. Open Implementation Items (Confirmed Unimplemented)

### 2.1 MSCI Reversal Probability Flag in M5 — P1

**From:** GAME_THEORY_KAJIAN.md Oct 19 priorities. Thread 23.
**Effort:** 2 days.

Current state: `foreign-flow-engine.ts` handles `MSCI_CLASSIFICATION_STATUS` = `downgrade_risk` and computes `msciScoreBump`, `bryantPhase`, `sairBonus`. It knows MSCI is a downgrade risk. What it **does not** have:

```typescript
msci_reversal_probability: float  // prior 0.10–0.15
```

No formal field tracking `P(reversal | current evidence)`. No flag at `P < 0.20` threshold: *"MSCI COMMITMENT CREDIBLE — cheap talk will not move this metric until verifiable structural reforms emerge."*

**Why it matters right now:** KS#3 (SBN foreign ownership >15%) and KS#4 (credit market benign) are the kill switches for Thesis #14. But the MSCI game structure says: if `P(reversal) < 0.15`, even KS#3/KS#4 improvement is likely temporary positioning, not structural return of confidence. Without an explicit reversal probability field, the engine has no way to discount kill switch signals in the context of the MSCI commitment game.

**Implement:** Add `msciReversalProbability` to `ForeignFlowOutput`. Initialize at 0.12 (prior). Update based on observable implementation signals (enforceable reforms announced + verified). Flag in output when < 0.20.
**Priority:** P1

---

### 2.2 Cascade Node 2 Policy Response Tracker / KS#2 Partial Automation — P1

**From:** GAME_THEORY_KAJIAN.md Oct 19 Thread 25 + Priorities table. Effort: 3 days.

Current state: KS#2 ("BI coordinated stabilization package") is **fully manual**. There is no automated detection of coordinated policy response. The `check-thesis.ts` script flags it as "candidate — manual confirm before kill."

`policy_response_tracker` described in the doc:
```
- Monitor: BI DNDF outstanding change, BEI buyback programs,
  Kemenkeu ALCo statements, Danantara stabilization signals
- Classify: isolated_instrument vs partial_coordination vs full_package
- Score: full_package = KS#2 candidate
- Flag: "COORDINATED RESPONSE DETECTED" → reduce SCD by up to 8pp
```

Not present in `fx-defense-engine.ts` or `silent-crisis-detector.ts`.

**Why urgent:** Bryant T+5d ETF mechanics phase is active now (Oct 20–Nov 18). If BI/Kemenkeu mount a coordinated response in this window, the engine won't signal it. KS#2 would remain stuck as manual-only while the most policy-active phase of Thesis #14 runs.

The minimum viable implementation: add Exa/Tavily scan for coordinated response keywords (DNDF + buyback + ALCo + Danantara in same 72h window). Flag as `partial_coordination`. Reduce SCD 4pp. Full package = 8pp reduction + KS#2 candidate signal.
**Priority:** P1

---

### 2.3 Post-Bryant Selling-Period Classifier — P2

**From:** GAME_THEORY_KAJIAN.md Oct 19 Thread 24. Effort: 1 week.

Current state: M5 knows Bryant phase (`etf_mechanics` / `mandate_rebalancing` etc.) but treats each phase with the same analytical frame — primarily measuring selling pressure. Thread 24 describes 4 distinct periods with fundamentally different game structures:

- T+0 to T+30: ETF mechanics (operational forced sell, non-strategic)
- T+30 to T+90: **wait game** — institutions watching for reform signals before sizing short
- T+90 to T+360: **information acquisition game** — gathering evidence on reform credibility
- T+360 (Jun 2027): MSCI final decision

The wait game and information acquisition phases require a **two-sided market model** — sellers (mandate-driven, unconditional) vs buyers (reform speculators, conditional on implementation evidence). IHSG floor is determined by equilibrium between these two groups, not just selling pressure.

**What to add:** M9 or M5 phase classifier with different scoring logic per period. Include "reform speculation probability" indicator (short interest data, BEI buyback announcements, BUMN stabilization signals). Explicit IHSG floor estimation output.
**Priority:** P2 (high impact for Thesis #14 T+3 milestone Dec 2026)

---

### 2.4 Gap D Long-Term: `LPS_FUND_ADEQUACY_PCT` Env Var — P2

**From:** GAME_THEORY_KAJIAN.md Bagian 3, Gap D long-term. Effort: 1 day.

Current state: Gap D short-term is ✅ done — M8 D-D condition 6 (weight 0.5) uses `apbn_deficit_pct_gdp > 4.5%` as sovereign backstop proxy. But the long-term full implementation uses the actual LPS fund adequacy ratio.

What's missing:
- `LPS_FUND_ADEQUACY_PCT` not in `CLAUDE.md` env vars
- Not in `scripts/health-check.ts` ENV_VARS audit list
- Not in `banking-stress-engine.ts` (condition 6 only checks APBN deficit)

Source: `lps.go.id` Laporan Tahunan LPS, "Tingkat Kecukupan Dana". Cadence: annual (~Apr for prior year). Historical: 2022=2.87%, 2023=2.94%, 2024=est.3.1%.

M8 D-D condition 6 logic with both triggers:
```
condition_6_backstop = lps_fund_adequacy_pct < 2.0 || apbn_deficit_pct_gdp > 4.5
```

**Implement:** Add env var to CLAUDE.md + health-check.ts ENV_VARS + banking-stress-engine.ts condition 6 enhancement.
**Priority:** P2

---

### 2.5 3rd-Gen Balance Sheet Amplifier (M3+M8+M13 Unified) — P3

**From:** GAME_THEORY_KAJIAN.md Thread 9 / Thread 16. Horizon: 6+ months.

Chang-Velasco 1998 / Burnside-Eichenbaum-Rebelo 2001. Currency mismatch in corporate/banking balance sheet creates feedback loop between IDR depreciation, ULN dollarization shock, and bank CAR erosion.

What's missing:
- FX-hedging ratio korporasi (from SULNI quarterly, ~6wk lag after Q-release)
- Currency mismatch index per bank
- Cross-module feedback coefficient (M3 IDR shock → M13 ULN cost → M8 CAR → M3 further pressure)

This is explicitly noted as requiring SULNI FX-hedging data. Available source: SULNI quarterly press release (Q3 2026 data expected Nov 2026). Dexter already scrapes some SULNI data.

**No action yet — track data availability.** When SULNI Q3 2026 publishes (~Nov 2026), check if FX-hedging ratio per sector is included.
**Priority:** P3

---

### 2.6 Political Economy Veto Player Mapping (Tsebelis 2002) — P3

**From:** GAME_THEORY_KAJIAN.md Thread 10 / Roadmap. Horizon: 8 months.

Distinct from PolEcon payoff matrix (Oct 20 ✅). Veto player model maps: Prabowo (veto) × DPR factions × cabinet coalition × street. Requires Poltracking Indonesia or Indikator Politik Indonesia survey time series — not available without subscription or manual quarterly update.

**No action needed now.** Revisit when Poltracking API or survey data becomes accessible.
**Priority:** P3

---

### 2.7 Bayesian M6 Full Calibration — P3

**From:** GAME_THEORY_KAJIAN.md Thread 11 / Thread 17. Horizon: 6 months.

Current state: Partial Sobel cheap-talk implementation in M6. Uses heuristic prior for `P(BI credible | data)`. Full calibration needs `likelihood P(data|credible)` vs `P(data|not_credible)` estimated from 6 historical crises in `backtest/crisis-calendar.ts`.

The backtest data infrastructure already exists. This is a calibration task, not a data-acquisition task. Estimated 6 months because it requires careful statistical work (no lookahead bias in likelihood estimation).
**Priority:** P3

---

## 3. Missing from CLAUDE.md Env Vars

These env vars are documented in README.md or exist in code but are **absent from `CLAUDE.md`** — operators won't know to set them.

| Env Var | Source | Used In | CLAUDE.md Gap |
|---|---|---|---|
| `RUSSIA_CRUDE_DISCOUNT_USD` | README.md Russia deal section | `src/tools/macro/sources/pertamina.ts` line 78 | Not in CLAUDE.md |
| `MSCI_REVIEW_DATE` | `scripts/msci-countdown.ts` line 26 | countdown script only | Not in CLAUDE.md |
| `LPS_FUND_ADEQUACY_PCT` | GAME_THEORY_KAJIAN.md Gap D | `banking-stress-engine.ts` (planned) | Not in CLAUDE.md |
| `SOLAR_BLEND_RATIO` | README.md BBM section | M11 solar cost recovery | Not in CLAUDE.md |

All four should be added to CLAUDE.md env vars block.
**Priority:** P2 for `RUSSIA_CRUDE_DISCOUNT_USD` and `SOLAR_BLEND_RATIO` (already in code); P2 for `LPS_FUND_ADEQUACY_PCT` (when implemented); P2 for `MSCI_REVIEW_DATE` (operational now).

---

## 4. SOUL.md Aspirations Not Yet Engineered

SOUL.md describes analytical behaviors that have no corresponding engine implementation.

### 4.1 DSR Slope / Velocity (Persona V)

**Quote:** *"The level at 24.69% looks manageable. The slope — +4.4pp in one year — does not. At that trajectory, the 2025 data point is likely to show a threshold breach."*

**Engine reality:** M13 `uln-engine.ts` stores and scores the DSR level. No `dsrSlope` field, no velocity computation, no trend flag. The slope insight is analyst-expressed but not machine-computed.

**Gap:** Add `dsrSlope` field to `UlnOutput` — compute as `(latest_dsr − prior_year_dsr) / months`. Flag when slope > 3pp/year as ORANGE, > 5pp/year as RED. Currently the SOUL.md insight is invisible to the engine.
**Priority:** P2

---

### 4.2 China PMI Weekly (Persona V, Leading Indicator #1)

**Quote:** *"China manufacturing PMI → nickel and base metal demand → LME nickel price → Indonesian nickel export unit value → monthly trade balance → reserve accumulation rate → GG trajectory. The lag between a China PMI shock and an Indonesian trade data confirmation is approximately 6-8 weeks."*

**Engine reality:** M4 Commodity tracks `nickel_price_lme_usd`, `coal_price_usd`, `cpo_price_usd` via Yahoo Finance. No explicit China PMI indicator. The 6-8 week lead signal is not implemented.

**Gap:** Add `china_caixin_pmi` or `china_official_pmi` as leading indicator in M4. Source: Yahoo Finance via `^CN-PMI` or NBS website via Exa. If PMI < 50 and trending down, flag M4 as YELLOW forward-looking (nickel/coal demand at risk 6-8 weeks out).
**Priority:** P2 (low cost, high signal value given MSCI+commodity double stress)

---

### 4.3 ASEAN Peer Simultaneous Stress Diagnostic (Persona V)

**Quote:** *"If IDR is falling while MYR and PHP are stable, that is an Indonesia-specific event... If IDR is falling while MYR, PHP, and THB are all falling simultaneously, that is a regional capital flow event."*

**Engine reality:** M7 ASEAN RV computes UIP carry, JPY carry, and peer spreads. The diagnostic distinction (idiosyncratic vs regional) is not output as a flag. Morning brief doesn't distinguish "ASEAN-wide EM risk-off" from "Indonesia-specific political repricing."

**Gap:** Add `aseanStressMode: 'idiosyncratic' | 'regional' | 'mixed'` to M7 output. Simple implementation: if ≥2 other ASEAN currencies (MYR, PHP, THB) are simultaneously down >1% same week → `regional`. If IDR alone → `idiosyncratic`. This changes the response prescription — domestic policy is less effective in regional mode.
**Priority:** P2

---

### 4.4 Deposit Concentration Data (Persona IV + GT Kajian Thread 14)

**From:** GAME_THEORY_KAJIAN.md Thread 14 + SOUL.md Persona IV banking data awareness.

D-D `runCoordinationScore` condition matrix currently has 5 conditions (NPL, LDR, IndONIA, fintech NPL, CAR erosion). Thread 14 identified: deposit concentration (top-5 bank share) and interbank exposure matrix as missing inputs.

OJK interbank matrix = not public (requires FSAP BI access — effectively blocked).
Deposit concentration = potentially available from OJK LSPI quarterly (top-5 DPK share). Dexter already scrapes OJK LSPI for CAR/LDR. Check if top-5 concentration is in same publication.
**Priority:** P3

---

## 5. Operational Pending Items

### 5.1 SRBI Oct 23 Backfill

Run immediately after Oct 23 auction results published (14:00–17:00 WIB):
```bash
bun scripts/backfill-srbi-history.ts --from=2026-10-23
```
macOS reminder set. This is time-sensitive — bid-cover ratio from first SRBI auction post-circuit-breaker is key M3 signal.

---

### 5.2 APBN Semester II Realisasi (APBN Jul-Agu Pending)

**README note:** "APBN data Jul-Agu pending (Suahasil janji ALCo)."

Menkeu Suahasil promised ALCo transparency at pelantikan (Sep 14). By Oct 21, Jul and Agu APBN realisasi should be available. Currently M10 is using the Jun 30 (Semester I) figures. The subsidi run-rate 457% is based on Rp331.4T YTD through Sep 30, sourced from Kemenkeu Oct 9 press release — that data appears current. But formal APBN realisasi statement for Jul-Agu should be verified and seeded.

**Action:** Check Kemenkeu.go.id for APBN realisasi Jul and Agu 2026 official publication. Update `macro_series` if new figures available.

---

### 5.3 Thesis #14 T+3 Milestone Dec 21 2026

Armed Sep 22. T+90 = Dec 21 2026 (61 days from now). Auto-check via cron 07:30 WIB every Monday. Manual check available via `bun scripts/check-thesis.ts`.

Current actuals vs targets:
- CDS: 99.5bps (target: 164bps — 39% of way there)
- USDIDR: 17,995 (target: 20,020 — 28% of way there)
- SBN 10Y: 7.169% (target: 8.62% — 48% of way there)

Bryant ETF mechanics active Oct 20–Nov 18. MSCI consultation running. Fed Dec hike odds 88%. trajectory toward T+3 targets is plausible.

---

## 6. Priority Matrix Summary

| Item | Status | Effort | Who/When | Impact |
|---|---|---|---|---|
| README GT coverage update ~65% | DOC | 5 min | Immediate | Accuracy |
| README MSCI env values fix | DOC | 5 min | Immediate | Operator safety |
| GT Kajian PolEcon coverage update | DOC | 15 min | Immediate | Accuracy |
| `msci-countdown.ts` milestone plan | P2 | 2 hrs | Before Nov 12 | Ops continuity |
| MSCI reversal probability flag (M5) | P1 | 2 days | This week | KS#3/KS#4 reliability |
| Cascade node 2 policy response (KS#2 auto) | P1 | 3 days | This week | Thesis #14 KS |
| `LPS_FUND_ADEQUACY_PCT` env + M8 | P2 | 1 day | This sprint | D-D precision |
| `RUSSIA_CRUDE_DISCOUNT_USD` → CLAUDE.md | P2 | 10 min | This sprint | Operator docs |
| `SOLAR_BLEND_RATIO` → CLAUDE.md | P2 | 5 min | This sprint | Operator docs |
| `MSCI_REVIEW_DATE` → CLAUDE.md | P2 | 5 min | This sprint | Ops |
| DSR slope/velocity in M13 | P2 | 2 days | Next sprint | SOUL.md intent |
| China PMI weekly indicator (M4) | P2 | 2 days | Next sprint | M4 lead signal |
| ASEAN simultaneous stress diagnostic (M7) | P2 | 1 day | Next sprint | Diagnostic precision |
| Post-Bryant selling-period classifier | P2 | 1 week | Before Nov 15 | Thesis #14 T+3 |
| SRBI Oct 23 backfill | OPS | immediate | Oct 23 14:30+ WIB | M3 freshness |
| 3rd-gen balance sheet | P3 | 6+ months | — | Unified loop model |
| Veto player mapping (Tsebelis) | P3 | 8 months | — | M12 structural |
| Bayesian M6 full calibration | P3 | 6 months | — | M6 precision |
| Deposit concentration (D-D) | P3 | unknown | — | M8 precision |

---

## 7. System Health Snapshot (Oct 21, 2026)

### What is working correctly
- All 13 module engines: scoring, freshness gates, env overrides
- SCD aggregator: convex escalation, strategic complementarity, cross-module chain
- GT implementations: Morris-Shin, Krugman/FG, Barro-Gordon (M10), Diamond-Dybvig (M8), herding cascade (M5), SSS 3-phase (SCD), stop-loss cascade (M9), PolEcon payoff matrix (M12)
- WAF/CF bypass chain: FlareSolverr cf_clearance cache → Playwright stealth → env overrides (FINTECH_NPL_PCT, SBN_FOREIGN_OWNERSHIP_PCT, IDX_SHORT_SELL_VOLUME_IDR_BN)
- Thesis lifecycle: arm → trigger → milestone → kill switch logic
- Dashboard: 3 pages (/, /rr, /bs) with all panels
- Cron schedule: morning brief + weekly + monthly + thesis check registered

### What is at risk
- **KS#2 fully manual** while Thesis #14 is in its most policy-active phase (Bryant T+5d)
- **M5 has no reversal probability field** — kill-switch over-optimism risk if KS#3/KS#4 improve temporarily
- **msci-countdown.ts will silently expire Nov 12** without tracking Apr 30 / Jun 30 2027 milestones
- **README misleads operators** with stale MSCI env values

### Clean
- Freshness gates: Oct 20 baseline 45 fresh · 2 aging · 1 stale · 0 critical
- Backtest: 100% hit rate (6/6 crises), stable since Sep 16
- PolEcon M12 wired and scoring (Oct 20)
- AT1 fix (81.4%) + DPK BI SEKI deposito threshold (52.5%) correct

---

*Generated: Oct 21 2026 | Victor @ Sadasa Intelligence | docs/AUDIT_OCT21_2026.md*
