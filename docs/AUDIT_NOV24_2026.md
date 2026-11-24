# Dexter Indonesia — Session Audit
**24 November 2026 | ~20:00 WIB onward | Victor @ Sadasa Intelligence**

> **Scope:** APBN Lapsem Jun 2026 architecture audit + Haye Oil Framework comprehensive review + system-wide propagation across all modules, dashboard, and panels.
> **Trigger:** User-requested deep review of Haye panel accuracy → cascaded into full structural audit of APBN assumption layer used throughout the codebase.

---

## Trigger & Discovery Chain

**Entry point:** User noted USDIDR Rp18,260 "ATH vs APBN Rp16,500" label and Pertamina Rp14T "kerugian" — requested deep verification.

**Key findings from initial research:**
1. **USDIDR ATH confirmed**: Rp18,321 intraday (Nov 20), not 18,260. Nov 24 current = Rp18,131 (recovery). ATH framing correct.
2. **Pertamina Rp14T**: NOT net accounting loss — "potensi penurunan pendapatan" (revenue opportunity loss). Direktur Transformasi Agung Wicaksono, CSF Forum Bappenas 23 Nov 2026.
3. **CRITICAL: Lapsem Jun 2026 revision not reflected in codebase.** APBN UU No.17/2025 (legal: kurs Rp16,500 / ICP $70) was revised via Laporan Semester I Jun 2026 to operational anchor kurs Rp17,500 / ICP $83 / Subsidi+Kompensasi energi Rp338T→Rp500T. No APBN-P (formal UU revision) — Lapsem is mid-year report to DPR, not new legislation. Codebase had only the UU layer.

**Quote (verbatim, Plt. DJA Hidayat Amir, APBN KiTa Nov 14 2026):**
> *"Yang menonjol adalah nilai tukar waktu itu. Dari Rp 16.500 menjadi Rp 17.500 dan juga harga minyak mentah dunia, dari US$ 70 per barel menjadi US$ 83 per barel."*

---

## 3-Layer APBN Architecture (Established This Session)

| Layer | Kurs (IDR/USD) | ICP (USD/bbl) | Subsidi+Komp Energi | Status |
|---|---|---|---|---|
| **UU No.17/2025** (legal benchmark) | 16,500 | $70 | Rp338T | Disahkan DPR 22 Okt 2025 |
| **Lapsem Jun 2026** (operational benchmark) | 17,500 | $83 | Rp500T | Revisi via Laporan Semester I; disampaikan ke DPR Jun 2026; bukan UU baru |
| **Realisasi YTD Nov 2026** | 17,529 avg / 18,154 EOP 12 Nov | $94.4 avg Oct (ICP Oct $117.24) | Rp415.8T (83.2% of Rp500T) | APBN KiTa Nov 13-14 2026 |

**Design decision — M6 exception:** `narrative-divergence-engine.ts` INTENTIONALLY keeps UU $70/$16,500 as reference. M6 measures gap between what government PROMISED (UU legislative commitment) and market reality. Lapsem = operational acknowledgment, not revised commitment. All other engines use Lapsem Rp17,500/$83 as operational baseline.

---

## Morning Check Comparison

| Metric | Before fixes (~20:00 WIB) | After all fixes |
|--------|--------------------------|-----------------|
| **SCD** | 63% 🟠 ORANGE | 65% 🟠 ORANGE (+2pp) |
| Cross-confirmed | 5/13 | 5/13 |
| M6 narrative | 48/100 | 47/100 (CV% slight drop from L2=$83) |
| M10 fiscal | 100/100 | 100/100 (subsidi flag: "102% of Rp447T" → "91% of Rp500T") |
| M12 political risk | 88/100 | 91/100 (live news fetch — new unrest signal) |
| M4 commodity | 78/100 | 79/100 (Brent $88.3→$87.2 intraday) |
| USDIDR | 18,131 | 18,131 |
| CDS 5Y | 99.6 bps | 99.6 bps |
| SBN 10Y | 7.712% | 7.712% |
| Brent | $88.3/bbl | $87.2/bbl |

**SCD +2pp delta** driven by M12 polrisk +3pp (new unrest headlines in second fetch), not by any fix. Fixes were structurally correct — no score gaming, only accuracy.

---

## Commits This Session (Chronological)

### `b5d45a8` — fix(apbn): add Lapsem Jun 2026 revision layer (kurs Rp17,500 / ICP $83)
**11 files changed**

| File | Change | Type |
|------|--------|------|
| `uln-engine.ts` | `GDP_USD_BN_AT_16500` → `GDP_USD_BN_AT_LAPSEM` (17,500 basis) | **Scoring fix** |
| `fx-defense-engine.ts` | Table label "APBN anchor" → "Lapsem anchor: 17,500; UU orig: 16,500" | Display |
| `macro-threshold-monitor.ts` | Added `LAPSEM_OIL = 83`; shows both UU and Lapsem deviations | Display + accuracy |
| `narrative-divergence-engine.ts` | Footnote expanded — M6 intentionally keeps UU values; Lapsem note added | Comment |
| `minsky-engine.ts` | Note added re: Lapsem operational baseline | Comment |
| `sources/pertamina.ts` | `APBN_ICP_ASSUMPTION = 70` comment: UU legal, Lapsem = $83 | Comment |
| `sources/dndf.ts` | Fallback conversion 16,500 → 17,500 (actual calc change) | **Scoring fix** |
| `sources/subsidi.ts` | Comment updated | Comment |
| `sources/neraca-pembayaran.ts` | Comment updated | Comment |
| `CLAUDE.md` | 3-layer table + verbatim Hidayat Amir quote + BI Rate 6.00% | Docs |
| `README.md` | 3-layer table, 8-event timeline, fiscal gap calc, source links | Docs |

**Scoring impact of ULN engine fix:**
- Before: `GDP_USD_BN = Rp25,714T / 16,500 = $1,558bn` → ULN/GDP = 458.9/1558 = **29.5%**
- After: `GDP_USD_BN = Rp25,714T / 17,500 = $1,470bn` → ULN/GDP = 458.9/1470 = **31.2%** (+1.7pp)
- ULN engine still GREEN (threshold 35%) but more accurate stress level

---

### `539bdb2` — fix(lapsem): dashboard + engines 3-layer fixes
**4 files changed**

| File | Change | Type |
|------|--------|------|
| `scripts/dashboard.ts` | `apbnRate` for R&R PPP calc: 16,500 → 17,500; label "vs APBN UU 16,500"; thesis shows both UU+Lapsem gaps | Display + accuracy |
| `domestic-pressure-engine.ts` | Fallback USDIDR: 16,500 → 17,500 | **Scoring fix** (cost recovery when live data unavailable) |
| `political-risk-engine.ts` | Clarify game theory thresholds are POLITICAL ($90/$100 Bahlil) not APBN $70 — logic was always correct | Comment |
| `docs/MACRO.md` | 3-layer table; BI Rate 5.75%→6.00% (RDG Nov 17-18); term premium 1.21%→1.71% (SBN 7.712%−6.00%) | Docs |

**Dashboard design decision:** `usdidrVsApbn` base at line 286 INTENTIONALLY kept at 16,500 (narrative/divergence signal purposes). `apbnRate` for R&R PPP calculation updated to 17,500 (operational stress context). Two values, two purposes.

---

### `4721c00` — fix(haye): comprehensive Haye panel refresh
**1 file changed: `scripts/dashboard.ts`**

| Section | Before | After |
|---------|--------|-------|
| L2 belief stack | $80 "Stale Analyst Consensus" | $83 "Lapsem ICP Anchor (Jun 2026 revised)" |
| BPS data | H1 Jan-Jun 2026 (source: BPS Agu 2026) — $22.0B | Jan-Sep 2026 (source: BPS Nov 2 2026) — $32.57B (+37.35% YoY) |
| Q3 detail | — | Sep $3.27B (+23.94% YoY) · Aug $3.53B (+30.73%) · Q3 $10.57B |
| Migas deficit | — | $23.60B Jan-Sep (BoP drain) |
| Full-year annualized | $44B (H1×2) | ~$43.4B (Jan-Sep×12/9, Q4 relief factor) |
| ICP section | — (missing) | **NEW**: Sep $112.81 · Oct $117.24 ← PEAK (Kepmen ESDM No.416.K/MG.03/MEM.M/2026) · Nov proj $103-109 |
| Subsidi pagu | Rp447.5T, Sem I Rp233T (52.1%) | Rp500T (Lapsem), YTD Oct Rp415.8T (83.2%) |
| usdIdr fallback | 17,635 | 17,500 (Lapsem) |

**BPS data verified (Bisnis.com + BPS official, Nov 2 2026):**
- Jan-Sep 2026 migas: $32.57B (+37.35% YoY from $23.71B)
- Migas deficit Jan-Sep: $23.60B
- Note: H1 crude composition 73.4% (inverted from 2025 28%) — Indonesia buying crude directly (G2G Russia, Saudi)

**ICP Oct 2026 verified (Kepmen ESDM No.416.K):**
- ICP Oct 2026: $117.24/bbl (Dated Brent $124.77/bbl)
- ICP Sep 2026: $112.81/bbl
- Nov 2026 projection: $103.94–108.94/bbl (ESDM Nov 11 press release)

---

### `38b70b9` — fix(lapsem): propagate L2=$83 + pagu Rp500T to M6/M10/subsidi engines
**3 files changed**

| File | Change | Scoring impact |
|------|--------|----------------|
| `narrative-divergence-engine.ts` | `l2 = 80` → `83`; officialClaim: "analyst consensus $80" → "Lapsem $83 operational anchor"; marketSignal: new revelation risk = Lapsem $83 itself $34 below ICP Oct $117 | CV% 16.3% → 15.8% (-0.5pp, still HIGH >15%) |
| `fiscal-engine.ts` | `subsidiKompenasasiCombinedTrn: 447.0` → `500.0` | M10 flag: "102% of Rp447T" → "91% of Rp500T"; M10 score 100 unchanged (deficit % GDP driver, not combined pagu) |
| `sources/subsidi.ts` | Comment: pagu 447T → 500T, % 93% → 83.2% | None (comment only) |

---

### `ff5ba49` — fix(lapsem): L2=$80→$83 in /bs divergence scanner belief stack chip
**1 file changed: `scripts/dashboard.ts`**

Found SECOND independent belief stack computation at line 3147:
```
const vals = [70, 80, L3, L4]  // /bs divergence scanner Morris-Shin chip
```
Updated to `[70, 83, L3, L4]`. Display label chip: `L2=$80` → `L2=$83`.

This was separate from both the Haye panel belief stack AND the M6 engine — all three were inconsistent. Now all three aligned at L2=$83.

---

## Cross-Module Evaluation

| Module | Impact | Mechanism |
|--------|--------|-----------|
| **M13 ULN** | **SCORING FIX** | GDP USD denominator 16,500→17,500; ULN/GDP 29.5%→31.2% (+1.7pp); still GREEN but more accurate |
| **M11 Domestic Pressure** | **SCORING FIX** (edge case) | USDIDR fallback 16,500→17,500 for cost recovery when live data unavailable |
| **M6 Narrative Divergence** | **STRUCTURAL FIX** | l2=$83 matches operational anchor; new revelation risk framing (Lapsem $83 itself $34 below ICP Oct $117); M6 exception preserved (l1=$70 UU) |
| **M10 Fiscal** | **ACCURACY FIX** | Pagu 447→500T; flag description corrected (91% not 102%); M10 100/100 score unchanged |
| **M3 FX Defense** | Display | Table label updated to show both Lapsem and UU anchors |
| **M4 Commodity** | Display | Threshold monitor now shows both UU $70 and Lapsem $83 deviations |
| **Dashboard `/bs`** | Multiple | apbnRate R&R PPP: 16500→17500; belief stack chip L2: $80→$83; Haye panel full refresh |
| **M1 BoP** | None — engine fetches from DB | No hardcoded BPS migas figures in bop-engine.ts |
| **M5, M7, M8, M9, M12** | None | No APBN assumption references in these engines |

---

## CV% (Morris-Shin) Impact

**L2 change $80→$83 effect on belief stack dispersion:**

| | Before (L2=$80) | After (L2=$83) |
|--|--|--|
| Levels | [70, 80, 88.3, 108.3] | [70, 83, 88.3, 108.3] |
| Mean | $86.65 | $87.33 |
| σ | $14.08 | $13.78 |
| CV% | **16.3%** | **15.8%** |
| Regime | HIGH >15% | HIGH >15% ✓ |

Slight dispersion decrease is analytically correct: government acknowledging Lapsem $83 (closer to market $88) reduces belief gap. But CV stays HIGH because:
1. L4 delivered cost ~$107 still far above L2
2. ICP Oct actual $117.24 creates new revelation risk layer
3. The "sudden revelation" risk shifted: not "government denying $80+" but "Lapsem $83 itself usang vs Oct $117"

**All three CV% computations now consistent:**
- Haye panel `renderHaye()`: `[L1=70, L2=83, L3, L4]` ✓
- M6 `narrative-divergence-engine.ts`: `l2=83` ✓
- `/bs` divergence scanner chip: `[70, 83, L3, L4]` ✓

---

## Data Quality Audit

### Stale data updated this session

| Indicator | Before | After |
|-----------|--------|-------|
| BPS Impor Migas (Haye panel) | H1 2026 $22.0B (BPS Agu 2026) | Jan-Sep 2026 $32.57B (BPS Nov 2 2026) |
| Subsidi realisasi (Haye panel) | Sem I Rp233T (52.1% pagu Rp447T) | YTD Oct Rp415.8T (83.2% pagu Rp500T) |
| ICP (Haye panel) | — (missing) | Sep $112.81, Oct $117.24, Nov proj $103-109 |
| L2 belief anchor | $80 "analyst consensus" (stale since Lapsem Jun 2026) | $83 Lapsem operational |

### Persistent data gaps (not fixed this session)

| Gap | Status | Workaround |
|-----|--------|------------|
| `bank_pdnl_pct` stale (OJK WAF blocks scrape) | YELLOW freshness | `BANK_PDN_PCT` env override |
| BPS Oct 2026 migas (released ~Dec 1) | Not yet available | Panel shows Jan-Sep with annualized note |
| ICP Nov 2026 official (released ~Dec 11) | Not yet available | Panel shows Nov proj $103-109 (ESDM estimate) |

---

## Non-Bugs Confirmed

### Game theory thresholds correct
`polEconHoldEV` in `political-risk-engine.ts` uses $90/$100 (Bahlil public commitment threshold), NOT APBN $70. These are POLITICAL price thresholds, not fiscal. Only the comment was misleading — logic was always correct.

### M6 divergence UU reference intentional
`APBN_ASSUMPTIONS.oilPrice = 70` and `usdIdr = 16_500` in `narrative-divergence-engine.ts` INTENTIONALLY kept. M6 measures rhetoric gap vs ORIGINAL legislative commitment (UU). Lapsem is an acknowledgment that reduces the gap — if we used $83 as reference, we'd understate the government's credibility deficit vs original promise.

### Dashboard `usdidrVsApbn` base = 16,500 intentional
Used for narrative divergence signal in `/bs` thesis panel. Distinct from `apbnRate = 17,500` used for R&R PPP operational stress calculation. Two values, two purposes — not a bug.

### M10 100/100 score unchanged after pagu fix
`subsidiKompenasasiCombinedTrn: 447.0 → 500.0` changes denominator for the combined pagu flag. The M10 100/100 score is driven by: deficit 4.23% GDP (>3% constitutional limit), interest/revenue 20.6% (>15% S&P threshold), Calvo r-g +2.24pp, Minsky speculative×3. The combined pagu flag is informational only — no score contribution.

### ULN still GREEN after scoring fix
ULN/GDP 29.5%→31.2% — 4pp below GREEN/YELLOW threshold (35%). Score stays at 5/100 GREEN. The fix is accuracy, not crisis detection change.

---

## Morning Check #2 (Post-Fix) — Nov 24 2026

```
SCD: 65% 🟠 ORANGE | Cross-confirmed: 5/13 | Thesis #15 hari ke-9 TRIGGERED
IHSG: 5,242 | A/D: 2.14 🟢 | CDS: 99.6bps | SBN: 7.712% | USDIDR: 18,131
Brent: $87.2 | Reserves: $146.8bn (eff $138.8bn)

RED:    M10 fiscal 100 · M12 polrisk 91 · M4 cmdy 79 · M11 dom 77
ORANGE: M3 FX 57 (ATTACK ZONE)
YELLOW: M8 bank 43 · M6 narr 47 · M2 sov 34
GREEN:  M9 market 0 (CASCADE CLEAR) · M5 flow 28 · M1 BoP 25 · M13 ULN 5

Key fix impacts visible:
- M10: "91% of Rp500T" (was "102% of Rp447T") — correct Lapsem pagu
- M6: CV% 15.8% (was 16.3%) — Lapsem $83 closer to market
- ULN: 31.2% (was 29.5%) — Lapsem GDP denominator
```

---

## README Baseline Updated

**`e76b1fd`** — Nov 24 2026 baseline recorded:
- SCD 63% ORANGE (first check) → 65% ORANGE (post-fix check)
- Live deviations section: CDS 99.6bps, BPS $88.3→$87.2, IHSG 5,242 A/D 2.14
- Subsidi: Brent $88.3 gap Rp6,676/L Pertalite · Rp13,347/L Solar B50

---

## Git Summary

| Commit | Scope | Type |
|--------|-------|------|
| `b5d45a8` | APBN Lapsem 3-layer: 11 files | Scoring fix + docs |
| `539bdb2` | Dashboard + engines Lapsem: 4 files | Scoring fix + display |
| `4721c00` | Haye panel refresh: 1 file | Data refresh + accuracy |
| `38b70b9` | M6+M10+subsidi propagation: 3 files | Scoring fix + accuracy |
| `ff5ba49` | /bs scanner L2 chip: 1 file | Display fix |

**Total: 5 commits · 20 files changed**

Typecheck (`tsc --noEmit`) passed clean after each batch. No test regressions.
