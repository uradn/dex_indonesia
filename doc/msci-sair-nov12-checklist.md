# MSCI SAIR Nov 12 2026 — Checklist Post-Event

**Tanggal:** 12 November 2026 (T+0)
**Event:** MSCI Semi-Annual Index Review (SAIR)
**Status sebelum event:** Standalone consultation aktif (Oct 15 2026), `MSCI_CLASSIFICATION_STATUS=downgrade_risk`

---

## Apa yang Diumumkan SAIR Nov 12

SAIR bukan pengumuman final Standalone. Yang diumumkan:
1. Free-float exclusions efektif (saham yang sudah kena cap/excluded dari index weight)
2. Konfirmasi/update status Standalone consultation
3. Kemungkinan sinyal arah consultation progress

Keputusan final Standalone: **Jun 30 2027** (setelah consultation tutup Apr 30 2027).

---

## Tiga Skenario + Env Actions

### Skenario A — MSCI Konfirmasi Standalone Parameters (Probabilitas ~85%)

MSCI: language netral-negatif, tidak ada concession, consultation "on track" per timeline.

**Env vars yang perlu diupdate dalam 1 jam setelah SAIR:**

```bash
# .env — update semua ini:

# Geser SAIR date ke berikutnya (May 2027, tanggal exact biasanya 2nd Thursday of May)
MSCI_SAIR_DATE=2027-05-08    # estimasi — cek tanggal exact dari MSCI press release

# Consultation timeline tetap
MSCI_REVIEW_DATE=2027-04-30  # consultation closes (tidak berubah)

# Status tetap downgrade_risk
MSCI_CLASSIFICATION_STATUS=downgrade_risk

# Optional: turunkan sedikit dari formula baseline (consultation progresses)
# Formula auto: pReversal = 1 − (0.85 + 0.10 × consultationProgress)
# Jangan set ini kecuali MSCI language berubah signifikan dari ekspektasi
# MSCI_REVERSAL_PROBABILITY_OVERRIDE=   ← BIARKAN UNSET (auto-formula aktif)
```

**Efek pada sistem setelah update:**
- M5 `sairBonus`: setelah Nov 12, T menghitung dari MSCI_SAIR_DATE baru (May 2027) → bonus 0 sampai T-30 hari dari May 2027
- M5 `msciReversalProbability`: auto-formula jalan dengan consultationProgress yang makin tinggi → P(reversal) makin turun

---

### Skenario B — MSCI Soften Language / Acknowledge Progress (Probabilitas ~10%)

MSCI: mengakui ada improvement spesifik, memberi conditional language, tidak explicitly confirm timeline tetap.

**Env vars:**

```bash
MSCI_SAIR_DATE=2027-05-08           # geser ke May 2027
MSCI_REVIEW_DATE=2027-04-30         # tetap
MSCI_CLASSIFICATION_STATUS=under_review   # turun dari downgrade_risk

# SET override — formula default terlalu pesimis untuk skenario ini
MSCI_REVERSAL_PROBABILITY_OVERRIDE=0.20   # range 0.18–0.25 tergantung bahasa
```

**Efek pada sistem:**
- M5 score turun ~10-15 poin dari downgrade_risk baseline
- Dashboard `/bs` tesis akan flag "kill switch kandidat #2 approaching" — tapi belum auto-kill
- Jika SBN yield + CDS ikut turun dalam 48 jam: manual KS#2 review dibutuhkan

---

### Skenario C — MSCI Reversal / Halt Standalone (Probabilitas ~5%)

MSCI: secara eksplisit menyatakan tidak melanjutkan Standalone consultation atau memperpanjang dengan outcome terbuka.

**Env vars:**

```bash
MSCI_SAIR_DATE=2027-05-08
MSCI_REVIEW_DATE=2027-04-30
MSCI_CLASSIFICATION_STATUS=confirmed        # EM confirmed, bukan Standalone

# Hapus override — formula auto berlaku untuk EM-confirmed state
# MSCI_REVERSAL_PROBABILITY_OVERRIDE=      ← HAPUS BARIS INI dari .env
```

**Efek pada sistem:**
- M5 score drop signifikan (sairBonus + classification reset)
- SCD akan turun ke bawah 40% jika market ikut rally
- Thesis #14 — evaluasi KS#2 segera (Bloomberg/Exa news langsung cek)

---

## Langkah Segera Setelah Event (Semua Skenario)

```bash
# 1. Baca MSCI press release
#    URL biasanya: msci.com/index-review-announcements atau msci.com/esg-and-real-assets/...

# 2. Update .env sesuai skenario di atas

# 3. Run morning check manual untuk capture updated M5 score
bun scripts/morning-check.ts

# 4. Cek Thesis #14 status
bun scripts/check-thesis.ts

# 5. Update README.md baseline dengan angka dari morning check baru
#    Cari: "Health-check baseline Nov 2 2026" → ganti dengan tanggal dan angka baru
```

---

## Yang Pasti Berubah Setelah Nov 12 (Tanpa Lihat Skenario)

| Variable | Sebelum Nov 12 | Setelah Nov 12 |
|----------|---------------|---------------|
| `MSCI_SAIR_DATE` | `2026-11-12` | `2027-05-08` (estimasi) |
| M5 sairBonus | +10 (T-7 s/d T-0) | 0 (sampai T-30 dari May 2027) |
| `MSCI_REVIEW_DATE` | `2026-11-12` | `2027-04-30` |

**`MSCI_SAIR_DATE` WAJIB diupdate setelah Nov 12 apapun skenarionya** — kalau tidak, M5 engine akan hitung T dari tanggal yang sudah lewat → sairBonus stuck atau error.

---

## Referensi

- MSCI consultation announcement Oct 15 2026: msci.com
- Consultation timeline: closes Apr 30 2027 → decision Jun 30 2027 → implementation Sep-Dec 2027
- Engine: `src/tools/macro/sources/msci-classification.ts` (sairBonus logic)
- Env docs: `CLAUDE.md` section Environment Variables
