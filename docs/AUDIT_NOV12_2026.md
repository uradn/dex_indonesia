# Dexter Indonesia — Sprint & Data Quality Audit
**12 November 2026 | Victor @ Sadasa Intelligence**

> Scope: Sprint 4 (Wash Trade Screener) + Sprint 5A (Institutional Foreign Tracker) + cross-module evaluation + data quality audit.
> Trigger: Sprint completion review + user-requested comprehensive check for slop, hallucinations, data gaps, end-to-end issues.

---

## Sprint 4 — Wash Trade Screener (`/ownership` Tab 7)

**Completed:** `606528a` feat(ownership): Sprint 4

### What was built
- **Velocity Flippers**: investors NEW in month T, EXITED by T+1 (one monthly KSEI cycle). FIRST_MONTH guard (`2026-02-27`) excludes initialization artifacts.
- **Entity Groups**: normalizeGroupKey strips legal suffixes + jurisdictions, first 24 chars prefix → groups cross-emiten concentrations (23 groups found: DJS, CGS, Fidelity, PEMDA families, etc.)
- **Wash Score**: `churn_rate×0.4 + flip_score×0.4 + coord_score×0.2`, each 0–100. Top scores: PPGL 74.
- **API routes**: `/api/ownership/wash-screener`, `/api/ownership/flippers`, `/api/ownership/entity-groups`

### Key findings (Nov 2026 data)
- 113 velocity flippers across Feb–Oct 2026 window (excluding first-month artifacts)
- 23 entity groups with cross-emiten footprint
- CUSTODIAN_TYPES (`['SE','BR','IB']`) excluded from suspicious actor analysis — these are market infrastructure, not speculative
- Wash trade flag in Bloomberg story ("Wash Trades and 5,000% Gains") independently confirms the PPGL signal

---

## Sprint 5A — Institutional Foreign Tracker (`/ownership` Tab 8)

**Completed:** `35b4eea` feat(ownership) + `b1a7c6b` feat(integration)

### What was built
- **18 tracked institutions**: 1 SWF (GIC) + 10 AMs (Vanguard, Fidelity, Franklin, Aberdeen, Lazard, Wellington, Invesco, Maybank AM, CIMB, Allianz) + 7 custodians (Pictet, JPMCB, UBS, HSBC, SCB, CGS, Phillip)
- **Known vs Dark split**: dark_ratio = % of total foreign holdings by anonymous investors (structural 94.8–95.0%). Dark rising = quality degradation.
- **Priority-order keyword match**: AM keywords checked before CUSTODIAN (prevents "JPMCB NA RE - VANGUARD…" matching JPMCB instead of VANGUARD)
- **`getInstitutionalFlowSignal()`**: dark_score (60% max) + am_score (25% max) + swf_score (15% max) → composite quality signal
- **API routes**: `/api/ownership/institutions`, `/api/ownership/institution-timeline`, `/api/ownership/institution-holdings`, `/api/ownership/known-vs-dark`, `/api/ownership/institutional-flow-signal`

### Key findings (Nov 2026 data)
- **GIC holds MTEL 5.32%** — MTEL is in the MSCI Nov 30 forced-sell list; GIC staying = separating equilibrium signal (strategic, not ETF-mandated)
- **Fidelity net +2.2% MoM** — accumulating during stress, not exiting
- **Dark ratio 94.8→95.0%** — slowly rising; marginal quality degradation
- **JPMCB/HSBC custodian reductions** — consistent with passive ETF redemption mechanics, not fundamental reassessment

---

## Cross-Module Evaluation

### M1–M13 Impact Assessment

| Module | Impact | Mechanism |
|--------|--------|-----------|
| M5 Foreign Flow | **DIRECT** | `getInstitutionalFlowSignal()` as supplementary quality overlay — dark ratio, AM direction, SWF direction shown in morning-check footnote. NOT in SCD weights yet. |
| M9 Market Stress | **MODERATE** | Separating equilibrium between strategic holders (floor-forming) vs mandated sellers (price-inelastic) informs cascade floor estimate timing |
| M2 Sovereign Risk | **INDIRECT** | If all strategic AMs exit simultaneously, that's pre-crisis signal. Currently holding → no negative signal |
| M7 ASEAN RV | **INDIRECT** | GIC/Temasek presence across ASEAN markets; Indonesia discount vs EM peers partly explained by MSCI mechanics, not fundamental |
| M1–M4, M6, M8, M10–M13 | **NONE DIRECT** | No path from KSEI ownership to these modules currently |

### Game Theory Impact
Bryant (1980) common-knowledge game: KSEI makes institution-level coordination *observable*. When GIC holds MTEL and Fidelity accumulates, that is public common knowledge — other participants can see these holdings. This breaks the pure coordination equilibrium and introduces a **separating equilibrium**: strategic holders signal conviction publicly, which should raise the floor for mandated sellers' price impact.

Documented in `docs/MACRO.md` M5 section and `SOUL.md` "How Structural Stress Reaches Price."

### Dashboard Alignment

| Dashboard | Update | Status |
|-----------|--------|--------|
| `/ownership` | 8 tabs including Wash Screener + Institutions | ✅ done |
| `/bs` Big Short | "Institutional Positioning Intel" panel (right column) — dark ratio, AM/SWF directions, known/dark split, institution detail | ✅ done |
| `/rr` R&R | No change needed — institutional flow not part of G-G / R&R framework | ✅ no-op |
| Morning check | KSEI footnote after M5: `AM {direction} | SWF {direction} | dark {ratio}%` | ✅ done |

### Documentation Updates
| File | Update | Status |
|------|--------|--------|
| `docs/MACRO.md` M5 | Full KSEI supplementary paragraph — 18 institutions, dark ratio, GIC/MTEL separating equilibrium, NOT in SCD weights | ✅ done |
| `README.md` | `/ownership` row updated to "8 tabs"; sync-ksei commands listed | ✅ done |
| `SOUL.md` | KSEI separating equilibrium paragraph added to "How Structural Stress Reaches Price" section | ✅ done (this session) |

---

## Data Quality Audit — Bugs Found & Fixed

**4 bugs fixed**, `6d457b5` fix(data): CPO outlier guard + IHSG float display + B50 unit consistency

### Bug 1: CPO false RED signal (critical)
**What**: `worldbank_pinksheet_exa` wrote `cpo_price_myr = 436 USD/MT` on 2026-11-01 (bad Exa parse). Real price ~$1,120/MT (Oct data). Generated z-score = −7.1, false RED in M4 Commodity engine.

**Root cause**: `fetchCpo()` in `scripts/refresh-monthly-data.ts` validated `val >= 400` (historical floor), but 436 passes that check. World Bank Pink Sheet Nov 2026 value not yet released — Exa hallucinated from some other figure in search results.

**Fix**:
1. Deleted bad DB record (`DELETE FROM macro_series WHERE indicator='cpo_price_myr' AND date='2026-11-01' AND source='worldbank_pinksheet_exa'`)
2. Added outlier guard: reject if `val < avgRecent * 0.5` (>50% drop from 6-month rolling average)

**Impact**: M4 score corrected. CPO now shows Oct 2026 value ($1,120/MT, z ≈ −0.5 neutral).

### Bug 2: IHSG float display formatting
**What**: Yahoo Finance returns `ihsg_level = 5250.895` (float). `.toLocaleString()` without locale → "5.250,895" (locale-dependent garbage — Indonesian locale: dot=thousands, comma=decimal).

**Locations**: `market-stress-engine.ts` (stop-loss cascade table, floor flag) + `scripts/morning-check.ts`

**Fix**: `Math.round(priceLevel).toLocaleString('en')` — round to integer before formatting, explicit English locale.

### Bug 3: B50 unit mixing
**What**: Flag said `"CPO feedstock demand ~18M mt vs capacity 19.6M kL"` — mixed metric tons (feedstock) and kiloliters (biodiesel output). Incompatible units confusing.

**Fix**: `"quota 19.6M kL biodiesel (~17.8M MT CPO feedstock)"` — explicit labels + correct conversion direction.

### Bug 4 (not a code bug): bank_pdnl_pct 60d stale
**What**: OJK PDN (bank FX position) last updated Sep 13, 2026. Now 60d old (threshold: 35d fresh, 55d yellow). Health check shows YELLOW.

**Root cause**: OJK SPI website blocks direct scrape (WAF). Exa/Tavily auto-fetch runs but can't find Oct 2026 media report on PDN figure yet.

**Fix**: None available without manual intervention. Operational gap, not code bug. Add env override `BANK_PDN_PCT` if needed (mirrors DNDF pattern). Current 1.77% is structurally low-stress so YELLOW freshness doesn't distort M8 score meaningfully.

---

## Non-Bugs Confirmed

### Food CPI 1.54% vs Food Stress 100/100
**Not a contradiction.** Two different metrics:
- Food CPI 1.54% YoY = BPS national food basket aggregate (base effects from prior year's high prices make YoY appear low)
- Food Stress 100/100 = PIHPS individual commodity z-scores vs 90d rolling history

PIHPS Nov 12 data: cabai merah kriting Rp99,200/kg (+18% from Nov 11), cabai rawit Rp103,500/kg. These are crisis-level prices (normal: Rp30,000–60,000). z-scores >>2.5 on multiple items → 100/100 score correct.

The discrepancy is real: headline CPI understates actual market stress because (1) cabai weight in national basket is small and (2) base effects hide absolute price levels. This is by design — the PIHPS signal captures what CPI misses.

### Coal ETF $16.91 (BTU)
BTU (Peabody Energy) is a valid proxy for coal. KOL (VanEck Vectors Coal ETF) was delisted. $16.91 is in normal operating range for Peabody stock. No issue.

---

## Health Check Baseline (Nov 12 2026)
```
56 fresh | 0 aging | 1 stale (bank_pdnl_pct 60d) | 0 critical
```

---

## Open Items (Not Fixed — Deferred)

1. **`bank_pdnl_pct` env override**: Consider adding `BANK_PDN_PCT` to `.env` and health-check if Exa continues to fail to find Oct 2026 data
2. **USDIDR float display**: Similar issue to IHSG — Yahoo returns `18058.30078125`. `.toLocaleString()` → "18,058.301". Less critical than IHSG case (semantics clear) but cosmetically imperfect across ~8 flag locations in `fx-defense-engine.ts`, `narrative-divergence-engine.ts`, `minsky-stress-index.ts`
3. **CPO Pink Sheet XLSX refresh**: Now that bad Nov record is deleted, CPO will show Oct 2026 ($1,120/MT). The XLSX fetcher (`fetchCpoPriceWorldBank` in `worldbank.ts`) should pick up Nov data once World Bank publishes it (~2nd week of Dec). The Exa path remains fallback; outlier guard now prevents hallucinated values from overwriting valid data.
