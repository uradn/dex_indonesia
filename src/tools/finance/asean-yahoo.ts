import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance();
import { formatToolResult } from '../types.js';
import { readCache, writeCache } from '../../utils/cache.js';
import { TTL_15M, TTL_24H } from './utils.js';

export const ASEAN_MARKET_SUFFIXES: Record<string, string> = {
  JK: 'Indonesia (IDX)',
  KL: 'Malaysia (Bursa)',
  SI: 'Singapore (SGX)',
  BK: 'Thailand (SET)',
  PS: 'Philippines (PSE)',
};

export const ASEAN_INDICES: Record<string, string> = {
  // Composite indices
  '^JKSE': 'IHSG – Indonesia Composite',
  '^KLSE': 'KLCI – Malaysia Composite',
  '^STI': 'STI – Singapore Straits Times',
  '^SET.BK': 'SET – Thailand Composite',
  '^PSEi': 'PSEi – Philippines Composite',
  // IDX sub-indices
  '^JKLQ45': 'LQ45 – Indonesia Top 45 Liquid Stocks',
  // IDX sectoral indices
  '^JKAGRI': 'IDX Agriculture Sector',
  '^JKCONS': 'IDX Consumer Goods Sector',
  '^JKPROP': 'IDX Construction, Property & Real Estate Sector',
  '^JKMISC': 'IDX Miscellaneous Industry Sector',
};

// ---------------------------------------------------------------------------
// get_asean_quote
// ---------------------------------------------------------------------------

export const getAseanQuote = new DynamicStructuredTool({
  name: 'get_asean_quote',
  description:
    'Current price snapshot for one or more ASEAN stocks or market indices. ' +
    'Stock tickers need exchange suffix: .JK (Indonesia), .KL (Malaysia), .SI (Singapore), .BK (Thailand), .PS (Philippines). ' +
    'Index tickers: ^JKSE (IHSG), ^JKLQ45 (LQ45), ^JKAGRI/^JKCONS/^JKPROP/^JKMISC (IDX sectors), ^KLSE (KLCI), ^STI, ^SET.BK, ^PSEi.',
  schema: z.object({
    symbols: z
      .array(z.string())
      .describe(
        'Ticker symbols with exchange suffix, e.g. ["BBCA.JK", "^JKSE", "DBS.SI"]. Up to 10 symbols per call.',
      ),
  }),
  func: async (input) => {
    const results: Record<string, unknown> = {};

    await Promise.all(
      input.symbols.map(async (symbol) => {
        const endpoint = `/yahoo/quote/${symbol}`;
        const cached = readCache(endpoint, {}, TTL_15M);
        if (cached) {
          results[symbol] = cached.data['result'];
          return;
        }
        try {
          const q = await yf.quote(symbol);
          const data = {
            symbol: q.symbol,
            shortName: q.shortName,
            longName: q.longName,
            currency: q.currency,
            exchange: q.exchange,
            marketState: q.marketState,
            regularMarketPrice: q.regularMarketPrice,
            regularMarketChange: q.regularMarketChange,
            regularMarketChangePercent: q.regularMarketChangePercent,
            regularMarketOpen: q.regularMarketOpen,
            regularMarketDayHigh: q.regularMarketDayHigh,
            regularMarketDayLow: q.regularMarketDayLow,
            regularMarketVolume: q.regularMarketVolume,
            regularMarketPreviousClose: q.regularMarketPreviousClose,
            marketCap: q.marketCap,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow,
            fiftyDayAverage: q.fiftyDayAverage,
            twoHundredDayAverage: q.twoHundredDayAverage,
            trailingPE: q.trailingPE,
            forwardPE: q.forwardPE,
            dividendYield: q.dividendYield,
            epsTrailingTwelveMonths: q.epsTrailingTwelveMonths,
          };
          writeCache(endpoint, {}, { result: data }, `https://finance.yahoo.com/quote/${symbol}`);
          results[symbol] = data;
        } catch (err) {
          results[symbol] = { error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );

    const urls = input.symbols.map((s) => `https://finance.yahoo.com/quote/${s}`);
    return formatToolResult(results, urls);
  },
});

// ---------------------------------------------------------------------------
// get_asean_history
// ---------------------------------------------------------------------------

export const getAseanHistory = new DynamicStructuredTool({
  name: 'get_asean_history',
  description:
    'Historical OHLCV price data for an ASEAN stock or index over a date range. ' +
    'Use for trend analysis, charting, or performance comparisons.',
  schema: z.object({
    symbol: z.string().describe('Ticker with exchange suffix, e.g. "BBCA.JK" or "^JKSE"'),
    start_date: z.string().describe('Start date YYYY-MM-DD'),
    end_date: z.string().describe('End date YYYY-MM-DD'),
    interval: z
      .enum(['1d', '1wk', '1mo'])
      .default('1d')
      .describe('Bar interval. Default: 1d (daily)'),
  }),
  func: async (input) => {
    const endpoint = `/yahoo/history/${input.symbol}`;
    const params = { start: input.start_date, end: input.end_date, interval: input.interval };

    const endDate = new Date(input.end_date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cacheable = endDate < today;

    if (cacheable) {
      const cached = readCache(endpoint, params);
      if (cached) return formatToolResult(cached.data['result'], [cached.url]);
    }

    const rows = await yf.historical(input.symbol, {
      period1: input.start_date,
      period2: input.end_date,
      interval: input.interval,
    });

    const data = (rows as unknown as Array<{ date: Date; open?: number; high?: number; low?: number; close?: number; adjClose?: number; volume?: number }>).map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      adjClose: r.adjClose,
      volume: r.volume,
    }));

    const url = `https://finance.yahoo.com/quote/${input.symbol}/history`;
    if (cacheable) writeCache(endpoint, params, { result: data }, url);
    return formatToolResult(data, [url]);
  },
});

// ---------------------------------------------------------------------------
// get_asean_fundamentals
// ---------------------------------------------------------------------------

const STATEMENT_MODULE_MAP = {
  income_statement_annual: 'incomeStatementHistory',
  income_statement_quarterly: 'incomeStatementHistoryQuarterly',
  balance_sheet_annual: 'balanceSheetHistory',
  balance_sheet_quarterly: 'balanceSheetHistoryQuarterly',
  cash_flow_annual: 'cashflowStatementHistory',
  cash_flow_quarterly: 'cashflowStatementHistoryQuarterly',
  key_statistics: 'defaultKeyStatistics',
  financial_data: 'financialData',
  asset_profile: 'assetProfile',
  summary_detail: 'summaryDetail',
} as const;

type StatementKey = keyof typeof STATEMENT_MODULE_MAP;
type YahooModule = (typeof STATEMENT_MODULE_MAP)[StatementKey];

export const getAseanFundamentals = new DynamicStructuredTool({
  name: 'get_asean_fundamentals',
  description:
    'Income statement, balance sheet, cash flow statement, and key financial ratios for an ASEAN stock via Yahoo Finance. ' +
    'Coverage varies by company; major IDX, Bursa, SGX, SET, PSE stocks generally have data.',
  schema: z.object({
    symbol: z.string().describe('Ticker with exchange suffix, e.g. "BBCA.JK" or "DBS.SI"'),
    statements: z
      .array(
        z.enum([
          'income_statement_annual',
          'income_statement_quarterly',
          'balance_sheet_annual',
          'balance_sheet_quarterly',
          'cash_flow_annual',
          'cash_flow_quarterly',
          'key_statistics',
          'financial_data',
          'asset_profile',
          'summary_detail',
        ]),
      )
      .default(['income_statement_annual', 'balance_sheet_annual', 'cash_flow_annual'])
      .describe('Which data modules to fetch. Defaults to annual income statement, balance sheet, and cash flow.'),
  }),
  func: async (input) => {
    const modules = [
      ...new Set(input.statements.map((s) => STATEMENT_MODULE_MAP[s as StatementKey])),
    ] as YahooModule[];

    const endpoint = `/yahoo/fundamentals/${input.symbol}`;
    const params = { modules: modules.join(',') };

    const cached = readCache(endpoint, params, TTL_24H);
    if (cached) return formatToolResult(cached.data['result'], [cached.url]);

    const summary = await yf.quoteSummary(input.symbol, { modules });

    const url = `https://finance.yahoo.com/quote/${input.symbol}/financials`;
    writeCache(endpoint, params, { result: summary as unknown as Record<string, unknown> }, url);
    return formatToolResult(summary, [url]);
  },
});

// ---------------------------------------------------------------------------
// get_asean_search
// ---------------------------------------------------------------------------

export const getAseanSearch = new DynamicStructuredTool({
  name: 'get_asean_search',
  description:
    'Search Yahoo Finance for a company name and return matching ticker symbols. ' +
    'Use when you have a company name but not the ticker (e.g. "Bank Central Asia" → "BBCA.JK").',
  schema: z.object({
    query: z.string().describe('Company name or keyword, e.g. "Telkom Indonesia" or "DBS Bank"'),
  }),
  func: async (input) => {
    const endpoint = `/yahoo/search/${input.query}`;
    const cached = readCache(endpoint, {}, TTL_24H);
    if (cached) return formatToolResult(cached.data['result'], [cached.url]);

    const res = await yf.search(input.query);
    const hits = (res.quotes as unknown as Array<Record<string, unknown>>)
      .filter((q) => q['quoteType'] === 'EQUITY' || q['quoteType'] === 'INDEX')
      .slice(0, 15)
      .map((q) => ({
        symbol: q['symbol'],
        shortname: q['shortname'],
        longname: q['longname'],
        exchange: q['exchange'],
        exchangeDisp: q['exchDisp'],
        quoteType: q['quoteType'],
      }));

    const url = `https://finance.yahoo.com/lookup?s=${encodeURIComponent(input.query)}`;
    writeCache(endpoint, {}, { result: hits }, url);
    return formatToolResult(hits, [url]);
  },
});
