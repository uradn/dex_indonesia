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

### 3H. China Slowdown Shock (commodity demand collapse)

**Context:** China = ~25% of Indonesia's export destination. A hard landing / property sector collapse → simultaneous demand-side shock on all major export commodities. Distinct from Hormuz (supply-side, pushes Brent up) — this is DEMAND-side (pushes commodity prices DOWN while IDR also weakens, eliminating the export cushion).

**Shock parameters (use these unless user specifies):**

| Parameter | Mild | Moderate | Severe |
|-----------|------|----------|--------|
| Coal (KOL) Δ | −15% | −30% | −45% |
| CPO (FCPO.KL) Δ | −12% | −25% | −38% |
| Nickel (NI=F) Δ | −15% | −30% | −45% |
| USDIDR Δ | +800 | +1,500 | +2,500 |
| FX Reserves Δ | −$8bn | −$15bn | −$25bn |
| BI Rate Δ | 0 | −25bps (growth support) | −50bps (growth panic) |
| Brent Δ | −$5 | −$10 | −$20 (demand destruction) |

**Module 4 — Commodity (primary channel):**
- Coal, CPO, nickel are top-3 export commodities ($24.5bn, $24.4bn, $8.4bn respectively)
- Combined 2026 export impact at Moderate: coal −$7.3bn + CPO −$6.1bn + Ni −$2.5bn = −$15.9bn annual export earnings
- Commodity Cushion Score: all three simultaneously z < −2.0 → score jumps 30–50 pts
- If all three z < −2.5 simultaneously: RED flag fires

**Module 1 — BoP (secondary):**
- Export earnings collapse → trade surplus shrinks or flips negative
- Synthetic CAD risk: reserves fall as export receipts drop while import bill (oil) relatively stickier
- BoP score: +20–35 pts at Moderate

**Module 1 — FX Defense (tertiary):**
- IDR weakens (less export USD inflow)
- Reserve drawdown: BI defends IDR while export support gone
- Bid-cover ratio on SRBI likely falls (carry attractiveness drops with IDR pressure)
- Apply 3B (USDIDR shock) at Moderate: +1,500 → USDIDR ~19,500

**Module 13 — ULN:**
- IDR depreciation worsens ULN/GDP and DSR (same as 3B)
- At Moderate: shocked_usdidr 19,500 → ULN/GDP ~30.5%, DSR ~26.5% (crosses 25% threshold)

**Module 10 — Fiscal:**
- Royalti & PNBP dari sektor tambang turun → revenue shortfall
- At Moderate: estimate PNBP shortfall ~IDR 50–80T (mining royalties ~3% of revenue)
- Apply absorption rate penalty: revenue falls to ~80% pace → fiscal score +15 pts

**Module 6 — Narrative:**
- Official growth narrative vs commodity price collapse divergence
- APBN oil/commodity assumptions now further from market
- Add 10 to narrative score

**Regime (secondary):**
- Commodity demand shock = growth deceleration signal
- If simultaneous IDR weakness: stagflation risk Q3 (Growth↓ Inflation↑ via IDR pass-through)

**Standard China Slowdown severity applied to June 2026 baseline (USDIDR 18,160):**

| Tier | Shocked IDR | Shocked KOL/CPO/Ni | Shocked Reserves | BI Rate | Step 3 modules |
|------|------------|-------------------|-----------------|---------|----------------|
| Mild | ~18,960 | −15% each | ~$143bn | flat | 3B + 3C + commodity |
| Moderate | ~19,660 | −30% each | ~$137bn | −25bps | 3B + 3C + commodity + 3E |
| Severe | ~20,660 | −45% each | ~$127bn | −50bps | 3B + 3C + commodity + 3E + fiscal |

**Key difference from 2015 China deval analog:** 2015 had CNY depreciation as trigger → competitive devaluation pressure. 2026 China slowdown is property/demand-led → no CNY deval needed, pure volume shock. Commodity module hit is similar magnitude but without the currency contagion channel.

---

### 3I. BI Rate Cut Premature (domestic policy error)

**Context:** BI cuts rates while IDR is already under pressure → carry trade unwinds → sudden stop. The 2nd-gen Morris-Shin dynamic triggered by a DOMESTIC policy mistake, not an external attack. Risk highest when: BI Rate real = BI Rate − CPI is already low (<1%), IDR 3M depreciation >5%, and foreign SBN ownership still >10%.

**Shock parameters:**

| Parameter | Mild | Moderate | Severe |
|-----------|------|----------|--------|
| BI Rate Δ | −25bps | −50bps | −100bps |
| SBN yield response (beta 0.7×) | −18bps | −35bps | −70bps |
| USDIDR Δ (carry unwind) | +500 | +1,200 | +2,500 |
| SBN foreign ownership Δ | −0.5pp | −1.5pp | −3.0pp |
| EIDO Δ | −5% | −12% | −25% |

**Transmission sequence:**
1. BI cuts → real rate falls → carry spread vs USD narrows
2. Carry trade unwind: foreigners sell IDR assets → SBN + EIDO simultaneous exit
3. IDR weakens → BI forced to intervene (reserve burn) or reverse cut
4. If BI reverses cut: credibility loss + fiscal interest burden spike (SBN yield re-prices up faster)
5. If BI holds cut: IDR spiral → inflation pass-through → real rate turns negative → capital flight

**Module 3 — FX Defense:**
- Apply 3B (USDIDR shock) at stated delta
- Additional flag: "POLICY ERROR — carry trade unwind, BI rate cut vs IDR weakness divergence"
- SRBI bid-cover likely drops sharply (carry premium gone)
- Confidence Gate: abandonment cost falls (IDR weaker = harder to defend) → net DC-AC worsens

**Module 2 — Sovereign Risk:**
- If rate cut reads as fiscal dominance (BI accommodating deficit): CDS widens +20–40bps
- SBN yield: may fall short-term (rate cut) then spike (risk premium re-pricing)
- Net effect: sovereign score up 15–25 pts

**Module 5 — Foreign Flow:**
- Carry unwind = SBN foreign ownership decline of stated delta
- EIDO falls of stated delta
- Silent exit probability: +25pp at Moderate

**Module 13 — ULN:**
- IDR depreciation → ULN/GDP worsens per 3B
- Hedging compliance may drop as corporates scramble (1997 loop risk if compliance <70%)

**Morris-Shin 2nd-gen check:**
- After shock: recalculate DC vs AC
- If (post-shock DC) < (post-shock AC): ATTACK zone — self-fulfilling crisis becomes rational
- Flag explicitly: "POLICY ERROR + 2nd-gen threshold: BI rate cut moved confidence gate to ATTACK zone"

**Key asymmetry vs external shock:** External shocks often allow BI to credibly raise rates as defense. Policy error cut destroys the rate-hike defensive option — BI can't raise again without admitting mistake. Markets price in policy uncertainty premium. Add +10 to sovereign score for credibility loss.

**Standard severity applied to June 2026 baseline (BI Rate 5.25%):**

| Tier | Shocked BI Rate | Shocked IDR | SBN ownership Δ | Key Risk |
|------|----------------|------------|-----------------|----------|
| Mild | 5.00% | ~18,660 | −0.5pp | Carry thinning, watch |
| Moderate | 4.75% | ~19,360 | −1.5pp | EIDO exit + SBN selling |
| Severe | 4.25% | ~20,660 | −3.0pp | 2nd-gen confidence gate breached |

---

### 3J. Sovereign Downgrade Shock (Baa2 → Baa3, last notch investment grade)

**Context:** Moody's/S&P/Fitch downgrades Indonesia to last notch of investment grade (Baa3/BBB−). This triggers mandatory selling by investment-grade-only funds (pension funds, insurance, ETFs that track IG indices). Indonesia's sovereign rating: currently Baa2 (Moody's), BBB (S&P). Downgrade watch typically: CDS >200bps sustained 3+ months. Historical analog: Brazil 2015 downgrade → CDS +150bps, BRL −20% in 3 months.

**Trigger conditions (check before applying):**
- CDS 5Y > 200bps: downgrade watch zone
- CDS > 250bps: downgrade imminent
- Deficit > 3.5% GDP: fiscal triggers S&P methodology
- Foreign SBN ownership already falling + no domestic absorption: rating action catalyst

**Shock parameters (apply at downgrade announcement):**

| Parameter | Announcement Day | 1-Month | 3-Month |
|-----------|-----------------|---------|---------|
| CDS Δ | +50–80bps | +80–120bps | +100–150bps |
| SBN 10Y yield Δ | +50–100bps | +100–150bps | +150–250bps |
| Foreign SBN exit | −1pp day 1 | −3pp | −5 to −8pp |
| USDIDR Δ | +1,000 | +2,000 | +3,000–5,000 |
| EIDO Δ | −8% | −15% | −25% |
| FX Reserves Δ | −$5bn | −$15bn | −$25bn |

**Module 2 — Sovereign Risk (primary):**
- CDS absolute + z-score both spike
- Foreign SBN ownership cliff: IG-mandate funds forced sellers
- Refinancing stress: new issuance costs spike → rollover risk on maturing SBN
- Sovereign score: +30–50 pts → likely RED

**Module 5 — Foreign Flow (primary):**
- Mandatory selling = structural exit, not tactical
- Domestic absorption capacity check: can BI/banks absorb forced selling?
  - If SBN/assets at banks already high (>20%): limited headroom
  - BI SRBI bid-cover likely collapses (foreigners exiting BI instruments too)
- Silent exit probability: +40pp → likely >70%

**Module 1 — FX Defense:**
- Apply 3B (USDIDR shock) + 3C (reserve depletion)
- Confidence Gate: both DC and AC shift → likely VULNERABLE or ATTACK zone
- SRBI sterilization demand collapses (foreigners exit carry trade)

**Module 8 — Banking (FSAP nexus):**
- Apply 3A SBN yield shock: +150bps at 3-month → CAR hit = 1.5 × 1.2 = 1.8pp
- 1.8pp CAR hit → doom loop territory if starting CAR < 22%
- Current CAR 25.8% → post-shock ~24.0% (still above 14% regulatory minimum, but watch)

**Module 10 — Fiscal:**
- New SBN issuance at higher cost → interest burden rises
- Each +100bps on Rp 1,000T issuance = +Rp 10T belanja bunga
- Deficit trajectory: downgrade typically coincides with fiscal stress that triggered it

**Sovereign-bank doom loop check:**
- Sovereign downgrade → SBN price falls → bank CAR erodes → credit contraction → growth falls → sovereign revenue falls → deficit widens → CDS widens → downgrade watch again
- Flag if: SBN yield shock >150bps AND CAR hit >1.5pp simultaneously

**Investment-grade cliff magnitude (Indonesia-specific):**
- Bloomberg Barclays EM index: ~$X bn of Indonesia bonds held by IG-mandate funds
- Estimate: if foreign SBN ~Rp 885T (~$48bn) and IG-mandate funds hold ~40% = ~$19bn forced selling
- $19bn = ~12% of FX reserves → reserves fall from $152bn to ~$133bn over 3 months
- Apply 3C: reserves fall $19bn → GG ratio = 133 / 67 = 1.99 (near YELLOW at 2.0)

**Standard downgrade severity applied to June 2026 baseline:**

| Timing | CDS Δ | SBN 10Y Δ | IDR Δ | SBN exit | Reserves | Key Module |
|--------|-------|-----------|-------|----------|---------|------------|
| Day 1 | +60bps | +75bps | +1,000 | −1pp | −$5bn | Sovereign RED |
| 1-month | +100bps | +125bps | +2,000 | −3pp | −$15bn | Foreign Flow RED |
| 3-month | +130bps | +175bps | +3,500 | −6pp | −$25bn | Banking ORANGE, doom loop check |

**Historical analog (Brazil 2015):** Petrobras scandal + fiscal slippage → S&P downgrade Aug 2015 → BRL −20%, CDS +150bps in 90d. Indonesia 2026 asymmetry: smaller fiscal deficit (2.68% vs Brazil's 8%+), but lower FX reserves relative to external debt, and higher political risk.

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

### Forward-Looking Scenario Presets

For user invocations like "simulate China slowdown", "test BI rate cut scenario", "run sovereign downgrade shock" — use Step 3H/3I/3J parameters directly with TODAY's live baseline (fetch Step 1 first). Default tier = Moderate unless user specifies.

| Scenario Preset | Invocation phrases | Default Tier | Primary Step 3 |
|----------------|-------------------|--------------|----------------|
| **China Slowdown** | "China slowdown", "China hard landing", "China property collapse", "China demand shock" | Moderate | 3H → 3B → 3C → 3E |
| **BI Rate Cut Premature** | "BI rate cut", "premature cut", "policy error cut", "carry unwind", "BI cut too early" | Moderate | 3I → 3B → confidence gate check |
| **Sovereign Downgrade** | "sovereign downgrade", "Moody's downgrade", "IG cliff", "investment grade loss", "downgrade shock" | 1-month horizon | 3J → 3A → 3B → 3C → doom loop check |

**China Slowdown — Moderate applied to June 2026 baseline:**
- USDIDR: 17,879 → ~19,379 (+1,500)
- FX Reserves: $151.9bn → ~$136.9bn (−$15bn)
- BI Rate: 5.25% → 5.00% (−25bps growth support)
- Coal/CPO/Ni: −30% each; Brent: −$10/bbl
- Shocked GG: $136.9 / 67 = 2.04 (approaching YELLOW)
- Shocked DSR: ~26.5% → crosses IMF 25% threshold → YELLOW

**BI Rate Cut Premature — Moderate applied to June 2026 baseline:**
- BI Rate: 5.25% → 4.75% (−50bps)
- SBN 10Y: initial −35bps (rate cut beta), then risk re-pricing +80bps net = ~7.16%
- USDIDR: 17,879 → ~19,079 (+1,200)
- SBN foreign ownership: 12.68% → ~11.18% (−1.5pp)
- EIDO: −12%
- Check confidence gate: if post-shock DC < AC → flag ATTACK zone
- Key asymmetry: BI cannot credibly re-hike → credibility loss premium +10 to sovereign score

**Sovereign Downgrade — 1-month horizon applied to June 2026 baseline:**
- CDS: current baseline + 100bps (verify vs 200bps watch threshold before applying)
- SBN 10Y: 6.71% → ~7.96% (+125bps)
- USDIDR: 17,879 → ~19,879 (+2,000)
- SBN foreign exit: 12.68% → ~9.68% (−3pp; crosses 10% sudden stop warning)
- FX Reserves: $151.9bn → ~$136.9bn (−$15bn)
- Forced selling estimate: ~$19bn IG-mandate exit over 3 months (use 1-month rate: −$15bn)
- Doom loop check: SBN 10Y +125bps → CAR hit = 1.25 × 1.2 = 1.5pp → watch if starting CAR <23%

**Per-preset asymmetries vs historical analogs:**

- China Slowdown vs 2015 China Deval: 2026 = pure volume shock (no CNY deval). Commodity impact similar magnitude but currency contagion channel absent. Indonesia's export diversification slightly better (nickel EV processing added). More dangerous: 2026 fiscal deficit already at 2.68%, less room to absorb revenue shortfall.
- BI Rate Cut vs any historical episode: no close analog — Indonesia's 1997 crisis began with *inability* to hike (FX peg defense), not a voluntary cut. Closest: 2020 COVID cut (−100bps) but that was a global shock, not a policy error. The 2026 cut scenario is uniquely dangerous because BI Rate real is already near 0% (5.25% − 4.5–5% CPI ≈ 0.25–0.75% real).
- Sovereign Downgrade vs Brazil 2015: Brazil 2015 deficit 8%+ (much worse), but Brazil had deeper domestic debt market to absorb. Indonesia's lower deficit but higher reliance on foreign SBN holders (12.68% vs Brazil's ~10% at downgrade). Net: similar market reaction expected but faster via SRBI collapse channel.

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
