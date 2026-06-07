---
name: rr-framework
description: Rivera-Batiz & Rivera-Batiz "International Finance and Open Economy Macroeconomics" theoretical framework reference. Explains the academic basis behind each R&R-derived signal in this system, which modules implement them, and how to interpret the outputs.
---

# R&R Framework Reference — Indonesia Macro System

**Source:** Rivera-Batiz, F.L. & Rivera-Batiz, L. — *International Finance and Open Economy Macroeconomics* (2nd ed.)

This system embeds 9 R&R frameworks as detection signals. When a user asks "why does this signal matter" or "what is the theoretical basis for X", use this skill to explain the chain from theory → Indonesia-specific mechanism → live signal.

---

## Framework Map

### 1. Purchasing Power Parity — Ch. 4–5
**Premise:** Exchange rate should equalize purchasing power across countries. Relative PPP: `%ΔUSDIDR ≈ π_Indonesia − π_USA`. Persistent deviation = structural misalignment.

**Indonesia signal:** Module 6 (Narrative Divergence) check #8 — USDIDR actual 12M annualized change vs PPP-implied annual change (APBN CPI 2.5% − US CPI ~3.0%). Misalignment >10pp flagged.

**Positive misalignment** (IDR weaker than PPP predicts) → Dornbusch overshoot territory → expect partial mean-reversion.
**Negative misalignment** (IDR stronger than PPP) → latent depreciation pressure building.

**Read:** `narrative_divergence_engine` → "USDIDR vs Relative PPP Fair Value" check.

---

### 2. Uncovered Interest Parity (UIP) — Ch. 5
**Premise:** `carry_spread ≈ expected_depreciation`. If SBN yield − UST yield < expected IDR depreciation, carry trade unwinds. Foreign investors exit SBN because yield no longer compensates for FX loss.

**Indonesia signal:** Module 7 (ASEAN RV) — UIP Carry Attractiveness Index:
- `real_carry = (SBN_10Y − UST_10Y) − IDR_3M_annualized_depreciation`
- Labels: attractive (>3pp) | neutral (1–3pp) | watch (0–1pp) | unattractive (<0pp)

**Key property:** Leads Module 5 foreign flow data by 2–3 weeks. Carry math is instantaneous; actual SBN flow data is lagged by DJPPR reporting.

**Read:** `asean_relative_value_engine` → "UIP Carry Attractiveness" section.

---

### 3. Mundell-Fleming Open Economy Model — Ch. 8
**Premise:** In a small open economy with a floating exchange rate, fiscal expansion (ΔG) crowds out net exports via exchange rate appreciation (or depreciation in a crisis). Under open capital account: monetary policy affects exchange rate, fiscal policy affects income + current account.

**Indonesia application:** MBG (Makan Bergizi Gratis) fiscal shock → APBN overrun → term premium rise → SBN yield up → IDR pressure. `fiscalOverrunIdrT` parameter in stress simulator directly encodes this: every IDR 100T overrun adds ~30bps SBN yield premium (IMF fiscal-yield rule).

**Read:** `stress_simulator` with `fiscalOverrunIdrT` parameter.

---

### 4. Dornbusch Overshooting Model — Ch. 10
**Premise:** In the short run, exchange rates overshoot their long-run equilibrium (PPP) because asset markets clear faster than goods markets. A monetary shock causes the exchange rate to depreciate MORE than PPP predicts, then gradually appreciate back.

**Indonesia signal:** Stress simulator — when IDR shock >15% above current, the Dornbusch note fires automatically: "short-run overshoot likely before PPP mean-reversion." The actual peak depreciation may exceed the input before correcting.

**Implication for scenario analysis:** A "17% IDR shock" scenario should be read as the *equilibrium* anchor — actual peak during the overshoot could reach 20–22% before reverting. Stress-test both the overshoot peak and the reversion.

**Read:** `stress_simulator` with large `idrLevel` → Dornbusch note in output.

---

### 5. Mundell Trilemma — Ch. 11
**Premise:** A country cannot simultaneously maintain: (1) open capital account, (2) fixed exchange rate, (3) independent monetary policy. Indonesia chooses (1) and (3) → must let IDR float (partially). BI's FX interventions require sterilization → SRBI issuance.

**Indonesia signal:** Module 10 (Fiscal Engine) — SRBI sterilization cost:
- `annual_cost = SRBI_outstanding × BI_Rate`
- Expressed as % of APBN deficit target
- Flag at >5% (notable quasi-fiscal drag) and >10% (elevated)

**Key mechanism:** Open capital + monetary autonomy → sterilization mandatory → SRBI interest = quasi-fiscal drain on BI profit remittance to Treasury → reduces non-tax revenue in APBN.

**Read:** `fiscal_engine` → "SRBI Sterilization Cost (Trilemma)" section.

---

### 6. 1st-Generation Crisis Model — Ch. 12
**Source:** Krugman (1979), Flood-Garber (1984)
**Premise:** When a government maintains a peg, speculators attack exactly when FX reserves hit the "shadow rate" threshold (the rate that would prevail without intervention). Attack is rational and inevitable — not self-fulfilling. Timing is deterministic: `months_to_attack = (reserves − floor) / monthly_burn`.

**Indonesia signal:** Module 3 (FX Defense) — Shadow Rate + Months-to-Attack:
- **Months to GG breach:** when reserves hit short-term ULN floor (GG = 1.0)
- **Months to SRBI ceiling:** when SRBI hits ~1,500T IDR stress level
- **Binding constraint:** `monthsToAttack = min(GG_breach, SRBI_ceiling)`
- **Implied USDIDR** at attack point: current_rate extrapolated by dep3m/3 monthly trend

**Flags:** <6 months = CRITICAL | <12 months = WATCH.

**Read:** `fx_defense_engine` → "Shadow Rate Analysis" section.

---

### 7. 2nd-Generation Self-Fulfilling Crisis — Ch. 13
**Source:** Obstfeld (1986, 1996), Morris-Shin (1998)
**Premise:** Unlike 1st-gen, attack can happen BEFORE reserves run out — purely from belief coordination. Government faces a trade-off: defense cost (DC) vs abandonment cost (AC). When DC ≈ AC, multiple equilibria exist: both "defend" and "abandon" are rational, depending on what speculators expect.

**Zone classification:**
- `SAFE` (DC << AC): BI clearly will defend → attack fails → no coordination incentive
- `VULNERABLE` (DC ≈ AC): multiple equilibria → sentiment shift alone triggers crisis. This is the most dangerous zone because no deterioration in fundamentals is required.
- `ATTACK` (DC >> AC): abandonment is dominant strategy → attack happens regardless of coordination → alert floor ORANGE

**Indonesia signal:** Module 3 (FX Defense) — Confidence Gate:
- **DCI (Defense Cost):** rate hike burden (IDR deviation × sensitivity, w=0.40) + growth sacrifice (GDP proximity to zero, w=0.30) + reserve runway from shadow rate (w=0.30)
- **ACI (Abandonment Cost):** ULN shock (hedging compliance + GG ratio, w=0.40) + inflation pass-through (dep3m, w=0.30) + credibility loss (CDS level, w=0.30)
- `net = DC − AC`: negative → SAFE, near-zero → VULNERABLE, positive → ATTACK

**Indonesia calibration today (Jun 2026):** DC ≈ 4 (low — IDR near APBN assumption, GDP healthy), AC ≈ 28 (ULN manageable, CDS moderate) → net ≈ −24 → SAFE. The gate becomes dangerous when IDR overshoots APBN by >10%, GDP slips toward 4%, or SRBI runway shortens.

**Read:** `fx_defense_engine` → "Confidence Gate" section.

---

### 8. r-g Debt Dynamics — Ch. 14–16
**Premise:** If r (real interest rate) > g (real GDP growth), debt/GDP expands automatically without a primary surplus. Primary surplus required to stabilize: `PS* = (r−g)/100 × Debt/GDP`. In nominal terms: r−g = r_nom − g_nom (CPI cancels).

**Indonesia signal:** Module 13 (ULN Engine) — r-g trajectory:
- `r−g = SBN_10Y − GDP_growth_nominal`
- Current: 6.71% − 5.40% = **+1.31pp** [KNIFE-EDGE]
- Labels: stable (≤0) | knife_edge (0–1.5pp) | expanding (1.5–3pp) | explosive (>3pp)
- Primary surplus required: `+1.31/100 × 27.8% = +0.36% GDP`
- Flag fires when r−g > 1.0pp

**Critical watch:** Indonesia's knife-edge position means any combination of SBN yield spike (above 7.5%) + GDP growth deceleration (below 5%) shifts the trajectory from knife_edge toward expanding. The r-g gap widens exactly when fiscal stress is highest (crisis = higher yields + lower growth simultaneously).

**Read:** `uln_engine` → "R-G Debt Dynamics" section.

---

### 9. Sudden Stop Vulnerability — Ch. 15
**Source:** Calvo (1998), Edwards (2004)
**Premise:** A sudden stop is an abrupt reversal of capital inflows — not a gradual exit but a discontinuous shock. Preconditions: carry trade unwind + foreign ownership cliff + thin reserve buffer occurring simultaneously. Once triggered, the sudden stop is self-reinforcing (capital exit → IDR weakening → more exit).

**Indonesia signal:** Module 5 (Foreign Flow) — Sudden Stop Vulnerability Index (SSVI):

| Component | Weight | Signal |
|-----------|--------|--------|
| SBN foreign ownership level | 0.30 | >15%: 0 / 12-15%: 25 / 10-12%: 50 / 8-10%: 75 / <8%: 100 |
| UIP real carry | 0.25 | >3pp: 0 / 1-3pp: 20 / 0-1pp: 50 / negative: 75-100 |
| EIDO 90d structural trend | 0.25 | z90d score (equity demand proxy) |
| Greenspan-Guidotti ratio | 0.20 | GG>2.0: 0 / GG<1.0: 100 |

**Phase:** low (<25) | watch (25–50) | elevated (50–75) | imminent (≥75 → alert floor ORANGE).

**Key interaction:** SSVI is complementary to Module 3's shadow rate (1st-gen) and confidence gate (2nd-gen). Shadow rate = mechanics tell you WHEN attack happens. Confidence gate = tells you IF attack is rational. SSVI = tells you HOW MUCH capital could leave at once (sudden vs gradual).

**Read:** `foreign_flow_engine` → "Sudden Stop Vulnerability Index" section.

---

## Cross-Framework Signal Interactions

| Scenario | R&R Frameworks | Modules Fired |
|----------|---------------|---------------|
| Carry trade unwind | UIP (Ch.5) → Sudden Stop (Ch.15) | M7 carry unattractive → M5 SSVI elevated |
| Fiscal overrun | Mundell-Fleming (Ch.8) → r-g (Ch.14-16) | Stress sim → M13 r-g expanding |
| Reserve depletion | 1st-gen (Ch.12) | M3 months-to-attack shortening |
| Confidence shock | 2nd-gen (Ch.13) | M3 gate → VULNERABLE zone |
| IDR overshoot | Dornbusch (Ch.10) + PPP (Ch.4-5) | Stress sim note + M6 PPP misalignment |
| Full crisis convergence | All 9 frameworks | M3+M5+M6+M7+M10+M13 simultaneous |

## How to Use This Skill

When user asks about signal interpretation, theoretical basis, or "why does X matter for Indonesia":
1. Identify which framework drives the signal (use table above)
2. Explain the transmission chain: theory → Indonesia mechanism → specific threshold/flag
3. Note cross-module interactions (which modules confirm or amplify each other)
4. Cite the current Indonesia calibration value where available

Do not re-run engines just to answer a theoretical question — use live values already in conversation context.
