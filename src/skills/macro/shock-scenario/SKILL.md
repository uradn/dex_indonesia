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
- `uln_engine` — total ULN, DSR, GG ratio, short-term %, hedging compliance

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
- `uln_total_bn`: total gross external debt USD bn (confirmed Q1 2026: $433.38bn)
- `uln_dsr_pct`: debt service ratio % of exports (WB 2024: 24.69% — near 25% IMF threshold)
- `uln_shortterm_pct`: short-term as % of total (WB 2024: 15.47%)
- `greenspan_guidotti`: FX reserves / short-term ULN (live: 2.27 GREEN)
- `uln_hedging_compliance_pct`: BI macro-prudential compliance % (null if BI scrape unavailable)

## Step 2 — Parse Shock Parameters

Identify the shock type(s) from the user's request:

| Shock Type | Example Inputs |
|------------|---------------|
| SBN yield | "SBN 10Y to 7.5%", "yield spike +100bps", "SBN 8%" |
| USDIDR | "IDR to 20,000", "USDIDR 22,000", "IDR depreciates 15%" |
| FX reserves | "reserves fall to $100bn", "BI burns $30bn", "reserves 80bn" |
| NPL | "NPL rises to 5%", "NPL shock +3pp" |
| BI Rate | "BI hikes to 7%", "rate cut to 5%" |
| ULN/hedging | "corporate hedging compliance drops to 60%", "ULN grows 15% YoY", "DSR crosses 30%" |
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

**Module 13 — ULN (primary IDR shock transmission):**
- Depreciation % = Δusdidr / baseline_usdidr × 100
- ULN/GDP worsens: shocked_gdp_usd = 25,714.2T / shocked_usdidr; new_ratio = uln_total_bn / shocked_gdp_usd × 100
- DSR worsens: shocked_dsr ≈ baseline_dsr × (shocked_usdidr / baseline_usdidr) — USD debt service heavier in export terms
- GG ratio: unchanged unless reserves also fall (see 3C); flag if GG drops below 1.5
- Hedging amplifier fires if compliance < 70%: unhedged corporates forced to buy USD → amplifies IDR depreciation (1997 loop)
  - Trigger check: depreciation >15% AND compliance <70% → flag FORCED USD BUYING RISK
  - Score multiplier: compliance 70-85% = ×1.15; 55-70% = ×1.30; <55% = ×1.50
- Score: recalculate scoreUlnGdp(new_ratio) + scoreDsr(shocked_dsr), apply hedging amplifier

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

**Module 1 — BoP:**
- If reserve depletion caused by current account deficit: flag CAD stress
- If caused by capital account: sudden stop signal

**Module 13 — ULN (Greenspan-Guidotti degradation):**
- GG ratio = shocked_reserves / (uln_total_bn × uln_shortterm_pct / 100)
- Baseline GG 2.27 (GREEN). At $120bn reserves: GG = 120 / (433 × 0.1547) = 1.79 (YELLOW)
- At $100bn: GG = 100 / 67 = 1.49 (ORANGE — approaching <1.5 threshold)
- At $80bn: GG = 80 / 67 = 1.19 (RED — rollover risk CRITICAL)
- Score: recalculate scoreGg(new_gg)

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

**Module 13 — ULN (BI Rate → corporate USD funding shift):**
- Higher domestic rates → corporates shift borrowing to offshore USD → ULN growth risk
- Each +100bps BI Rate sustained >2Q: estimate ULN growth +1-2pp vs baseline trajectory
- If compliance already <85%: new USD borrowers may not hedge → ratchets hedging risk upward
- Score: flag if BI Rate shock likely to accelerate ULN growth beyond GDP growth rate

**Regime:**
- Rate hike in Q3 (stagflation) = forced tightening → worsens growth component → entrenches Q3

### 3F. ULN/Hedging Shock (Δcompliance or ΔDSR or ΔULNgrowth)

**Module 13 — ULN (direct):**
- Compliance drop: new_amplifier = hedgingAmplifier(shocked_compliance); recalculate ULN score
- DSR shock: shocked_dsr = new value; if crossing 25% → YELLOW; 30% → ORANGE flag fires
- ULN growth shock: shocked_yoy > 15% → scoreGrowth() hits ORANGE range
- Compound: compliance drop + IDR depreciation = 1997 loop; flag explicitly

**Module 3 — FX Defense (secondary):**
- Compliance <70%: add flag "UNHEDGED EXPOSURE: forced USD buying risk — IDR amplification"
- Estimate unhedged USD demand: uln_total × private_share × (1 − compliance/100)
  - private_share ≈ 55% of total ULN historically

**Module 8 — Banking (tertiary, lag 2-3Q):**
- Compliance drop → eventual NPL: estimate +0.3pp NPL per 10pp compliance drop (historical)
- Flag as leading indicator: "ULN stress → NPL lag 2-3Q"

**Module 1 — BoP:**
- Unhedged corporate forced USD buying = capital account outflow proxy → reserve pressure

### 3G. MBG Fiscal Overrun (fiscalOverrunIdrT in IDR trillion)

**Context:** MBG (Makan Bergizi Gratis) — Prabowo's free school meals program. Budget: IDR 71T base (2025). Potential expansion IDR 100–450T in 2026 as coverage scales. Transmission follows **Mundell-Fleming (R&R Ch.8)**: ΔG → APBN overrun → term premium rise → SBN yield up → IDR pressure via open capital account.

**Fiscal yield premium (IMF fiscal-yield rule for Indonesia):**
```
fiscal_yield_premium_pct = (fiscalOverrunIdrT / 100) × 0.30
```
- IDR 100T overrun → +30bps SBN yield
- IDR 200T overrun → +60bps SBN yield
- IDR 300T overrun → +90bps SBN yield
- IDR 450T overrun → +135bps SBN yield

**Step 1 — compute shocked SBN yield, then apply Step 3A in full:**
```
shocked_sbn10y = baseline_sbn10y + fiscal_yield_premium_pct
```
All Step 3A transmission (sovereign score, FSAP CAR hit, foreign flow, fiscal interest burden) applies.

**Module 10 — Fiscal (direct APBN impact):**
- Additional deficit: `delta_deficit_pct_gdp = fiscalOverrunIdrT / 25_714 × 100`
  - 100T overrun → +0.39pp deficit
  - 200T overrun → +0.78pp (total ~3.46% GDP — approaching constitutional 3% ceiling if already stressed)
  - 300T overrun → +1.17pp (total ~3.85% GDP — breaches ceiling)
- Scoring: re-run deficit trajectory with new deficit_pct_gdp
- Revenue shortfall compound: if revenue running below 85% pace simultaneously, add 10 to fiscal score

**Module 6 — Narrative Divergence:**
- APBN spending assumption vs realized: fiscal overrun = direct divergence signal
- Widened gap raises narrative score: +10 per 100T overrun above IDR 100T

**Module 5 — Foreign Flow (Mundell-Fleming capital account channel):**
- Term premium rise → foreign SBN investors reprice: each 30bps yield premium historically → −0.3pp SBN foreign ownership over one quarter
- Apply as additional SBN ownership decline on top of any yield shock in 3A

**Dornbusch compound check:**
- If MBG overrun + existing IDR weakness pushes total IDR depreciation from APBN baseline >15%: fire Dornbusch overshoot note — "structural fiscal shock amplifies short-run overshoot; peak IDR may exceed equilibrium before PPP mean-reversion"

**Standard MBG severity tiers:**

| MBG Tier | fiscalOverrunIdrT | SBN Δ | Deficit Impact | Key Risk |
|----------|------------------|-------|---------------|----------|
| Mild | 100T | +30bps | +0.39pp GDP | Sovereign YELLOW |
| Moderate | 200T | +60bps | +0.78pp GDP | FSAP CAR watch (0.72pp) |
| Severe | 300T | +90bps | +1.17pp GDP | Deficit >3.85% GDP — breaches ceiling |
| Max rollout | 450T | +135bps | +1.75pp GDP | FSAP doom loop (CAR hit 1.62pp); sudden stop risk |

**Compound scenario (MBG + revenue shortfall):** most dangerous configuration — fiscal overrun on spending side while pajak shortfall widens on revenue side. When both fire, deficit_pct_gdp can cross 4%+ without BI credibly defending IDR. Check fiscal_engine revenue absorption rate before computing.

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

Silent Crisis Probability recalculation (approximate, 13 modules, weights sum = 1.00):
- Apply module weights: fx_defense 0.16, uln 0.09, bop 0.10, sovereign_risk 0.09, foreign_flow 0.09, banking 0.08, commodity 0.07, fiscal 0.09, market 0.05, domestic_pressure 0.06, political_risk 0.05, regime 0.05, narrative 0.02
- Weighted avg = Σ(score_after × weight) / Σ(weights of available modules)
- Non-linear amplifier: if ≥3 modules in stress zone (≥50), ×1.2; ≥4 modules ×1.3; ≥5 modules ×1.4
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
| ULN (M13) | 12 🟢 | 38 🟡 | GREEN→YELLOW | ULN/GDP worsens, DSR near threshold |
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

| Severity | SBN Yield | USDIDR | Reserves | NPL | Hedging Compliance |
|----------|-----------|--------|----------|-----|--------------------|
| Mild | +50bps | +1,500 | −$20bn | +1pp | −5pp |
| Moderate | +100bps | +3,000 | −$40bn | +3pp | −15pp |
| Severe | +150bps | +5,000 | −$60bn | +5pp | −25pp |
| Crisis | +250bps | +8,000 | −$80bn | +8pp | −35pp (→ 1997 zone) |

Default to "Moderate" if user says something like "stress test" without specifics. Always confirm parameters with user before computing.

## Historical Episode Presets

When user invokes a named historical episode ("simulate 2013 taper tantrum", "apply 2020 COVID scenario", etc.), skip Step 2 parsing and use the pre-calibrated parameters below directly in Step 3.

Apply deltas to TODAY's live baseline (fetch from live engines per Step 1), NOT to historical starting values. The goal is: "what would this historical shock magnitude do to Indonesia given current conditions?"

### Historical Shock Magnitudes (actual episode)

| Episode | IDR Δ | SBN 10Y Δ | FX Res Δ | EIDO Δ | Commodity | BI Rate Δ | Root Cause |
|---------|-------|-----------|----------|--------|-----------|-----------|-----------|
| **Taper Tantrum 2013** | +21.4% | +300bps | −$15bn | −25% | −12% broad | +175bps | Fed taper signal → EM capital outflow |
| **China Devaluation 2015** | +14.8% | +100bps | −$7bn | −20% | Coal −30%, CPO −25%, Ni −30% | −25bps | CNY deval → commodity demand shock |
| **EM Contagion 2018** | +10.3% | +150bps | −$14bn | −30% | Brent +20% | +175bps | Turkey/Argentina crisis → EM spillover |
| **COVID Crash 2020** | +15.2% | +250bps | −$11bn | −40% | −30% broad, Brent −65% | −100bps | Global risk-off → foreign SBN exit |
| **Fed Tightening 2022** | +9.2% | +100bps | −$25bn | −20% | Mixed (coal/CPO high) | +225bps | Fed +425bps → USD strength |
| **Dollar Surge 2023** | +6.1% | +50bps | −$8bn | −15% | −15% normalization | 0bps | Fed "higher-for-longer" + commodity fade |

### Applied to June 2026 Baseline

Baseline: USDIDR 17,879 | SBN 6.71% | BI Rate 5.25% | FX Reserves $151.9bn | GG 2.27

| Episode | Shocked IDR | Shocked SBN 10Y | Shocked Reserves | EIDO Δ | BI Rate Response | Step 3 Modules |
|---------|-------------|-----------------|-----------------|--------|-----------------|----------------|
| Taper Tantrum | ~21,700 | ~9.71% | ~$137bn | −25% | 5.25% → 7.00% | 3A + 3B + 3C + 3E |
| China Deval | ~20,500 | ~7.71% | ~$145bn | −20% | flat/mild cut | 3B + commodity 3A + 3C |
| EM Contagion | ~19,720 | ~8.21% | ~$138bn | −30% | 5.25% → 7.00% | 3A + 3B + 3C + 3E |
| COVID | ~20,600 | ~9.21% | ~$141bn | −40% | 5.25% → 4.25% | 3A + 3B + 3C + 3E |
| Fed Tightening | ~19,520 | ~7.71% | ~$127bn | −20% | 5.25% → 7.50% | 3A + 3B + 3C + 3E |
| Dollar Surge | ~18,960 | ~7.21% | ~$144bn | −15% | 5.25% (unchanged) | 3A (mild) + 3B (mild) |

### 2026 Asymmetries vs Historical (always note in output)

**Larger reserve buffer** ($151.9bn vs $92–141bn historical starts) → more BI ammo before GG degrades.

**Higher starting SBN yield** (6.71%) → panic zones are closer. Taper Tantrum analog hits 9.71% (vs 8.5% actual 2013 peak) — would be Indonesia's highest yield since 2001.

**Tighter fiscal space** (deficit 2.68% already) → BI hike amplifies fiscal stress faster. Each +100bps BI Rate: belanja bunga rises ~IDR 10T on each IDR 1,000T SBN outstanding.

**Better ULN position** (GG 2.27 GREEN, DSR 24.69% near-threshold) → less vulnerable than 2013 (GG ~2.0) but DSR rising trend (2022=23.3% → 2024=24.7%) is the watch metric.

**Commodity cushion varies by episode**: 2022 analog gets inflation from coal/CPO still elevated; 2015 analog is worst for commodity module as export basket collapses simultaneously with IDR.

### Per-Episode Critical Watch Points

**Taper Tantrum analog:**  SBN 9.71% → banking FSAP CAR hit = 3.0% × 1.2 = 3.6pp — doom loop territory. Foreign SBN ownership cliff risk (currently ~12.68% — below 2013's 25% → exit amplitude smaller but starting position already fragile).

**China Deval analog:** Commodity module → primary stress channel. Coal −30% + CPO −25% + Ni −30% simultaneously = export earnings collapse. Trade surplus at risk → BoP current account turns negative.

**EM Contagion analog:** Most similar to current 2026 setup (similar CAD trajectory, Fed hiking). Key trigger: if Greenspan-Guidotti drops toward 1.5 ($101bn reserves), ULN orange threshold breached simultaneously.

**COVID analog:** Fastest transmission — 6-week window. Foreign SBN ownership exit: in 2020 foreigners sold ~Rp150T in 6 weeks. At current 12.68% ownership (~Rp885T): full sudden stop would exceed BI's absorption capacity.

**Fed Tightening analog:** Longest cycle — 9 months of sustained pressure. BI hike 225bps → IndONIA corridor stressed; LDR rises as credit tightens; NPL lag 2–3Q. Reserve drawdown largest ($25bn) → watch GG → 1.5 threshold: $151.9 − $51 = $100.9bn → GG = 100.9/67 = 1.51 (barely ORANGE).

**Dollar Surge analog:** Mildest scenario. Warning: 2026 has higher fiscal deficit than 2023, so narrative divergence module (APBN assumption vs market IDR) amplifies faster.

## Key Indonesia Macro Constants (check live data for latest)

- APBN 2026 USDIDR assumption: 16,500
- APBN 2026 ICP oil: $70/bbl
- APBN 2026 SBN 10Y assumption: 6.9%
- APBN 2026 deficit ceiling: 3.0% GDP (constitutional)
- Monthly imports: ≈ $19bn
- Bank SBN/assets ratio: ≈ 20%
- SBN portfolio duration: ≈ 6 years
- M2 money supply: ≈ IDR 9,000 trillion (≈ $500bn at 18,000)
- External debt (ULN): $433.38bn (Q1 2026, confirmed live); ULN/GDP 27.8%; DSR 24.69%; GG ratio 2.27; ST% 15.47%
- BI Rate corridor: DFR = BI Rate − 100bps, LF Rate = BI Rate + 75bps (IndONIA corridor; breach = forced BI liquidity injection)
