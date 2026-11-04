# Dashboard Data Quality Audit Log

Periodic audit of indicator freshness, source reliability, and data anomalies.
Run before major morning-check sessions or whenever dashboard shows suspicious values.

**Audit cadence:** weekly or before each major SCD run.
**How to run:** `bun scripts/health-check.ts` + manual spot-checks below.

---

## 2026-11-04 (pre-morning-check audit)

**Auditor:** Victor / Claude  
**Health-check baseline:** 51 fresh | 1 aging | 2 stale | 0 critical

### Status summary

| Indicator | DB Name | Value | Data Date | Fetch Age | Status | Notes |
|-----------|---------|-------|-----------|-----------|--------|-------|
| Brent crude | `brent_price_usd` | $104.38 | 2026-11-04 | 0.1d | ✅ | yahoo_finance |
| Dubai crude | `dubai_crude_spot_usd` | $102.88 | 2026-11-04 | 0.0d | ✅ FIXED | See bug below |
| Brent-Dubai spread | `brent_dubai_spread_usd` | $1.50 | 2026-11-04 | 0.0d | ✅ | brent_proxy |
| CPO price | `cpo_price_myr` | MYR 1120 | 2026-10-01 | 0.1d | 🟡 34d data | Worldbank pinksheet monthly — structural lag |
| SRBI BCR | `srbi_bid_cover_ratio` | 2.541 | 2026-10-09 | 14.8d | 🟠 26d data | BI bi-weekly since Oct 24; next auction ~Nov 11; Exa re-fetch returned null |
| IDX short sell | `idx_short_sell_volume_idr_bn` | IDR 1.68bn | 2026-10-14 | 14.1d | 🟠 21d data | IDX SSV data sparse; Cloudflare blocks direct; `IDX_SHORT_SELL_VOLUME_IDR_BN` env pin option |
| PDN-L (banks) | `bank_pdnl_pct` | 1.77% | 2026-09-13 | 1.5d | 🔴 52d data | Structural: OJK SPI Q3 2026; next update ~Dec (Q4); re-fetch returns same Kontan article |
| SBN foreign own. | `sbn_foreign_ownership_pct` | 12.96% | 2026-11-02 | 0.1d | ✅ | djppr_pdf |
| IndONIA compounded | `indonia_compounded_30d_pct` | NULL | — | — | ⚠️ NULL | P2-A BI direct scrape implemented; not yet cached (Playwright gated — runs in morning-check) |
| IndONIA 3M (TE) | `indonia_3m_pct` | 5.807% | 2026-08-07 | 57.8d | 🔴 89d data | TE source stale; will be superseded by BI direct on next run |
| TKD realisasi | `tkd_realisasi_pct` | 84.93% | 2026-11-04 | 0.1d | ✅ | djpk_sikd (new P3-A) |
| USDIDR | `usdidr_spot` | 18,148 | 2026-11-04 | 0.1d | ✅ | yahoo_finance |
| CDS 5Y | `indonesia_cds_5y_bps` | 103.64 bps | 2026-11-03 | 0.9d | ✅ | worldgovernmentbonds |
| SBN 10Y yield | `sbn_10y_yield_pct` | 7.707% | 2026-11-04 | 0.1d | ✅ | trading_economics |
| BI Rate | `bi_rate_pct` | 5.75% | 2026-11-04 | 0.1d | ✅ | trading_economics |
| Prabowo approval | `prabowo_approval_pct` | 65.2% | 2026-11-01 | 1.5d | ✅ | tavily/BBC |
| Himbara AT1 | `himbara_at1_secondary_pct` | 88.4% | 2026-11-04 | 1.5d | ✅ | exa_search |
| GDP growth | `gdp_growth_pct` | 5.29% | 2026-06-30 | 57d | 🟡 127d data | Structural: Q2 BPS; Q3 release ~Nov 6–7 2026 |
| TKD sub-indicators | `dau/dbh/dana_desa/dak_nonfisik` | various | 2026-11-04 | 0.1d | ✅ | djpk_sikd (all P3-A) |

### Bug detected and fixed: Dubai crude $65 anomaly

**Symptom:** Dashboard showed Dubai crude $65.0/bbl while Brent was $104.4/bbl → impossible $43.4 spread.

**Root cause:** `fetchViaExa()` in `sources/dubai-crude.ts` searched for Dubai price on Oct 21.
Exa returned an article from Oct 21 containing `$65` as a historical or discount reference — not the actual Dubai spot.
Parser regex (`[\d]{2,3}`) matched it without cross-checking against Brent price.

**Fix (commit this session):**
1. `parseDubaiPriceFromText()` now accepts optional `brentHint` param
2. Rejects parsed values where `v < brentHint × 0.70` or `v > brentHint × 1.15`
3. `fetchViaExa()` receives `brentPrice` from caller
4. DB corrected: upserted `dubai_crude_spot_usd = 102.88` (brent_proxy) for 2026-11-04

**Files changed:** `src/tools/macro/sources/dubai-crude.ts`

### Open items (carry forward)

| # | Item | Priority | Action |
|---|------|----------|--------|
| 1 | SRBI BCR 26d stale | 🟠 | Auto-fetch failed; next auction Nov 11; manually set `SRBI_BID_COVER_RATIO` env pin if media covers it |
| 2 | IDX SSV 21d stale | 🟠 | Pin `IDX_SHORT_SELL_VOLUME_IDR_BN` env or wait for IDX media coverage |
| 3 | IndONIA compounded NULL | ⚠️ | Morning-check will attempt BI direct Playwright; check if stored after run |
| 4 | GDP Q3 release | 🟡 | BPS Q3 GDP expected ~Nov 6–7 2026; run `refresh-monthly-data.ts` after release |
| 5 | bank_pdnl_pct 52d | 🔴 structural | OJK SPI Q3; next update ~Dec 2026; not actionable until Q4 OJK press release |

---

## 2026-10-30 (reference — from memory)

**Health-check baseline:** 42 fresh | 0 aging | 1 stale | 0 critical  
**Key issue:** M12 single-pass scorecard vs detail mismatch (fixed same session, sticky floor)  
**Key issue:** M7 peDiscountScore bug (fixed same session)

---

## Audit checklist

Run these checks before each major SCD session:

```bash
# 1. Health check
bun scripts/health-check.ts

# 2. Spot-check the 3 most crisis-critical indicators
bun -e "
import { getLatestPoint } from './src/tools/macro/time-series-db.js';
const inds = ['indonesia_cds_5y_bps','usdidr_spot','sbn_10y_yield_pct','brent_price_usd','dubai_crude_spot_usd'];
for (const i of inds) {
  const p = await getLatestPoint(i);
  if (!p) { console.log(i+': NULL'); continue; }
  const age = ((Date.now() - new Date(p.fetchedAt).getTime())/86_400_000).toFixed(1);
  console.log(i+':', p.value, '('+age+'d old, src='+p.source+')');
}
" 2>/dev/null

# 3. Check for impossible spreads / values
# Dubai crude should be within 15% of Brent
# CDS 5Y: sanity range 50–500 bps
# USDIDR: sanity range 14,000–22,000
```

## Known structural lags (not bugs — expected delays)

| Indicator | Source | Typical lag | Cadence |
|-----------|--------|-------------|---------|
| `cpo_price_myr` | World Bank Pink Sheet | ~1 month | Monthly (released ~1st) |
| `gdp_growth_pct` | BPS | ~6 weeks | Quarterly |
| `bank_pdnl_pct` | OJK SPI (Kontan) | 1.5–2 months | Quarterly |
| `srbi_bid_cover_ratio` | BI official | ~2 weeks | Bi-weekly (changed Oct 24 from weekly) |
| `indonia_3m_pct` | Trading Economics | 1–3 months | Monthly |
| `indonia_compounded_30d_pct` | BI direct (Playwright) | Same-day | Daily (requires Playwright session) |
| `prabowo_approval_pct` | Media/Exa | ~1 month | Monthly polling |
| `uln_total_bn_usd` | BI SULNI | ~6 weeks | Quarterly |
| `cadev_usd_bn` | BI monthly | ~3 weeks | Monthly |
