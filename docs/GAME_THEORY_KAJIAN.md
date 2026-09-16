# Kajian Game Theory dalam Dexter — Sep 16 2026
**"Dari 35% ke 63%: Roadmap Game Theory untuk Silent Crisis Detector"**
> **Update Sep 16 2026:** P1 Barro-Gordon, P2 Diamond-Dybvig, P3 Herding cascade — semua implemented Sep 15. Coverage naik 35% → **~51%**. Milestone Des 2026 (49%) terlampaui lebih awal.

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

*Dokumen: docs/GAME_THEORY_KAJIAN.md | Generated: Sep 14 2026 | Updated: Sep 16 2026 (P1+P2+P3 implemented, coverage 35%→51%) | Victor @ Sadasa Intelligence*
