# Kajian Game Theory dalam Dexter — Sep 14 2026
**"Dari 35% ke 63%: Roadmap Game Theory untuk Silent Crisis Detector"**

---

## BAGIAN 1: Status Implementasi Saat Ini (~35%)

### Thread 1/20
🧵 Dexter sekarang deteksi krisis IDR pakai 13 modul. Tapi seberapa dalam logika "strategic behavior"-nya? Spoiler: baru ~35%. Thread ini bahas gap + roadmap ke 63%. #GameTheory #IDR #Macro

---
*[ILUSTRASI 1: Pie chart — 35% filled (hijau = implemented), 65% empty (abu = gap). Label: "Game Theory Coverage dalam Dexter Sep 2026"]*

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
GAP BESAR #1: **Barro-Gordon time inconsistency**. Post-reshuffle, Suahasil Nazara BARU jadi Menkeu. Dia harus build credibility dari nol. Masalah: subsidi BBM 247% APBN → tekanan populis vs disiplin fiskal. Classic commitment vs discretion problem. BELUM ada di Dexter.

---
*[ILUSTRASI 6: Game tree — Node "Menkeu baru" → branch "Commit (ortodoks)" vs "Discretion (populis)". Bawah "Commit": market trust +, yield turun. Bawah "Discretion": short-term approval +, long-term credibility −. Label: "Barro-Gordon 1983"]*

---

### Thread 7/20
GAP BESAR #2: **Diamond-Dybvig bank run**. M8 Banking punya NPL 2.1%, Fintech NPL 5.0%, CAR 26.5%. Data ada. Yang BELUM ada: model koordinasi deposan. Kalau 3 kondisi terpenuhi (NPL spike + LDR >100% + IndONIA spread widening), bank run jadi self-fulfilling.

---
*[ILUSTRASI 7: Diamond-Dybvig matrix 2×2 — axis: "Deposan A tarik/tidak" × "Deposan B tarik/tidak". Nash equilibria: (tarik,tarik) = bank bangkrut, (tidak,tidak) = bank sehat. Arrow merah menunjuk ke panic equilibrium.]*

---

### Thread 8/20
GAP BESAR #3: **Herding/cascade di M5 Foreign Flow**. Sekarang M5 hitung net flow + MSCI overhang. Yang belum: apakah exit hari ini *meningkatkan* probabilitas exit besok? Strategic complementarity: EIDO turun → trigger passive redemption → turun lagi. Cascade belum dimodel.

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
*[ILUSTRASI 19: Roadmap peta jalan — garis horizontal dari Sep 2026 ke Sep 2027. Milestone: Des 2026 (P1+P2+P3 = 49%), Mar 2027 (3rd-gen = 54%), Jun 2027 (PolEcon = 59%), Sep 2027 (Bayesian = 63%). Warna gradient dari kuning ke hijau.]*

---

### Thread 20/20
KESIMPULAN: Dexter sekarang ~35% GT coverage — kuat di currency attack (Krugman + Morris-Shin) tapi blind spot di bank run coordination, herding cascade, time inconsistency fiskal, dan Bayesian credibility. Roadmap: 49% (6 bulan), 63% (12 bulan). Next: implementasi P1 dulu.

---
*[ILUSTRASI 20: Before/after bar chart — "Sep 2026: 35%" (kuning), "Des 2026: 49%" (hijau muda), "Sep 2027: 63%" (hijau tua). Sub-bar per konsep GT. Judul: "Dexter Game Theory Roadmap". Caption: "Dari currency attack detector → full strategic behavior engine."]*

---

## RINGKASAN DATA GAP (Quick Reference)

| Konsep | Data Ada | Data Gap | Sumber Gap | Horizon |
|---|---|---|---|---|
| **P1 Barro-Gordon** | Deficit %, interest/revenue, subsidi run rate | Commitment index, reversal frequency | Manual historical coding | 3 bulan |
| **P2 Diamond-Dybvig** | NPL, LDR, CAR, M2/reserves, IndONIA | Deposit concentration, interbank matrix, DPK velocity | OJK FSAP (non-publik) | 4 bulan |
| **P3 Herding cascade** | EIDO daily, IDX net flow, MSCI | Rolling autocorrelation, passive AUM split | Komputasi dari data ada | 2 bulan |
| **3rd-gen balance sheet** | ULN, CAR, FX reserves, SBN duration | FX hedging ratio korporasi, currency mismatch index | SULNI quarterly | 6 bulan |
| **Political economy** | Political score M12, headline count | Veto player mapping, payoff matrix per isu | Poltracking time series | 8 bulan |
| **Bayesian M6** | Semua divergence z-scores | Prior distribution dari 6 krisis historis, likelihood functions | Backtest calibration | 6 bulan |

---

## SOLUSI PREFERENSI

### Jangka Menengah (P1+P2+P3 → 49%):
- **P3 dulu** (2 bulan): data sudah ada, hanya tambah `eidoAutocorrelation()` ke M5 + cascade threshold. Effort paling rendah, impact tinggi.
- **P1 kedua** (bulan 3): tambah `commitmentIndex` ke M10 dari manual coding 5 kebijakan Kemenkeu terakhir. Post-reshuffle Suahasil = timing paling relevan.
- **P2 ketiga** (bulan 4): tambah `runCoordinationScore` ke M8 sebagai threshold matrix (NPL >4% AND LDR >95% AND IndONIA >BI+75bps → run risk HIGH).

### Jangka Panjang (→ 63%):
- **3rd-gen**: refactor M8+M13+M3 ke unified balance sheet amplifier. Data terbesar dari SULNI.
- **PolEcon M12**: butuh political science input — pertimbangkan integrasi Poltracking API atau manual quarterly update.
- **Bayesian M6**: paling technically demanding — butuh calibrate likelihood dari 6 krisis historis (backtest data sudah ada di `backtest/`).

---

*Dokumen: docs/GAME_THEORY_KAJIAN.md | Generated: Sep 14 2026 | Victor @ Sadasa Intelligence*
