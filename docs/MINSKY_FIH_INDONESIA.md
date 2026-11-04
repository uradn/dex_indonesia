---
title: "Minsky Financial Instability Hypothesis — Indonesia Implementation Research"
subtitle: "New GT Signal for M8 Banking + M10 Fiscal: Detecting Hedge→Speculative→Ponzi Transitions"
author: "Victor Elvino | victor@sadasa.id"
date: "4 November 2026"
---

# Minsky Financial Instability Hypothesis — Indonesia M8/M10 Research

**Dibuat:** 4 November 2026  
**Sistem:** Dexter Indonesia Sovereign Macro Intel  
**Scope:** GT gap baru — Minsky FIH sebagai debt-cycle dimension di M8 Banking + M10 Fiscal  
**Status:** Research phase — roadmap implementasi di Bagian 5  
**Basis:** Minsky (1986, 1992), Toporowski-Cozzi (2006), Vercelli (2009), Jakarta Post "Minsky Stability" May 2026, B50 subsidy mechanics, LPS/OJK data 2026

---

## Bagian 1: Teori — Minsky Financial Instability Hypothesis

### Core Framework

Hyman Minsky (1986, "Stabilizing an Unstable Economy") mengidentifikasi tiga regime pembiayaan dalam ekonomi kapitalis:

```
HEDGE FINANCE
  Arus kas operasi > total debt service (bunga + pokok)
  → Tidak ada rollover risk
  → Stabil. Paling umum di awal siklus kredit (recovery/expansion)

SPECULATIVE FINANCE  
  Arus kas operasi ≥ bunga, TAPI < pokok
  → Harus rollover pokok setiap jatuh tempo
  → Vulnerable terhadap kenaikan suku bunga atau credit crunch
  → Meningkat di pertengahan siklus (boom)

PONZI FINANCE
  Arus kas operasi < bunga
  → Harus meminjam hanya untuk membayar bunga
  → Hutang tumbuh secara eksponensial
  → Collapses ketika akses kredit terputus
  → Dominan di akhir siklus (bubble peak)
```

**Minsky Moment:** Titik ketika Ponzi dan speculative borrowers tidak lagi bisa rollover → terpaksa jual aset → harga turun → margin calls → spiral deflasi hutang.

**Paradoks Minsky:** "Stability is destabilizing." Periode panjang stabil → lending standards longgar → leverage meningkat → sistem lebih fragil.

### Relevansi untuk Open Economy

Vercelli (2009) dan Toporowski-Cozzi (2006) mengembangkan Minsky untuk emerging markets dengan tambahan:
- **Foreign currency debt + domestic revenue:** Depresiasi IDR = kenaikan debt service dalam IDR → percepatan transisi hedge→speculative→Ponzi
- **Commodity export dependency:** Commodity shock = revenue collapse → arus kas turun drastis → sistem yang kelihatan hedge tiba-tiba masuk speculative zone
- **Government as "lender of last resort" with fiscal constraint:** Jika sovereign backstop tidak tersedia (M10 CI < 50, APBN deficit > 4.5%), bank runs menjadi self-fulfilling

Ini adalah *missing link* antara D-D model (bank run coordination) dan Barro-Gordon (fiscal commitment) — Minsky menjelaskan *mengapa* sistem bergerak dari hedge ke Ponzi sebelum run terjadi.

---

## Bagian 2: Indonesia 2026 — Pemetaan ke Tiga Regime

### 2.1 BPDPKS B50 Biodiesel — Structural Ponzi Risk (M4/M10)

**Mekanisme:**

```
CPO export levy → BPDPKS fund → subsidi biodiesel ke Pertamina (FAME premium)
                                      ↑
                              B50 mandate = 50% blend = lebih banyak FAME
                              Lebih banyak FAME = lebih banyak CPO domestik
                              Lebih banyak CPO domestik = lebih sedikit ekspor
                              Lebih sedikit ekspor = levy income turun
                              Levy income turun TAPI subsidi obligation naik
```

**Data (dari search, Nov 2026):**
- ESDM klaim B50 saves Rp170T/tahun forex (import substitution)
- Tapi: CPO ekspor berkurang → levy revenue turun → BPDPKS fund tergerus
- CropGPT (2026): "B50 launched amid subsidy strain"
- East Asia Forum (Oct 2026): "Indonesia secures fuel supply at the cost of food and forests"

**Klasifikasi Minsky:**
- Sebelum B50 mandate (B40): **Hedge** — BPDPKS fund adequacy > 1.5×
- B50 transition (Jul–Dec 2026): **Speculative** — levy income falls, subsidy rises; fund draining
- B50 full demand scenario (2027): **Ponzi risk** — if export diversification fails and CPO price falls

**Signal untuk engine:** BPDPKS fund balance vs quarterly obligation → DSCR < 1.0 = Ponzi flag

**Data source:** ESDM/APROBI quarterly BPDPKS report (tersedia via Exa/Tavily)

---

### 2.2 Pertamina Subsidi Gap — Quasi-Ponzi Structure (M10/M11)

**Mekanisme:**

```
Pertamina: membeli minyak mentah di ICP ~$70/bbl = Rp ~18,000/L landed cost
            menjual Pertalite di Rp 10,000/L (harga subsidi)
            gap = Rp 8,000/L yang harus dibayar APBN via BPDP/subsidinya

Jika APBN delay pembayaran → Pertamina harus pinjam modal kerja
Pinjaman bertambah + delay payment = effective Ponzi jika kumulatif
```

**Data (dari M10/M11 engine aktif):**
- ICP aktual 2026 avg: ~$80-91.86/bbl vs APBN assumption $70 (gap +$10-22)
- Pertalite harga tetap Rp 10,000/L (Kepmen ESDM 2022, belum naik)
- Landed cost at ICP $91 + USDIDR 18,000: ~Rp 23,000-25,000/L sebelum refinery margin
- Gap subsidi per liter: Rp 13,000-15,000/L (escalated dari estimasi awal)
- Total annual gap: Rp 150-200T+ per tahun (dari M11 BBM subsidy gap engine)

**Klasifikasi Minsky:**
- Pertamina operasional (fuel supply): **Hedge** — revenue dari non-subsidi fuel cukup untuk operasional
- Pertamina + subsidi obligation: **Speculative** — butuh APBN transfer tepat waktu untuk tidak defisit
- Jika APBN transfer delay > 90 hari: **Ponzi** — Pertamina rolls ke bank pinjaman jangka pendek

**Current signal:** Sudah ditangkap sebagian oleh M11 BBM subsidy gap, tapi tidak sebagai Minsky DSCR — hanya sebagai nominal gap.

---

### 2.3 BPD (Bank Pembangunan Daerah) — Speculative Finance (M8/M10)

**Mekanisme:**

```
BPD liabilities: DPK dari Pemda deposits (captive, non-market rate, bisa ditarik setiap saat)
BPD assets: loans ke Pemda infrastructure + regional SMEs (illiquid, 3-5 tahun tenor)

Normal: Pemda tidak menarik DPK → BPD liquid
Stress: TKD shortfall → Pemda forced liquidate investments → withdrawal DPK
         → BPD harus fund dari PUAB O/N (saat ini 117bps spread = ALL-TIME HIGH)
         → Cost of funding naik tajam
         → Interest expense > operating income → masuk Ponzi zone
```

**Data (dari P3-A/djpk.ts):**
- TKD realisasi Nov 4: 84.93% (on pace, below shortfall trigger)
- Namun: PUAB O/N spread 117bps (ATH, dari KBMI EWS doc Nov 3)
- BPD dengan LDR tinggi (>80%) + TKD shortfall + PUAB stress = textbook speculative transition

**Signal yang sudah ada:** `fetchBpdEquityProxy()` BJBR + BJTM, `fetchTkdRealisasi()` shortfall flag  
**Yang kurang:** Minsky DSCR untuk BPD — interest expense / BPD operating income trend

---

### 2.4 Corporate Sector USD Debt — 1997 Loop (M13/M8)

**Mekanisme (dari Persona V SOUL.md + Toporowski-Cozzi 2006):**

```
Korporasi: revenue IDR + USD debt = currency mismatch
IDR depreciate 15% → USD debt service naik 15% dalam IDR
Jika EBITDA tidak tumbuh proporsional → hedge → speculative → Ponzi

Yang membuat 1997 collapse: unhedged + rollover + IDR spiral = forced dollar buying
                             forced dollar buying → IDR falls further → more Ponzi units
```

**Data 2026:**
- ULN private: ~$260B+
- Hedging compliance: estimated <70% (BI SULNI tidak publish compliance quarterly)
- USDIDR: 18,148 (up dari 15,900 di awal 2024 = +14.2% depreciation)
- 14.2% IDR weakening = effective cost increase 14.2% pada semua USD debt service

**Klasifikasi Minsky:**
- Perusahaan dengan full hedge + IDR revenue: **Hedge** (tidak terpengaruh)
- Perusahaan dengan partial hedge + USD mix revenue: **Speculative** (rate-sensitive)
- Perusahaan dengan no hedge + pure IDR revenue + USD debt: **Ponzi-at-risk** jika IDR >20,000

**Signal yang sudah ada:** `uln_hedging_compliance_pct` di M13 ULN  
**Yang kurang:** Minsky unit count — estimasi % korporasi di masing-masing regime

---

### 2.5 MBG (Makan Bergizi Gratis) — Fiscal Ponzi Risk (M10)

**Mekanisme (dari M10 engine + Barro-Gordon):**

```
MBG: Rp335T/year = 8.7% APBN
Funded by: peningkatan revenue + efisiensi belanja
Revenue 2026: shortfall vs target (M6 narrative divergence aktif)
Efisiensi: sudah digunakan untuk offset MBG sebelumnya

Jika revenue terus shortfall:
  APBN deficit melebihi 3% PDB (saat ini ~4.23%)
  Interest payment naik (rollover ke yield lebih tinggi)
  Interest/revenue ratio naik (sudah >20%, S&P watch >15%)
  → Sovereign fiscal Ponzi: harus nerbitkan SBN baru untuk bayar bunga SBN lama
```

**Ini adalah S&P interest/revenue metric yang sudah ada di M10 — tapi belum di-frame sebagai Minsky detection.**

---

## Bagian 3: Minsky Detection Framework untuk Dexter

### 3.1 Minsky Stress Index (MSI) — Proposed Metric

```typescript
interface MinskySectorAssessment {
  sector: 'bpdpks' | 'pertamina' | 'bpd' | 'corporate_fx' | 'fiscal';
  regime: 'hedge' | 'speculative' | 'ponzi' | 'unknown';
  dscr: number | null;         // debt service coverage ratio: OCF / debt service
  dscrTrend: 'improving' | 'deteriorating' | 'stable' | 'unknown';
  keyRisk: string;
  score: number;               // 0–20 per sector; Ponzi = 20, Speculative = 10, Hedge = 0
}

interface MinskySovereignDetector {
  assessments: MinskySectorAssessment[];
  overallRegime: 'systemic_hedge' | 'transition' | 'systemic_speculative' | 'ponzi_dominant';
  minskySector: number;        // 0–100 composite
  minskyMomentRisk: boolean;   // true if 2+ sectors Ponzi simultaneously
  transmissionPath: string[];  // which sectors likely to cascade
}
```

### 3.2 Score Mapping ke M8 dan M10

**M8 Banking — Minsky Bump:**
| Sector | Condition | Score Bump |
|--------|-----------|-----------|
| BPD | Speculative (TKD shortfall + PUAB >100bps) | +8 |
| BPD | Ponzi (DPK withdrawal + PUAB >150bps) | +15 |
| Corporate FX | Ponzi-at-risk (USDIDR >19,000 + hedging <55%) | +10 |
| PUAB O/N | ATH spread >100bps sustained 7d | +5 |

**M10 Fiscal — Minsky Bump:**
| Sector | Condition | Score Bump |
|--------|-----------|-----------|
| BPDPKS | Speculative (fund ratio <1.2×) | +5 |
| BPDPKS | Ponzi (fund ratio <0.8×) | +12 |
| Fiscal sovereign | Interest/revenue >20% (Ponzi boundary) | +8 (additive ke S&P flag) |
| MBG | Burn rate >9% APBN + deficit >3.5% | +5 |

### 3.3 Cross-Module Chain (Minsky Extension)

```
Minsky Ponzi sektor (M10) →
  Fiscal transfer delay (M10 credibility ↓) →
    Pertamina/BPD liquidity crunch (M8 ↑) →
      PUAB spread naik (IndONIA corridor ↑) →
        D-D run coordination conditions meningkat →
          KBMI contagion basket stress →
            System-wide Minsky Moment
```

Ini adalah **transmission path baru** yang tidak ada di SCD chain amplification saat ini. Minsky adds the *debt cycle* dimension sebelum crisis trigger — bukan hanya equilibrium selection (Morris-Shin) tapi juga *balance sheet deterioration* sebagai precondition.

---

## Bagian 4: Paper References

### Core Minsky
- **Minsky, H.P.** (1986). *Stabilizing an Unstable Economy*. Yale University Press. — definisi hedge/speculative/Ponzi
- **Minsky, H.P.** (1992). "The Financial Instability Hypothesis." Levy Economics Institute WP 74. — compact formulation

### Open Economy Extensions
- **Toporowski, J., and Cozzi, G.** (2006). "The Balance Sheet Approach to Financial Crises in Emerging Markets." SSRN WP 951751. — EM adaptation dengan corporate FX mismatch
- **Vercelli, A.** (2009). "A Perspective on Minsky Moments." Levy Economics Institute WP 579. — post-2008 formalization
- **Nersisyan, Y., and Wray, L.R.** (2010). "Does Excessive Sovereign Debt Really Hurt Growth?" Levy WP 603. — sovereign Ponzi detection

### Indonesia Specific
- **"Minsky and Indonesia: Revisiting the Indonesian Crisis by Financial Instability Hypothesis."** Springer (2010). Chapter 19. — 1997 Indonesia via FIH lens; corporate balance sheet fragility
- **The Jakarta Post** (May 15, 2026). "The calm that was never real: 'Minsky stability' as a source of instability." — 2026 application; foreign currency deposits +18.5% YoY vs IDR deposits +6.3%
- **SSRN WP 951751** (Toporowski-Cozzi). — framework untuk B2B aplikasi ke BPD/Pertamina

### B50/BPDPKS Mechanics
- **ANTARA News** (2026). "B50 program to save Indonesia Rp170 trillion in 2026." — official projection
- **East Asia Forum** (Oct 7, 2026). "Indonesia secures its fuel supply at the cost of its food and forests." — structural critique
- **CropGPT** (2026). "Indonesia launches B50 biodiesel amid subsidy strain." — Ponzi dynamics

---

## Bagian 5: Roadmap Implementasi

### Phase 1 — Data Collection (1 minggu)

```bash
# Buat sumber data baru: BPDPKS fund ratio
# Exa search quarterly BPDPKS siaran pers
# DB table: bpdpks_fund_adequacy_ratio (quarterly)

# Extend M10 untuk track:
# bpdpks_fund_balance_idr_t (dari Exa/ESDM siaran pers)
# bpdpks_quarterly_obligation_idr_t (dari mandate volume × FAME premium)

# Extend M8 untuk track BPD Minsky indicator:
# bpd_puab_exposure_pct (% BPD DPK funded dari PUAB)
# → proxy: PUAB O/N spread × BJBR/BJTM LDR
```

### Phase 2 — Engine Integration (2 minggu)

```
1. src/tools/macro/sources/minsky-detector.ts (baru)
   - fetchBpdpksMinskyData(): BPDPKS fund adequacy DSCR
   - assessCorporateFxMinsky(): USDIDR × hedging compliance → regime
   - assessFiscalMinsky(): interest/revenue → regime (extend M10 existing)
   - assessBpdMinsky(): PUAB spread × TKD shortfall → regime

2. M8 banking-stress-engine.ts: import dan score
3. M10 fiscal-engine.ts: import dan score
4. Output: MinskySovereignDetector di engine result
```

### Phase 3 — Cross-Module Chain (4 minggu, koordinasi dengan Chain Amplification)

```
Extend SCD chain amplification (M10 → M8 path):
  Current: M10 ≥55 AND M6 ≥60 AND M3 ≥55 → +8pp SCD
  Add: M10 Minsky ≥ speculative AND M8 Minsky ≥ speculative → +6pp SCD (additive)
  Add: ANY sector Ponzi → +10pp SCD (independent trigger)
```

### Phase 4 — Backtest Validation (2 minggu)

```
Test against 6 crisis events:
  - 1997: Corporate FX Ponzi (terprediksi dari B2 unhedged USD debt)
  - 2013 taper tantrum: speculative → did BI SRBI issuance prevent Ponzi?
  - 2020 COVID: government fiscal speculative entry
  
Validate: does Minsky detector fire BEFORE D-D run coordination?
Expected: yes — Minsky = balance sheet deterioration precursor, D-D = run trigger
```

---

## Bagian 6: Integration dengan Persona VI

Minsky FIH paling natural dibaca oleh **Persona VI — Strategic Behavior Analyst** (akan ditambah ke SOUL.md sesi ini). Alasannya:

Minsky bukan hanya deskripsi balance sheet — ini adalah *strategic interaction*:
- Borrower tahu mereka Ponzi tapi terus borrow karena "market will bail me out" = Nash equilibrium yang buruk
- Lender tahu portofolio berisiko tapi terus lend karena "first to exit loses" = coordination failure
- Minsky Moment = equilibrium breakdown ketika multiple actors simultaneously recalibrate

Ini sangat berbeda dari cara Persona V (External Balance) membaca balance sheet (ledger tracking) — Persona VI akan menambah lapisan *strategic incentive* mengapa sistem tetap di Ponzi zone bahkan ketika semua pelaku tahu kondisi tidak sustainable.

---

## Bagian 7: Interaction dengan GT Coverage Existing

| Existing Model | Minsky Interaction |
|---------------|-------------------|
| Diamond-Dybvig (M8) | Minsky = *precondition* untuk D-D run; Ponzi borrowers = fragile anchor untuk depositor confidence |
| Barro-Gordon (M10) | Fiscal Ponzi = extreme form discretion in Barro-Gordon; commitment device absent when DSCR < 1.0 |
| Morris-Shin (M3) | Minsky determines *attack zone width* — deeper in Ponzi = wider zone of multiple equilibria |
| Brunnermeier-Pedersen (M8) | B-P spiral = *accelerator* of Minsky Moment; forced asset sales = BP feedback loop |
| Calvo debt trap (M2) | Calvo = sovereign Minsky; debt trap = sovereign Ponzi requiring primary surplus to exit |

Minsky tidak menggantikan model yang ada — melengkapi dengan **debt-cycle timing dimension**. Model existing = equilibrium selection. Minsky = balance sheet condition yang *enables* multiple equilibria zone.

---

*Dokumen: docs/MINSKY_FIH_INDONESIA.md | Dibuat: 4 November 2026 | Research basis: Minsky (1986/1992) + EM extensions + Indonesia 2026 data | Victor @ Sadasa Intelligence*
