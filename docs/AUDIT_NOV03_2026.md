# Dexter Indonesia — Technical Audit Report
**3 November 2026 | Victor @ Sadasa Intelligence**

> Scope: M8 Banking Stress Engine — signal gap analysis, bug inventory, data source audit, dead code.
> Trigger: 5 critical findings from research session Nov 3 — PUAB 117bps ATH, BABP live crisis, JIBOR date bug, kbmi-contagion.ts unintegrated, IndONIA daily from BI feasible.
> Rating: P1 = fix now / P2 = important soon / P3 = long-term / BUG = correctness issue / ARCH = architecture issue.

---

## 1. M8 Performance Gap — Jul–Nov 2026 Retrospective

### 1.1 The Hidden Signal: PUAB O/N Spread Jul 2026

**Finding:** PUAB O/N spread reached **117 bps in July 2026** — all-time high, exceeding Sep 2015 peak (96.5 bps) by 21 bps. BI SSKI Tabel 13 confirms this. M8 did not detect it.

There are **two separate problems**, and they must not be conflated:

**Problem A — Data lag (4 weeks via Trading Economics)**

IndONIA via TE scrapes from BI SSKI monthly aggregate. Jul 2026 data was not in DB when M8 ran August–September 2026. Fix: replace TE with BI direct scrape (19:30 WIB daily).

**Problem B — Scoring architecture dilution (the worse problem)**

Even if IndONIA had been fetched with zero lag, M8 score with 117 bps spread would still be **17/100 (GREEN)**. Computed from actual M8 scoring functions with Aug 2026 bank fundamentals:

| Component | Value (Aug 2026) | Score | Weight | Contribution |
|-----------|-----------------|-------|--------|-------------|
| NPL gross | 2.09% | 1 | 0.30 | 0.30 |
| LDR | 88.14% | 0 | 0.25 | 0.00 |
| CAR | 24.1% | 0 | 0.25 | 0.00 |
| IndONIA spread | 117 bps (ATH) | 81 | 0.20 | **16.20** |
| **Total** | | | | **17 → GREEN** |

For reference — IndONIA scenarios across the crisis arc:

| Scenario | Spread | IndONIA score | M8 total | Alert |
|----------|--------|--------------|----------|-------|
| Normal | 10 bps | 5 | 1 | GREEN |
| TE trigger threshold | 40 bps | 28 | 6 | GREEN |
| Jun 2026 (stress) | 70 bps | 64 | 13 | GREEN |
| Sep 2015 prior ATH | 96 bps | 76 | 16 | GREEN |
| **Jul 2026 ATH** | **117 bps** | **81** | **17** | **GREEN** |

**Conclusion:** Fixing the lag would not have changed M8 alert level. M8 was architecturally incapable of detecting the Jul 2026 interbank stress event regardless of data freshness.

### 1.2 Root Cause: Weighted Average Suppresses Leading Indicators

M8 scoring is a weighted average of 4 components: NPL (0.30), LDR (0.25), CAR (0.25), IndONIA (0.20). When NPL/LDR/CAR are healthy (near-zero scores), they dilute any IndONIA signal via the normalization denominator.

This is the **GFC 2008 pattern**: LIBOR-OIS spread blew out weeks before bank balance sheets showed stress. Weighted average of "balance sheet looks fine" + "interbank trust collapsing" = "aggregate looks fine." Exactly what happened here.

Bank fundamentals (NPL, LDR, CAR) are **lagging indicators** — they reflect *past* lending decisions. IndONIA spread is a **leading indicator** — it reflects *current* counterparty trust in the interbank market. Mixing them with equal weighting methodology suppresses the faster signal.

### 1.3 Architecture Fix Required

Two options:

**Option A: Standalone floor (simpler)**
```typescript
// After weighted score computed:
if (indoniaSpreadBps !== null && indoniaSpreadBps >= 75) {
  stressScore = Math.max(stressScore, 55); // ORANGE floor at BI corridor crisis level
}
if (indoniaSpreadBps !== null && indoniaSpreadBps >= 96) {
  stressScore = Math.max(stressScore, 70); // HIGH ORANGE floor at prior ATH level
}
if (indoniaSpreadBps !== null && indoniaSpreadBps >= 117) {
  stressScore = Math.max(stressScore, 80); // RED floor at new ATH level
}
```

**Option B: Multiplier when IndONIA + any other signal (better)**
```typescript
// If IndONIA spread elevated AND any other component elevated:
const indoniaStress = indoniaSpreadBps !== null && indoniaSpreadBps > 50;
const fundamentalStress = (nplPct ?? 0) > 3 || (ldrPct ?? 0) > 95;
if (indoniaStress && fundamentalStress) {
  stressScore = Math.min(100, stressScore * 1.5); // 50% amplifier
}
```

**Recommendation:** Option A (standalone floor) is simpler and directly addresses the suppression problem. Threshold calibration: BI corridor ceiling (75bps) → 55/100 ORANGE; prior ATH (96bps) → 70; new ATH (117bps) → 80.

**Priority:** P1 — this is a scoring correctness issue, not an enhancement.

### 1.4 IndONIA Indicator Name Bug

**Finding:** `fetchIndoniaRateTe()` saves to indicator key `indonia_3m_pct` in DB.

**Bug:** IndONIA is an **overnight (O/N)** rate. It replaced JIBOR O/N specifically. There is no "3M IndONIA." The `_3m` suffix is a stale artifact from when M8 tracked JIBOR 3M before the Dec 2025 transition.

Files affected:
- `src/tools/macro/sources/sovereign-scraper.ts:408` — `indicator: 'indonia_3m_pct'`
- `src/tools/macro/sources/sovereign-scraper.ts:417` — same fallback
- `src/tools/macro/banking-stress-engine.ts:421` — `getLatestPoint('indonia_3m_pct')`

Fix: rename to `indonia_on_pct` (overnight). **Requires DB migration** — existing `indonia_3m_pct` records in `macro_series` should be renamed, or engine reads both keys with fallback for backcompat.

**Priority:** BUG (P2) — misleading but not breaking. Rename when fixing lag issue.

### 1.5 Nov 3 2026 BABP — Live Test Confirms Design

BABP in active liquidity event today (MotionBank app down, Rp 2M teller limit, OJK "perhatian serius"). Basket KBMI status: BABP crashed, BBYB/BMAS/AGRO did not crash bersamaan.

Result: basket ≥3/4 trigger = NOT fired. Correct behavior — isolated idiosyncratic event, not systemic contagion. This empirically validates the basket design: single-bank crisis does not pollute the systemic signal.

Had basket been integrated in M8, today's output would include: "BABP.JK crash [X]% — basket 1/4, below contagion threshold (need ≥3/4)" — informative without false alarm.

---

## 2. Dead Code / Unintegrated

### 2.1 `kbmi-contagion.ts` — Ready Code Sitting Idle

**File:** `src/tools/macro/sources/kbmi-contagion.ts`
**Git status:** Untracked — never committed
**Integration:** Not imported anywhere

This file implements:
- KBMI I basket monitoring (BABP + BBYB + BMAS + AGRO via Yahoo Finance)
- OJK formal action news search (Exa, 7-day lookback)
- SRBI BCR cross-check (reads M3 DB)
- `fetchKbmiContagion()` returns `KbmiContagionResult` with basketCrashCount, crashSymbols, contagionSignal, ojkFormalAction

M8 does not call this. The Nov 3 BABP event happened and M8 produced no basket-related output. Zero awareness of today's event.

**Fix:** Integrate into `banking-stress-engine.ts`. See design doc `KBMI_Contagion_EWS_Design.md` Section 7, Priority 1. ~2–3 hours effort, zero new dependency.

**Priority:** P1

---

## 3. Bug Inventory

### 3.1 JIBOR Discontinuation Date — Wrong in Two Files

**Finding (from APLMA Gibson Dunn Dec 2024 note):**
- Jan 2, 2019: JIBOR **O/N tenor only** discontinued
- Dec 31, 2025: ALL remaining JIBOR tenors discontinued
- Jan 1, 2026: Indonesia full IndONIA transition

**Bug 1:** `src/tools/macro/banking-stress-engine.ts:47`
```
// Current (WRONG):
- IndONIA 3M: Trading Economics scraper (Playwright, monthly) — BI discontinued JIBOR Dec 2023

// Fix:
- IndONIA O/N: Trading Economics scraper (Playwright, monthly) — BI discontinued JIBOR O/N Jan 2019, all tenors Jan 2026
```

**Bug 2:** `src/tools/macro/sources/sovereign-scraper.ts:387`
```
// Current (WRONG):
* BI discontinued JIBOR in Dec 2023; TE now reports IndONIA on the same interbank-rate URL.

// Fix:
* BI discontinued JIBOR O/N Jan 2019; all tenors Jan 2026. TE reports IndONIA O/N.
```

**Bug 3:** `src/tools/macro/sources/sovereign-scraper.ts:422`
```
// Current (WRONG):
/** @deprecated Use fetchIndoniaRateTe — JIBOR discontinued Dec 2023 */

// Fix:
/** @deprecated Use fetchIndoniaRateTe — JIBOR O/N discontinued Jan 2019, all tenors Jan 2026 */
```

**Priority:** BUG (P4) — comment only, no runtime impact. Fix in same commit as lag fix.

### 3.2 Summary of All Bugs Found

| # | File | Line | Bug | Priority |
|---|------|------|-----|---------|
| B1 | `banking-stress-engine.ts` | 47 | "JIBOR Dec 2023" → "JIBOR O/N Jan 2019, all Jan 2026" | P4/BUG |
| B2 | `sovereign-scraper.ts` | 387 | Same wrong date | P4/BUG |
| B3 | `sovereign-scraper.ts` | 422 | Same wrong date in @deprecated | P4/BUG |
| B4 | `sovereign-scraper.ts` | 408, 417 | `indonia_3m_pct` — IndONIA is O/N, not 3M | P2/BUG |
| B5 | `banking-stress-engine.ts` | 421 | reads `indonia_3m_pct` — same misnomer | P2/BUG |
| B6 | `banking-stress-engine.ts` | 506–509 | IndONIA 20% weight insufficient for standalone crisis signal | P1/ARCH |

---

## 4. Data Source Audit

### 4.1 IndONIA — Full Source Chain

| Layer | Current source | Lag | Problem | Fix |
|-------|---------------|-----|---------|-----|
| Raw data | BI publishes IndONIA 19:30 WIB daily | 0 | — | — |
| SSKI Table 13 | BI publishes monthly PDF | ~30d | Monthly aggregate only | Historical reference |
| Trading Economics | Aggregates from SSKI | ~4 weeks | Intermediary adds lag | Bypass |
| M8 DB | `indonia_3m_pct` from TE | ~4 weeks | Wrong name, lagging | Fix |

**Fix path:** Playwright scrape `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/` at 19:30 WIB. Published: daily. Precedent: BI SEKI TABEL1_1 DPK (Oct 20 session) successfully scraped. Estimated effort: 3–5 hours (test + implement). Risk: BI Cloudflare unknown.

### 4.2 M8 Data Sources — Full Audit

| Indicator | Source | Lag | Freshness target | Status |
|-----------|--------|-----|-----------------|--------|
| NPL gross | OJK SJKPublic XMLA | ~45d | Monthly | ✅ Working (P9 Oct 20) |
| LDR | OJK SJKPublic XMLA | ~45d | Monthly | ✅ Working (P9 Oct 20) |
| CAR | OJK SJKPublic XMLA | ~45d | Monthly | ✅ Working (P9 Oct 20) |
| IndONIA O/N | Trading Economics | **~4 weeks** | Should be daily | ❌ Needs fix |
| External debt | Trading Economics | ~quarterly | Quarterly | 🟡 Acceptable |
| IHPR (property) | Trading Economics | ~monthly | Monthly | 🟡 Acceptable |
| M2 money supply | Trading Economics / World Bank | ~monthly | Monthly | 🟡 Acceptable |
| Fintech NPL | OJK IKNB scrape / env pin | ~monthly | Monthly | 🟡 Acceptable |
| AT1 bonds | Env pin `HIMBARA_AT1_SECONDARY_PCT` | Manual | Manual update | 🟡 Structural |
| LPS coverage | Env pin / `fetchLpsDepositCoverage` | Manual | Quarterly | 🟡 Structural |
| SRBI outstanding | M3 DB cross-read | Daily | Daily | ✅ Working |
| OJK PDN (net open position) | `fetchOjkPdn` | Monthly | Monthly | ✅ Working |

**Single critical gap:** IndONIA lag. All other sources have acceptable lag given their nature (stock data changes monthly, not daily).

### 4.3 M10 Data Gap — TKD Not Tracked

M10 currently scrapes Trading Economics for government revenue, spending, deficit (monthly). **TKD (Transfer ke Daerah)** realisasi is NOT in M10 data flow.

**New source discovered:** DJPK SIKD portal `djpk.kemenkeu.go.id/portal/data/tkdd` — confirmed machine-readable web table with real-time TKD tracking. Not a JS-heavy SPA. Playwright accessible (needs test).

**Impact on BPD cross-flag:** Cannot implement `TKD shortfall → BPD DPK captive risk` flag in M10 without this scraper. Feature currently blocked.

**Priority:** P3 (BPD cross-flag is important but not a gap in current M8/M10 live signals).

---

## 5. New Sources Available

### 5.1 BI IndONIA Direct (Daily)

URL: `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/default.aspx`
Frequency: daily, 19:30 WIB
Precedent: BI SEKI TABEL1_1 DPK Playwright scrape (Oct 20 session) = confirmed accessible
Action: test Playwright, implement `fetchIndoniaBiDirect()` in `sources/bi-seki-money.ts`

### 5.2 DJPK SIKD TKD Realisasi

URL: `djpk.kemenkeu.go.id/portal/data/tkdd`
Frequency: near real-time (CakLur feature, updated daily)
Data: per komponen TKD (DAU, DAK, DBH, Dana Desa), pagu vs realisasi kumulatif, per provinsi
Action: Playwright test, implement `fetchTkdRealisasi()` for M10 BPD cross-flag

### 5.3 BI SSKI Tabel 13 (Historical PUAB Spread)

URL: `bi.go.id/id/statistik/ekonomi-keuangan/sski/Documents/Tabel_13.pdf`
Frequency: monthly PDF
Contains: PUAB O/N spread historical, volume, participant count
Use: calibrate IndONIA scoring thresholds; not for real-time trigger (monthly too slow)
Action: Jina Reader / PDF parse for historical baseline. Lower priority.

### 5.4 BABP Liquidity Event (Empirical Test Today)

The Nov 3 2026 BABP event provides a live test of architecture:
- Single-bank crisis active
- Basket (kbmi-contagion.ts) would have returned: basketCrashCount=1, contagionSignal=false
- OJK formal action: not yet declared (OJK "monitoring" only, not BDPI)
- M8 current output: no awareness of event at all — blank
- Desired output: "BABP.JK liquidity event — basket 1/4, below contagion threshold; OJK monitoring"

The difference between "no output" and "informative watch flag" is the kbmi-contagion.ts integration (P1).

---

## 6. Priority Matrix

### P1 — Fix Now

| Item | File | What | Effort |
|------|------|------|--------|
| P1-A | `banking-stress-engine.ts` | Integrate `kbmi-contagion.ts` — import, parallel fetch, scoring, flags | 2–3h |
| P1-B | `banking-stress-engine.ts` | Add IndONIA standalone floor (75bps→55, 96bps→70, 117bps→80) to prevent scoring dilution | 30min |

### P2 — Important Soon

| Item | File | What | Effort |
|------|------|------|--------|
| P2-A | `sovereign-scraper.ts` + `banking-stress-engine.ts` | Test BI IndONIA direct Playwright; if accessible, replace TE for daily freshness | 3–5h |
| P2-B | `sovereign-scraper.ts` + `banking-stress-engine.ts` | Rename `indonia_3m_pct` → `indonia_on_pct` (correct tenor name); DB migration | 1h |

### P3 — Long-term

| Item | File | What | Effort |
|------|------|------|--------|
| P3-A | `sources/djpk.ts` (new) | DJPK SIKD TKD scraper → M10 BPD cross-flag | 4–6h |
| P3-B | `kbmi-contagion.ts` | Replace AGRO.JK with BBHI.JK (independent, liquid, no BUMN backstop) | 1h |
| P3-C | `kbmi-contagion.ts` | Historical backtest basket vs 2020 COVID crash data | 1h |
| P3-D | `banking-stress-engine.ts` | Validate SRBI BCR threshold 1.3 against historical BCR distribution | 1h |

### BUG — Comment/Name Fixes (low urgency, bundle with P2-A/P2-B)

| Item | File | Lines | Fix |
|------|------|-------|-----|
| B1–B3 | `banking-stress-engine.ts:47`, `sovereign-scraper.ts:387,422` | "JIBOR Dec 2023" → correct dates | 5min |
| B4–B5 | `sovereign-scraper.ts:408,417`, `banking-stress-engine.ts:421` | `indonia_3m_pct` → `indonia_on_pct` | 5min |

---

## 7. Summary — What M8 Is Missing Right Now

| Gap | Severity | Can detect today? | Fix |
|-----|----------|-------------------|-----|
| PUAB 117bps ATH (Jul 2026) | Critical — ATH not detected | **No** — both lag AND scoring dilution | P1-B + P2-A |
| BABP liquidity event (Nov 3) | High — no output about event | **No** — kbmi-contagion not integrated | P1-A |
| IndONIA lag 4 weeks | High | Partially — can see old data | P2-A |
| IndONIA scoring weight too low | Critical architecture | No — fundamental scoring issue | P1-B |
| TKD→BPD cross-flag | Medium — M10 gap | No — not in M10 yet | P3-A |
| AGRO implicit backstop in basket | Low — accuracy issue | N/A | P3-B |

**The two P1 fixes are independent and can be done in either order. P1-A (integrate kbmi-contagion.ts) has zero new dependency risk. P1-B (IndONIA standalone floor) requires only editing the scoring function.**

---

*Audit completed: 3 November 2026*
*Triggered by: research session findings — PUAB ATH, BABP live event, JIBOR timeline, DJPK SIKD, IndONIA daily*
*Next step: implement P1-A and P1-B, then P2-A (BI direct scrape test)*
