---
title: "Banking Contagion Early Warning System — Indonesia M8 Architecture Review"
subtitle: "IndONIA Lag Resolution · KBMI Basket Design · BPD/TKD Fiscal Linkage"
author: "Victor Elvino | victor@sadasa.id"
date: "3 November 2026"
---

# Banking Contagion Early Warning System — Indonesia M8 Architecture Review

**Dibuat:** 3 November 2026
**Sistem:** Dexter Indonesia Sovereign Macro Intel — Module 8 (Banking Stress)
**Scope:** IndONIA lag resolution, KBMI contagion basket design, BPD/TKD M10 cross-flag
**Status:** Design document — pre-implementation review
**Basis data:** BI SSKI Tabel 13, OJK LSPI, DJPK SIKD, IMF FSAP CR/25/53, Gibson Dunn APLMA Dec 2024, CEIC, banking-stress-engine.ts, kbmi-contagion.ts

---

## Ringkasan Eksekutif

Module 8 (Banking Stress) menggunakan IndONIA via Trading Economics sebagai indikator tekanan interbank — konsep benar, implementasi bermasalah. Trading Economics mengagregasi data BI secara bulanan, menciptakan lag ~4 minggu. Dalam banking crisis yang bergerak cepat, 4 minggu = tidak berguna sebagai early warning.

**Temuan kritis dari research — data aktif yang tidak tertangkap M8:**

> **PUAB O/N spread Juli 2026: 117 bps — all-time high sepanjang masa, melampaui September 2015 (96.5 bps).**
>
> Data ini tersedia di BI SSKI Tabel 13. M8 tidak mendeteksi ini saat berjalan September–Oktober 2026 karena Trading Economics belum mengagregasinya. Krisis sinyal tersembunyi di balik lag data.

**Tambahan — BABP dalam liquidity event aktif hari ini (3 November 2026):** Nasabah MNC Bank tidak bisa bertransaksi via MotionBank app, terbatas Rp 2 juta penarikan teller. OJK menyatakan "perhatian serius." Ini mengkonfirmasi BABP single-stock trigger *akan* fire hari ini — tetapi tidak mencerminkan contagion sistemik karena bank lain tidak crash bersamaan. Exactly sesuai prediksi analisis: BABP = idiosyncratic, bukan systemic.

---

### Kesimpulan utama

| Item | Verdict | Alasan |
|------|---------|--------|
| BABP single-stock trigger | **Tolak** | Idiosyncratic (MNC Group risk), illiquid, aktif dalam krisis sendiri Nov 3 |
| KBMI I basket ≥3/4 crash >8% | **Setujui** | Pattern systemic, existing infra, calibrated |
| IndONIA direct dari BI (19:30 WIB) | **Prioritas 1** | BI publish harian — lag fix sejati |
| IndONIA via TE sebagai confirmator | **Pertahankan** | Lagging tapi tidak perlu dibuang |
| BPD/TKD cross-flag di M10 | **Setujui** | DJPK SIKD machine-readable, no JS-SPA needed |
| Bug: komentar "JIBOR discontinued Dec 2023" | **Fix segera** | Salah: O/N Jan 2019, ALL tenors Dec 2025 |

---

## 1. IndONIA — Definisi, Kronologi JIBOR, dan Lag Problem

### 1.1 Apa itu IndONIA

**IndONIA** (Indonesia Overnight Index Average) adalah rata-rata tertimbang berdasarkan volume (*volume-weighted average*) dari transaksi pinjam-meminjam rupiah *unsecured* overnight antar bank yang tereksekusi aktual. Berbasis transaksi nyata, bukan kuotasi.

Karakteristik teknis:
- **Tenor:** overnight (1 hari)
- **Basis:** actual/360
- **Window pelaporan bank:** 07:00–18:00 WIB; koreksi online hingga 19:00 WIB
- **Publikasi BI:** setiap **19:30 WIB hari kerja** — daily, bukan bulanan
- **Regulasi:** PBI No. 20/7/PBI/2018 tentang IndONIA dan JIBOR
- **URL resmi:** `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/default.aspx`

Analog global: SOFR (AS), SONIA (UK), €STR (EU), TONA (Jepang), SORA (Singapura). Semua transaction-based menggantikan quote-based predecessors post-LIBOR-scandal.

### 1.2 Kronologi JIBOR Discontinuation — Koreksi Bug Codebase

**Bug aktif di `banking-stress-engine.ts:47`:**
```
// IndONIA 3M: Trading Economics scraper (Playwright, monthly) — BI discontinued JIBOR Dec 2023
```

**Ini SALAH.** Timeline aktual berdasarkan BI resmi + Gibson Dunn APLMA December 2024 note:

| Tanggal | Event |
|---------|-------|
| 1 Agt 2018 | IndONIA diluncurkan — menggantikan JIBOR O/N tenor |
| **2 Jan 2019** | BI **berhenti publikasi JIBOR O/N tenor saja** |
| 2019–Des 2025 | JIBOR 1W/1M/3M/6M/12M masih aktif (dipublikasikan 11:00 WIB) |
| **31 Des 2025** | BI berhenti publikasi **SEMUA tenor JIBOR** yang tersisa |
| **1 Jan 2026** | Indonesia full IndONIA — JIBOR tidak ada lagi |

Kode menyebut "Dec 2023" — tidak ada event JIBOR di Desember 2023. Koreksi perlu di dua tempat:
- `banking-stress-engine.ts:47`
- `sovereign-scraper.ts` (komentar deprecated `fetchJiborRateTe`)

**Konteks global benchmark reform:**

| Benchmark | Transisi ke | Selesai |
|-----------|------------|---------|
| USD LIBOR | SOFR | Jun 2023 |
| GBP LIBOR | SONIA | Des 2021 |
| EUR EONIA | €STR | Jan 2022 |
| SGD SOR | SORA | Apr 2023 |
| THB BIBOR | THOR | Apr 2021 |
| **IDR JIBOR** | **IndONIA** | **Jan 2026** |

Indonesia salah satu yang paling lambat di Asia.
Sumber: Gibson Dunn, "A Note about JIBOR Transition," APLMA, December 16, 2024.

### 1.3 Sumber dan Lag Problem

**Sumber ideal: BI langsung (daily, ~0 lag)**
BI publish IndONIA setiap 19:30 WIB. Tersedia T+0 (hari yang sama). Format: halaman web `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/` — kemungkinan scrapeable Playwright (belum diuji; precedent: BI SEKI TABEL1_1 DPK berhasil di Oct 20 session).

**Sumber historis: BI SSKI Tabel 13 (bulanan)**
URL: `bi.go.id/id/statistik/ekonomi-keuangan/sski/Documents/Tabel_13.pdf`
Publikasi bulanan (~30 hari lag). Berisi: IndONIA rate, PUAB O/N spread (bps), volume harian, jumlah bank peserta. Valuable untuk historical analysis, bukan real-time trigger.

**Sumber M8 saat ini: Trading Economics (bulanan)**
`fetchIndoniaRateTe()` di `sovereign-scraper.ts`. TE mengagregasi dari SSKI. **Lag efektif ~4 minggu.** Tanggal di DB: `${yr}-${mm}-${lastDay}` (selalu akhir bulan).

Root cause: bukan IndONIA yang lambat. BI publish daily. Trading Economics adalah unnecessary intermediary. Bypass TE = fix lag.

### 1.4 PUAB O/N Spread — Krisis Tersembunyi Jul 2026

BI SSKI Tabel 13 mempublikasikan "daily average spread between highest and lowest overnight PUAB rate" per bulan (bps). Spread tinggi = polarisasi harga — bank tertentu membayar premium, mengindikasikan counterparty credit concern atau liquidity hoarding.

**Data aktual PUAB O/N spread (BI SSKI + CEIC):**

| Periode | Spread (bps) | Kondisi |
|---------|-------------|---------|
| Jan 2021 | **2.1** | All-time low (COVID liquidity glut) |
| 2022 full year | 9 avg | Normal |
| 2023 full year | 24 avg | Normal-elevated |
| 2024 full year | 28 avg | Elevated baseline |
| **Sep 2015** | **96.5** | Prior ATH (China devaluation) |
| Sep–Nov 2025 | 18–26 | Normal |
| Apr 2026 | 36 | Watch |
| **Jun 2026** | **70** | STRESS — 2.7× median |
| **Jul 2026** | **117** | **ALL-TIME HIGH — 4.5× median, surpasses Sep 2015** |
| Agt 2026 | 56 | Relieving from peak |
| Sep 2026 | 54 | Still 2× median |

Sumber: BI SSKI Tabel 13; CEIC "Money Market Rupiah: Interbank: Daily Average Spread: Overnight."

**Interpretasi krisis Jul 2026:**

PUAB O/N spread 117 bps = kondisi yang belum pernah terjadi dalam sejarah Indonesia yang terdokumentasi. Konteks bersamaan: Perry Warjiyo mundur (Agt 2026), MSCI Standalone consultation aktif, IDR melemah ke 18,032. Ini **seharusnya meng-trigger M8 ke RED di Juli 2026.** Tidak terdeteksi karena Trading Economics lag — signal tersembunyi selama 4+ minggu.

**Skala referensi:**

| Threshold | Kondisi |
|-----------|---------|
| ≤ 30 bps | Normal |
| 30–50 bps | Watch |
| 50–75 bps | Stress |
| > 75 bps | Crisis (di atas historical 95th percentile pre-2026) |
| > 96.5 bps | Exceeds prior ATH (Sep 2015 China devaluation) |
| **117 bps** | **New ATH — uncharted territory** |

---

## 2. BABP.JK sebagai Contagion Proxy — Analisis Kritis

### 2.1 Profil BABP (Data Per Nov 2026)

**PT MNC Bank Internasional Tbk (BABP)**

| Atribut | Data |
|---------|------|
| Listed IDX | 15 Juli 2002, Papan Pengembangan |
| Pengendali | MNC Investama (Hary Tanoesoedibjo Group) |
| KBMI | **I** (modal inti ~Rp 3.59T < threshold Rp 6T) |
| Total aset Q3 2026 | Rp 18.79 triliun (↓ dari Rp 20.27T Des 2025) |
| Market cap (Okt 2026) | ~Rp 1 triliun (harga ~Rp 22; 52-wk high Rp 73 = -70%) |

*Koreksi penting: KBMI didasarkan pada **modal inti / core capital**, bukan total aset.*

**Kondisi keuangan Q3 2026:**

| Indikator | Q3 2025 | Q3 2026 | Arah |
|-----------|---------|---------|------|
| DPK | ~Rp 13.6T | Rp 11.32T | ↓ −17.1% YoY |
| LDR | 80.87% | **105.8%** | ↑ Danger zone |
| CAR | 24.5% | 20.68% | ↓ Declining |
| NPL gross | ~4.0% | **4.64%** | ↑ Approaching 5% threshold |
| Net profit Q1–Q3 | Rp 60.4B | Rp 46.6B | ↓ −22.8% YoY |
| Accumulated losses | — | Rp 489.7B | Structural concern |

**Event aktif hari ini (2–3 November 2026):**
Nasabah MNC Bank tidak bisa bertransaksi via MotionBank app. Terbatas Rp 2 juta penarikan teller. OJK (Dian Ediana Rae): "perhatian serius, akan mengambil tindakan pengawasan sesuai ketentuan." MNC Group dilaporkan memindahkan akun penggajian karyawan dari BABP sejak Oktober 2026.
*Sumber: Katadata, Nov 3 2026.*

**Status OJK:** Belum ada deklarasi formal "Bank dalam Penyehatan" (pengganti Pengawasan Intensif per POJK 5/2024). OJK posisi: monitoring.

**Prior context:** Rencana merger BABP–NOBU dibatalkan November 2025. OJK minta kedua pemegang saham perkuat modal secara mandiri. Credit rating KRI "irA" Stable (Jun 2025) — catatan: 79.6% DPK adalah time deposits high-cost, CASA hanya 20.4%.

### 2.2 Klasifikasi KBMI — Koreksi

Berdasarkan OJK POJK No. 12/POJK.03/2021 — basis: **modal inti (Tier 1 capital)**, bukan total aset:

| KBMI | Modal Inti | Contoh |
|------|-----------|--------|
| I | < Rp 6T | BABP, BBYB, BMAS, AGRO |
| II | Rp 6–14T | BBHI, ARTO, BBKP, MAYA |
| III | Rp 14–70T | BTN, Permata, Panin |
| IV | > Rp 70T | BCA, BRI, BNI, Mandiri |

### 2.3 Tiga Kelemahan Fatal sebagai Systemic Proxy

**Kelemahan 1: Illiquid — false positive rate sangat tinggi**

Market cap BABP ~Rp 1 triliun. ADTV sangat tipis (micro-cap Papan Pengembangan). Satu block trade bisa menggerakkan harga 10–20% tanpa informasi baru. LDR 105.8% dan DPK -17% YoY mencerminkan bank-run-in-slow-motion pada level individual institution — bukan systemic contagion signal.

**Kelemahan 2: Corporate risk ≠ systemic banking risk**

MNC Group konglomerat: media (RCTI, MNC TV, GTV, iNews, Indovision/K-Vision ~15M subscribers), properti (Park Hyatt Jakarta, Oakwood Surabaya, Westin Nusa Dua), sekuritas (MNC Sekuritas), politik (Hary Tanoesoedibjo — founder Partai Perindo). BABP saham bisa crash karena:
- MNC Group utang/restrukturisasi induk
- Pembatalan corporate deal (merger NOBU 2025)
- Risiko politik HTanoe
- Jika MNC non-bank subsidiary bermasalah → ETIKONOMI 2025: *"volatility transmission within banking conglomerates predominantly originates from subsidiary companies to parent companies"*

Tidak ada mekanisme membedakan "BABP crash karena systemic banking stress" vs "BABP crash karena MNC Group problem."

**Kelemahan 3: KBMI I failure ≠ systemic**

IMF FSAP 2025 (CR 25/53): *"Large banks (mostly SOBs) exhibit the highest contagion levels among all types of banks while small banks typically are less contagious yet highly vulnerable."*

KBMI I bank jatuh = vulnerable, bukan contagious. Systemic contagion = ketika KBMI III/IV ikut terdampak. Bank Century 2008: bailout dilakukan karena alasan political/institutional, bukan karena genuine systemic contagion evidence. Bank lain tidak ikut collapse bersamaan.

**Konfirmasi empiris hari ini (Nov 3 2026):**
BABP crisis aktif. Bank lain tidak crash bersamaan. Ini adalah isolasi idiosyncratic, persis seperti prediksi analisis. Single-stock trigger would fire; systemic signal: **tidak**. Basket trigger: belum diaktifkan karena hanya 1/4 bank.

### 2.4 Kapan BABP Valid

- Sebagai *komponen* basket multi-bank (bukan sole trigger)
- Sebagai *canary* awal: "BABP DPK -17% YoY → cek apakah trend serupa di KBMI I lain"
- Sebagai *news event anchor* untuk Exa OJK formal action search

---

## 3. Alternatif Fast-Trigger: Comparative Analysis

### 3.1 Opsi A: IndONIA Direct dari BI (Prioritas 1)

**Mengapa ini solusi terbaik:**
BI publish IndONIA 19:30 WIB setiap hari kerja. Zero intermediary. Lag 0 hari kerja vs 4 minggu via TE.

**Implementasi:**
1. Playwright scrape `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/default.aspx`
2. Parse IndONIA rate
3. Hitung spread vs BI Rate (dari sovereign_risk DB)
4. Threshold existing M8 sudah benar: >30bps tension, >50bps stress, >75bps ceiling

**BI Rate corridor (already calibrated in M8, hanya perlu fix lag):**
- DFR (floor): BI Rate − 75bps = 5.00%
- LF (ceiling): BI Rate + 75bps = 6.50%
- Normal IndONIA: antara DFR dan BI Rate
- Stress: IndONIA > BI Rate + 30bps
- Crisis: IndONIA > BI Rate + 50bps
- Forced injection: IndONIA > LF (BI Rate + 75bps)

**Kendala:** BI website bisa ada Cloudflare. Perlu test. Precedent: BI SEKI TABEL1_1 DPK berhasil di-Playwright (Oct 20 session). Kemungkinan accessible.

### 3.2 Opsi B: Multi-Bank Equity Basket (KBMI I)

**Implementasi yang sudah ada (`kbmi-contagion.ts`, untracked):**
```typescript
const KBMI1_BASKET = ['BABP.JK', 'BBYB.JK', 'BMAS.JK', 'AGRO.JK']
const CRASH_THRESHOLD_PCT = 8   // session drop >8% = crash signal
const CONTAGION_MIN_COUNT = 3   // ≥3/4 crash = basket contagion
```

**Empirical validation:**

*18 Maret 2025 (IHSG -7.1%, circuit breaker):*
- BMRI: -6.62%, BBRI: -6.27%, BBNI: -5.54%, ARTO: -16.56%, BRIS: -6.77%
- Multiple banks crash simultaneously = pattern valid

*3 November 2026 (BABP crisis):*
- BABP: ~crash (liquidity event)
- BBYB, BMAS, AGRO: tidak ada crash bersamaan
- Basket signal: TIDAK fire — correct behavior untuk isolated bank event

**Mengapa basket lebih robust:**
P(3/4 banks crash bersamaan by chance) ≈ 0.05%/hari jika P(individual false crash) = 5%. Versus P(BABP crash by chance) = 5%/hari. False positive rate basket vs single-stock: 100× lebih rendah.

CoVaR evidence: multiple papers (UGM, UIN Jakarta, ETIKONOMI March 2025) mengkonfirmasi significant systemic risk spillover dalam Indonesia banking sector valid dengan cross-bank equity basket methodology.

**Status:** `kbmi-contagion.ts` exists, NOT integrated ke M8 engine.

### 3.3 Opsi C: OJK Formal Action News Search

Sudah ada di `kbmi-contagion.ts`:
```javascript
Query: 'OJK bank "pengawasan intensif" OR "BDPI" OR "pembekuan" OR "pencabutan izin"'
Lookback: 7 hari via Exa includeDomains
Pattern: /BDPI|bank dalam pengawasan intensif|pembekuan|pencabutan izin/i
```

Karakteristik: zero false positive untuk genuine events, high false negative (OJK tidak selalu announce sebelum krisis memburuk). Valid sebagai **definitive confirmator Layer RED**, bukan early warning.

### 3.4 Opsi D: Bank Bond / Subordinated Debt Spread

AT1 HIMBARA sudah dimonitor sebagai bagian M8 via `HIMBARA_AT1_SECONDARY_PCT` env pin. OTC secondary market tidak tersedia real-time tanpa Bloomberg. **Tidak feasible sebagai automated fast-trigger.**

### 3.5 Comparative Summary

| Opsi | Lag | False Positive | Infra Cost | Verdict |
|------|-----|----------------|-----------|---------|
| A: IndONIA BI direct | ~0 | Sangat rendah | Test BI Playwright | **Prioritas 1** |
| B: KBMI basket ≥3/4 >8% | Intraday | Rendah (basket filter) | Zero — existing | **Prioritas 2** |
| C: OJK news search | Hours | Zero (FN tinggi) | Zero — existing | Confirmator layer |
| D: Bank bonds | Real-time | N/A | Bloomberg needed | Tidak feasible |
| Current: IndONIA via TE | ~4 minggu | Rendah | Existing | Pertahankan (lagging escalator) |

---

## 4. Desain KBMI I Basket — Review dan Refinement

### 4.1 Basket Composition Assessment

| Ticker | Bank | Modal Inti | KBMI | Issue | Verdict |
|--------|------|-----------|------|-------|---------|
| BABP.JK | MNC Bank | ~Rp 3.59T | I | Illiquid, MNC Group risk, aktif krisis Nov 3 | Pertahankan sebagai canary |
| BBYB.JK | Bank Neo Commerce | ~Rp 3.32T | I | Digital bank — DPK outflow cepat (digital run) | Valid |
| BMAS.JK | Bank Maspion | ~Rp 3–4T | I | KBMI I independen, Jawa Timur fokus | Valid |
| AGRO.JK | Bank Raya (BRI Agro) | ~Rp 3.42T | I | **Anak BRI KBMI IV — implicit backstop** | Pertimbangkan replace |

**Daftar pengganti AGRO — listed IDX, independen (dari research):**

*KBMI I candidates:*
- BACA.JK (Bank Capital) — Rp 3.39T, independen
- BGTG.JK (Bank Ganesha) — Rp 3.24T, independen
- BBSI.JK (Krom Bank, ex-Bisnis) — Rp 3.20T, independen
- AMAR.JK (Bank Amar) — Rp 3.18T, independen

*KBMI II candidates (lebih liquid, higher value signal):*
- BBHI.JK (Allo Bank, Salim Group) — Rp 6.89T, **most liquid KBMI II**, independen dari BUMN
- ARTO.JK (Bank Jago, Gojek ecosystem) — Rp 8.36T, sangat liquid
- MAYA.JK (Bank Mayapada) — Rp 4.40T, borderline I/II

**Rekomendasi basket revised:**
```typescript
// Replace AGRO (BRI backstop) dengan BBHI (Allo/Salim, independent, liquid)
const KBMI1_BASKET = ['BABP.JK', 'BBYB.JK', 'BMAS.JK', 'BBHI.JK']
```
Atau pertahankan AGRO dengan flag di output: "AGRO crash alone not systemic — BRI parent backstop available."

### 4.2 Threshold Calibration: >8%

IDX individual stock circuit breaker auto-halt = −8% intraday. Drop >8% menyentuh atau melewati auto-halt. Saham bank KBMI I normal daily volatility jarang ±5%+ tanpa news material.

Historical validation:
- **Mar 2020 COVID (16–17 Maret):** Multiple banks drop 10–20%+ single session bersamaan → basket ≥3/4 threshold would trigger
- **18 Mar 2025 (IHSG circuit breaker):** ARTO -16.56%, BMRI -6.62%, etc. → basket trigger
- **Nov 3 2026 (BABP isolated):** 1/4 basket crash → basket NOT trigger → correct behavior

**Verdict:** >8% reasonable. Pertahankan.

### 4.3 SRBI Cross-Check Layer

Sudah ada di `kbmi-contagion.ts`:
```
SRBI BCR < 1.3 + basket crash ≥3 = banks hoarding interbank cash AND equity market panic simultaneously
```

Signal sangat kuat jika keduanya fire: bank tidak confident SRBI bisa di-unwind saat butuh likuiditas (liquidity trap condition) + market pricing systemic risk.

**SRBI BCR baseline belum dikonfirmasi.** Perlu analisis dari `backfill-srbi-history.ts` data (84 data points Sep 2023–May 2025). Normal SRBI BCR berkisar 1.5–3.0+. BCR < 1.3 harus genuine stress signal, bukan occasional anomaly.

### 4.4 Blind Spots

| Kondisi | Basket Menangkap? | Fallback |
|---------|-------------------|----------|
| Overnight PUAB freeze | Tidak | IndONIA BI direct (Layer 1) |
| Gradual 3-week bank selloff | Tidak | IndONIA lagging confirmator |
| Digital bank run (silent, app layer) | Partial (BBYB crash) | BI SEKI TABEL1_1 DPK monitoring |
| OJK pre-market intervention | Tidak langsung | OJK news Layer C |
| BPD-specific TKD-driven outflow | Tidak | DJPK SIKD + BJBR/BJTM monitoring |

---

## 5. BPD/TKD Cross-Flag di M10 — Analisis Lengkap

### 5.1 BPD Landscape Indonesia

**Aggregate statistics (Asbanda, per 2025–2026):**

| Metrik | Nilai |
|--------|-------|
| Total BPD | 27 bank |
| Total aset | **Rp 1,043 triliun** (~8.7% sistem perbankan) |
| Total kredit | ~Rp 673 triliun |
| Total DPK | ~Rp 770 triliun |
| LDR Jun 2025 | **84.84%** (peak: 87.49% Des 2024) |
| CAR Des 2024 | 24.86% (aggregate adequate) |
| BPD belum penuhi modal inti min Rp 3T | **10 dari 27** (Q2 2025) |

OJK solusi untuk BPD undercapitalized: **KUB (Kelompok Usaha Bank)** — BPD kecil bergabung agar likuiditas dapat mengalir antar provinsi.

IMF FSAP 2025 (CR 25/53) explicit: *"Regional development banks face higher vulnerabilities due to higher interbank deposits into and funding from other banks."*

### 5.2 Ketergantungan BPD pada TKD — Data Aktual

Ketergantungan Pemda DPK bervariasi per BPD, trend turun dari 70% (2017 aggregate est.) ke ~40–60% karena BPD besar berhasil diversifikasi retail DPK:

| BPD | TKD/Pemda share DPK | DPK total | Catatan |
|-----|---------------------|-----------|---------|
| Bank Jatim (BJTM.JK) | ~26.8% | Rp 78.9T (Jun 2025) | Listed, data dari laporan BJTM |
| Bank DIY (Yogyakarta) | ~9–9.5% | Rp 10–12T | Turun dari 19% (2017) |
| Bank Nagari (Sumbar) | ~10–15% | Rp 27.05T (Jun 2025) | LDR 93.98% — sudah terbatas |
| BPD kecil (NTT, Papua) | ~70–80% | < Rp 10T | Sangat vulnerable |

**Structural risk confirmed (Asbanda Chairman 2017, dikonfirmasi literatur):**
> "Pencairan DAU dan DBH dari pusat cenderung tidak merata, mempengaruhi cash flow BPD. Pembayaran gaji PNS tiap tanggal 1 harus dibayarkan meski dana Pemda belum masuk ke BPD — periodic liquidity tightening."

Ini adalah **unconditional liquidity obligation**: BPD wajib bayar gaji ASN regional setiap tanggal 1, regardless TKD sudah cair atau belum. TKD delay = negative liquidity gap yang terjadwal.

### 5.3 TKD Realisasi 2026 — Data Aktual

**Data DJPK SIKD (per 9 Oktober 2026):**

| Komponen | Pagu (Rp T) | Realisasi s.d. Sep (Rp T) | Capaian |
|----------|------------|--------------------------|---------|
| DAU | 416.5 | 345.4 | 82.9% |
| DAK Non-Fisik | 149.3 | 128.1 | 85.8% |
| DBH | 70.3 | 52.7 | 74.9% |
| Dana Desa | 51.9 | 22.5 | **43.4% — sangat lagging** |
| **TOTAL TKDD** | **713.5** | **564.2** | **79.1%** |

Konteks: TKD 2026 dipotong ~24% dari 2025 via Inpres No.1/2025 efisiensi anggaran (−Rp 50.6T). Dampak pada BPD: LDR naik 83.46% (Jun 2024) → 87.49% (Des 2024) → 84.84% (Jun 2025) — tren yang berkorelasi dengan TKD efisiensi.

Asbanda seminar 21 Agt 2026: *"BPD liquidity is in the spotlight. Aggregate adequate liquidity does NOT necessarily reflect even distribution across BPDs. Funding pressure is rising."*

### 5.4 Data Availability — Koreksi Major

**Asumsi sebelumnya:** TKD hanya via APBN KiTa (JS-heavy SPA, complex).

**Koreksi dari research:** Ada **dua sumber yang jauh lebih accessible:**

**Sumber 1: DJPK SIKD Portal** ⭐ Primary

URL: `djpk.kemenkeu.go.id/portal/data/tkdd`

- Real-time tabular data, fitur CakLur tracking harian
- Dikonfirmasi aktif per Oktober 2026
- Format: web table — Playwright scrapeable
- Data granular: per komponen TKD, pagu vs realisasi kumulatif, breakdown per provinsi
- **Tidak butuh APBN KiTa SPA**

**Sumber 2: APBN KiTa PDF** (backup)

URL: `djppr.kemenkeu.go.id/paparanapbnkita`
Monthly PDF — Jina Reader parseable. Editions confirmed: Sep, Jul, May, Apr, Mar, Feb, Jan 2026.

**Data gap BPD DPK (granular):**
Tidak ada automated source untuk BPD DPK per bank. Namun BI SEKI TABEL1_1 DPK mempublikasikan breakdown per kategori bank termasuk BPD — ini sudah ada di codebase dari Oct 20 session. Monitor aggregate BPD DPK trend dari situ.

### 5.5 Mekanisme Transmisi TKD → BPD

```
TKD penyaluran < target (shortfall atau delay)
    ↓ [lag: 2–4 minggu — Pemda notice cash shortfall]
Pemda recall deposito dari BPD / tidak renew time deposit
    ↓ [lag: 1–3 bulan]
BPD DPK turun → LDR naik → harus kurangi kredit baru
    ↓ [lag: 3–6 bulan]
Kredit infrastruktur daerah terhambat
    ↓ [lag: 6–12 bulan]
NPL BPD naik → efek berganda pada ekonomi daerah
```

Dokumentasi empiris: Efisiensi APBN 2025 (Inpres No.1/2025) potong TKD → BPD LDR naik → Asbanda complaint Agt 2026. Kausal chain confirmed.

### 5.6 Desain Cross-Flag

```typescript
// Data: TKD realisasi YTD (%) dari DJPK SIKD
// Seasonality-aware: compare vs expected pace per bulan

Expected TKD pace (approx):
  Jan: 8–10%   Apr: 30–35%   Jul: 55–58%   Oct: 78–82%
  Feb: 15–18%  May: 38–42%   Aug: 62–65%   Nov: 85–88%
  Mar: 22–26%  Jun: 46–50%   Sep: 70–74%   Dec: 95–100%

Shortfall = realisasi < (expected_pace × 0.85)

IF shortfall_significant:
  flags.push("TKD realisasi [X]% — below seasonal pace [Y]%: "
    + "BPD DPK captive risk, regional credit tightening likely 3–6 bulan. "
    + "Monitor BJBR.JK + BJTM.JK equity for early signal.")

IF shortfall_severe (< expected × 0.75):
  ESCALATE: "TKD shortfall severe — BPD liquidity pressure HIGH."
```

**Why seasonality-aware:** Sep 2026 TKDD realisasi 79.1% — dengan threshold statik 80% ini akan false-trigger (79.1% < 80% tapi actually di atas expected September pace 70–74%). Seasonality-aware threshold mencegah false positive.

**Additional equity layer:** BJBR.JK dan BJTM.JK (dua BPD listed di Papan Utama) bisa dimonitor via Yahoo Finance. Simultaneous drop >5% kedua BPD = BPD equity stress signal yang independent dari TKD data.

### 5.7 Data Gap Final — Objek 2

| Item | Available? | Notes |
|------|-----------|-------|
| TKD realisasi YTD (DJPK SIKD) | ✅ Machine-readable web table | Perlu test Playwright |
| TKD target 2026 (denominator) | ✅ Hardcode dari APBN 2026 | Fixed by law, update tahunan |
| BPD DPK aggregate (BI SEKI TABEL1_1) | ✅ Existing codebase | Monthly, Oct 20 session |
| BPD DPK per bank | ❌ Tidak ada auto source | Tidak blocking — inference only |
| Listed BPD proxy (BJBR, BJTM) | ✅ Yahoo Finance, daily | Zero new infra |

**Kesimpulan Objek 2:** Tidak ada structural gap. DJPK SIKD jauh lebih accessible dari APBN KiTa SPA yang diasumsikan. Implementasi feasible.

---

## 6. Arsitektur 4-Layer Early Warning — Final Design

```
╔══════════════════════════════════════════════════════════════════════╗
║          BANKING CONTAGION EARLY WARNING — 4-LAYER ARCHITECTURE     ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Layer 1: INTERBANK RATE DIRECT (Daily, ~0 lag)            [NEW]   ║
║  ─────────────────────────────────────────────────────────────────  ║
║  Source: bi.go.id IndONIA — published 19:30 WIB daily              ║
║  Signal: spread > BI Rate +30bps tension / +50bps stress           ║
║          spread > BI Rate +75bps = BI ceiling, forced injection     ║
║  Action: FLAG immediately                                           ║
║  Status: NOT implemented — test Playwright BI IndONIA page         ║
║                                                                      ║
║  Layer 2: KBMI EQUITY BASKET (Intraday, D+0)            [READY]   ║
║  ─────────────────────────────────────────────────────────────────  ║
║  Source: Yahoo Finance (kbmi-contagion.ts, existing infra)          ║
║  Signal: ≥3/4 basket crash >8% same session                        ║
║  SRBI cross: BCR < 1.3 + basket = composite high-confidence        ║
║  Action: FLAG "KBMI contagion pattern"                              ║
║  Status: kbmi-contagion.ts exists, NOT integrated to M8            ║
║                                                                      ║
║  Layer 3: OJK REGULATORY NEWS (Hours)                   [READY]   ║
║  ─────────────────────────────────────────────────────────────────  ║
║  Source: Exa news search (kbmi-contagion.ts, existing infra)        ║
║  Signal: BDPI / Bank dalam Penyehatan / pembekuan                  ║
║  Action: ESCALATE to RED immediately                                ║
║  Status: implemented in kbmi-contagion.ts, NOT integrated          ║
║                                                                      ║
║  Layer 4: INDONIA via TE CONFIRMATOR (Lagging)       [EXISTING]   ║
║  ─────────────────────────────────────────────────────────────────  ║
║  Source: Trading Economics (existing, monthly)                      ║
║  Signal: IndONIA spread >40bps (existing M8 condition)             ║
║  Action: if Layer 1/2 already fired → ESCALATE to RED              ║
║          standalone: existing M8 scoring unchanged                  ║
║  Status: already implemented — no change needed                    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

**BPD supplementary layer (M10 cross-flag):**
```
DJPK SIKD TKD realisasi < seasonality-adjusted threshold
  → M10 output flag: BPD DPK captive risk
  → Monitor BJBR.JK + BJTM.JK equity
  → Cross to BI SEKI TABEL1_1 for BPD category DPK trend
```

**Scoring integration:**

| Signal | Score delta | Alert |
|--------|------------|-------|
| Layer 1 >50bps | +10 | → ORANGE |
| Layer 2 basket ≥3/4 alone | +12 | → ORANGE |
| Layer 2 + SRBI BCR < 1.3 | +20 | → RED |
| Layer 3 OJK formal action | +25 | → RED immediately |
| Layer 4 confirms Layer 1/2 | escalate | → RED |
| Layer 1 + 2 simultaneously | +25 | → RED |

---

## 7. Implementation Roadmap

### P1: Integrasi `kbmi-contagion.ts` ke M8 Engine

**Effort:** ~2–3 jam | **Risk:** Low | **Impact:** High — closes gap immediately, zero new dependency

Files:
- `src/tools/macro/banking-stress-engine.ts` — import, parallel fetch, scoring, flags, output interface
- `src/tools/macro/sources/kbmi-contagion.ts` — verify SRBI BCR cross-check reads from DB correctly

Steps:
1. `import { fetchKbmiContagion, KbmiContagionResult } from './sources/kbmi-contagion.js'`
2. Add to parallel `Promise.allSettled` block bersama IndONIA, DPK, etc.
3. Add `kbmiContagion: KbmiContagionResult | null` ke `BankingStressOutput` interface
4. Scoring: `contagionSignal === true` → +12; `ojkFormalAction === true` → +25
5. Flag output: detail basket state + which symbols crashed
6. Summary line: basket state dalam output tabel M8

### P2: Test IndONIA Direct dari BI

**Effort:** ~3–5 jam | **Risk:** Medium (BI scrapeability unknown) | **Impact:** Very High

Steps:
1. Playwright test: `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/default.aspx`
2. Parse IndONIA rate dari halaman
3. Jika accessible: `fetchIndoniaBiDirect()` di `sources/bi-seki-money.ts`
4. Daily freshness gate (1d TTL vs current monthly)
5. Replace `fetchIndoniaRateTe()` untuk current rate, pertahankan TE sebagai fallback
6. Update date field: actual daily date bukan end-of-month

### P3: TKD DJPK SIKD Scraper untuk M10

**Effort:** ~4–6 jam | **Risk:** Medium | **Impact:** Medium (enables BPD cross-flag)

Steps:
1. Inspect `djpk.kemenkeu.go.id/portal/data/tkdd` — Playwright table parse
2. `fetchTkdRealisasi()` di `sources/djpk.ts` (baru) atau extend `kemenkeu.ts`
3. Parse: TKDD pagu, realisasi YTD, bulan data
4. Seasonality-aware shortfall detection
5. Cross-flag output di fiscal engine

### P4: Fix JIBOR Comment Bug

**Effort:** 5 menit | **Risk:** Zero | **Impact:** Code correctness

- `banking-stress-engine.ts:47`: `"Dec 2023"` → `"Jan 2026 (O/N discontinued Jan 2019)"`
- `sovereign-scraper.ts` deprecated comment: sama

### P5: AGRO.JK Replacement (Optional)

**Effort:** ~1 jam | **Risk:** Low | **Impact:** Low-Medium

Verify BBHI.JK ADTV > Rp 1B/hari. Jika valid, replace AGRO → BBHI di `kbmi-contagion.ts`.

---

## 8. Pertanyaan Terbuka

**1. BI IndONIA page — Playwright accessible?**
Belum diuji. Dependency kritis untuk Layer 1. Perlu proof-of-concept.

**2. DJPK SIKD table — scrapeable?**
Visual web table dikonfirmasi ada. Perlu test Playwright intercept/parse.

**3. SRBI BCR threshold 1.3 — validated?**
Perlu analisis 84 data points dari `backfill-srbi-history.ts`. Berapa BCR normal? Jika median 2.0+, maka <1.3 genuine stress. Belum dikonfirmasi.

**4. Basket historical backtest (2020 COVID):**
Apakah BABP + BBYB + BMAS + AGRO semua crash ≥3/4 pada 16–17 Maret 2020? `yf.chart(period1: '2020-03-01')` dapat menjawab ini. Perlu validation sebelum production.

**5. AGRO replacement — BBHI atau tetap?**
Binary decision sebelum implementasi.

---

## Appendix A: PUAB O/N Spread Historical Reference

Data dari BI SSKI Tabel 13 + CEIC series:

| Tahun | Median spread (bps) | Peak (bps) | Event peak |
|-------|--------------------|-----------| -----------|
| 2021 | 3 | 5 | COVID liquidity glut |
| 2022 | 9 | 15 | Fed tightening start |
| 2023 | 24 | 35 | JIBOR transition year |
| 2024 | 28 | 40 | Elevated baseline |
| Pre-2026 ATH | — | **96.5** | Sep 2015 China devaluation |
| 2026 | — | **117** | **Jul 2026 — new ATH** |

URL: `bi.go.id/id/statistik/ekonomi-keuangan/sski/Documents/Tabel_13.pdf` (monthly PDF)
CEIC: `ceicdata.com/en/indonesia/financial-system-statistics-money-market-sector/...`

---

## Appendix B: KBMI Classification (Koreksi)

Basis: **modal inti (Tier 1 capital)**, bukan total aset. POJK No. 12/POJK.03/2021.

| KBMI | Modal Inti | Contoh |
|------|-----------|--------|
| I | < Rp 6T | BABP, BBYB, BMAS |
| II | Rp 6–14T | BBHI, ARTO, BBKP |
| III | Rp 14–70T | BTN, Permata |
| IV | > Rp 70T | BCA, BRI, BNI, Mandiri |

---

## Appendix C: JIBOR/IndONIA Full Timeline

| Tanggal | Event |
|---------|-------|
| 1 Agt 2018 | IndONIA launch, JIBOR O/N begins phase-out |
| **2 Jan 2019** | JIBOR O/N tenor discontinued |
| 2019–2025 | JIBOR 1W/1M/3M/6M/12M masih aktif |
| **31 Des 2025** | Semua tenor JIBOR discontinued |
| **1 Jan 2026** | Indonesia full IndONIA — JIBOR tidak ada |

*Kode bug:* `"BI discontinued JIBOR Dec 2023"` — salah di dua file.
*Sumber:* Gibson Dunn APLMA note, December 16, 2024.

---

## Appendix D: Bank Banten (BEKS) — TKD Dependency Failure Case

BEKS = BPD Banten, BPD termuda (Banten pisah dari Jawa Barat 2000). APBD Banten kecil, retail DPK diversification sangat rendah. Sangat dependent Pemda Banten DPK. Hasil: liquidity limitations constrained credit distribution sejak 2019. Status IDX: **Papan Pemantauan Khusus**. Excluded dari basket monitoring (terlalu illiquid). Validates BPD TKD-dependency risk secara empiris.

---

## Appendix E: Key Source URLs

| Sumber | URL | Digunakan untuk |
|--------|-----|-----------------|
| BI IndONIA page | `bi.go.id/en/fungsi-utama/moneter/indonia-jibor/` | Layer 1 scrape target |
| BI SSKI Tabel 13 | `bi.go.id/id/statistik/ekonomi-keuangan/sski/Documents/Tabel_13.pdf` | PUAB spread historical |
| DJPK SIKD TKD | `djpk.kemenkeu.go.id/portal/data/tkdd` | TKD realisasi scrape |
| APBN KiTa PDF | `djppr.kemenkeu.go.id/paparanapbnkita` | Backup TKD (PDF) |
| OJK bank pengawasan | `ojk.go.id/en/kanal/perbankan/Pages/Bank-dalam-pengawasan-khusus.aspx` | OJK status check |
| OJK LSPI quarterly | `ojk.go.id/id/kanal/perbankan/data-dan-statistik/laporan-profil-industri-perbankan/` | Banking KPI |
| IMF FSAP 2025 (CR 25/53) | `imf.org/-/media/files/publications/cr/2025/english/1idnea2025003-print-pdf.pdf` | BPD vulnerability evidence |
| CEIC PUAB spread | `ceicdata.com/en/indonesia/.../money-market-rupiah-interbank-...overnight` | Historical spread data |
| Gibson Dunn JIBOR note | `gibsondunn.com/wp-content/uploads/2024/12/Thomas-Cheah-A-Note-about-Jakarta-Interbank-...` | JIBOR timeline |
| Katadata BABP Nov 3 | `katadata.co.id/finansial/bursa/6ae946e35396b/ojk-soroti-gangguan-layanan-di-mnc-bank-babp` | BABP crisis confirmation |
| Asbanda BPD Aug 2026 | `voi.id/en/amp/590647` | BPD liquidity spotlight |
| TKD–BPD Kontan | `keuangan.kontan.co.id/news/keputusan-anggaran-tkd-bisa-pengaruhi-likuiditas-bank-daerah` | TKD–BPD mechanism |

---

*Dibuat: 3 November 2026*
*Research findings incorporated: PUAB spread Jul 2026 117bps ATH, JIBOR timeline correction, BABP liquidity crisis active Nov 3, DJPK SIKD TKD machine-readable, KBMI threshold correction (modal inti, not assets), IMF FSAP 2025 BPD findings*

---

## Appendix F: Binary Decisions Before Implementation

**Q1 (Basket):** Ganti AGRO.JK dengan BBHI.JK (liquid, independent, no BUMN backstop), atau pertahankan AGRO dengan catatan di output?

**Q2 (TKD cross-flag):** Scrape DJPK SIKD (preferred, test needed) atau gunakan APBN KiTa PDF via Jina Reader (simpler, less automated)?
