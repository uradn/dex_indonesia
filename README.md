# dex_indonesia 🇮🇩

**Indonesia Sovereign Macro Intelligence System** — fork dari [virattt/dexter](https://github.com/virattt/dexter), dikustomisasi untuk monitoring risiko sovereign Indonesia secara institusional.

> **Tentang fork ini:** Repository ini bukan general-purpose financial agent. Fokus tunggal: deteksi dini krisis sovereign Indonesia sebelum pasar repricing — *Big Short mode* untuk IDR, SBN, dan IHSG. Dan mungkin MBG!

<img width="1080" height="1080" alt="image" src="https://github.com/user-attachments/assets/80d387bd-6c30-4f5d-9160-db8929a4786a" />


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

13 modul macro intelligence khusus Indonesia, berjalan paralel, agregat ke satu angka: **Silent Crisis Probability (0–100%)**.

```
Silent Crisis Probability: 21%  🟢 GREEN
Synthetic Stability Score: 44/100
Cross-confirmed modules: 1/13
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
| 8 | Banking Stress | NPL (OJK/World Bank API), LDR, CAR, ~~JIBOR~~ IndONIA corridor (DFR = BI Rate −100bps / LF = BI Rate +75bps), FSAP nexus (implied CAR hit), KLR signals, M2/FX reserves ratio |
| 9 | Market Stress | IHSG P/E + breadth, valuation disconnect |
| 10 | Fiscal | APBN realisasi vs target, revenue shortfall, deficit trajectory |
| 11 | Domestic Pressure | PIHPS 10 komoditas pangan, Food Stress Index 0–100 |
| 12 | Political Risk | Unemployment + Exa news sentiment (social unrest, stabilitas) |
| 13 | ULN / External Debt | DSR (IMF threshold 25%), Greenspan-Guidotti ratio, ULN/GDP, BI hedging compliance (PBI 21/14/2019), 1997 transmission mechanism |

**Logika inti:** Satu modul di RED bisa noise. Dua modul di ORANGE = deteriorasi struktural. Tiga+ = systemic fragility.

### Research Frameworks

**KLR EWS (Kaminsky-Reinhart-Lizondo):**
21-indicator dual crisis signal matrix (12 currency + 9 banking). Threshold-based early warning kalibrasi untuk EM. Includes Module 13 ULN signals: Greenspan-Guidotti ratio (<1.0), DSR (>25%), hedging compliance (<70%). Crisis probability: LOW (0–3 sinyal), MODERATE (4–7), HIGH (8–12), CRITICAL (13+). Invoke via skill `klr-ews`.

**IMF FSAP Sovereign-Bank Nexus:**
SBN yield shock → implied bank CAR erosion: `(sbn_10y − 6.5% baseline) × 6yr duration × 20% SBN/assets`. At +100bps: −1.2pp CAR. Doom loop signal di >1.5pp. Terintegrasi langsung ke Module 8 scoring.

**BI Interest Rate Corridor:**
IndONIA harus stay dalam corridor DFR (BI Rate −100bps) sampai LF Rate (BI Rate +75bps). Spread >30bps = YELLOW, >50bps = ORANGE, >75bps = RED (BI terpaksa inject liquidity = crisis signal).

**Rivera-Batiz & Rivera-Batiz (R&R) — International Finance & Open Economy Macroeconomics:**

Framework teoritis utama yang di-embed ke dalam sistem ini. Setiap sinyal berikut bukan heuristic — ada basis teori makro terbuka yang eksplisit:

| Framework R&R | Chapter | Diimplementasikan di | Sinyal yang dihasilkan |
|---------------|---------|----------------------|------------------------|
| Purchasing Power Parity (PPP) | Ch. 4–5 | Module 6 (Narrative Divergence) | USDIDR vs PPP fair value; Dornbusch overshoot flag |
| Uncovered Interest Parity (UIP) | Ch. 5 | Module 7 (ASEAN RV) | UIP Carry Attractiveness Index: real carry = SBN spread − IDR depreciation. Leads Module 5 foreign flow 2–3 minggu |
| Mundell-Fleming Open Economy | Ch. 8 | Stress Simulator | MBG fiscal shock: ΔG → ΔIDR → term premium → foreign flow (param `fiscalOverrunIdrT`) |
| Dornbusch Overshooting | Ch. 10 | Stress Simulator | IDR shock >15%: short-run overshoot sebelum PPP mean-reversion. Note otomatis di output |
| Trilemma (Mundell) | Ch. 11 | Module 10 (Fiscal) | SRBI sterilization cost: open capital + monetary autonomy → wajib sterilisasi → quasi-fiscal drag BI |
| r-g Debt Dynamics | Ch. 14–16 | Module 13 (ULN) | r−g = SBN 10Y − GDP growth. Jika positif tanpa primary surplus → debt/GDP expands mechanically |
| 1st-gen Crisis (Krugman-FG) | Ch. 12 | Module 3 (FX Defense) *(Wave 3)* | Shadow exchange rate, months-to-attack estimate |
| 2nd-gen Self-fulfilling Crisis | Ch. 13 | Module 3 (FX Defense) *(Wave 3)* | Confidence gate: multiple equilibria, self-fulfilling attack threshold |
| Sudden Stop (Calvo) | Ch. 15 | Module 5 (Foreign Flow) *(Wave 3)* | Sudden Stop Vulnerability Index: SBN foreign ownership cliff + UIP carry reversal |

**Contoh output r-g (Module 13):**
```
### R-G Debt Dynamics (R&R Ch.14–16)
r−g = SBN 10Y 6.71% − GDP growth 5.40% = +1.31pp [KNIFE-EDGE]
Debt/GDP: 27.8% → Primary surplus needed to stabilize: +0.36% GDP
Flag: R-G ADVERSE — without primary surplus, debt/GDP expands mechanically
```

### Shock Scenario Simulator

Forward-looking stress test — simulasi bagaimana satu atau compound shock mengubah seluruh 13 modul sekaligus. Tersedia sebagai CLI script (`scripts/shock-scenario.ts`) maupun skill agent (`shock-scenario`).

```bash
bun scripts/shock-scenario.ts --list          # lihat semua preset
bun scripts/shock-scenario.ts crisis          # 1997/2008 severity analog
bun scripts/shock-scenario.ts idr-freefall    # sudden stop + forced BI hike
bun scripts/shock-scenario.ts moderate        # baseline stress test
# Custom parameter override
bun scripts/shock-scenario.ts moderate --sbn 8.5 --usdidr 21000 --npl 4.5
```

**10 named presets:**

| Preset | Deskripsi | SBN Δ | USDIDR Δ | Reserves Δ |
|--------|-----------|-------|----------|------------|
| `mild` | Early deterioration | +50bps | +1,500 | −$20bn |
| `moderate` | Standard stress | +100bps | +3,000 | −$40bn |
| `severe` | Pre-crisis | +150bps | +5,000 | −$60bn |
| `crisis` | 1997/2008 analog | +250bps | +8,000 | −$80bn |
| `trump-tariff` | US tariff shock + EM selloff | +75bps | +2,000 | −$15bn |
| `em-selloff` | Global EM risk-off | +125bps | +4,000 | −$35bn |
| `oil-spike` | Commodity shock + imported inflation | +50bps | +1,000 | −$10bn |
| `idr-freefall` | Sudden stop + forced BI hike | +150bps | +5,000 | −$50bn |
| `bank-crisis` | Credit shock (NPL surge) | +100bps | +2,000 | −$20bn |
| `bi-hike` | Aggressive rate tightening | +200bps | +1,000 | −$5bn |

**Output per scenario:**
- Before vs After score tiap modul (GREEN/YELLOW/ORANGE/RED)
- Transmission chain narrative (doom loop detection, fiscal breach, foreign ownership buffer)
- Silent Crisis Probability: Before → After
- Critical thresholds yang terlewati

**Contoh output (Full Crisis):**
```
## Shock Scenario: Full Crisis
Baseline regime: Q3 — Stagflation (Growth↓ Inflation↑)

| Module         | Before       | After        | Alert Δ       |
|----------------|--------------|--------------|---------------|
| FX Defense     | 32 🟢 GREEN  | 100 🔴 RED   | GREEN→RED     |
| Sovereign Risk | 16 🟢 GREEN  |  97 🔴 RED   | GREEN→RED     |
| Banking Stress |  2 🟢 GREEN  | 100 🔴 RED   | GREEN→RED     |
| Fiscal         | 33 🟡 YELLOW |  55 🟠 ORANGE| YELLOW→ORANGE |

Silent Crisis Probability: 24% 🟢 → 85% 🔴
DOOM LOOP TERRITORY: CAR erosion 3.26pp (threshold >1.5pp)
```

### APBN 2026 Baseline

UU No. 17 Tahun 2025 / Perpres No. 118 Tahun 2025:
- USDIDR: 16,500 | ICP oil: $70/bbl | GDP growth: 5.4% | CPI: 2.5%
- Revenue: 3,154T | Spending: 3,843T | Deficit: 2.68% GDP

### Scripts Tambahan

```bash
bun scripts/morning-check.ts              # morning brief semua 13 modul
bun scripts/shock-scenario.ts --list      # lihat semua preset scenario
bun scripts/shock-scenario.ts crisis      # full crisis simulation (1997/2008 analog)
bun scripts/shock-scenario.ts idr-freefall # sudden stop + forced BI hike cycle
bun scripts/seed-banking-baseline.ts      # seed CAR/LDR dari OJK LSPI (quarterly)
bash health-check.sh                      # cek scraper, DB, Playwright, TypeScript
bash env-check.sh                         # live ping semua API key di .env
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
