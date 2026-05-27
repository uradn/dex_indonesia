/**
 * Indonesia APBN fiscal realization scrapers.
 *
 * APBN 2026 targets (Perpres 201/2024):
 *   Revenue:  IDR 2,996.9 trillion
 *   Spending: IDR 3,621.3 trillion
 *   Deficit:  IDR 624.4 trillion (~2.56% of GDP)
 *
 * Sources:
 *   Trading Economics Playwright — monthly IDR trillion figures:
 *     government-revenues, government-spending, government-budget-value
 *
 * Note: TE shows latest monthly figure, not cumulative YTD.
 *   Fiscal engine accumulates monthly DB entries to compute YTD actuals.
 *   Kemenkeu APBN KiTa (apbnkita.kemenkeu.go.id) would give cumulative —
 *   JS-heavy SPA, not yet scraped.
 */
import type { MacroDataPoint } from '../types.js';
import { fetchRenderedTextWithBrowser } from './playwright-browser.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

interface TeFiscalResult {
  value: number;
  dateStr: string;
}

function parseTeFiscalPage(text: string, keyword: string): TeFiscalResult | null {
  // Table: "Government Revenues  500.27  449.73  IDR Trillion  Nov 2025"
  const tableRe = new RegExp(
    `${keyword}\\s+([\\d,]+\\.?\\d*)\\s+[\\d,]+\\.?\\d*\\s+IDR\\s+Trillion\\s+(\\w{3})\\s+(\\d{4})`, 'i',
  );
  const tableMatch = text.match(tableRe);
  if (tableMatch) {
    const val = parseFloat(tableMatch[1]!.replace(/,/g, ''));
    const mon = tableMatch[2]!;
    const yr = tableMatch[3]!;
    const mm = MONTH_MAP[mon] ?? '01';
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    if (!isNaN(val) && val > 0 && val < 50_000) {
      return { value: parseFloat(val.toFixed(2)), dateStr: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}` };
    }
  }

  // Prose: "Government Revenues in Indonesia increased to 500.27 IDR Trillion in November"
  const proseRe = new RegExp(
    `${keyword} in Indonesia[^0-9]+(\\d+\\.?\\d*)\\s+(?:IDR )?Trillion`, 'i',
  );
  const proseMatch = text.match(proseRe);
  if (proseMatch) {
    const val = parseFloat(proseMatch[1]!);
    if (!isNaN(val) && val > 0 && val < 50_000) {
      return { value: parseFloat(val.toFixed(2)), dateStr: TODAY() };
    }
  }

  // Fallback: look for IDR Billion (TE sometimes shows in billions)
  const billionRe = new RegExp(
    `${keyword}[^0-9]+(\\d+\\.?\\d*)\\s+IDR\\s+Billion`, 'i',
  );
  const billionMatch = text.match(billionRe);
  if (billionMatch) {
    const val = parseFloat(billionMatch[1]!) / 1000; // convert bn to trn
    if (!isNaN(val) && val > 0 && val < 50_000) {
      return { value: parseFloat(val.toFixed(2)), dateStr: TODAY() };
    }
  }

  return null;
}

/**
 * Fetch monthly government revenues from Trading Economics.
 * Returns IDR trillion for latest available month.
 */
export async function fetchGovernmentRevenueTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/government-revenues');
  if (!text) return null;
  const result = parseTeFiscalPage(text, 'Government Revenues');
  if (!result) return null;
  return {
    indicator: 'apbn_revenue_monthly_trn',
    category: 'sovereign',
    date: result.dateStr,
    value: result.value,
    unit: 'IDR_trn',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

/**
 * Fetch monthly government spending from Trading Economics.
 * Returns IDR trillion for latest available month.
 */
export async function fetchGovernmentSpendingTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/government-spending');
  if (!text) return null;
  // TE 'government-spending' may show % of GDP — try specific fiscal page
  const result = parseTeFiscalPage(text, 'Government Spending');
  if (!result) return null;
  return {
    indicator: 'apbn_spending_monthly_trn',
    category: 'sovereign',
    date: result.dateStr,
    value: result.value,
    unit: 'IDR_trn',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

/**
 * Fetch monthly government budget balance from Trading Economics.
 * Positive = surplus, Negative = deficit. IDR trillion.
 */
export async function fetchGovernmentBudgetValueTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/government-budget-value');
  if (!text) return null;
  const result = parseTeFiscalPage(text, 'Government Budget');
  if (!result) return null;
  return {
    indicator: 'apbn_budget_balance_monthly_trn',
    category: 'sovereign',
    date: result.dateStr,
    value: result.value,
    unit: 'IDR_trn',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

export interface FiscalRealization {
  revenue: MacroDataPoint | null;
  spending: MacroDataPoint | null;
  budgetBalance: MacroDataPoint | null;
}

export async function fetchFiscalRealization(): Promise<FiscalRealization> {
  const [revenue, spending, budgetBalance] = await Promise.all([
    fetchGovernmentRevenueTe(),
    fetchGovernmentSpendingTe(),
    fetchGovernmentBudgetValueTe(),
  ]);
  return { revenue, spending, budgetBalance };
}
