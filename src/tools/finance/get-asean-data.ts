import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { withTimeout, SUB_TOOL_TIMEOUT_MS } from './utils.js';
import { getAseanQuote, getAseanHistory, getAseanFundamentals, getAseanSearch, ASEAN_INDICES } from './asean-yahoo.js';

export const GET_ASEAN_DATA_DESCRIPTION = `
Intelligent meta-tool for ASEAN equity and index market data. Covers Indonesia (IDX), Malaysia (Bursa), Singapore (SGX), Thailand (SET), and Philippines (PSE). Data sourced from Yahoo Finance — no API key required.

## When to Use

- ASEAN stock quotes and price snapshots (current price, market cap, P/E, 52-week range)
- Market index snapshots: IHSG (Indonesia), KLCI (Malaysia), STI (Singapore), SET (Thailand), PSEi (Philippines)
- Historical price data and performance analysis for ASEAN stocks or indices
- Income statements, balance sheets, cash flow statements for ASEAN-listed companies
- Key financial ratios and statistics for ASEAN companies
- Company profile and sector information
- Resolving ASEAN company names to their ticker symbols

## When NOT to Use

- US stocks or indices (use get_financials and get_market_data instead)
- Crypto prices (use get_market_data)
- SEC filings (use read_filings — US only)
- General web search (use web_search)

## Ticker Format

Tickers require the exchange suffix:
- Indonesia (IDX): BBCA.JK, TLKM.JK, BBRI.JK, ASII.JK, BMRI.JK
- Malaysia (Bursa): MAYBANK.KL, CIMB.KL, TENAGA.KL
- Singapore (SGX): DBS.SI, OCBC.SI, UOB.SI, SINGTEL.SI
- Thailand (SET): PTT.BK, CPALL.BK, SCB.BK
- Philippines (PSE): SM.PS, ALI.PS, BDO.PS

Index tickers (no suffix): ^JKSE (IHSG), ^JKLQ45 (LQ45), ^KLSE (KLCI), ^STI, ^SET.BK, ^PSEi

IDX sectoral indices: ^JKAGRI (Agriculture), ^JKCONS (Consumer Goods), ^JKPROP (Property & Construction), ^JKMISC (Miscellaneous Industry)

## Coverage Limitations

- stock_screener is US-only — cannot screen IDX stocks by fundamental criteria
- IDX small/mid-cap fundamentals on Yahoo Finance are often incomplete; large-caps (BBCA, TLKM, BBRI, ASII, BMRI, GOTO, BREN) are reliable
- IDX30, JII (Sharia), IDX80 index tickers are not available on Yahoo Finance; use ^JKLQ45 as the primary IDX blue-chip proxy

## Usage Notes

- Call ONCE with the full natural language query — internal routing handles complexity
- If you have a company name but not the ticker, this tool will resolve it
- Fundamental data coverage varies; major large-cap ASEAN stocks typically have full data
- Prices are in local currency (IDR for .JK, MYR for .KL, SGD for .SI, THB for .BK, PHP for .PS)
`.trim();

const ASEAN_TOOLS: StructuredToolInterface[] = [
  getAseanQuote,
  getAseanHistory,
  getAseanFundamentals,
  getAseanSearch,
];

const ASEAN_TOOL_MAP = new Map(ASEAN_TOOLS.map((t) => [t.name, t]));

function formatSubToolName(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildRouterPrompt(): string {
  const indexList = Object.entries(ASEAN_INDICES)
    .map(([ticker, name]) => `  - ${ticker} → ${name}`)
    .join('\n');

  return `You are an ASEAN financial data routing assistant.
Current date: ${getCurrentDate()}

Given a natural language query about ASEAN markets, call the appropriate tool(s) below.

## Tool Selection Guidelines

- **get_asean_search**: Use FIRST if you do not know the exact ticker for a company name. Also use if the user asks "what is the ticker for X".
- **get_asean_quote**: Current price snapshot, market cap, P/E ratio, 52-week range. Handles multiple symbols in one call — batch them.
- **get_asean_history**: Historical OHLCV data over a date range. Use for trend analysis, YTD performance, comparisons.
- **get_asean_fundamentals**: Income statement, balance sheet, cash flow, key statistics. Prefer annual for long-term analysis, quarterly for recent results.

## Ticker Suffix Rules

Always append the correct suffix:
- Indonesia → .JK (e.g. BBCA.JK, TLKM.JK, IHSG index = ^JKSE)
- Malaysia → .KL (e.g. MAYBANK.KL)
- Singapore → .SI (e.g. DBS.SI)
- Thailand → .BK (e.g. PTT.BK)
- Philippines → .PS (e.g. SM.PS)

## ASEAN Indices

${indexList}

## Date Inference

- "YTD" → start_date: Jan 1 of current year, end_date: today
- "last year" → start_date: 1 year ago, end_date: today
- "last month" → start_date: 1 month ago, end_date: today
- "2024" → start_date: 2024-01-01, end_date: 2024-12-31

## Efficiency

- For index monitoring (e.g. "how is IHSG today?") → get_asean_quote with ['^JKSE']
- For multi-market dashboard → batch all index symbols in a single get_asean_quote call
- For fundamentals, default to annual statements unless user asks for quarterly
- Do not call get_asean_search if you already know the ticker

Call the appropriate tool(s) now.`;
}

const GetAseanDataInputSchema = z.object({
  query: z
    .string()
    .describe(
      'Natural language query about ASEAN stocks, market indices, fundamentals, or prices. Examples: "How is IHSG today?", "Show BBCA income statement", "Compare DBS vs OCBC YTD performance"',
    ),
});

export function createGetAseanData(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_asean_data',
    description:
      'ASEAN market data: stock quotes, index snapshots (IHSG, KLCI, STI, SET, PSEi), historical prices, and company fundamentals (income statement, balance sheet, cash flow) for Indonesia, Malaysia, Singapore, Thailand, and Philippines. No API key required.',
    schema: GetAseanDataInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('Routing ASEAN market query...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: ASEAN_TOOLS,
      });
      const aiMessage = response as AIMessage;

      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'No tools selected for query' }, []);
      }

      const toolNames = [...new Set(toolCalls.map((tc) => formatSubToolName(tc.name)))];
      onProgress?.(`Fetching ${toolNames.join(', ')}...`);

      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const tool = ASEAN_TOOL_MAP.get(tc.name);
            if (!tool) throw new Error(`Tool '${tc.name}' not found`);
            const rawResult = await withTimeout(tool.invoke(tc.args), SUB_TOOL_TIMEOUT_MS, tc.name);
            const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            const parsed = JSON.parse(result);
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null,
            };
          } catch (error) {
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      const successful = results.filter((r) => r.error === null);
      const failed = results.filter((r) => r.error !== null);
      const allUrls = results.flatMap((r) => r.sourceUrls);

      const combinedData: Record<string, unknown> = {};
      for (const r of successful) {
        const symbol =
          (r.args as Record<string, unknown>).symbol as string | undefined;
        const symbols =
          (r.args as Record<string, unknown>).symbols as string[] | undefined;
        const key =
          symbol ? `${r.tool}_${symbol}` :
          symbols?.length === 1 ? `${r.tool}_${symbols[0]}` :
          r.tool;
        combinedData[key] = r.data;
      }

      if (failed.length > 0) {
        combinedData._errors = failed.map((r) => ({ tool: r.tool, args: r.args, error: r.error }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}
