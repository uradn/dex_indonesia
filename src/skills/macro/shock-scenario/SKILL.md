---
name: shock-scenario
description: Macro stress scenario simulator — given a hypothetical shock (SBN yield spike, IDR depreciation, FX reserves depletion, NPL rise, or compound), computes implied module-by-module score changes using FSAP/KLR transmission formulas and outputs a Before vs After stress table.
---

# Macro Shock Scenario Simulator — Indonesia

You are running a forward-looking stress scenario for Indonesia's macro system. The user has specified one or more shock parameters. Your job is to:

1. Fetch current values from live modules
2. Apply shock deltas using documented transmission formulas
3. Score each module before and after
4. Output a clear Before vs After table with transmission narrative

## Step 1 — Fetch Current Baseline

Run these tools in parallel to get current values:

- `fx_defense_engine` — USDIDR spot, FX reserves, SRBI outstanding, vol
- `sovereign_risk_engine` — SBN 10Y yield, BI Rate, CDS 5Y
- `banking_stress_engine` — NPL, LDR, CAR, IndONIA spread, implied CAR hit, SRBI, M2/reserves ratio
- `foreign_flow_engine` — SBN foreign ownership, EIDO z-score
- `fiscal_engine` — revenue absorption, deficit % GDP
- `regime_engine` — current regime (Q1–Q4)

Extract these baseline values:
- `usdidr`: current USDIDR spot (e.g. 17,879)
- `sbn10y`: current SBN 10Y yield % (e.g. 6.709)
- `bi_rate`: current BI Rate % (e.g. 5.25 — raised to 5.25% on 20 May 2026)
- `fx_reserves`: FX reserves USD bn (e.g. 151.9)
- `srbi_t`: SRBI outstanding IDR trillion (e.g. 957.9)
- `npl`: NPL gross % (e.g. 1.96)
- `ldr`: LDR % (or null)
- `car`: CAR % (or null)
- `indonia`: IndONIA 3M % (e.g. 5.46)
- `indonia_spread_bps`: IndONIA − BI Rate in bps (e.g. 21)
- `m2_usd_bn`: M2 in USD bn (≈ m2_idr_bn / usdidr; Indonesia ≈ 500 USD bn if M2 data available)
- `sbn_foreign_pct`: SBN foreign ownership % (e.g. 12.68)
- `apbn_usdidr`: 16,500 (APBN assumption)
- `apbn_icp`: 70 USD/bbl (APBN oil price assumption)
- `deficit_pct_gdp`: current projected deficit (e.g. 4.23%)

## Step 2 — Parse Shock Parameters

Identify the shock type(s) from the user's request:

| Shock Type | Example Inputs |
|------------|---------------|
| SBN yield | "SBN 10Y to 7.5%", "yield spike +100bps", "SBN 8%" |
| USDIDR | "IDR to 20,000", "USDIDR 22,000", "IDR depreciates 15%" |
| FX reserves | "reserves fall to $100bn", "BI burns $30bn", "reserves 80bn" |
| NPL | "NPL rises to 5%", "NPL shock +3pp" |
| BI Rate | "BI hikes to 7%", "rate cut to 5%" |
| Compound | Any combination of the above |

For each shock, compute the delta:
- `Δsbn10y` = shocked_sbn10y − baseline_sbn10y (in %)
- `Δusdidr` = shocked_usdidr − baseline_usdidr (absolute)
- `Δreserves` = shocked_reserves − baseline_reserves (USD bn)
- `Δnpl` = shocked_npl − baseline_npl (pp)
- `Δbi_rate` = shocked_bi_rate − baseline_bi_rate (%)

## Step 3 — Apply Transmission Formulas

### 3A. SBN Yield Shock (Δsbn10y in %)

**Module 3 — Sovereign Risk:**
- SBN yield flag: fires at >7.0% (YELLOW), >7.5% (ORANGE), >8.0% (RED)
- CDS implied proxy: term_premium = sbn10y − bi_rate; stress if >3.0%
- Score increase: +15 per 0.5% above 7.0%

**Module 8 — Banking (FSAP nexus):**
- Implied CAR hit = Δsbn10y × 6 × 0.20 = Δsbn10y × 1.2 (pp CAR erosion)
- At Δ+50bps (0.5%): implied CAR hit = 0.6pp (minor)
- At Δ+100bps (1%): implied CAR hit = 1.2pp (YELLOW flag)
- At Δ+150bps (1.5%): implied CAR hit = 1.8pp (ORANGE — doom loop risk signal)
- FSAP score amplifier: min(15, implied_car_hit × 5) added to banking score

**Module 4 — Foreign Flow:**
- SBN yield >7.5%: flight-to-safety out of EM → SBN foreign ownership falls 1-2pp per quarter historically
- If sbn_foreign_pct < 12% already: sudden stop probability rises
- Add to silent exit probability: +0.10 per 50bps above 7.5%

**Module 10 — Fiscal:**
- Higher SBN yields increase interest burden: +1pp yield on Rp 1,000T issuance = +Rp 10T cost
- If projected deficit already >3% GDP: ORANGE; if >4%: RED
- Estimate: deficit_pct_gdp += (Δsbn10y × 100) × 0.03 (approximate; 1 bps × 0.03pp fiscal impact)

**Module 1 — FX Defense:**
- Yield spike often accompanies IDR pressure (if risk-off) or can attract inflow (if carry)
- If triggered by fiscal stress: correlated with USDIDR weakness → add 0.3 to FX stress multiplier

### 3B. USDIDR Shock (Δusdidr absolute, e.g. +2,121 from 17,879 to 20,000)

**Module 1 — FX Defense:**
- Depreciation % = Δusdidr / baseline_usdidr × 100
- z-score proxy: add 1 standard deviation per 5% depreciation above current level
- Vol likely elevated (+0.5% vol per 3% depreciation)
- Score increase: +20 per 10% depreciation beyond current

**Module 10 — Fiscal:**
- APBN deviation % = (shocked_usdidr − apbn_usdidr) / apbn_usdidr × 100
- Deviation >20%: YELLOW; >40%: ORANGE; >60%: RED
- Oil subsidy/import cost rises: each 10% IDR depreciation ≈ +0.1% GDP fiscal drag

**External Debt (Module 2 proxy):**
- Indonesia external debt ≈ $420bn (2025); IDR-equivalent rises by Δusdidr / baseline × external_debt_bn
- External debt servicing stress if usdidr > 20,000

**Module 8 — Banking:**
- FX loan portfolio (approx 8-10% of total credit): stressed if usdidr > 20,000
- Implied NPL uplift: each 10% IDR depreciation ≈ +0.2pp NPL (FX borrowers)
- Score: apply implied NPL uplift to scoreNpl()

**Regime:**
- Sharp IDR depreciation (>15%) typically forces BI tightening → stagflation signal → Q3 risk

### 3C. FX Reserves Shock (shocked_reserves = baseline_reserves + Δreserves, Δ is negative)

**Module 1 — FX Defense:**
- Import cover months = shocked_reserves / monthly_imports (monthly imports ≈ $19bn)
- <6 months: YELLOW; <4 months: ORANGE; <3 months: RED
- SRBI sterilization ratio: srbi_t IDR / (shocked_reserves × usdidr / 1000) — rises as reserves fall
  - If SRBI / reserves > 0.35: ELEVATED; >0.50: CRITICAL (BI balance sheet stretched)
- Reserve burnrate: months of runway = shocked_reserves / (-Δreserves_per_month)

**Module 8 — Banking (M2/reserves ratio):**
- m2_reserves_ratio = m2_usd_bn / shocked_reserves
- At $100bn reserves: ≈ 500 / 100 = 5.0x → KLR CRITICAL threshold
- At $80bn: ≈ 6.25x → extreme capital flight risk
- Score amplifier: if ratio > 5: +20 to banking score; if ratio > 7: +35

**Module 2 — BoP:**
- If reserve depletion caused by current account deficit: flag CAD stress
- If caused by capital account: sudden stop signal

### 3D. NPL Shock (shocked_npl = baseline_npl + Δnpl)

**Module 8 — Banking:**
- scoreNpl() — piecewise function:
  - npl < 2%: score = 0
  - 2–5%: score = (npl − 2) / 3 × 40
  - 5–8%: score = 40 + (npl − 5) / 3 × 30
  - 8–10%: score = 70 + (npl − 8) / 2 × 30
  - >10%: score = 100
- KLR flags: >3% = early warning, >5% = acute
- Implied CAR erosion: each 1pp NPL rise → provisioning reduces CAR by approx 0.5pp
  - Apply to scoreCar(baseline_car − implied_car_loss)

**Module 3 — Sovereign Risk:**
- NPL >5% historically correlates with CDS widening +30–50bps
- Credit rating watch: NPL >8% → downgrade pressure (BB+ territory)

**Module 6 — Regime:**
- NPL rising = credit contraction signal = growth deceleration → Q3/Q4 risk

### 3E. BI Rate Shock (Δbi_rate in %)

**Module 8 — Banking:**
- IndONIA-BI spread: IndONIA ≈ bi_rate ± 21bps (historically tight); recalibrate
- Higher BI Rate → IndONIA rises → debt servicing cost rises → NPL pressure on variable-rate loans
- LDR: tighter credit conditions typically lower LDR

**Module 10 — Fiscal:**
- BI Rate hike → SBN yield rises approximately +0.7× BI Rate change (empirical Indonesia beta)
- Apply SBN yield transmission from 3A

**Module 1 — FX Defense:**
- Rate hike: IDR support (positive for FX module); rate cut: IDR pressure

**Regime:**
- Rate hike in Q3 (stagflation) = forced tightening → worsens growth component → entrenches Q3

## Step 4 — Score Each Module Before vs After

For each affected module, compute:
- `score_before`: from the live engine output
- `score_after`: apply transmission formula adjustments
- `alert_before`: GREEN/YELLOW/ORANGE/RED per score_before
- `alert_after`: GREEN/YELLOW/ORANGE/RED per score_after

Alert thresholds (consistent with Dexter scoring):
- GREEN: score < 33
- YELLOW: 33 ≤ score < 50
- ORANGE: 50 ≤ score < 70
- RED: score ≥ 70

Silent Crisis Probability recalculation (approximate):
- Apply module weights: fx 0.18, bop 0.18, sovereign 0.14, foreign_flow 0.14, banking 0.10, commodity 0.09, domestic 0.08, fiscal 0.08, political 0.06, regime 0.03, narrative 0.02
- Weighted avg = Σ(score_after × weight) / Σ(weights)
- Non-linear amplifier: if ≥3 modules in stress zone (≥50), multiply by 1.2; ≥5 by 1.4
- Cap at 95%

## Step 5 — Output Format

```
## Shock Scenario: [Description]
**As of:** [Date] | **Baseline regime:** [Q1–Q4 label]

### Shock Parameters
| Parameter | Baseline | Shocked | Delta |
|-----------|----------|---------|-------|
| SBN 10Y   | 6.71%    | 7.50%   | +79bps |
| (etc)     |          |         |       |

### Module Impact — Before vs After
| Module | Score Before | Score After | Alert Δ | Key Driver |
|--------|-------------|-------------|---------|------------|
| Sovereign Risk | 16 🟢 | 45 🟡 | GREEN→YELLOW | SBN yield above 7.5% flag |
| Banking | 4 🟢 | 28 🟢 | GREEN | Implied CAR hit 0.95pp (moderate) |
| FX Defense | 50 🟡 | 68 🟠 | YELLOW→ORANGE | IDR vol + yield-driven outflow |
| Foreign Flow | 33 🟢 | 48 🟡 | GREEN→YELLOW | SBN ownership fall expected |
| Fiscal | 33 🟢 | 50 🟠 | GREEN→ORANGE | SBN interest burden increase |
| (unchanged modules: omit or show as — ) | | | |

### Transmission Chain
[Prose: 3–5 sentences tracing the primary shock → secondary effects → tertiary risks.
Explicitly call out: doom loop risk if present (sovereign ↔ bank), sudden stop risk if FX/SBN involved, regime shift risk.]

### Silent Crisis Probability
- **Before:** X%
- **After shock:** Y% [LEVEL]
- **Stressed modules (≥50):** list

### Critical Thresholds to Watch
[2–3 specific numeric tripwires: "If SBN yield reaches 8.0%, banking CAR hit crosses 1.8pp = doom loop territory"]

### Caveats
- Transmission formulas are calibrated to Indonesia historical episodes; may differ in speed
- Regime interactions are non-linear; compound shocks tend to transmit faster than sum of parts
- IndONIA-BI Rate spread may widen faster than modeled if interbank market seizes
```

## Handling Ambiguous Shocks

If user doesn't specify exact parameters, use these standard severity tiers:

| Severity | SBN Yield | USDIDR | Reserves | NPL |
|----------|-----------|--------|----------|-----|
| Mild | +50bps | +1,500 | −$20bn | +1pp |
| Moderate | +100bps | +3,000 | −$40bn | +3pp |
| Severe | +150bps | +5,000 | −$60bn | +5pp |
| Crisis | +250bps | +8,000 | −$80bn | +8pp |

Default to "Moderate" if user says something like "stress test" without specifics. Always confirm parameters with user before computing.

## Key Indonesia Macro Constants (check live data for latest)

- APBN 2026 USDIDR assumption: 16,500
- APBN 2026 ICP oil: $70/bbl
- APBN 2026 SBN 10Y assumption: 6.9%
- APBN 2026 deficit ceiling: 3.0% GDP (constitutional)
- Monthly imports: ≈ $19bn
- Bank SBN/assets ratio: ≈ 20%
- SBN portfolio duration: ≈ 6 years
- M2 money supply: ≈ IDR 9,000 trillion (≈ $500bn at 18,000)
- External debt: ≈ $420bn (2025)
- BI Rate corridor: DFR = BI Rate − 75bps, LF Rate = BI Rate + 75bps
