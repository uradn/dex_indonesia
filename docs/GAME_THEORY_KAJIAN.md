# Kajian Game Theory dalam Dexter — Sep 16 2026
**"Dari 35% ke 63%: Roadmap Game Theory untuk Silent Crisis Detector"**
> **Update Sep 16 2026:** P1 Barro-Gordon, P2 Diamond-Dybvig, P3 Herding cascade — semua implemented Sep 15. Coverage naik 35% → **~51%**. Milestone Des 2026 (49%) terlampaui lebih awal.
> **Update Oct 1 2026:** Kajian Chatib Basri "Perlukah Batas Defisit APBN 3 Persen?" (Kompas) mengekspos 4 implementation gap baru — Gap A (rhetoric tracking), Gap B (multiplier regime), Gap C (cross-module CI chain), Gap D (D-D sovereign backstop). Detail di Bagian 3.

---

## BAGIAN 1: Status Implementasi Saat Ini (~51%)

### Thread 1/20
🧵 Dexter sekarang deteksi krisis IDR pakai 13 modul. Tapi seberapa dalam logika "strategic behavior"-nya? Spoiler: ~51% per Sep 16 (naik dari 35% setelah Sep 15 sprint — P1+P2+P3 done). Thread ini bahas implementasi + roadmap ke 63%. #GameTheory #IDR #Macro

---
*[ILUSTRASI 1: Pie chart — 51% filled (hijau = implemented), 49% empty (abu = gap). Label: "Game Theory Coverage dalam Dexter Sep 2026"]*

---

### Thread 2/20
Yang SUDAH ada #1: **Obstfeld/Morris-Shin 2nd-gen model** di FX Defense (M3). Inti: serangan IDR bisa jadi self-fulfilling SEBELUM cadangan habis — kalau cukup spekulan percaya BI akan menyerah, menyerah jadi rasional.

---
*[ILUSTRASI 2: Diagram dua zona — "SAFE (DC≪AC)" → "VULNERABLE (DC≈AC)" → "ATTACK (DC≫AC)". Arrow menunjukkan transisi. Label DC = Defense Cost Index, AC = Abandonment Cost Index. Judul: "Confidence Gate: Multiple Equilibria Zone"]*

---

### Thread 3/20
Cara Dexter hitung: DC Index = beban kenaikan rate + pengorbanan growth + runway cadangan. AC Index = shock ULN dollarisasi + inflasi passthrough + kehilangan kredibilitas. Kalau DC > AC+20 → ATTACK zone. Real-time, per morning check.

---
*[ILUSTRASI 3: Formula box — DC formula di kiri, AC formula di kanan, dengan panah ke "Net Score = DC − AC". Zone mapping: >+20 = ATTACK 🔴, ±20 = VULNERABLE 🟠, <−20 = SAFE 🟢]*

---

### Thread 4/20
Yang SUDAH ada #2: **Krugman 1979 / Flood-Garber 1984 1st-gen** — shadow exchange rate. Hitung: pada tingkat cadangan berapa serangan jadi rasional? Dexter output "bulan sebelum serangan" + implied USDIDR saat collapse. Completeness: 80%.

---
*[ILUSTRASI 4: Timeline horizontal — "Sekarang (cadangan X)" → countdown → "Shadow rate = market rate" → "Attack rational". Brent $108.3 + USDIDR 17,595 ditandai posisi saat ini.]*

---

### Thread 5/20
Yang SUDAH ada #3: **Cheap-talk signaling** (implicit) di M6 Narrative Divergence. BI kirim sinyal guidance → market reprice. CV% dari z-score divergence: >20% = self-fulfilling threshold (Morris-Shin). >15% = fragile equilibrium. Completeness: 40%.

---
*[ILUSTRASI 5: Dua kolom — "Official Guidance" vs "Market Pricing". Arrow di antara = "credibility gap". Makin lebar gap = cheap talk territory. Warna merah kalau CV >20%.]*

---

### Thread 6/20
~~GAP BESAR #1~~ **✅ IMPLEMENTED Sep 15:** **Barro-Gordon time inconsistency**. Post-reshuffle, Suahasil Nazara BARU jadi Menkeu. Dia harus build credibility dari nol. Masalah: subsidi BBM 247% APBN → tekanan populis vs disiplin fiskal. Classic commitment vs discretion problem. **Sudah live di M10 Fiscal** — `credibilityIndex` 0-100, 4 sinyal (subsidi run-rate 35% + deficit 25% + S&P cost 25% + fiscal space 15%). Sep 16: CI=63, regime=STRAINED.

---
*[ILUSTRASI 6: Game tree — Node "Menkeu baru" → branch "Commit (ortodoks)" vs "Discretion (populis)". Bawah "Commit": market trust +, yield turun. Bawah "Discretion": short-term approval +, long-term credibility −. Label: "Barro-Gordon 1983"]*

---

### Thread 7/20
~~GAP BESAR #2~~ **✅ IMPLEMENTED Sep 15:** **Diamond-Dybvig bank run**. M8 Banking punya NPL 2.1%, Fintech NPL 5.0%, CAR 26.5%. **Sudah live di M8 Banking** — 5-condition matrix: NPL>3.5%, LDR>92%, IndONIA>40bps, fintech NPL>5%+growing, CAR erosion>0.8pp. Sep 16: 2/5 conditions → watch zone, skor 35. Model run coordination `runCoordinationScore` aktif.

---
*[ILUSTRASI 7: Diamond-Dybvig matrix 2×2 — axis: "Deposan A tarik/tidak" × "Deposan B tarik/tidak". Nash equilibria: (tarik,tarik) = bank bangkrut, (tidak,tidak) = bank sehat. Arrow merah menunjuk ke panic equilibrium.]*

---

### Thread 8/20
~~GAP BESAR #3~~ **✅ IMPLEMENTED Sep 15:** **Herding/cascade di M5 Foreign Flow**. **Sudah live di M5** — EIDO rolling autocorrelation lag-1 (10d+21d Pearson), cascade signal aktif kalau autocorr >0.6 sustained. Strategic complementarity: EIDO turun → passive redemption → turun lagi — sekarang dimodel sebagai `cascadeSignal` dengan threshold matrix.

---
*[ILUSTRASI 8: Cascade diagram — EIDO −3% → passive fund redemption → forced sell → EIDO −5% → lebih banyak redemption. Garis eksponensial merah. Label: "Strategic Complementarity = Coordination Failure"]*

---

### Thread 9/20
GAP BESAR #4: **3rd-gen crisis (Chang-Velasco 1998, Burnside-Eichenbaum-Rebelo 2001)**. Indonesia 2026: ULN $453B (M13) × kurs × SBN duration erosion CAR (M8) = balance sheet feedback loop. Belum ada model yang hubungkan ketiga modul ini secara eksplisit.

---
*[ILUSTRASI 9: Triangle diagram — tiga sudut: "Kurs IDR (M3)", "ULN Dollarisasi (M13)", "Bank CAR (M8)". Panah circular di antara ketiganya. Label: "3rd-gen: Balance Sheet Amplifier"]*

---

### Thread 10/20
GAP BESAR #5: **Political economy bargaining (M12)**. Model BBM hike decision sebagai bargaining game: Prabowo (veto player) × Menkeu (fiskal ortodoks) × Bahlil ESDM (populis) × tekanan street. Sekarang M12 hanya count headline + unemployment. Belum ada payoff structure.

---
*[ILUSTRASI 10: Bargaining tree — "Prabowo" di atas → dua branch ke "Izin hike" / "Blok hike". Masing-masing punya payoff: fiskal relief vs popularitas. Label: "Veto Player Model (Tsebelis 2002)"]*

---

### Thread 11/20
GAP BESAR #6: **Bayesian belief updating di M6**. BI umumkan hal A → market update belief P(BI credible | data). Setiap data point (SRBI bid-cover, SBN yield, CDS) update posterior. Sekarang M6 hanya hitung divergence snapshot — tidak track evolusi posterior. Belum ada.

---
*[ILUSTRASI 11: Bayesian chart — Prior P(credible) = 0.7 → observasi SRBI bid-cover 1.22 (lemah) → Posterior turun ke 0.52 → observasi CDS naik 82.8bps → Posterior 0.41. Garis stepwise menurun.]*

---

### Thread 12/20
Re: **Stackelberg BI vs spekulan** — kenapa marginal return rendah untuk crisis detection? Stackelberg berguna untuk TIMING intervention (first-mover advantage). Tapi Dexter misi = DETEKSI krisis, bukan prescription timing. Detection lebih butuh equilibrium selection, bukan sequential game.

---
*[ILUSTRASI 12: Dua kolom komparasi — "Stackelberg" (berguna untuk: timing intervensi BI, prescription). "Morris-Shin Global Games" (berguna untuk: deteksi vulnerability, prediksi attack threshold). Highlight: Dexter = detection → Morris-Shin lebih tepat.]*

---

### Thread 13/20
DATA GAP: **P1 Barro-Gordon** butuh apa? Data SUDAH ada: M10 fiscal credibility 63/100, APBN deficit 4.23% GDP, S&P interest/revenue 20.5%. Yang KURANG: (a) historical "commitment index" BI/Kemenkeu, (b) track record policy reversal Indonesia 2015-2026.

---
*[ILUSTRASI 13: Tabel dua kolom — "Data Ada" (hijau) vs "Data Gap" (merah). Baris: Deficit %, Interest/Revenue, Subsidi run rate, Inflation credibility gap. Gap: commitment index historical, reversal frequency, institutional strength score.]*

---

### Thread 14/20
DATA GAP: **P2 Diamond-Dybvig** butuh apa? Data SUDAH ada: NPL 2.1%, LDR 84%, CAR 26.5%, IndONIA spread, M2/reserves 3.9x. Yang KURANG: (a) deposit concentration (top-5 bank share), (b) interbank exposure matrix, (c) real-time DPK (deposit) growth trend.

---
*[ILUSTRASI 14: Funnel diagram — Input tersedia (hijau): NPL/LDR/CAR/M2/IndONIA. Input missing (merah): deposit concentration, interbank matrix, DPK velocity. Output yang diinginkan: "Run Probability Score" 0-100.]*

---

### Thread 15/20
DATA GAP: **P3 Herding cascade** butuh apa? Data SUDAH ada: EIDO daily, IDX net flow, MSCI status. Yang KURANG: (a) EIDO rolling autocorrelation (deteksi momentum self-reinforcing), (b) passive vs active AUM split Indonesia, (c) redemption threshold per fund type.

---
*[ILUSTRASI 15: Time series chart — EIDO price (biru) + rolling 10d autocorrelation (merah). Ketika autocorrelation >0.6 = herding signal aktif. Shaded area = "cascade risk zone".]*

---

### Thread 16/20
DATA GAP: **3rd-gen balance sheet** butuh apa? Data SUDAH ada: ULN $453B, CAR 26.5%, SBN duration ~6yr, FX reserves $146.5B. Yang KURANG: (a) FX-hedging ratio korporasi, (b) currency mismatch index bank, (c) real-time cross-module feedback coefficient.

---
*[ILUSTRASI 16: Balance sheet diagram dua kolom — Aset IDR vs Liabilitas USD. Kurs shock +10% → amplifikasi ke CAR, ke ULN/GDP, ke fiscal. Panah feedback loop warna merah.]*

---

### Thread 17/20
DATA GAP: **Bayesian M6** butuh apa? Data SUDAH ada: semua divergence z-scores (ICP, BBM gap, BI Rate vs SBN, guidance vs market). Yang KURANG: (a) prior distribution dari 6 krisis historis, (b) likelihood function P(data|credible) vs P(data|not credible).

---
*[ILUSTRASI 17: Bayesian network diagram — Node "BI Credible?" di tengah. Input nodes: SRBI bid-cover, CDS, SBN yield, ICP gap. Output: Posterior probability. Label threshold: P<0.4 = credibility crisis zone.]*

---

### Thread 18/20
SOLUSI JANGKA MENENGAH (3-6 bulan): P1+P2+P3 fully implementable dengan data yang ADA. P1: tambah commitment_index ke M10 (proxy: track record 5 kebijakan Menkeu terakhir, reversal rate). P2: tambah run_coordination_score ke M8 (threshold matrix). P3: tambah cascade_signal ke M5 (EIDO autocorrelation).

---
*[ILUSTRASI 18: Gantt chart — P1 (bulan 1-2), P2 (bulan 2-3), P3 (bulan 3-4), 3rd-gen (bulan 4-6), PolEcon (bulan 5-6), Bayesian M6 (bulan 6). Bar hijau = data ready, kuning = partial, merah = data gap.]*

---

### Thread 19/20
SOLUSI JANGKA PANJANG (6-12 bulan): 3rd-gen + PolEcon + Bayesian butuh data baru. Sumber: (a) OJK interbank matrix — resmi tapi tidak publik, butuh akses FSAP BI; (b) FX hedging ratio — SULNI Q-release; (c) political economy index — Poltracking/Indikator Politik Indonesia survey time series.

---
*[ILUSTRASI 19: Roadmap peta jalan — garis horizontal dari Sep 2026 ke Sep 2027. Milestone: Sep 15 2026 (P1+P2+P3 = **51%** ✅ DONE), Mar 2027 (3rd-gen = 56%), Jun 2027 (PolEcon = 59%), Sep 2027 (Bayesian = 63%). Warna gradient dari kuning ke hijau.]*

---

### Thread 20/20
KESIMPULAN: Dexter sekarang **~51% GT coverage** (naik dari 35% Sep 14 → 51% Sep 15) — kuat di currency attack (Krugman + Morris-Shin), time inconsistency fiskal (Barro-Gordon), bank run coordination (Diamond-Dybvig), herding cascade (De Long/Shleifer). Blind spot tersisa: 3rd-gen balance sheet, PolEcon bargaining, Bayesian M6 full calibration. Roadmap: 63% (12 bulan dari Sep 2026). **Milestone Des 2026 (49%) sudah terlampaui.**

---
*[ILUSTRASI 20: Before/after bar chart — "Sep 14 2026: 35%" (kuning), "Sep 15 2026: 51% ✅" (hijau), "Sep 2027: 63%" (hijau tua). Sub-bar per konsep GT. Judul: "Dexter Game Theory Roadmap". Caption: "Dari currency attack detector → full strategic behavior engine. Milestone Des 2026 terlampaui 3+ bulan lebih awal."]*

---

## RINGKASAN DATA GAP (Quick Reference)

| Konsep | Status | Implementasi | Gap Tersisa | Horizon |
|---|---|---|---|---|
| **P1 Barro-Gordon** | ✅ DONE Sep 15 | `credibilityIndex` di M10 — 4 sinyal, regime: committed/strained/discretion | Commitment index historical pre-2020 | — |
| **P2 Diamond-Dybvig** | ✅ DONE Sep 15 | `runCoordinationScore` di M8 — 5-condition matrix | Deposit concentration, interbank matrix | — |
| **P3 Herding cascade** | ✅ DONE Sep 15 | `cascadeSignal` di M5 — EIDO autocorr lag-1 (10d+21d) | Passive AUM split per fund type | — |
| **3rd-gen balance sheet** | ⏳ Open | — | FX hedging ratio korporasi, currency mismatch | SULNI quarterly + 6 bulan dev |
| **Political economy** | ⏳ Open | — | Veto player mapping, Poltracking time series | 8 bulan |
| **Bayesian M6** | ⏳ Open | Partial: Sobel cheap-talk posterior | Full likelihood calibration dari 6 krisis | 6 bulan dev |
| **Gap A — M10 Rhetoric** | ✅ DONE Oct 1 | `fetchFiscalRhetoricExa` + Tavily fallback — 14d Exa scan, keyword scoring commitment/discretion, CI adjusted ±6pts max via `rhetoricalNetSignal` | Exa existing key; Tavily fallback | — |
| **Gap B — Multiplier Regime** | ✅ DONE Oct 1 | `multiplierRegime` di M10 — rate_gap vs neutral 4.5% + growth_gap vs potential 5.4%; LOW_MULTIPLIER aktif Oct 2026 | SBN 2Y yield (WGB hanya 6wk data — tidak viable; pakai sbn10y−bi_rate slope proxy) | — |
| **Gap C — Cross-Module Chain** | ✅ DONE Oct 1 | `chainAmplification` di SCD — +max 8pp ketika M10≥55 AND M6≥60 AND M3≥55; theoretical prior corr 0.179 (kalibrasi setelah ≥90d live data) | Tidak ada; correlations hardcoded theoretical prior | — |
| **Gap D short-term** | ✅ DONE Oct 1 | `backstopStrained` di M8 D-D kondisi ke-6 (weight 0.5) — `apbn_deficit_pct_gdp > 4.5%` dari DB; effective max 5.5 conditions | Tidak ada; baca DB yang sudah ada | — |
| **Gap D long-term** | ⏳ Open | — | Env var `LPS_FUND_ADEQUACY_PCT` (pola BI_DNDF); manual seed dari LPS Laporan Tahunan ~April | 1 hari |

---

## SOLUSI PREFERENSI

### ✅ Sudah Selesai Sep 15 (P1+P2+P3 → 51%):
- **P3 Herding cascade** (M5): `cascadeSignal` — EIDO autocorr lag-1 10d+21d, threshold >0.6.
- **P1 Barro-Gordon** (M10): `credibilityIndex` 0-100 — 4 sinyal weighted. Sep 16: CI=63, regime=STRAINED.
- **P2 Diamond-Dybvig** (M8): `runCoordinationScore` — 5-condition matrix. Sep 16: 2/5 conditions.

### Jangka Menengah → Panjang (→ 63%):
- **3rd-gen balance sheet** (M3+M8+M13): refactor ke unified balance sheet amplifier. Data terbesar dari SULNI FX-hedging ratio korporasi. Est. 6 bulan.
- **PolEcon M12**: butuh Poltracking time series atau manual quarterly update. Veto player model (Tsebelis). Est. 8 bulan.
- **Bayesian M6 full calibration**: partial sudah ada (Sobel cheap-talk). Full butuh likelihood P(data|credible) dari 6 krisis historis — backtest data sudah ada di `backtest/`. Est. 6 bulan.

---

## BAGIAN 3: Gap Baru dari Kajian Fiskal Chatib Basri (Oct 2026)

> Sumber: Muhamad Chatib Basri, "Perlukah Batas Defisit APBN 3 Persen?" (Kompas). Dibagikan via X: https://x.com/ChatibBasri/status/2105070290581815761
> Basri = former Menkeu 2013-2014, Harvard CID / LSE CETEx.

### Gap A — M10 Rhetoric Tracking (Barro-Gordon Commitment Signal)

**Masalah:** M10 `credibilityIndex` tracking *realized* data: subsidi run-rate, deficit actual, S&P interest/revenue ratio. Tidak track *sinyal retoris* — pernyataan Menkeu tentang fleksibilitas 3% rule. Padahal Barro-Gordon pre-commitment game bergantung pada **announcement credibility**, bukan hanya realized outcomes.

**Konsekuensi yang diabaikan:** Satu pernyataan Suahasil Nazara "perlu dikaji ulang batas 3%" = signal discretion. Market update posterior P(fiscal credible) turun sebelum deficit angka berubah. CI saat ini 63 (STRAINED) bisa drop ke DISCRETION (<50) dari rhetoric saja — dan M10 tidak akan menangkap ini sampai data realized berubah seminggu kemudian.

**Solusi yang dirancang:**

```
fiscalCommitmentSignal (M10 enhancement):
  - Daily Exa scan: "Menteri Keuangan Suahasil Nazara" + "defisit" + (7 hari terakhir)
  - Keyword scoring:
      COMMITMENT signals (+): "disiplin fiskal", "tetap 3%", "komitmen", "konsolidasi", "ortodoks"
      DISCRETION signals (−): "perlu dikaji", "fleksibel", "kondisional", "tidak kaku", "sementara"
  - Score: net_signal = commitment_count − discretion_count, clamp(−3, +3)
  - Integrate ke CI: subtract up to 8pts dari CI ketika net_signal < 0
```

**Data yang dibutuhkan:**
- ✅ Exa search (sudah ada)
- ❌ Keyword taxonomy (harus dibuat manual — lihat tabel di bawah)
- ❌ Historical press statement corpus untuk kalibrasi baseline (Kemenkeu.go.id arsip)

**Keyword taxonomy awal:**

| Commitment (menguatkan CI) | Discretion (melemahkan CI) |
|---|---|
| "disiplin fiskal" | "perlu dikaji ulang" |
| "tetap pada 3 persen" | "fleksibel" |
| "konsolidasi fiskal" | "kondisional" |
| "fiskal ortodoks" | "tidak kaku" |
| "efisiensi belanja" | "ruang fiskal lebih lebar" |
| "penerimaan ditingkatkan" | "kebutuhan stimulus" |

**Effort:** 2 minggu. Tidak butuh data baru. Risiko: Exa coverage Kemenkeu press release belum teruji.

---

### Gap B — Multiplier Regime Flag (M10 Fiscal Effectiveness)

**Masalah:** M10 fiscal score sama di semua kondisi siklus. Chatib eksplisit: multiplier >1 hanya di *slack + low-rate*. Indonesia 2026 = BI Rate 5.75% (elevated, above neutral ~4.5%) + growth near-potential (5.3% vs target 5.4%) = **multiplier <1 regime**. Belanja fiskal ekspansif sekarang = inflationary, bukan growth-multiplying.

**Konsekuensinya:** M10 melaporkan fiscal expansion tanpa flag bahwa expansion tersebut tidak efektif secara makro — bahkan kontraproduktif (tambah deficit, tambah bunga, tidak dapat growth offset). Barro-Gordon CI tidak incorporate konteks ini.

**Solusi yang dirancang:**

```
multiplierRegimeFlag (M10 enhancement):
  Inputs (semua sudah tersedia di DB):
    r = bi_rate_pct                           // BI Rate (M2, fresh ≤30d)
    g = gdp_growth_pct                        // GDP growth annual (M0)
    neutral_rate = 4.5                        // Indonesia NAIRU proxy (konstanta)
    potential_growth = 5.4                    // APBN 2026 target (konstanta, update annually)

  Multiplier regime classification:
    rate_gap = r − neutral_rate               // >0 = restrictive monetary
    growth_gap = potential_growth − g         // >0 = below potential (slack exists)

    if rate_gap > 0.5 AND growth_gap < 0.3:  // Elevated rate + near-potential
      regime = 'LOW_MULTIPLIER'               // Fiscal expansion inflationary
    elif rate_gap < 0 AND growth_gap > 1.0:  // Accommodative rate + slack
      regime = 'HIGH_MULTIPLIER'             // Fiscal expansion growth-enhancing
    else:
      regime = 'NEUTRAL'

  Output: flag string di M10 narrative: "⚠ FISCAL MULTIPLIER: LOW (rate 5.75% > neutral 4.5%, growth near-potential)"
  CI adjustment: if regime = 'LOW_MULTIPLIER': subtract 5pts dari CI (expansion menurunkan kredibilitas)
```

**Data yang dibutuhkan:**
- ✅ bi_rate_pct (ada, M2)
- ✅ gdp_growth_pct (ada, M0)
- ✅ neutral_rate 4.5% (konstanta, bank consensus Indonesia)
- ❌ **SBN 2Y yield** — untuk yield curve slope (full implementation)
  - SBN 2Y = leading indicator siklus lebih sensitif dari GDP (quarterly lag)
  - Source: WGB Playwright sama dengan SBN 10Y — `bond-historical-data/indonesia/2-years/`
  - Effort: 3 hari untuk scrape + DB indicator `sbn_2y_yield_pct` baru
  - Freshness spec: 3/7/14 (sama dengan sbn_10y_yield_pct)
  - Yield curve slope = SBN 10Y − SBN 2Y: >1% = normal/bullish, <0% = inverted = recession signal

**Effort:** Short-term tanpa SBN 2Y: 1 minggu. Full dengan SBN 2Y: 3 minggu.

---

### Gap C — Cross-Module CI Chain (3rd-Gen Foundation)

**Masalah:** Empat modul (M10, M6, M3, M8) track secara independen. SCD aggregates via weighted sum. Tapi Chatib Basri + Barro-Gordon + Morris-Shin + Diamond-Dybvig semua describe **feedback loops**, bukan independent signals:

```
M10 CI drop (fiscal credibility)
  → M6 divergence rises (market no longer believes official guidance)
    → M3 DC-AC narrows (FX attack becomes rational sooner)
      → M8 run threshold lowers (sovereign backstop less credible)
        → SCD escalates nonlinearly (each module amplifies others)
```

Current SCD: linear weighted sum. Actual dynamics: **convex amplification when modules co-move**.

**Solusi yang dirancang:**

```
crossModuleAmplifier (new SCD component):
  Step 1: Compute pairwise correlation dari 6 historical crises (backtest data already in DB)
    corr_M10_M6 = pearson(m10_scores_crisis, m6_scores_crisis) across 6 events
    corr_M6_M3  = pearson(m6_scores_crisis, m3_scores_crisis) across 6 events
    corr_M3_M8  = pearson(m3_scores_crisis, m8_scores_crisis) across 6 events

  Step 2: Amplifier score
    chain_active = (CI < 55) AND (M6_score > 60) AND (M3_score > 55)
    if chain_active:
      amplifier = 1 + (corr_M10_M6 × corr_M6_M3 × corr_M3_M8) × 0.15
      // Max +15% amplification when all correlations = 1.0
    else:
      amplifier = 1.0

  Step 3: SCD_adjusted = SCD_raw × amplifier
    Cap: SCD_adjusted ≤ min(SCD_raw + 12, 100)  // Max +12pp dari amplifier alone

  Output: dashboard shows "⚡ Cross-module chain active: +Xpp amplification"
```

**Data yang dibutuhkan:**
- ✅ Module scores dari 6 backtest crises (ada di backtest historical-loader + replay-engine)
- ✅ macro_scores DB (module scores dari setiap run)
- ❌ Perlu satu kali **offline computation** untuk correlation matrix — bukan ongoing data
- ❌ Perlu refactor `silent_crisis_detector.ts` untuk incorporate amplifier post-aggregation

**Effort:** 4 minggu (architecture change ke SCD core — hati-hati regression ke backtest 6 crises). Ini adalah **Phase 1 dari 3rd-gen balance sheet** implementation (Thread 9 BAGIAN 1).

---

### Gap D — Diamond-Dybvig Sovereign Backstop Link

**Masalah:** M8 `runCoordinationScore` 5-condition matrix (NPL>3.5%, LDR>92%, IndONIA>40bps, fintech NPL>5%+growing, CAR erosion>0.8pp) tidak include **sovereign backstop credibility**. Diamond-Dybvig equilibrium selection fundamental: kalau depositor tahu ada credible lender-of-last-resort (LPS + BI + sovereign), panic equilibrium less likely. Ketika M10 CI = DISCRETION (<50), sovereign backstop credibility turun → panic equilibrium lebih mudah tercapai.

**Solusi yang dirancang:**

**Short-term (M10 CI proxy):**
```
condition_6_backstop = (M10_CI < 50)   // DISCRETION regime = backstop credibility low
  Weight: 0.5 (half-count vs other 5 full conditions)
  runCoordinationScore: was /5, now /5.5
  Threshold stays: ≥3/5 conditions = elevated run risk
  With backstop: ≥3.5/5.5 = elevated (same sensitivity at current levels)
```

**Long-term (LPS adequacy ratio):**
```
lps_fund_adequacy_pct (new indicator):
  Source: lps.go.id → Laporan Tahunan LPS → "Tingkat Kecukupan Dana"
  Cadence: annual (publish ~Apr each year for prior year)
  Freshness spec: 200d/365d/500d (annual publication)
  Threshold: <2% = LOW backstop, 2-3% = MEDIUM, >3% = ADEQUATE
  Stored as: lps_fund_adequacy_pct in DB
  M8 condition_6: lps_fund_adequacy_pct < 2.0 OR M10_CI < 50
```

**Data yang dibutuhkan:**
- Short-term: ✅ M10 CI (sudah computed, ada di macro_scores DB)
- Long-term: ❌ LPS adequacy ratio — manual annual scrape dari lps.go.id (no automated API)
  - LPS Laporan Tahunan 2025: est. publish Apr 2026 → sudah bisa di-seed manual
  - Historical: 2022=2.87%, 2023=2.94%, 2024=est.3.1% (trend naik — healthy)

**Effort:** Short-term: 1 minggu. Long-term LPS scrape: 2 minggu additional.

---

## Prioritas Implementasi (Updated Oct 2026)

| Gap | Status | Effort | Data | Impact |
|---|---|---|---|---|
| **Gap A rhetoric** | ✅ DONE Oct 1 | — | Exa existing key | M10 leading indicator |
| **Gap D short-term** | ✅ DONE Oct 1 | — | Tidak ada | M8 backstop realism |
| **Gap B partial** | ✅ DONE Oct 1 | — | slope proxy (sbn10y−bi_rate) | M10 cycle-awareness |
| **Gap C chain** | ✅ DONE Oct 1 | — | Theoretical prior (kalibrasi ≥90d) | SCD architecture |
| **Gap D long-term** | ⏳ Open | 1 hari | Env var LPS_FUND_ADEQUACY_PCT | M8 backstop precision |
| **Gap B full** | ⏳ Open (deprioritized) | — | SBN 2Y tidak feasible (WGB 6wk only) | Resolved via proxy |

**Semua Gap A-D implementable sudah selesai Oct 1.** Tersisa: Gap D long-term = env var 1 hari; Gap B full = tidak feasible.

---

*Dokumen: docs/GAME_THEORY_KAJIAN.md | Generated: Sep 14 2026 | Updated: Sep 16 2026 (P1+P2+P3 implemented, 35%→51%) | Updated: Oct 1 2026 (Gap A-D dirancang dari Chatib Basri; semua A-D implemented same day) | Victor @ Sadasa Intelligence*
