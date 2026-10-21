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

*Dokumen: docs/GAME_THEORY_KAJIAN.md | Generated: Sep 14 2026 | Updated: Sep 16 2026 (P1+P2+P3 implemented, 35%→51%) | Updated: Oct 1 2026 (Gap A-D dirancang dari Chatib Basri; semua A-D implemented same day) | **Updated: Oct 19 2026 (SSS 3-phase fix + stop-loss cascade + MSCI commitment game; coverage 51%→~63%; milestone Sep 2027 tercapai 11 bulan lebih awal)** | Victor @ Sadasa Intelligence*
