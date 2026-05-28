# dex_indonesia 🇮🇩

**Indonesia Sovereign Macro Intelligence System** — fork dari [virattt/dexter](https://github.com/virattt/dexter), dikustomisasi untuk monitoring risiko sovereign Indonesia secara institusional.

> **Tentang fork ini:** Repository ini bukan general-purpose financial agent. Fokus tunggal: deteksi dini krisis sovereign Indonesia sebelum pasar repricing — *Big Short mode* untuk IDR, SBN, dan IHSG.

---

## Apa itu Dexter (aslinya)?

Dexter dibuat oleh [@virattt](https://twitter.com/virattt) sebagai autonomous financial research agent — think Claude Code, tapi khusus untuk riset keuangan. Ia bisa decompose pertanyaan finansial kompleks, eksekusi riset bertahap, self-validate, dan iterasi sampai dapat jawaban berbasis data.

**Kemampuan asli Dexter:**
- Task planning otomatis untuk riset keuangan
- Akses real-time: income statement, balance sheet, cash flow
- Self-reflection dan loop detection
- WhatsApp gateway (chat langsung dari HP)
- Eval suite dengan LangSmith tracking

Semua kemampuan asli di atas **tetap ada** di fork ini.

---

## Apa yang ditambahkan di fork ini?

### Big Short Mode — Silent Crisis Detector

12 modul macro intelligence khusus Indonesia, berjalan paralel, agregat ke satu angka: **Silent Crisis Probability (0–100%)**.

```
Silent Crisis Probability: 21%  🟢 GREEN
Synthetic Stability Score: 44/100
Cross-confirmed modules: 1/12
```

| # | Modul | Signal |
|---|-------|--------|
| 1 | FX Defense | USDIDR z-score, pseudo-stability, BI intervention |
| 2 | BoP | Trade balance, FX reserves, synthetic CAD risk |
| 3 | Sovereign Risk | CDS 5Y, SBN yield, foreign SBN ownership |
| 4 | Foreign Flow | EIDO, silent exit detection |
| 5 | Commodity | Ekspor basket, oil import vulnerability |
| 6 | Regime | Quad regime Q1–Q4 via Growth ROC × Inflation ROC |
| 7 | Narrative Divergence | Official guidance vs market — APBN assumptions vs aktual |
| 8 | Banking Stress | NPL, LDR, CAR, JIBOR spread — Big Short early warning |
| 9 | Market Stress | IHSG P/E + breadth, valuation disconnect |
| 10 | Fiscal | APBN realisasi vs target, revenue shortfall, deficit trajectory |
| 11 | Domestic Pressure | PIHPS 10 komoditas pangan, Food Stress Index 0–100 |
| 12 | Political Risk | Unemployment + Exa news sentiment (social unrest, stabilitas) |

**Logika inti:** Satu modul di RED bisa noise. Dua modul di ORANGE = deteriorasi struktural. Tiga+ = systemic fragility.

### APBN 2026 Baseline

UU No. 17 Tahun 2025 / Perpres No. 118 Tahun 2025:
- USDIDR: 16,500 | ICP oil: $70/bbl | GDP growth: 5.4% | CPI: 2.5%
- Revenue: 3,154T | Spending: 3,843T | Deficit: 2.68% GDP

### Scripts Tambahan

```bash
bun scripts/morning-check.ts   # morning brief semua 12 modul
bash health-check.sh           # cek scraper, DB, Playwright, TypeScript
bash env-check.sh              # live ping semua API key di .env
bash git-push.sh               # push ke GitHub pakai GITHUB_TOKEN dari .env
```

---

## Prerequisites

- [Bun](https://bun.com) v1.0+
- Minimal satu LLM API key (OpenAI / Anthropic / Google / DeepSeek / OpenRouter)
- Exa API key — untuk Module 12 political risk news sentiment

Optional (premium data):
- Bloomberg REST proxy — CDS 5Y, SBN yield akurat
- Refinitiv/LSEG — EMBI spread
- BPS API key — webapi.bps.go.id (gratis, tapi Cloudflare block direct curl)

## Install

```bash
git clone https://github.com/uradn/dex_indonesia.git
cd dex_indonesia
bun install
cp env.example .env
# edit .env, isi API keys
```

## Run

```bash
bun start                          # interactive CLI
bun dev                            # watch mode
bun scripts/morning-check.ts       # morning brief langsung
bash health-check.sh --verbose     # infrastructure check
bash env-check.sh --verbose        # API key validation
```

## Health Checks

```bash
# Infrastructure (Playwright, SQLite, scrapers, TypeScript)
bash health-check.sh
bash health-check.sh --verbose
bash health-check.sh --timeout 60  # per-check timeout

# API keys (.env validation + live ping)
bash env-check.sh
bash env-check.sh --verbose
```

## WhatsApp Gateway

```bash
bun run gateway:login   # scan QR, link HP
bun run gateway         # start gateway
```

Kirim pesan ke chat sendiri di WhatsApp → Dexter jawab. Bisa tanya "run big short analysis" langsung dari HP.

---

## ⚠️ Disclaimer

Proyek ini untuk tujuan **edukasi dan riset** saja. Bukan saran investasi, keuangan, pajak, atau hukum. Output bisa salah, tidak lengkap, atau tidak up-to-date. Gunakan dengan risiko sendiri. Konsultasikan keputusan investasi dengan advisor berlisensi.

---

## License

MIT — sama dengan upstream [virattt/dexter](https://github.com/virattt/dexter).
