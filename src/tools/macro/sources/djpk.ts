/**
 * DJPK SIKD — TKD (Transfer ke Daerah dan Dana Desa) realisasi scraper.
 *
 * Source: djpk.kemenkeu.go.id/portal/data/tkdd
 * Format: static HTML table — no Playwright, no APBN Kita SPA needed.
 * Freshness: daily (CakLur tracking, DJPK updates real-time).
 * Freshness gate: 6h — morning check gets fresh data; manual re-runs within a day stay cached.
 *
 * Why TKD matters for M10/M8 cross-flag:
 *   BPD (Bank Pembangunan Daerah) derive 40–80% of DPK from Pemda deposits.
 *   Pemda deposit level = f(TKD disbursement pace). TKD shortfall → Pemda recall
 *   deposits from BPD → BPD LDR rises → credit crunch in daerah → NPL lag.
 *   Inpres No.1/2025 cut TKD ~Rp50.6T; Asbanda Aug 2026: "BPD liquidity in spotlight."
 *
 * Components extracted:
 *   TOTAL TKDD   — total pagu + realisasi + % (primary signal)
 *   DAU          — Dana Alokasi Umum (~57% of TKD; BPD primary income: ASN salaries)
 *   DBH          — Dana Bagi Hasil (volatile; resource-extraction-dependent)
 *   Dana Desa    — village funds (36.45% as of Nov 2026 — normally disbursed Jan + Jun + Oct)
 *   DAK Non-Fisik — largest operational DAK component (teachers' pay, BOK)
 *
 * DB indicators saved:
 *   tkd_realisasi_pct          — TOTAL TKDD realisasi % of pagu
 *   tkd_realisasi_idr_t        — TOTAL TKDD realisasi IDR trillion
 *   tkdd_pagu_idr_t            — TOTAL TKDD pagu IDR trillion (annual target)
 *   dau_realisasi_pct          — DAU realisasi % (BPD primary funding indicator)
 *   dbh_realisasi_pct          — DBH realisasi %
 *   dana_desa_realisasi_pct    — Dana Desa realisasi %
 *   dak_nonfisik_realisasi_pct — DAK Non-Fisik realisasi %
 *
 * BPD equity proxy:
 *   BJBR.JK (Bank Jabar Banten) + BJTM.JK (Bank Jatim) session returns via Yahoo Finance.
 *   Both drop >5% same session = BPD equity stress signal (forward-leading vs TKD data).
 */
import { upsertPoints, getLatestPoint } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const DJPK_URL = 'https://djpk.kemenkeu.go.id/portal/data/tkdd';
const FRESHNESS_HOURS = 6;
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// Indonesian number format: "725.393,76" → period = thousands sep, comma = decimal
// Result in miliar IDR → / 1000 = T IDR
function parseMiliar(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : parseFloat((val / 1000).toFixed(4));
}

export interface TkdRealisasiResult {
  tkddPaguTrn: number | null;
  tkddRealisasiTrn: number | null;
  tkddRealisasiPct: number | null;
  dauRealisasiPct: number | null;
  dbhRealisasiPct: number | null;
  danaDesaRealisasiPct: number | null;
  dakNonfisikRealisasiPct: number | null;
  date: string;
  fetchedAt: string;
}

export interface BpdEquityProxy {
  bjbrReturnPct: number | null;
  bjtmReturnPct: number | null;
  bothDown5: boolean;
  sessionDate: string;
  fetchedAt: string;
}

async function scrapeTable(): Promise<TkdRealisasiResult | null> {
  try {
    const r = await fetch(DJPK_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,*/*',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return null;

    const plain = tableMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    function extractRow(label: string): { pagu: number | null; real: number | null; pct: number | null } | null {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Label followed by pagu (M), realisasi (M), pct — first match only
      const re = new RegExp(esc + '\\s+([\\d.,]+)\\s+M\\s+([\\d.,]+)\\s+M\\s+([\\d.]+)', 'i');
      const m = plain.match(re);
      if (!m) return null;
      return {
        pagu: parseMiliar(m[1]!),
        real: parseMiliar(m[2]!),
        pct: parseFloat(m[3]!),
      };
    }

    const tkdd     = extractRow('TOTAL TKDD');
    const dau      = extractRow('Dana Alokasi Umum');          // first match = aggregate
    const dbh      = extractRow('Dana Bagi Hasil');
    const desa     = extractRow('DANA DESA');
    const dakNf    = extractRow('Dana Alokasi Khusus Nonfisik');

    if (!tkdd) return null;

    return {
      tkddPaguTrn:           tkdd.pagu,
      tkddRealisasiTrn:      tkdd.real,
      tkddRealisasiPct:      tkdd.pct,
      dauRealisasiPct:       dau?.pct ?? null,
      dbhRealisasiPct:       dbh?.pct ?? null,
      danaDesaRealisasiPct:  desa?.pct ?? null,
      dakNonfisikRealisasiPct: dakNf?.pct ?? null,
      date:      TODAY(),
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch TKD realisasi from DJPK SIKD portal.
 * Freshness gate: 6h. On cache hit, reconstructs result from DB.
 * Returns null only if HTTP fetch fails and no cached data exists.
 */
export async function fetchTkdRealisasi(): Promise<TkdRealisasiResult | null> {
  const cached = await getLatestPoint('tkd_realisasi_pct');
  if (cached?.source === 'djpk_sikd') {
    const ageHours = (Date.now() - new Date(cached.fetchedAt).getTime()) / 3_600_000;
    if (ageHours < FRESHNESS_HOURS) {
      const [dauPt, dbhPt, desaPt, dakPt, paguPt, realPt] = await Promise.all([
        getLatestPoint('dau_realisasi_pct'),
        getLatestPoint('dbh_realisasi_pct'),
        getLatestPoint('dana_desa_realisasi_pct'),
        getLatestPoint('dak_nonfisik_realisasi_pct'),
        getLatestPoint('tkdd_pagu_idr_t'),
        getLatestPoint('tkd_realisasi_idr_t'),
      ]);
      return {
        tkddPaguTrn:             paguPt?.value ?? null,
        tkddRealisasiTrn:        realPt?.value ?? null,
        tkddRealisasiPct:        cached.value,
        dauRealisasiPct:         dauPt?.value ?? null,
        dbhRealisasiPct:         dbhPt?.value ?? null,
        danaDesaRealisasiPct:    desaPt?.value ?? null,
        dakNonfisikRealisasiPct: dakPt?.value ?? null,
        date:      cached.date,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const result = await scrapeTable();
  if (!result) return null;

  const base: Omit<MacroDataPoint, 'indicator' | 'value' | 'unit'> = {
    category: 'sovereign',
    source:   'djpk_sikd',
    date:     result.date,
    fetchedAt: result.fetchedAt,
  };

  const pts: MacroDataPoint[] = [];
  if (result.tkddRealisasiPct !== null)
    pts.push({ ...base, indicator: 'tkd_realisasi_pct',           value: result.tkddRealisasiPct,           unit: '%'    });
  if (result.tkddRealisasiTrn !== null)
    pts.push({ ...base, indicator: 'tkd_realisasi_idr_t',         value: result.tkddRealisasiTrn,           unit: 'T_IDR' });
  if (result.tkddPaguTrn !== null)
    pts.push({ ...base, indicator: 'tkdd_pagu_idr_t',             value: result.tkddPaguTrn,                unit: 'T_IDR' });
  if (result.dauRealisasiPct !== null)
    pts.push({ ...base, indicator: 'dau_realisasi_pct',           value: result.dauRealisasiPct,            unit: '%'    });
  if (result.dbhRealisasiPct !== null)
    pts.push({ ...base, indicator: 'dbh_realisasi_pct',           value: result.dbhRealisasiPct,            unit: '%'    });
  if (result.danaDesaRealisasiPct !== null)
    pts.push({ ...base, indicator: 'dana_desa_realisasi_pct',     value: result.danaDesaRealisasiPct,       unit: '%'    });
  if (result.dakNonfisikRealisasiPct !== null)
    pts.push({ ...base, indicator: 'dak_nonfisik_realisasi_pct',  value: result.dakNonfisikRealisasiPct,    unit: '%'    });

  if (pts.length > 0) await upsertPoints(pts);
  return result;
}

/**
 * Fetch BPD equity proxy: BJBR.JK + BJTM.JK session returns.
 *
 * BJBR = Bank Jabar Banten (Jawa Barat Pemda), BJTM = Bank Jatim (Jawa Timur Pemda).
 * Both listed BPDs (KBMI III — large regional banks). Combined drop >5% = BPD equity stress.
 * Forward-leading vs TKD realisasi data by days–weeks (equity market prices in early).
 *
 * Note: freshness gate is NOT applied here — Yahoo Finance quote is always live.
 * Use only as daily flag; do not gate on DB cache (session return must be today's).
 */
export async function fetchBpdEquityProxy(): Promise<BpdEquityProxy> {
  const BPD_SYMBOLS = ['BJBR.JK', 'BJTM.JK'] as const;
  const results = await Promise.allSettled(
    BPD_SYMBOLS.map(async sym => {
      const chart = await yf.chart(sym, {
        period1: new Date(Date.now() - 5 * 86_400_000),
        period2: new Date(),
        interval: '1d',
      });
      const quotes = (chart.quotes ?? []).filter(q => q.close != null);
      if (quotes.length < 2) return { sym, returnPct: null };
      const prev = quotes[quotes.length - 2].close!;
      const curr = quotes[quotes.length - 1].close!;
      if (prev === 0) return { sym, returnPct: null };
      return {
        sym,
        returnPct: parseFloat((((curr - prev) / prev) * 100).toFixed(2)),
      };
    }),
  );

  const bjbr = results[0].status === 'fulfilled' ? results[0].value.returnPct : null;
  const bjtm = results[1].status === 'fulfilled' ? results[1].value.returnPct : null;

  return {
    bjbrReturnPct: bjbr,
    bjtmReturnPct: bjtm,
    bothDown5: bjbr !== null && bjtm !== null && bjbr < -5 && bjtm < -5,
    sessionDate: TODAY(),
    fetchedAt:   NOW(),
  };
}
