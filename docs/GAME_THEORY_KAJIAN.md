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
KESIMPULAN: Dexter sekarang **~65% GT coverage** (naik dari 35% Sep 14 → 51% Sep 15 → 63% Oct 19 → 65% Oct 20 dengan PolEcon M12) — kuat di currency attack (Krugman + Morris-Shin), time inconsistency fiskal (Barro-Gordon), bank run coordination (Diamond-Dybvig), herding cascade (De Long/Shleifer), SSS 3-phase (Kreps-Wilson), stop-loss cascade (Eisenberg-Noe), PolEcon payoff matrix (Barro-Gordon BBM hike game). Blind spot tersisa: 3rd-gen balance sheet, PolEcon veto player, Bayesian M6 full calibration. Roadmap: 70% (12 bulan dari Oct 2026). **Milestone Sep 2027 (63%) terlampaui 11 bulan lebih awal.**

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
| **PolEcon payoff matrix (BBM hike)** | ✅ DONE Oct 20 | `polEconState` di M12 — Kemenkeu×Masyarakat EV game; TRAPPED/FORCED_HOLD/RISKY_HIKE/STABLE; +0–8pts score adj | P(resist) from unrest score; Brent-adjusted holdEV | — |
| **Political economy veto player** | ⏳ Open | — | Tsebelis 2002: Prabowo × DPR × cabinet. Butuh Poltracking time series | 8 bulan |
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

---

## BAGIAN 4: Oct 19 2026 — Crisis Regime: Tiga Implementasi Baru + Dua Gap Baru

> **Context:** IHSG sub-5,000 (−14.91% weekly, terparah sejak Jan 1998). MSCI Standalone consultation launched Oct 15 (Bryant common knowledge event FIRED). SSS 93→32 bug ditemukan dan di-fix. Coverage naik **~51% → ~63%** dengan tiga tambahan baru.
>
> **Tiga implementasi Oct 19:**
> 1. SSS 3-phase sequential equilibrium (SCD)
> 2. Stop-loss cascade sebagai threshold game (M9)
> 3. MSCI consultation sebagai credible commitment game (M5 + SCD)
>
> **Dua gap baru teridentifikasi:**
> 4. Post-Bryant execution dynamics (belum implemented)
> 5. Coordinated institutional response timing (belum implemented)

---

### Thread 21/20 — SSS 3-Phase Model sebagai Sequential Equilibrium

**Latar belakang bug:** SSS 93→32 ketika IHSG sub-5,000 mendorong `financialAvg` dari 33.6 ke 36.2 (melewati threshold 35). Formula lama: dua branch. `politicalLeadingFinancial` flip FALSE → `SCD × 0.5 = 32`. Semantik terbalik: *active transmission lebih berbahaya dari silent crisis, bukan lebih aman.*

**Game theory underpinning yang diabaikan:** SSS mengukur **divergence gap** antara political stress dan financial market pricing. Gap ini adalah informational asymmetry dalam sequential equilibrium:

```
State 1 — stable:         No stress, no gap. SSS rendah. Equilibrium unique.
State 2 — silent_crisis:  Political stress tinggi. Financial markets belum tau.
                           Ini adalah pre-play communication failure:
                           markets observe polrisk signal tapi treat it as noise
                           (institutional career risk dari being early = systematic
                           underreaction). Gap TERBUKA.
State 3 — active_transmission: Gap MENUTUP. Pasar mulai coordinate.
                           Ini bukan perbaikan — ini execution of the repricing
                           equilibrium. Multiple equilibria collapsed ke satu:
                           semua agen coordinate SELL karena public signal sudah
                           melebihi threshold (MSCI = common knowledge event).
```

**Sequential equilibrium (Kreps-Wilson 1982) yang benar:**
- State 2 → State 3 bukan improvement. Ini adalah **phase transition** dari "attack belum terjadi" ke "attack sedang berjalan."
- Di State 3, pertanyaan bukan lagi "will they attack?" tapi "what's the floor?" — berbeda secara fundamental.
- SSS seharusnya tetap tinggi di State 3 karena bahaya tidak berkurang — hanya sifatnya berubah dari probabilistic ke actualized.

**Implementasi fix (Oct 19):**
```typescript
// 3-branch formula:
activeTransmission = polrisk > 75 AND financialAvg ∈ [35, 55)
→ SSS = min(100, SCD × 1.3 + polrisk × 0.20)

// Oct 19 result: SSS = min(100, 63×1.3 + 99×0.20) = 100 ✓
// (vs bug: 32)
```

**Polrisk coefficient sedikit turun (0.25→0.20) di active_transmission:** Di silent_crisis, polrisk adalah *leading indicator* — komponen informasional utama. Di active_transmission, polrisk sudah partial-resolve ke financial stress (financialAvg naik). Weight polrisk berkurang, tapi elevated SCD mendominasi. Total SSS tetap tinggi.

**New output field:** `syntheticPhase: 'stable' | 'silent_crisis' | 'active_transmission'`
**Flag behavior:** active_transmission triggers Critical Flag terlepas dari nilai SSS numerik (pre-fix: SSS=32 → flag hilang dari morning brief di momen paling kritis).

---

*[ILUSTRASI 21: Phase transition diagram — tiga lingkaran: "STABLE (SSS rendah)" → "SILENT CRISIS (SSS tinggi, gap terbuka)" → "ACTIVE TRANSMISSION (SSS max, gap menutup, repricing underway)". Arrow berwarna: hijau→kuning→merah. Label tiap fase dengan threshold: financialAvg<35 / 35-55 / >55. Caption: "SSS bukan 'semakin rendah = semakin aman' — fase 3 lebih berbahaya dari fase 2."]*

---

### Thread 22/20 — Stop-Loss Cascade sebagai Eisenberg-Noe Threshold Game (M9)

**Konteks:** IHSG 4,918 (Oct 19 intraday). Node 5,000 BREACHED. Node 4,800 approaching.

**Framework: Multi-type sequential threshold game**

Stop-loss cascade bukan satu game — ini adalah sequence dari tiga sub-games dengan player-type berbeda di setiap node:

```
Node 1 — 5,000 (Psychological Floor):
  Players: retail investors + momentum algorithms + EM benchmark soft-floor managers
  Game type: mass action / coordination game (Schelling 1960)
  Decision: sell vs hold, observing aggregate price level
  Nash equilibrium: kedua equilibria exist (hold-hold, sell-sell)
  IHSG sub-5,000 = observable public signal → koordinasi ke sell-sell
  Selling: partially fundamental (stop-loss triggers) + partially coordination
  Reversible? YES — fundamental buyers dapat masuk jika price asserts floor

Node 2 — 4,800 (Mandate-Driven Floor):
  Players: EM-mandate institutional funds (post-MSCI Standalone = PROHIBITED from holding)
           OJK insurance fund solvency-floor rebalancers (regulatory, not choice)
  Game type: NO GAME — mandatory execution, tidak ada strategic choice
  Selling: UNCONDITIONAL. Cheaper IHSG tidak perlambat; justru mempercepat (urgency).
  Key distinction: bukan market game, tapi regulatory compliance trigger
  Reversible? NO until MSCI decision Jun 2027

Node 3 — 4,500 (Systemic Cascade):
  Players: domestic margin accounts (forced liquidation by broker)
           pension fund mandates (regulatory rebalancing threshold)
           foreign custody clearing thresholds (operational, not strategic)
  Game type: forced liquidation — tidak ada strategic consideration
  Selling: UNCONDITIONAL + TIME-CONSTRAINED (margin calls T+1 to T+3)
  Systemic: satu margin call memicu lainnya (network externality)
  Reversible? NO in short run; recovery butuh external capital injection
```

**Eisenberg-Noe (2001) Clearing Network relevance:**
Di Eisenberg-Noe, setiap node dalam jaringan memiliki kewajiban (`obligations`) kepada node lain. Clearing vector menentukan berapa yang bisa dibayar. Di cascade ini:
- Node 2 (mandate exits) bukan pilihan — itu kewajiban structural (mandate compliance)
- Node 3 (margin calls) adalah clearing vector: forced liquidation = obligation settlement

**Implementasi (Oct 19, M9):**
```typescript
const CASCADE_NODES = [
  { threshold: 5000, label: '5,000 psychological floor',
    description: 'Retail stop-losses + momentum algos + EM benchmark soft floors.' },
  { threshold: 4800, label: '4,800 mandate-driven floor',
    description: 'MSCI Standalone forced exits + OJK insurance solvency floor.' },
  { threshold: 4500, label: '4,500 systemic cascade',
    description: 'Margin calls + pension fund rebalancing + custody clearing.' },
];
// Bonus: +10pts per breached node, cap +30 (additive ke P/E+A/D base score)
```

**Implikasi untuk floor-finding:**
Setelah Node 2 fires, IHSG floor tidak ditentukan oleh fundamental valuation — ditentukan oleh *kapan mandatory sells selesai* (finite selling pressure) plus *siapa yang jadi fundamental buyer* (sovereign wealth fund, domestic retail accumulation). Ini adalah **thinning market problem**, bukan valuation problem.

**Live Oct 19:** Node 1 BREACHED (IHSG 4,918). Node 2 approaching (4,800 = −1.8% dari 4,918). Jika Node 2 fires, cascade berubah karakter: fundamental bid tidak cukup — butuh policy response (buyback program, BUMN danareksa, BI intervene ekuitas secara indirect).

---

*[ILUSTRASI 22: Waterfall diagram vertikal — IHSG dari atas ke bawah: 5,200 (normal) → 5,000 (Node 1: retail/momentum) → 4,800 (Node 2: mandate/regulatory) → 4,500 (Node 3: systemic). Setiap level punya player-type label + "Selling Type: coordination / unconditional / forced". Panah merah menunjukkan posisi 4,918 saat ini, dekat Node 2.]*

---

### Thread 23/20 — MSCI Consultation sebagai Credible Commitment Game

**Framework: Credible commitment + Sobel cheap-talk (extended)**

Situasi Oct 15: MSCI meluncurkan konsultasi reklasifikasi EM→Standalone dengan bahasa:
> *"expects to proceed unless consultation identifies clear evidence of material improvements"*

Ini adalah **pre-committed action** dalam game theory. Berbeda dari cheap talk.

**Mengapa ini credible commitment, bukan cheap talk:**
1. MSCI memiliki *reputational cost* yang besar jika mundur tanpa alasan kuat
2. Pengumuman dilakukan *out-of-cycle* (sebelum November Index Review) — menunjukkan deliberate urgency, bukan routine flag
3. Precedents: Russia 2022, Argentina 2021 — MSCI tidak pernah batal setelah announce
4. Bangkok roundtable Oct 13 (2 hari sebelum) = Indonesia gagal meyakinkan → keputusan sudah bulat sebelumnya

**Game structure:**

```
Players:
  - MSCI (pengumum + decision maker)
  - Indonesia/Pemerintah (reformer)
  - Market (observer + actor)

Period 1 (Oct 2026–Apr 2027): Consultation phase
  Indonesia chooses: cosmetic_reform vs structural_reform
    Cosmetic: cheap to announce, hard to verify in <6 bulan
    Structural: costly (enforcement, transparency overhaul), verifiable ≥12 bulan

  MSCI observes: reform_signals ∈ {visible_announcement, verifiable_implementation}
    MSCI type: Bayesian updater — weight implementation >>announcement

Period 2 (Apr 30 2027): MSCI decision
  MSCI chooses: proceed (Standalone) vs reverse (EM maintained)
    Proceed: loses Indonesia relationship + risk other EM markets watch
    Reverse: loses credibility globally; signal that governance concerns = negotiable
    → Reverse is DOMINATED for MSCI unless P(material improvement) > threshold

  MSCI threshold for reversal: requires observable enforcement cases + meaningful
    free-float compliance + verifiable anti-coordinated-trading actions
    Estimate: P(reversal | only cosmetic reform) < 15%
```

**Separating equilibrium:**
```
Strategy set untuk Indonesia:
  Type A (committed reformer): pay cost C_structural > 0 → signal credible → P(reversal) ↑
  Type B (tactical reformer): announce only → C=0 → MSCI reads as cheap talk → P(reversal) < 15%

Pooling equilibrium impossible: MSCI will wait for implementation signals, not announcements.
Separating equilibrium: only structural reform (enforceable in 6 months) separates types.
```

**Market pricing implication:**
Rational market prices `P(EM maintained) < 15%` dari konsultasi announcement. Setiap announcement dari Indonesia dianggap cheap talk sampai ada implementation evidence. Ini berbeda dari sebelum Oct 15 di mana announcement memiliki signaling value.

**Implementasi saat ini:** M5 Foreign Flow belum punya credible-commitment flag. Perlu tambah:
```
msci_reversal_probability: float  // prior 0.10-0.15; update on evidence of implementation
// Flag di M5 jika msci_reversal_probability < 0.20:
//   "MSCI COMMITMENT CREDIBLE: reversal P<20% — market should NOT price reversal
//    until verifiable structural reforms emerge. Cheap talk will not move this metric."
```

**Status: GAP TERIDENTIFIKASI — belum implemented.** Lihat Prioritas section di bawah.

---

*[ILUSTRASI 23: Game tree diagram — "MSCI Announces" (committed, costly signal) → branches ke "Indonesia: Cosmetic Reform" vs "Structural Reform". Under cosmetic: MSCI proceeds (dominant), P(reversal)=15%. Under structural: MSCI evaluates, P(reversal)=40%. Market pricing line di bawah: "Prices P(reversal)=15% until implementation signals emerge." Label: "Credible Commitment Game — Sobel 1985 extended"]*

---

### Thread 24/20 — Gap Baru #1: Post-Bryant Execution Dynamics

**Teridentifikasi:** Oct 19 2026. Belum implemented.

**Context:** Bryant (1980) common knowledge event sudah fired (MSCI Oct 15). Semua EM fund manager tahu, dan tahu bahwa yang lain tahu. Game theory memprediksi: dominant strategy = sell now.

**Gap yang ditemukan:** Bryant model berhenti di "event fires, coordination happens." Tapi execution dari koordinasi tersebut bukan instantaneous — ada multi-period dynamics:

```
Selling sequence post-Bryant:
  T+0 (Oct 15-16): Fast money / hedge funds → immediate sell (IHSG −11% Oct 16)
  T+1 to T+30: Passive ETF redemptions → basket sells (authorized participant mechanics)
  T+30 to T+90: EM benchmark rebalancing → mandate-driven exits (quarterly)
  T+90 to T+360: EM index removal implementation → structured exits
  T+360 (Jun 2027): MSCI final decision → final wave atau reversal
```

**Game structure di tiap periode:**
- T+0: coordination game sudah selesai — dominant sell
- T+1-30: ETF mechanics (operasional, bukan game)
- T+30-90: *wait game* — setiap institusi menunggu melihat reform signals sebelum size up short
- T+90-360: *information acquisition game* — institutions gathering evidence on reform credibility

**Implikasi yang belum di-model:**
Setelah T+30, pasar bukan lagi pure sell — sebagian institusi mungkin *buy on reform hopes* (contrarian bet). Ini menciptakan:
- Two-sided market: sellers (mandate-driven, unconditional) vs buyers (reform speculators, conditional)
- Price discovery problem: floor ditentukan oleh equilibrium antara dua grup
- Dexter belum model IHSG floor — hanya models selling pressure, bukan buying interest

**Status:** ⏳ **GAP TERBUKA.** Butuh: M9 tambah "reform speculation probability" indicator + buying interest proxy (short interest data, BEI buy-back announcements, BUMN stabilization fund signals).

---

*[ILUSTRASI 24: Timeline horizontal — T+0 (Bryant fires) → T+30 (ETF mechanics) → T+90 (wait game) → T+360 (MSCI decision). Di bawah timeline: "Selling pressure type" berubah tiap periode: immediate coordination → unconditional mandate → conditional/strategic. Caption: "Post-Bryant dynamics: selling pressure tidak uniform — model harus berbeda tiap periode."]*

---

### Thread 25/20 — Gap Baru #2: Coordinated Institutional Response Timing

**Teridentifikasi:** Oct 19 2026. Belum implemented.

**Context:** Pemerintah Indonesia punya beberapa instruments untuk merespons krisis:
- BUMN share buyback (PT Danareksa, BEI coordination)
- BI intervention (spot + DNDF + SRBI adjustment)
- Kemenkeu: fiscal signal (BBM hike timing, deficit communication)
- Danantara stabilization action (SWF)

**Game structure: Coordination game among policy instruments**

Setiap instrumen lebih efektif jika digunakan bersama-sama (complementarity):
```
Payoff matrix (simplified):
                    BI intervenes    BI holds
BEI buyback         (high, high)   (medium, low)
No buyback          (low, medium)    (low, low)
```

Nash equilibrium tunggal jika koordinasi ada: (BI intervenes, BEI buyback) = maximize floor.
Problem: institutional silos (BI independence, BUMN governance) membuat koordinasi sulit.

**Signaling game tambahan:**
Setiap instrumen yang digunakan *sends a signal* ke market:
- BI spot intervention alone → "only BI cares, Kemenkeu not aligned" → market reads as temporary
- BEI buyback alone → "defensive only, no macro support" → market reads as running out of ammo
- Coordinated package (BI + BUMN + Kemenkeu) → "crisis management mode" → market updates belief

**Implementasi yang dibutuhkan:**
```
policy_response_tracker (new M3/SCD component):
  - Monitor: BI DNDF outstanding change (weekly), BEI circuit breaker + buyback programs,
    Kemenkeu ALCo statements, Danantara stabilization signals
  - Classify response: isolated_instrument vs partial_coordination vs full_package
  - Score: full_package = KS#2 candidate (BI coordinated package kill switch)
  - Flag: "COORDINATED RESPONSE DETECTED" → reduce SCD by up to 8pp
```

**Status:** ⏳ **GAP TERBUKA.** Ini secara langsung berkaitan dengan KS#2 (kill switch Thesis #14: "BI coordinated stabilization package"). Saat ini KS#2 = MANUAL signal. Dengan implementasi ini, bisa menjadi auto-detectable (partial).

---

*[ILUSTRASI 25: 2×2 payoff matrix — rows: "BI intervenes/holds", columns: "BEI buyback/no buyback". Payoffs per cell. Label Nash equilibrium. Di bawah: timeline "isolated → partial → full package" dengan SCD impact tiap level.]*

---

## Coverage Update — Oct 19 2026

| Implementasi | Status | Modul | GT Basis |
|---|---|---|---|
| Morris-Shin 2nd-gen | ✅ Sep 14 | M3 FX Defense | Morris-Shin 1998 |
| Krugman/Flood-Garber 1st-gen | ✅ Sep 14 | M3 FX Defense | Krugman 1979, FG 1984 |
| Barro-Gordon time inconsistency | ✅ Sep 15 | M10 Fiscal | Barro-Gordon 1983 |
| Diamond-Dybvig bank run | ✅ Sep 15 | M8 Banking | Diamond-Dybvig 1983 |
| Herding cascade | ✅ Sep 15 | M5 Foreign Flow | De Long/Shleifer 1990 |
| SCD strategic complementarity | ✅ Sep 15 | SCD aggregator | Schelling 1960, Cooper-John 1988 |
| Sobel cheap-talk / Bayesian M6 | ✅ Sep 15 | M6 Narrative | Sobel 1985 |
| Gap A Rhetoric | ✅ Oct 1 | M10 Fiscal | Barro-Gordon extension |
| Gap B Multiplier Regime | ✅ Oct 1 | M10 Fiscal | Chatib Basri 2026 |
| Gap C Cross-Module Chain | ✅ Oct 1 | SCD aggregator | Theoretical prior |
| Gap D D-D Backstop | ✅ Oct 1 | M8 Banking | Diamond-Dybvig extension |
| **SSS 3-Phase Sequential Eq.** | **✅ Oct 19** | **SCD aggregator** | **Kreps-Wilson 1982** |
| **Stop-Loss Cascade Threshold Game** | **✅ Oct 19** | **M9 Market** | **Eisenberg-Noe 2001** |
| **MSCI Credible Commitment (dokumentasi)** | **✅ Oct 19** | **M5/SCD** | **Sobel 1985 extended** |
| MSCI commitment flag (implementation) | ⏳ Open | M5 Foreign Flow | Sobel extension |
| Post-Bryant execution dynamics | ⏳ Open | M9/M5 | Bryant 1980 extension |
| Coordinated policy response timing | ⏳ Open | M3/SCD (KS#2) | Coordination game |
| 3rd-gen balance sheet amplifier | ⏳ Open | M3+M8+M13 | Chang-Velasco 1998 |
| **Barro-Gordon PolEcon payoff matrix** | **✅ Oct 20** | **M12 Political Risk** | **BBM hike EV game: Kemenkeu×Masyarakat; TRAPPED/FORCED_HOLD/RISKY_HIKE/STABLE; polEconAdj 0–8pts** |
| Political economy veto player | ⏳ Open | M12 | Tsebelis 2002 — veto player (Prabowo × DPR × cabinet); requires Poltracking time series |

**Coverage estimate Oct 21 (incl. PolEcon M12 Oct 20):** ~**65%** (naik dari 51% pre-Oct-19 → 63% Oct 19 → 65% Oct 20). Target Sep 2027 original (63%) tercapai lebih awal — 11 bulan lebih awal dari roadmap.

---

## Prioritas Implementasi — Updated Oct 19 2026

| Gap | Effort | Data | Impact | Priority |
|---|---|---|---|---|
| MSCI reversal probability flag (M5) | 2 hari | Manual prior 0.10-0.15 | Prevents KS#3/KS#4 over-optimism | **P1** |
| Cascade node 2 policy response watch | 3 hari | BEI buyback + Danantara signals | KS#2 partial automation | **P1** |
| Post-Bryant selling-period classifier | 1 minggu | EIDO flow data + mandate period tracking | M5/M9 temporal dynamics | P2 |
| Gap D long-term LPS env var | 1 hari | Manual seed dari LPS Laporan 2025 | M8 backstop precision | P2 |
| 3rd-gen balance sheet (M3+M8+M13) | 6+ bulan | SULNI FX-hedging ratio | Unified loop model | P3 |
| Political economy veto mapping | 8 bulan | Poltracking time series | M12 structural | P3 |

---

*Dokumen: docs/GAME_THEORY_KAJIAN.md | Generated: Sep 14 2026 | Updated: Sep 16 2026 (P1+P2+P3 implemented, 35%→51%) | Updated: Oct 1 2026 (Gap A-D dirancang dari Chatib Basri; semua A-D implemented same day) | Updated: Oct 19 2026 (SSS 3-phase fix + stop-loss cascade + MSCI commitment game; coverage 51%→~63%; milestone Sep 2027 tercapai 11 bulan lebih awal) | **Updated: Nov 2 2026 (Brunnermeier-Pedersen spiral + Obstfeld escape clause + Calvo debt trap; tiga gap baru teridentifikasi; references section added; semua paper citations diverifikasi)** | Victor @ Sadasa Intelligence*

---

---

## BAGIAN 5: Nov 2 2026 — Tiga Gap Baru: Spiral, Escape Clause, Debt Trap

> **Context Nov 2 2026:** SCD 78% RED | Synthetic 100/100 TRANSMISSION UNDERWAY | 7/13 cross-confirmed.
> HIMBARA AT1 secondary 76.5% par. SBN 10Y z-score 2.59. IHSG P/E discount vs Thailand 47.1%.
> r−g = +2.35pp. Primary deficit ~−1.7% GDP. CDS 5Y 104.5bps. USDIDR 18,145. MSCI SAIR Nov 12 T-10d.
>
> **Tiga gap baru teridentifikasi:**
> 1. Brunnermeier-Pedersen (2009) Liquidity Spiral — M8+M9 INTERACTION (semua 3 kondisi fired hari ini)
> 2. Obstfeld (1996) Escape Clause (government side) — M3 (government loss function belum ada; Morris-Shin hanya model sisi spekulan)
> 3. Calvo (1988) Sovereign Debt Trap — M10/M13 (r-g flag sudah ada; trap mechanism self-fulfilling belum eksplisit)

---

### Thread 29/31 — Brunnermeier-Pedersen (2009): Liquidity Spiral

**Paper:** Brunnermeier, M. K., and Pedersen, L. H. (2009). "Market Liquidity and Funding Liquidity." *Review of Financial Studies*, 22(6), 2201–2238.

**Core mechanism:**

Market liquidity (kemampuan trade aset tanpa price impact besar) dan funding liquidity (kemampuan fund positions) saling berinteraksi dalam dua feedback loop:

**Loss spiral:** asset price ↓ → mark-to-market loss → equity capital berkurang → forced reduce positions → lebih banyak selling → asset price ↓ further.

**Margin spiral:** asset price ↓ → haircut/margin requirement naik → equity yang sama support fewer positions → forced deleveraging → more selling → asset price ↓ more.

Kedua spiral bisa berjalan bersamaan dan saling memperkuat.

**Tiga kondisi trigger (semua fired Nov 2 2026):**

| Kondisi | Threshold | Status Nov 2 | Nilai |
|---|---|---|---|
| Funding liquidity stress (AT1 secondary) | < 85% par | 🔴 FIRED | 76.5% par |
| Mark-to-market loss signal (SBN 10Y z-score) | z > 2.0 | 🔴 FIRED | z = 2.59 |
| Market liquidity thinning (IHSG P/E discount vs peers) | discount > 35% | 🔴 FIRED | −47.1% vs Thailand |

**Kenapa tiga kondisi ini maps ke spiral mechanism:**

1. **AT1 76.5% par** — HIMBARA AT1 bond di secondary market diprice 23.5pp di bawah par. Bond desks mengantisipasi loss-absorption event. Ini adalah *funding liquidity stress*: investor tidak mau fund bank capital instrument at par → bank cost of capital naik → bank mulai reduce loan growth → credit contraction. Analogous ke Brunnermeier-Pedersen "haircut rises" condition.

2. **SBN 10Y z=2.59** — Bank Indonesia hold ~20% assets di SBN domestik. Yield rise dari baseline → mark-to-market loss. Estimasi kasar: 6yr duration × 20% SBN/assets × 0.75pp yield rise dari neutral = ~0.9pp CAR erosion. Melampaui 0.8pp threshold yang sudah ada di M8. *Loss spiral precondition* terpenuhi.

3. **IHSG P/E 47.1% discount vs Thailand (7.5x vs 14.1x)** — Bid-ask spreads elevated: foreign mandate exiting (MSCI consultation), domestic buying power terbatas. *Market liquidity thinning* — Brunnermeier-Pedersen: ketika market liquidity menipis, funded traders tidak bisa offload positions tanpa large price impact → mereka reduce exposures pre-emptively → liquidity thins further → feedback loop.

**Gap di Dexter sekarang:**

M8 dan M9 score komponen ini secara terpisah. AT1 = M8 banking signal. SBN z-score = M2 sovereign. IHSG discount = M7 ASEAN RV / M9 market. Tidak ada fungsi yang mendeteksi **simultaneous firing** = spiral activation.

**Implementasi yang dibutuhkan:**

```typescript
// Kandidat lokasi: banking-stress-engine.ts atau scd-aggregator
function detectLiquiditySpiral(
  at1SecondaryPct: number,              // % of par; source: HIMBARA_AT1_SECONDARY_PCT env
  sbnYieldZScore: number,               // z-score SBN 10Y; source: M2 sovereign engine
  ihsgPeDiscountVsPeersPct: number,     // absolute % discount (positif = IHSG lebih murah)
): { active: boolean; score: number; detail: string } {
  const cond1 = at1SecondaryPct < 85;           // funding liquidity stress
  const cond2 = sbnYieldZScore > 2.0;           // mark-to-market loss signal
  const cond3 = ihsgPeDiscountVsPeersPct > 35;  // market liquidity thinning
  const active = cond1 && cond2 && cond3;
  const score = active ? 15 : 0;                // +15 to M8 when spiral fires
  const detail = `Brunnermeier-Pedersen spiral: AT1=${at1SecondaryPct}% par / SBN z=${sbnYieldZScore.toFixed(2)} / IHSG discount=${ihsgPeDiscountVsPeersPct.toFixed(1)}%`;
  return { active, score, detail };
}
// Nov 2 2026 result: active=true, score=+15
```

**Flag morning check:** `⚠ LIQUIDITY SPIRAL ACTIVE (Brunnermeier-Pedersen 2009): semua 3 kondisi fired — AT1 76.5%/SBN z=2.59/IHSG disc 47.1%.`

**Data sources (semua sudah tersedia):**
- AT1: `HIMBARA_AT1_SECONDARY_PCT` env var (sudah ada di .env)
- SBN z-score: dihitung di M2 sovereign engine dari `sbn_10y_yield_pct` DB
- IHSG discount: dihitung di M7 ASEAN RV dari Yahoo Finance P/E comparison

**Status:** ⏳ **GAP TERBUKA.** Effort: 1–2 hari. Semua input sudah tersedia.

---

*[ILUSTRASI 29: Diagram dua loop paralel — "Loss Spiral" kiri (SBN yield↑ → bank MTM loss → CAR erosion → reduce lending → SBN demand turun → yield↑). "Margin Spiral" kanan (AT1 ↓ → bank cost of capital↑ → reduce assets → more selling → AT1 ↓). Di tengah: "Market Liquidity" (IHSG discount) sebagai amplifier kedua spiral. Tiga kondisi Nov 2 2026 semua ditandai merah.]*

---

### Thread 30/31 — Obstfeld (1994, 1996): Escape Clause dan Government Loss Function

**Papers:**
- Obstfeld, M. (1994). "The Logic of Currency Crises." *Cahiers Économiques et Monétaires* (Banque de France), 43, 189–213.
- Obstfeld, M. (1996). "Models of Currency Crises with Self-Fulfilling Features." *European Economic Review*, 40(3–5), 1037–1047.

**Relasi ke yang sudah ada:**

Morris & Shin (1998) yang sudah diimplementasikan di M3 models **sisi spekulan** — kapan attack jadi profitable (DC > AC threshold, signal precision, Confidence Gate). Obstfeld (1994, 1996) models **sisi pemerintah** — kapan pemerintah/BI *memilih* menyerah vs defend. Keduanya complementary, tapi M3 sekarang hanya punya sisi Morris-Shin. Ini adalah *half the picture*.

**Government loss function (Obstfeld):**

```
L = (y* − y)² + λ · (e − ē)²
```

- `y* − y` = output gap = cost of defending (tight monetary policy / rate hike → growth loss)
- `e − ē` = exchange rate deviation dari implicit target = cost of abandoning peg
- `λ` = policymaker weight pada exchange rate stability vs employment/output

Pemerintah defend jika: `L(defend) < L(abandon)`

**Multiple equilibria zone:** ketika fiscal stress memaksa BI maintain SRBI cost tinggi dan rate elevated → `y* − y` naik → `L(defend)` naik → pada titik tertentu, abandon menjadi lebih murah dari defend — bahkan *sebelum* cadangan habis. Ini adalah escape clause: pemerintah rasional pilih deviate dari managed float.

**Self-reinforcing mechanism:** Market expektasikan BI akan abandon (karena L(defend) tinggi) → attack expected return naik → DC-AC gap menipis (Morris-Shin signal precision turun) → BI menghadapi lebih banyak tekanan → abandon makin mahal untuk ditolak → ekspektasi terkonfirmasi. Circular logic = multiple equilibria.

**Current parameter estimates (Nov 2 2026):**

| Parameter | Nilai | Sumber |
|---|---|---|
| BI Rate | 5.75% | BI RDG Jul 2026 |
| Neutral rate (proxy) | 4.5% | CLAUDE.md constant |
| SRBI sterilization cost | Rp52T/yr (~0.20% GDP) | M10 morning check |
| USDIDR aktual | 18,145 | M3 morning check |
| USDIDR APBN baseline | 16,500 | APBN 2026 |
| IDR deviation dari baseline | +9.97% | derived: (18145−16500)/16500 |
| M10 fiscal stress | 72/100 | morning check Nov 2 |

**Gap teridentifikasi:**

M3 sekarang model *vulnerability* (Morris-Shin: DC−AC gap, Confidence Gate, net score +15 = VULNERABILITY ZONE). Tapi tidak model:

1. BI's kalkulasi biaya defend vs abandon secara eksplisit — L(defend) vs L(abandon)
2. Bagaimana kenaikan M10 fiscal stress **menaikkan** L(defend) secara real-time → abandon relatif lebih murah dari sebelumnya
3. **Escape clause probability** sebagai fungsi dari fiscal stress + sterilization cost + IDR deviation

**Escape clause pressure score (proxy):**

```typescript
function escapeClausePressure(
  fiscalStressScore: number,       // M10 0–100
  srbiCostTrn: number,             // Rp triliun/tahun
  idrDeviationPct: number,         // % di atas APBN 16,500 target
): number {  // output: 0–15 tambahan ke M3 score
  // Pressure rises when fiscal cost of defending increases
  const fiscalP = Math.max(0, (fiscalStressScore - 55) / 45);  // 0 at M10=55, 1 at M10=100
  const srbiP   = Math.max(0, (srbiCostTrn - 30) / 40);       // 0 at 30T, 1 at 70T
  const idrP    = Math.max(0, (idrDeviationPct - 5) / 15);    // 0 at +5%, 1 at +20%
  const combined = (fiscalP + srbiP + idrP) / 3;
  return Math.round(combined * 15);
}
// Nov 2 2026:
//   fiscalP = (72−55)/45 = 0.378
//   srbiP   = (52−30)/40 = 0.550
//   idrP    = (9.97−5)/15 = 0.331
//   combined = 0.420 → escapeClausePressure = +6 pts to M3
```

**Perbedaan mendasar Morris-Shin vs Obstfeld:**
- Morris-Shin: *given* BI akan defend, kapan spekulan koordinasi serangan? → attack threshold, signal precision
- Obstfeld escape clause: apakah BI *akan* defend sama sekali, atau pilih menyerah demi menghindari growth cost? → government decision node

Keduanya harus dimodel bersama untuk full early warning. Sekarang M3 hanya punya *attacker's decision*, tidak punya *defender's decision*.

**Status:** ⏳ **GAP TERBUKA.** Effort: 2–3 hari. Cross-feeds dari M10 fiscal stress score (tersedia di `macro_scores` DB setelah setiap run).

---

*[ILUSTRASI 30: Decision tree dua level — Level 1 (Morris-Shin, sudah ada): "Spekulan: apakah attack profitable?" — DC vs AC comparison, Confidence Gate. Level 2 (BARU, Obstfeld): "BI: apakah defend worth it?" — L(defend) vs L(abandon), escape clause threshold. Current state: Level 1 = VULNERABILITY ZONE (net DC-AC +15) + Level 2 = escape clause pressure +6 (M10=72, SRBI=52T). Caption: "Morris-Shin models attacker; Obstfeld models defender — Dexter sekarang hanya punya setengah."]*

---

### Thread 31/31 — Calvo (1988): Sovereign Debt Trap

**Paper:** Calvo, G. A. (1988). "Servicing the Public Debt: The Role of Expectations." *American Economic Review*, 78(4), 647–661.

**Core mechanism:**

Multiple perfect-foresight equilibria di sovereign debt market. Model menunjukkan bahwa *ekspektasi investor saja* dapat menjadi self-fulfilling:

- **Good equilibrium:** investor ekspektasikan pemerintah solvent → yields rendah → debt service rendah → primary surplus cukup → tidak default → yields tetap rendah → ekspektasi terkonfirmasi.
- **Bad equilibrium:** investor ekspektasikan default risk → demand high yield → yields tinggi → debt service tinggi → fiscal space habis → default risk naik → yields naik lagi → ekspektasi terkonfirmasi.

Kedua equilibria bisa eksis secara simultan ketika fundamentals berada di *zona kritis* — investor beliefs menentukan equilibrium mana yang terealisasi.

**Trap condition (formal):**

```
Δ(debt/GDP) = (r − g) × (debt/GDP) − primary_surplus/GDP

Trap aktif ketika: (r − g) > primary_surplus / (debt/GDP)

Simplifikasi untuk monitoring:
trap_metric = (r − g) − (primary_balance / GDP)
  > 0 → debt ratio expanding secara mekanis
```

**Calvo trap berbeda dari r-g flag yang sudah ada di M13:**

| Aspek | r-g adverse flag (existing M13) | Calvo debt trap (gap) |
|---|---|---|
| Yang dimodel | Debt trend mechanic | Self-fulfilling expectations |
| Mekanisme | r > g → debt/GDP naik | Beliefs → yields → solvency → beliefs |
| Multiple equilibria | Tidak | Ya — dua equilibria bisa eksis |
| Trigger | Fundamental (interest vs growth) | Expectations shift (sunspot event) |
| Policy implication | Structural fiscal reform | Credible commitment + anchor |

**Current Indonesia calculation (Nov 2 2026):**

| Parameter | Nilai | Sumber |
|---|---|---|
| SBN 10Y yield (r) | 7.64% | M2 morning check (SBN 10Y = 7.747%; r dibulatkan ke 7.64% per M13) |
| GDP growth (g) | 5.3% | M0, BPS Q3 2026 est. |
| r − g | **+2.35pp** | Adverse — sudah diflag di M13 |
| Primary balance / GDP | **−1.70%** (estimasi) | M10: deficit 4.23% GDP − interest payments ~2.5% GDP |
| Debt / GDP | ~40% | World Bank, konsisten dengan APBN 2026 data |

**Trap metric:**
```
trap_metric = (r − g) − (primary_balance / GDP)
            = 2.35% − (−1.70%)
            = +4.05pp   →  TRAP CONDITION ACTIVE

Annual mechanical debt/GDP expansion:
  = trap_metric × debt_ratio / 100
  = 4.05% × 40% = 1.62% GDP per tahun

Tanpa perubahan fiskal, Indonesia debt/GDP naik ~1.6% GDP/tahun secara mekanis.
```

**Catatan penting:**
Primary balance −1.70% adalah *estimasi proxy*: APBN deficit 4.23% GDP dikurangi estimated interest payments. Angka ini perlu verifikasi dari APBN Kita terbaru (Kemenkeu quarterly release). Implementasi harus pakai proxy dulu sampai ada sumber resmi per-quarter.

**Implementasi:**

```typescript
function calvoDebtTrap(
  sbn10yYield: number,           // % annual; source: sbn_10y_yield_pct DB
  gdpGrowth: number,             // % annual; source: gdp_growth_pct DB
  primaryBalanceGdpPct: number,  // negatif = deficit (e.g. −1.7 untuk deficit 1.7% GDP)
  debtGdpRatioPct: number = 40,  // Indonesia est. ~40%; update saat data baru
): { active: boolean; metric: number; annualExpansionGdpPct: number } {
  const rMinusG = sbn10yYield - gdpGrowth;
  const metric = rMinusG - primaryBalanceGdpPct;       // positif = trap active
  const active = metric > 1.0;  // threshold: 1pp margin above zero
  const annualExpansionGdpPct = active ? (metric * debtGdpRatioPct / 100) : 0;
  return { active, metric, annualExpansionGdpPct };
}
// Nov 2 2026: metric=4.05, active=true, annualExpansion=1.62% GDP/yr
```

**Flag di morning check M10 dan M13:**
```
⚠ CALVO DEBT TRAP ACTIVE (Calvo 1988): r−g = +2.35pp, primary deficit ≈ 1.70% GDP
   → trap metric = +4.05pp
   → mechanical debt/GDP expansion: ~1.62% GDP/yr without additional spending
   [Distinct from r-g flag: Calvo adds self-fulfilling expectations dimension —
    investor belief shift alone can trigger yield spiral even before fundamentals deteriorate further]
```

**Effort:** Low — 1 hari. SBN 10Y dan GDP growth sudah ada di DB. Primary balance perlu proxy dari M10 engine output (deficit percentage − estimated interest ratio). Tidak butuh data source baru.

**Status:** ⏳ **GAP TERBUKA.** r-g adverse sudah ada di M13; Calvo trap = satu fungsi baru + cross-integration M10 primary balance estimate.

---

*[ILUSTRASI 31: Dua-equilibria diagram — "Good equilibrium" lingkaran kiri (yield rendah → debt service ok → no default → yield rendah). "Bad equilibrium" lingkaran kanan (yield tinggi → debt service jebol → default risk → yield lebih tinggi). Di tengah: "Nov 2 2026 Indonesia — trap metric 4.05pp" dengan arrow condong ke bad equilibrium zone. Sub-diagram: formula Δ(debt/GDP) dengan nilai aktual dimasukkan. Caption: "Berbeda dari r-g flag: Calvo memodelkan bagaimana ekspektasi saja bisa trigger spiral."]*

---

## Gap Deferred — Dua Model Belum Waktunya

### Abreu-Brunnermeier (2003): Synchronization Cascade — M5

**Papers:**
- Abreu, D., and Brunnermeier, M. K. (2002). "Synchronization Risk and Delayed Arbitrage." *Journal of Financial Economics*, 66(2–3), 341–360.
- Abreu, D., and Brunnermeier, M. K. (2003). "Bubbles and Crashes." *Econometrica*, 71(1), 173–204.

**Core mechanism:** Rational arbitrageurs tahu pasar akan crash — tapi tidak bisa observe kapan orang lain mulai sell. Masing-masing memiliki insentif untuk delay sell (ride trend terakhir). Cascade fires ketika cumulative sellers ≥ κ (critical mass). Timing: crash terjadi dalam window [t₀, t₀+η] bukan di satu titik. Semakin sempit η (window uncertainty), semakin predictable cascade timing.

**Aplikasi M5/MSCI:** Setiap EM fund manager tahu Standalone downgrade akan happen (P=86% per model). Mereka mau sell SETELAH riding rally terakhir, tapi SEBELUM yang lain sell. Cascade window = T-45d ke T-0 dari MSCI final decision. MSCI Nov 12 SAIR akan mempersempit η jika Standalone parameters dikonfirmasi.

**Kenapa defer sekarang:** T = T-240d dari Jun 30 2027 (final decision). Cascade risk tidak acute sampai T-90d (~Mar 2027). Tapi: setelah Nov 12 SAIR, perlu update η berdasarkan confirmation level.

**Action item post-Nov 12:** Jika SAIR Nov 12 konfirmasi Standalone parameters → update `MSCI_REVIEW_DATE` ke Jun 30 2027 → set reminder implement A-B logic di T-90d (~Apr 2027). Cascade window = T-45d = mid-May 2027.

---

### Mundell-Fleming Impossible Trinity Flag — Cross-Module Warning

**Framework:** Mundell (1963) / Fleming (1962) trilemma — tidak bisa ada tiga sekaligus:
1. Capital account openness (dibutuhkan untuk SBN foreign funding)
2. Managed exchange rate (dibutuhkan untuk import cost + subsidi predictability)
3. Independent monetary policy (dibutuhkan untuk inflation targeting)

BI sekarang mempertahankan (2) partial + (3) → sacrificing (1) increasingly (NDF cost naik, cadev tergerus). Setiap kenaikan M10 fiscal stress → more SBN yang harus dijual ke asing → butuh (1) terbuka → tapi IDR stabilization → butuh (2) → tapi BI Rate elevated → (3) active → trilemma binding.

**Implementasi:** Bukan scoring model — cukup cross-module warning flag di morning check:
```
if (M10 > 65 AND M3 > 45 AND M5 > 60):
  flag: "⚠ MUNDELL-FLEMING TRILEMMA BINDING: fiscal stress (M10=X) + FX defense (M3=Y) + capital flow (M5=Z) — impossible trinity constraint active. Non-linear risk elevated."
```

Nov 2 2026: kondisi MET (M10=72, M3=47, M5=75). **Effort: 2 jam. Quick win.**

---

## Coverage Update — Nov 2 2026

| Implementasi | Status | Modul | GT Basis | Paper |
|---|---|---|---|---|
| Morris-Shin 2nd-gen (attack side) | ✅ Sep 14 | M3 FX Defense | Currency attack coordination | Morris & Shin (1998) *AER* 88(3):587 |
| Krugman/Flood-Garber 1st-gen | ✅ Sep 14 | M3 FX Defense | Shadow exchange rate, BOP crisis | Krugman (1979) *JMCB* 11(3):311; Flood & Garber (1984) *JIE* 17:1 |
| Barro-Gordon time inconsistency | ✅ Sep 15 | M10 Fiscal | Commitment vs discretion | Barro & Gordon (1983) *JME* 12(1):101 |
| Diamond-Dybvig bank run | ✅ Sep 15 | M8 Banking | Bank run coordination failure | Diamond & Dybvig (1983) *JPE* 91(3):401 |
| Herding cascade (De Long-Shleifer) | ✅ Sep 15 | M5 Foreign Flow | Positive feedback, destabilizing speculation | De Long et al. (1990) *JF* 45(2):379 |
| SCD strategic complementarity | ✅ Sep 15 | SCD | Coordination failure | Schelling (1960); Cooper & John (1988) *QJE* 103(3):441 |
| Crawford-Sobel cheap-talk | ✅ Sep 15 | M6 Narrative | Strategic information transmission | Crawford & Sobel (1982) *Econometrica* 50(6):1431 |
| Gap A Rhetoric (Barro-Gordon ext.) | ✅ Oct 1 | M10 Fiscal | Announcement credibility, CI signal | Barro & Gordon (1983) ext. |
| Gap B Multiplier Regime | ✅ Oct 1 | M10 Fiscal | Fiscal effectiveness, regime-dependent | Chatib Basri (2026) + Blanchard framework |
| Gap C Cross-Module Chain | ✅ Oct 1 | SCD | Chain amplification, cross-corr | Theoretical prior, backtest calibration |
| Gap D D-D Backstop | ✅ Oct 1 | M8 Banking | Sovereign backstop credibility | Diamond & Dybvig (1983) ext. |
| SSS 3-Phase Sequential Eq. | ✅ Oct 19 | SCD | Phase transition, sequential equilibrium | Kreps & Wilson (1982) *Econometrica* 50(4):863 |
| Stop-Loss Cascade (Eisenberg-Noe) | ✅ Oct 19 | M9 Market | Multi-node threshold / clearing network | Eisenberg & Noe (2001) *MS* 47(2):236 |
| Bryant coordination game (MSCI) | ✅ Oct 19 | M5/SCD | Common knowledge coordination | Bryant (1980) *JBF* 4(4):335 |
| PolEcon BBM hike payoff matrix | ✅ Oct 20 | M12 Political Risk | Payoff matrix, EV game | Barro-Gordon extension; Nash (1950) |
| **Brunnermeier-Pedersen spiral** | **⏳ Gap terbuka** | **M8+M9** | **Funding–market liquidity spiral** | **Brunnermeier & Pedersen (2009) *RFS* 22(6):2201** |
| **Obstfeld escape clause (gov. side)** | **⏳ Gap terbuka** | **M3** | **Government loss function, escape clause** | **Obstfeld (1994, 1996) *EER* 40(3-5):1037** |
| **Calvo sovereign debt trap** | **⏳ Gap terbuka** | **M10/M13** | **Self-fulfilling debt spiral, multiple eq.** | **Calvo (1988) *AER* 78(4):647** |
| MSCI reversal probability flag | ⏳ Open | M5 | Credible commitment, separating equilibrium | Kreps (1982); Crawford-Sobel ext. |
| Post-Bryant selling-period classifier | ⏳ Open | M5/M9 | Temporal coordination dynamics | Bryant (1980) ext.; A-B (2003) |
| Coordinated policy response (KS#2) | ⏳ Open | M3/SCD | Coordination game among instruments | Nash (1950); Cooper & John (1988) |
| A-B synchronization cascade | ⏳ Deferred T-90d | M5 | Delayed arbitrage, synchronization risk | Abreu & Brunnermeier (2003) *Econometrica* 71(1):173 |
| Impossible Trinity flag | ⏳ Quick win 2 jam | Cross-module | Trilemma constraint | Mundell (1963) *CJEPS* 29(4):475; Fleming (1962) *IMF Staff Papers* |
| 3rd-gen balance sheet | ⏳ 6+ bulan | M3+M8+M13 | Balance sheet amplifier, currency mismatch | Chang & Velasco (2001) *QJE* 116(2):489 |
| Political economy veto player | ⏳ 8 bulan | M12 | Veto player model | Tsebelis (2002) *Veto Players*, Princeton UP |

**Coverage Nov 2 2026: ~65%** (tidak berubah — tiga gap baru teridentifikasi, belum implemented).
**Projected setelah tiga implementasi (Brunnermeier + Obstfeld escape clause + Calvo): ~70%.**

---

## Prioritas Implementasi — Updated Nov 2 2026

| # | Model | Modul | Effort | Kondisi Sekarang | Priority |
|---|---|---|---|---|---|
| 1 | **Brunnermeier-Pedersen spiral** | M8+M9 | 1–2 hari | SEMUA 3 KONDISI FIRED (AT1 76.5%, SBN z=2.59, IHSG disc 47.1%) | **P1 URGENT** |
| 2 | **Calvo debt trap flag** | M10/M13 | 1 hari | trap_metric = 4.05pp ACTIVE; r-g sudah ada, tinggal integrate primary balance proxy | **P1** |
| 3 | **Obstfeld escape clause** | M3 | 2–3 hari | M10=72, SRBI=Rp52T, IDR +9.97% → escapeClausePressure = +6 pts | **P1** |
| 4 | Impossible Trinity flag | morning-check | 2 jam | M10=72, M3=47, M5=75 → kondisi MET sekarang | P2 quick-win |
| 5 | MSCI reversal probability flag | M5 | 2 hari | Post-Nov 12 SAIR — update P(reversal) sesuai confirmation level | P2 post-Nov-12 |
| 6 | Gap D long-term LPS env var | M8 | 1 hari | `LPS_FUND_ADEQUACY_PCT` env var; manual seed dari LPS Laporan 2025 | P2 |
| 7 | Post-Bryant selling-period classifier | M5/M9 | 1 minggu | T+18d dari Oct 15 → approaching T+30 ETF mechanics window | P3 |
| 8 | A-B synchronization cascade | M5 | Low-effort | Defer ke T-90d dari MSCI decision (~Apr 2027) | Deferred |

---

---

## DAFTAR REFERENSI AKADEMIS LENGKAP

> Semua citations diverifikasi Nov 2 2026. Format: Author(s) (Year). "Title." *Journal*, Vol(Issue):Pages.

### Model Implementasi Core (✅ Sudah Live)

**Morris, S., and Shin, H. S.** (1998). "Unique Equilibrium in a Model of Self-Fulfilling Currency Attacks." *American Economic Review*, 88(3), 587–597.

**Krugman, P.** (1979). "A Model of Balance-of-Payments Crises." *Journal of Money, Credit and Banking*, 11(3), 311–325.

**Flood, R. P., and Garber, P. M.** (1984). "Collapsing Exchange-Rate Regimes: Some Linear Examples." *Journal of International Economics*, 17(1–2), 1–13.

**Barro, R. J., and Gordon, D. B.** (1983). "Rules, Discretion and Reputation in a Model of Monetary Policy." *Journal of Monetary Economics*, 12(1), 101–121.

**Diamond, D. W., and Dybvig, P. H.** (1983). "Bank Runs, Deposit Insurance, and Liquidity." *Journal of Political Economy*, 91(3), 401–419.

**De Long, J. B., Shleifer, A., Summers, L. H., and Waldmann, R. J.** (1990). "Positive Feedback Investment Strategies and Destabilizing Rational Speculation." *Journal of Finance*, 45(2), 379–395.

**Schelling, T. C.** (1960). *The Strategy of Conflict*. Harvard University Press, Cambridge, MA.

**Cooper, R., and John, A.** (1988). "Coordinating Coordination Failures in Keynesian Models." *Quarterly Journal of Economics*, 103(3), 441–463.

**Crawford, V. P., and Sobel, J.** (1982). "Strategic Information Transmission." *Econometrica*, 50(6), 1431–1451.
> *Catatan koreksi: dokumen versi sebelumnya menyebut "Sobel 1985." Paper seminal cheap-talk adalah Crawford & Sobel (1982). Sobel (1985) "A Theory of Credibility," Review of Economic Studies, 52(4):557 adalah paper berbeda tentang repeated games/credibility — juga relevan untuk BI credibility-building tapi tidak sama dengan cheap-talk model M6.*

**Kreps, D. M., and Wilson, R.** (1982). "Sequential Equilibria." *Econometrica*, 50(4), 863–894.

**Bryant, J.** (1980). "A Model of Reserves, Bank Runs, and Deposit Insurance." *Journal of Banking and Finance*, 4(4), 335–344.

**Eisenberg, L., and Noe, T. H.** (2001). "Systemic Risk in Financial Systems." *Management Science*, 47(2), 236–249.

### Model Gap Baru (⏳ Nov 2 2026 — Belum Implemented)

**Obstfeld, M.** (1994). "The Logic of Currency Crises." *Cahiers Économiques et Monétaires* (Banque de France), 43, 189–213.

**Obstfeld, M.** (1996). "Models of Currency Crises with Self-Fulfilling Features." *European Economic Review*, 40(3–5), 1037–1047.

**Brunnermeier, M. K., and Pedersen, L. H.** (2009). "Market Liquidity and Funding Liquidity." *Review of Financial Studies*, 22(6), 2201–2238.

**Calvo, G. A.** (1988). "Servicing the Public Debt: The Role of Expectations." *American Economic Review*, 78(4), 647–661.

### Model Deferred / Pipeline

**Abreu, D., and Brunnermeier, M. K.** (2002). "Synchronization Risk and Delayed Arbitrage." *Journal of Financial Economics*, 66(2–3), 341–360.

**Abreu, D., and Brunnermeier, M. K.** (2003). "Bubbles and Crashes." *Econometrica*, 71(1), 173–204.

**Mundell, R. A.** (1963). "Capital Mobility and Stabilization Policy under Fixed and Flexible Exchange Rates." *Canadian Journal of Economics and Political Science*, 29(4), 475–485.

**Fleming, J. M.** (1962). "Domestic Financial Policies under Fixed and under Flexible Exchange Rates." *IMF Staff Papers*, 9(3), 369–379.

### Model 3rd-Gen dan Jangka Panjang

**Chang, R., and Velasco, A.** (2001). "A Model of Financial Crises in Emerging Markets." *Quarterly Journal of Economics*, 116(2), 489–517. *(NBER Working Paper No. 6606, 1998)*

**Burnside, C., Eichenbaum, M., and Rebelo, S.** (2001). "Prospective Deficits and the Asian Currency Crisis." *Journal of Political Economy*, 109(6), 1155–1197.

**Tsebelis, G.** (2002). *Veto Players: How Political Institutions Work*. Princeton University Press, Princeton, NJ.

---

*Dokumen: docs/GAME_THEORY_KAJIAN.md | Generated: Sep 14 2026 | Updated: Sep 16 2026 (P1+P2+P3 implemented, 35%→51%) | Updated: Oct 1 2026 (Gap A-D dirancang dari Chatib Basri; semua A-D implemented same day) | Updated: Oct 19 2026 (SSS 3-phase fix + stop-loss cascade + MSCI commitment game; coverage 51%→~63%; milestone Sep 2027 tercapai 11 bulan lebih awal) | **Updated: Nov 2 2026 (Brunnermeier-Pedersen spiral + Obstfeld escape clause + Calvo debt trap; tiga gap baru teridentifikasi; references section added; semua paper citations diverifikasi)** | Victor @ Sadasa Intelligence*
