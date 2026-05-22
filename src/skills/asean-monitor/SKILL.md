---
name: asean-monitor
description: >
  Daily ASEAN market monitoring and briefing. Snapshots key indices (IHSG, LQ45, KLCI, STI, SET, PSEi),
  IDX sectoral indices, top IDX movers, and synthesizes a structured market briefing.
  Use when: user asks "how are ASEAN markets today", "IHSG morning briefing", "ASEAN market update",
  "how is IDX doing", "check Southeast Asian markets", or any regional market overview request.
---

# ASEAN Market Monitor Skill

Structured daily monitoring of ASEAN equity markets. Follow steps in order. Batch all index calls into single `get_asean_data` queries — never call one ticker per query.

## Step 1: Index Snapshot (all in one call)

Call `get_asean_data` with:
```
"Quote all ASEAN composite and sub-indices: ^JKSE, ^JKLQ45, ^KLSE, ^STI, ^SET.BK, ^PSEi"
```

Extract for each: `regularMarketPrice`, `regularMarketChangePercent`, `marketState`

## Step 2: IDX Sectoral Snapshot (one call)

Call `get_asean_data` with:
```
"Quote IDX sectoral indices: ^JKAGRI, ^JKCONS, ^JKPROP, ^JKMISC"
```

This shows which IDX sectors are leading or lagging the composite.

## Step 3: IDX Blue-Chip Pulse (one call)

Call `get_asean_data` with:
```
"Quote BBCA.JK, BBRI.JK, BMRI.JK, TLKM.JK, ASII.JK, GOTO.JK, BREN.JK, BYAN.JK"
```

These 8 stocks account for the majority of IHSG market cap. Their direction typically explains most of IHSG's move.

## Step 4: Regional News Scan (one call)

Call `web_search` with:
```
"ASEAN stock market today [current date] IHSG IDX Indonesia Bursa Singapore"
```

Pull 3–5 relevant headlines. Prioritize Reuters, Bloomberg, CNBC Asia, Kontan, Bisnis.com.

## Step 5: Synthesize Briefing

Format output as:

---

### ASEAN Markets — [Date] [Market Session: Pre-market / Active / Post-close]

**Regional Indices**

| Index | Price | Change % | Status |
|-------|-------|----------|--------|
| IHSG (^JKSE) | ... | ...% | ... |
| LQ45 (^JKLQ45) | ... | ...% | ... |
| KLCI | ... | ...% | ... |
| STI | ... | ...% | ... |
| SET | ... | ...% | ... |
| PSEi | ... | ...% | ... |

**IDX Sectoral Performance**

| Sector | Change % |
|--------|----------|
| Consumer Goods | ... |
| Property & Construction | ... |
| Agriculture | ... |
| Miscellaneous Industry | ... |

**IDX Blue-Chip Pulse** *(stocks driving IHSG today)*

List top 3 gainers and top 3 laggards among the 8 blue-chips with their % change.

**Key Headlines**

- [Headline 1] — [Source]
- [Headline 2] — [Source]
- [Headline 3] — [Source]

**Signal**

One paragraph: overall ASEAN sentiment (risk-on / risk-off / mixed), which market is leading/lagging, any notable divergence between IHSG and LQ45 (signals large-cap vs. broad market behavior), key macro driver if identifiable from news.

---

## Coverage Notes

- Data from Yahoo Finance, 15-min delayed during market hours
- IDX trading hours: 09:00–11:30 and 13:30–15:49 WIB (UTC+7)
- `stock_screener` is US-only — IDX screening not available; use this skill's blue-chip pulse as proxy
- IDX30, JII (Sharia index) tickers not available on Yahoo Finance; LQ45 is the closest available proxy for IDX blue-chip performance
- For deeper single-stock analysis, exit this skill and use `get_asean_data` directly with a fundamentals query
