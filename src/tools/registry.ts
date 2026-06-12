import { StructuredToolInterface } from '@langchain/core/tools';
import { createGetFinancials, createGetMarketData, createReadFilings, createScreenStocks } from './finance/index.js';
import { exaSearch, perplexitySearch, tavilySearch, langSearch, WEB_SEARCH_DESCRIPTION, xSearchTool, X_SEARCH_DESCRIPTION } from './search/index.js';
import { createWebSearchTool, type WebSearchProvider } from './search/web-search.js';
import { getSetting } from '../utils/config.js';
import type { SearchProviderId } from '../utils/env.js';
import { skillTool, SKILL_TOOL_DESCRIPTION } from './skill.js';
import { webFetchTool, WEB_FETCH_DESCRIPTION } from './fetch/web-fetch.js';
import { browserTool, BROWSER_DESCRIPTION } from './browser/browser.js';
import { readFileTool, READ_FILE_DESCRIPTION } from './filesystem/read-file.js';
import { writeFileTool, WRITE_FILE_DESCRIPTION } from './filesystem/write-file.js';
import { editFileTool, EDIT_FILE_DESCRIPTION } from './filesystem/edit-file.js';
import { GET_FINANCIALS_DESCRIPTION } from './finance/get-financials.js';
import { GET_MARKET_DATA_DESCRIPTION } from './finance/get-market-data.js';
import { READ_FILINGS_DESCRIPTION } from './finance/read-filings.js';
import { SCREEN_STOCKS_DESCRIPTION } from './finance/screen-stocks.js';
import { heartbeatTool, HEARTBEAT_TOOL_DESCRIPTION } from './heartbeat/heartbeat-tool.js';
import { cronTool, CRON_TOOL_DESCRIPTION } from './cron/cron-tool.js';
import { memoryGetTool, MEMORY_GET_DESCRIPTION, memorySearchTool, MEMORY_SEARCH_DESCRIPTION, memoryUpdateTool, MEMORY_UPDATE_DESCRIPTION } from './memory/index.js';
import { discoverSkills } from '../skills/index.js';
import { createGetAseanData, GET_ASEAN_DATA_DESCRIPTION } from './finance/get-asean-data.js';
import { fxDefenseEngine, FX_DEFENSE_DESCRIPTION } from './macro/fx-defense-engine.js';
import { bopEngine, BOP_DESCRIPTION } from './macro/bop-engine.js';
import { regimeEngine, REGIME_DESCRIPTION } from './macro/regime-engine.js';
import { sovereignRiskEngine, SOVEREIGN_RISK_DESCRIPTION } from './macro/sovereign-risk-engine.js';
import { commodityEngine, COMMODITY_DESCRIPTION } from './macro/commodity-engine.js';
import { foreignFlowEngine, FOREIGN_FLOW_DESCRIPTION } from './macro/foreign-flow-engine.js';
import { narrativeDivergenceEngine, NARRATIVE_DIVERGENCE_DESCRIPTION } from './macro/narrative-divergence-engine.js';
import { aseanRelativeValueEngine, ASEAN_RELATIVE_VALUE_DESCRIPTION } from './macro/asean-relative-value-engine.js';
import { bankingStressEngine, BANKING_STRESS_DESCRIPTION } from './macro/banking-stress-engine.js';
import { marketStressEngine, MARKET_STRESS_DESCRIPTION } from './macro/market-stress-engine.js';
import { fiscalEngine, FISCAL_DESCRIPTION } from './macro/fiscal-engine.js';
import { silentCrisisDetector, SILENT_CRISIS_DESCRIPTION } from './macro/silent-crisis-detector.js';
import { backtestEngine, BACKTEST_DESCRIPTION } from './macro/backtest-tool.js';
import { stressSimulator, STRESS_SIMULATOR_DESCRIPTION } from './macro/stress-simulator.js';
import { macroThresholdMonitor, THRESHOLD_MONITOR_DESCRIPTION } from './macro/macro-threshold-monitor.js';
import { fxRateRefreshTool, FX_RATE_REFRESH_DESCRIPTION } from './macro/fx-rate-refresh-tool.js';
import { domesticPressureEngine, DOMESTIC_PRESSURE_DESCRIPTION } from './macro/domestic-pressure-engine.js';
import { politicalRiskEngine, POLITICAL_RISK_DESCRIPTION } from './macro/political-risk-engine.js';
import { ulnEngine, ULN_DESCRIPTION } from './macro/uln-engine.js';
import { armThesisTool, ARM_THESIS_DESCRIPTION } from './macro/arm-thesis-tool.js';

/**
 * A registered tool with its rich description for system prompt injection.
 */
export interface RegisteredTool {
  /** Tool name (must match the tool's name property) */
  name: string;
  /** The actual tool instance */
  tool: StructuredToolInterface;
  /** Rich description for system prompt (includes when to use, when not to use, etc.) */
  description: string;
  /** 1-2 sentence description for token-optimized system prompts. */
  compactDescription: string;
  /** Whether this tool can safely execute concurrently with other concurrent-safe tools. */
  concurrencySafe: boolean;
}

/**
 * Get all registered tools with their descriptions.
 * Conditionally includes tools based on environment configuration.
 *
 * @param model - The model name (needed for tools that require model-specific configuration)
 * @returns Array of registered tools
 */
export function getToolRegistry(model: string): RegisteredTool[] {
  const tools: RegisteredTool[] = [
    {
      name: 'get_financials',
      tool: createGetFinancials(model),
      description: GET_FINANCIALS_DESCRIPTION,
      compactDescription: 'Financial statements and metrics. Handles multi-company/multi-metric queries in one call.',
      concurrencySafe: true,
    },
    {
      name: 'get_market_data',
      tool: createGetMarketData(model),
      description: GET_MARKET_DATA_DESCRIPTION,
      compactDescription: 'Stock/crypto prices, company news, and insider trades. Handles multi-asset queries in one call.',
      concurrencySafe: true,
    },
    {
      name: 'read_filings',
      tool: createReadFilings(model),
      description: READ_FILINGS_DESCRIPTION,
      compactDescription: 'SEC filings (10-K, 10-Q, 8-K). Extracts and summarizes specific filing sections.',
      concurrencySafe: true,
    },
    {
      name: 'stock_screener',
      tool: createScreenStocks(model),
      description: SCREEN_STOCKS_DESCRIPTION,
      compactDescription: 'Screen stocks by financial criteria (P/E, growth, margins, etc.).',
      concurrencySafe: true,
    },
    {
      name: 'get_asean_data',
      tool: createGetAseanData(model),
      description: GET_ASEAN_DATA_DESCRIPTION,
      compactDescription: 'ASEAN market data: stock quotes, indices (IHSG, KLCI, STI, SET, PSEi), historical prices, and fundamentals for IDX, Bursa, SGX, SET, PSE. No API key needed.',
      concurrencySafe: true,
    },
    {
      name: 'fx_defense_engine',
      tool: fxDefenseEngine,
      description: FX_DEFENSE_DESCRIPTION,
      compactDescription: 'FX Defense Engine: IDR stress, reserve trajectory, BI intervention proxy, pseudo-stability detection. Outputs institutional FX stress memo.',
      concurrencySafe: true,
    },
    {
      name: 'bop_engine',
      tool: bopEngine,
      description: BOP_DESCRIPTION,
      compactDescription: 'Balance of Payments Engine: trade balance, current account, FX reserves, import growth, synthetic CAD risk. Indonesia external vulnerability assessment.',
      concurrencySafe: true,
    },
    {
      name: 'regime_engine',
      tool: regimeEngine,
      description: REGIME_DESCRIPTION,
      compactDescription: 'Quad Regime Engine: classifies Indonesia macro regime (Q1–Q4) using Growth ROC × Inflation ROC. Shift probability + historical analogs.',
      concurrencySafe: true,
    },
    {
      name: 'sovereign_risk_engine',
      tool: sovereignRiskEngine,
      description: SOVEREIGN_RISK_DESCRIPTION,
      compactDescription: 'Sovereign Risk Engine: CDS 5Y, SBN yield, EMBI spread, foreign SBN ownership. Detects repricing cycles and fiscal credibility breakdown.',
      concurrencySafe: true,
    },
    {
      name: 'commodity_engine',
      tool: commodityEngine,
      description: COMMODITY_DESCRIPTION,
      compactDescription: 'Commodity Engine: tracks Indonesia export basket (coal, CPO, nickel, ferro-alloys, LNG, copper) and oil import vulnerability. Commodity Cushion Score + Oil Vulnerability Index.',
      concurrencySafe: true,
    },
    {
      name: 'foreign_flow_engine',
      tool: foreignFlowEngine,
      description: FOREIGN_FLOW_DESCRIPTION,
      compactDescription: 'Foreign Flow Engine: detects silent foreign exit via EIDO ETF and SBN ownership trend. Identifies domestic absorption masking.',
      concurrencySafe: true,
    },
    {
      name: 'narrative_divergence_engine',
      tool: narrativeDivergenceEngine,
      description: NARRATIVE_DIVERGENCE_DESCRIPTION,
      compactDescription: 'Narrative Divergence Engine: compares official BI/government guidance vs market pricing. Generates Narrative Credibility Score.',
      concurrencySafe: true,
    },
    {
      name: 'asean_relative_value_engine',
      tool: aseanRelativeValueEngine,
      description: ASEAN_RELATIVE_VALUE_DESCRIPTION,
      compactDescription: 'ASEAN Relative Value Engine: compares Indonesia vs ASEAN peers on FX depreciation. Decomposes IDR weakness into DXY story vs ID-specific repricing.',
      concurrencySafe: true,
    },
    {
      name: 'banking_stress_engine',
      tool: bankingStressEngine,
      description: BANKING_STRESS_DESCRIPTION,
      compactDescription: 'Banking Stress Engine: NPL ratio, LDR, CAR, JIBOR-BI spread, external debt, IHPR property index, sector NPL. The Big Short early warning — detects hidden credit cycle stress before consensus.',
      concurrencySafe: true,
    },
    {
      name: 'market_stress_engine',
      tool: marketStressEngine,
      description: MARKET_STRESS_DESCRIPTION,
      compactDescription: 'Market Stress Engine: IHSG P/E ratio vs historical, IDX advance/decline breadth. Detects valuation disconnect and narrow leadership risk.',
      concurrencySafe: true,
    },
    {
      name: 'fiscal_engine',
      tool: fiscalEngine,
      description: FISCAL_DESCRIPTION,
      compactDescription: 'Fiscal Engine: APBN 2026 realisasi vs target. Revenue/spending absorption rate, deficit trajectory vs 3% GDP limit. Monthly monitoring.',
      concurrencySafe: true,
    },
    {
      name: 'silent_crisis_detector',
      tool: silentCrisisDetector,
      description: SILENT_CRISIS_DESCRIPTION,
      compactDescription: 'Big Short Mode: aggregates all 10 macro modules into Silent Crisis Probability. Detects fake stability, cross-confirmed stress, and systemic fragility.',
      concurrencySafe: false,
    },
    {
      name: 'backtest_engine',
      tool: backtestEngine,
      description: BACKTEST_DESCRIPTION,
      compactDescription: 'Walk-forward backtest: validates macro stress signals against 6 Indonesia crisis events (2013–2023). Outputs hit rate, lead time, false positive rate.',
      concurrencySafe: false,
    },
    {
      name: 'stress_simulator',
      tool: stressSimulator,
      description: STRESS_SIMULATOR_DESCRIPTION,
      compactDescription: 'Stress scenario simulator: what-if analysis (IDR 18500, VIX 45, commodity crash -30%). Shows baseline vs stressed composite scores and alert level transition.',
      concurrencySafe: true,
    },
    {
      name: 'macro_threshold_monitor',
      tool: macroThresholdMonitor,
      description: THRESHOLD_MONITOR_DESCRIPTION,
      compactDescription: 'Fast threshold tripwire: checks USDIDR, VIX, DXY, Brent against fixed alert thresholds in seconds. Returns all-clear or breach list. Use for cron intraday checks.',
      concurrencySafe: true,
    },
    {
      name: 'fx_rate_refresh',
      tool: fxRateRefreshTool,
      description: FX_RATE_REFRESH_DESCRIPTION,
      compactDescription: 'Fetch and persist latest IDR/USD + ASEAN FX spots into macro DB. Lightweight spot-only refresh. Call before any analysis quoting IDR/USD levels.',
      concurrencySafe: true,
    },
    {
      name: 'domestic_pressure_engine',
      tool: domesticPressureEngine,
      description: DOMESTIC_PRESSURE_DESCRIPTION,
      compactDescription: 'Domestic Inflation Pressure Engine: tracks 10 PIHPS sembako prices (beras, cabai, bawang, daging, telur, minyak, gula). Food Stress Index + DOMESTIC PRESSURE ALERT when ≥2 commodities spike. CPI early warning feed for BI rate chain.',
      concurrencySafe: true,
    },
    {
      name: 'uln_engine',
      tool: ulnEngine,
      description: ULN_DESCRIPTION,
      compactDescription: 'ULN Engine (Module 13): Indonesia external debt stress. Tracks ULN/GDP, DSR, Greenspan-Guidotti ratio, YoY growth, BI hedging compliance. Cross-feeds to BoP, FX Defense, Banking engines.',
      concurrencySafe: true,
    },
    {
      name: 'political_risk_engine',
      tool: politicalRiskEngine,
      description: POLITICAL_RISK_DESCRIPTION,
      compactDescription: 'Political Risk Engine: BPS unemployment + Exa news sentiment (food pressure, labor protests, governance). Political Risk Index 0-100. Detects social contract stress before it reprices into sovereign spreads.',
      concurrencySafe: true,
    },
    {
      name: 'arm_thesis',
      tool: armThesisTool,
      description: ARM_THESIS_DESCRIPTION,
      compactDescription: 'ARM Big Short thesis to DB (status: armed). Call at end of big-short-thesis skill. Enables walk-forward T+3/6/12 backtesting and /bs dashboard tracking.',
      concurrencySafe: false,
    },
    {
      name: 'web_fetch',
      tool: webFetchTool,
      description: WEB_FETCH_DESCRIPTION,
      compactDescription: 'Fetch and extract content from a URL as markdown. Use when you need full article text beyond headlines.',
      concurrencySafe: true,
    },
    {
      name: 'browser',
      tool: browserTool,
      description: BROWSER_DESCRIPTION,
      compactDescription: 'JavaScript-rendered pages and interactive navigation. Actions: navigate, snapshot, act, read, close.',
      concurrencySafe: true,
    },
    {
      name: 'read_file',
      tool: readFileTool,
      description: READ_FILE_DESCRIPTION,
      compactDescription: 'Read a local file by path. Returns file content as text.',
      concurrencySafe: true,
    },
    {
      name: 'write_file',
      tool: writeFileTool,
      description: WRITE_FILE_DESCRIPTION,
      compactDescription: 'Create or overwrite a file. Requires user approval.',
      concurrencySafe: false,
    },
    {
      name: 'edit_file',
      tool: editFileTool,
      description: EDIT_FILE_DESCRIPTION,
      compactDescription: 'Edit a file by replacing text. Requires user approval.',
      concurrencySafe: false,
    },
    {
      name: 'heartbeat',
      tool: heartbeatTool,
      description: HEARTBEAT_TOOL_DESCRIPTION,
      compactDescription: 'View or update the periodic heartbeat checklist (.dexter/HEARTBEAT.md).',
      concurrencySafe: true,
    },
    {
      name: 'cron',
      tool: cronTool,
      description: CRON_TOOL_DESCRIPTION,
      compactDescription: 'Manage scheduled cron jobs (create, list, update, delete).',
      concurrencySafe: true,
    },
    {
      name: 'memory_search',
      tool: memorySearchTool,
      description: MEMORY_SEARCH_DESCRIPTION,
      compactDescription: 'Search persistent memory and past conversations for stored facts and preferences.',
      concurrencySafe: true,
    },
    {
      name: 'memory_get',
      tool: memoryGetTool,
      description: MEMORY_GET_DESCRIPTION,
      compactDescription: 'Read specific memory file sections by line range.',
      concurrencySafe: true,
    },
    {
      name: 'memory_update',
      tool: memoryUpdateTool,
      description: MEMORY_UPDATE_DESCRIPTION,
      compactDescription: 'Add, edit, or delete persistent memory entries.',
      concurrencySafe: false,
    },
  ];

  // Build web_search as a fallback chain over whichever providers have keys configured.
  // The user's preferred provider (set via /search) is tried first; the others act as fallbacks.
  const allWebSearchProviders: WebSearchProvider[] = [];
  if (process.env.EXASEARCH_API_KEY) {
    allWebSearchProviders.push({ id: 'exa', name: 'Exa', tool: exaSearch });
  }
  if (process.env.PERPLEXITY_API_KEY) {
    allWebSearchProviders.push({ id: 'perplexity', name: 'Perplexity', tool: perplexitySearch });
  }
  if (process.env.TAVILY_API_KEY) {
    allWebSearchProviders.push({ id: 'tavily', name: 'Tavily', tool: tavilySearch });
  }
  if (process.env.LANGSEARCH_API_KEY) {
    allWebSearchProviders.push({ id: 'langsearch', name: 'LangSearch', tool: langSearch });
  }

  if (allWebSearchProviders.length > 0) {
    const preferred = getSetting<SearchProviderId | undefined>('webSearchPreferredProvider', undefined);
    const orderedProviders = preferred
      ? [
          ...allWebSearchProviders.filter((p) => p.id === preferred),
          ...allWebSearchProviders.filter((p) => p.id !== preferred),
        ]
      : allWebSearchProviders;

    tools.push({
      name: 'web_search',
      tool: createWebSearchTool(orderedProviders),
      description: WEB_SEARCH_DESCRIPTION,
      compactDescription: 'Search the web for current information. Returns titles, URLs, and snippets.',
      concurrencySafe: true,
    });
  }

  if (process.env.X_BEARER_TOKEN) {
    tools.push({
      name: 'x_search',
      tool: xSearchTool,
      description: X_SEARCH_DESCRIPTION,
      compactDescription: 'Search X/Twitter for tweets, profiles, and threads.',
      concurrencySafe: true,
    });
  }

  const availableSkills = discoverSkills();
  if (availableSkills.length > 0) {
    tools.push({
      name: 'skill',
      tool: skillTool,
      description: SKILL_TOOL_DESCRIPTION,
      compactDescription: 'Invoke a specialized skill workflow (e.g., DCF valuation).',
      concurrencySafe: false,
    });
  }

  return tools;
}

/**
 * Build a name → concurrencySafe map for the tool executor.
 */
export function getToolConcurrencyMap(model: string): Map<string, boolean> {
  return new Map(getToolRegistry(model).map(t => [t.name, t.concurrencySafe]));
}

/**
 * Get just the tool instances for binding to the LLM.
 *
 * @param model - The model name
 * @returns Array of tool instances
 */
export function getTools(model: string): StructuredToolInterface[] {
  return getToolRegistry(model).map((t) => t.tool);
}

/**
 * Build the tool descriptions section for the system prompt.
 * Formats each tool's rich description with a header.
 *
 * @param model - The model name
 * @returns Formatted string with all tool descriptions
 */
/**
 * Build compact tool descriptions for token-optimized system prompts.
 * Uses 1-2 sentence descriptions instead of full multi-paragraph ones.
 * The LLM already has full tool schemas via bindTools().
 */
export function buildCompactToolDescriptions(model: string): string {
  return getToolRegistry(model)
    .map((t) => `- **${t.name}**: ${t.compactDescription}`)
    .join('\n');
}
