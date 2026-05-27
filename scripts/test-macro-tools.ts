/**
 * Live test runner for all macro intelligence tools.
 * Run: bun scripts/test-macro-tools.ts [toolName]
 *
 * Examples:
 *   bun scripts/test-macro-tools.ts fx_defense
 *   bun scripts/test-macro-tools.ts stress
 *   bun scripts/test-macro-tools.ts all
 */
import { fxDefenseEngine } from '../src/tools/macro/fx-defense-engine.js';
import { bopEngine } from '../src/tools/macro/bop-engine.js';
import { commodityEngine } from '../src/tools/macro/commodity-engine.js';
import { foreignFlowEngine } from '../src/tools/macro/foreign-flow-engine.js';
import { regimeEngine } from '../src/tools/macro/regime-engine.js';
import { sovereignRiskEngine } from '../src/tools/macro/sovereign-risk-engine.js';
import { narrativeDivergenceEngine } from '../src/tools/macro/narrative-divergence-engine.js';
import { aseanRelativeValueEngine } from '../src/tools/macro/asean-relative-value-engine.js';
import { silentCrisisDetector } from '../src/tools/macro/silent-crisis-detector.js';
import { bankingStressEngine } from '../src/tools/macro/banking-stress-engine.js';
import { marketStressEngine } from '../src/tools/macro/market-stress-engine.js';
import { fiscalEngine } from '../src/tools/macro/fiscal-engine.js';
import { stressSimulator } from '../src/tools/macro/stress-simulator.js';
import { macroThresholdMonitor } from '../src/tools/macro/macro-threshold-monitor.js';
import { backtestEngine } from '../src/tools/macro/backtest-tool.js';

const DIVIDER = '─'.repeat(60);

function section(name: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`  ${name}`);
  console.log(DIVIDER);
}

async function run(name: string, fn: () => Promise<unknown>) {
  section(name);
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(result);
    console.log(`\n⏱  ${elapsed}s`);
  } catch (err) {
    console.error(`❌ FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const arg = process.argv[2] ?? 'all';

const TOOLS: Record<string, () => Promise<void>> = {
  threshold: () => run('MACRO THRESHOLD MONITOR', () =>
    macroThresholdMonitor.invoke({})
  ),

  fx_defense: () => run('FX DEFENSE ENGINE', () =>
    fxDefenseEngine.invoke({ query: 'Show FX defense status', forceRefresh: true })
  ),

  bop: () => run('BoP ENGINE', () =>
    bopEngine.invoke({ query: 'Show BoP status' })
  ),

  commodity: () => run('COMMODITY ENGINE', () =>
    commodityEngine.invoke({ query: 'Show commodity risk' })
  ),

  foreign_flow: () => run('FOREIGN FLOW ENGINE', () =>
    foreignFlowEngine.invoke({ query: 'Are foreigners leaving?' })
  ),

  regime: () => run('REGIME ENGINE', () =>
    regimeEngine.invoke({ query: 'What macro regime is Indonesia in?' })
  ),

  sovereign: () => run('SOVEREIGN RISK ENGINE', () =>
    sovereignRiskEngine.invoke({ query: 'Show sovereign risk' })
  ),

  narrative: () => run('NARRATIVE DIVERGENCE ENGINE', () =>
    narrativeDivergenceEngine.invoke({ query: 'Does official guidance match markets?' })
  ),

  asean: () => run('ASEAN RELATIVE VALUE ENGINE', () =>
    aseanRelativeValueEngine.invoke({ query: 'Show ASEAN relative value' })
  ),

  banking: () => run('BANKING STRESS ENGINE — Module 8', () =>
    bankingStressEngine.invoke({ query: 'Show banking stress indicators' })
  ),

  market: () => run('MARKET STRESS ENGINE — Module 9', () =>
    marketStressEngine.invoke({ query: 'Show IHSG valuation and market breadth' })
  ),

  fiscal: () => run('FISCAL ENGINE — Module 10', () =>
    fiscalEngine.invoke({ query: 'APBN realisasi check' })
  ),

  big_short: () => run('SILENT CRISIS DETECTOR (Big Short)', () =>
    silentCrisisDetector.invoke({ query: 'Run big short analysis' })
  ),

  stress: () => run('STRESS SIMULATOR — IDR 18500 + VIX 45', () =>
    stressSimulator.invoke({ scenarioName: 'IDR 18500 + VIX 45 + Commodities -20%', idrLevel: 18500, vixLevel: 45, commodityShockPct: -20 })
  ),

  stress2: () => run('STRESS SIMULATOR — Fed shock', () =>
    stressSimulator.invoke({ scenarioName: 'Fed surprise hike + DXY 115', dxyLevel: 115, vixLevel: 38, eidoPctChange: -20 })
  ),

  backtest: () => run('BACKTEST ENGINE (2013–2023)', () =>
    backtestEngine.invoke({})
  ),
};

async function main() {
  console.log(`\n🔍 DEXTER MACRO TOOLS — LIVE TEST`);
  console.log(`Target: ${arg}`);
  console.log(`Date: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`);

  if (arg === 'all') {
    // Fast checks first, backtest last
    for (const [name, fn] of Object.entries(TOOLS)) {
      if (name === 'backtest') continue;
      await fn();
    }
    console.log('\n⚠️  Skipping backtest in "all" mode — run: bun scripts/test-macro-tools.ts backtest');
  } else if (arg in TOOLS) {
    await TOOLS[arg]();
  } else {
    console.error(`Unknown tool: ${arg}`);
    console.log(`Available: ${Object.keys(TOOLS).join(', ')}, all`);
    process.exit(1);
  }

  console.log(`\n${DIVIDER}`);
  console.log('  DONE');
  console.log(DIVIDER);
}

main().catch(console.error);
