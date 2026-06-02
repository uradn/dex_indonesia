#!/usr/bin/env bash
# health-check.sh — check all Dexter API calls, scrapers, and infrastructure
#
# Usage:
#   bash health-check.sh              # normal mode
#   bash health-check.sh --verbose    # show [running...] + elapsed per check
#   bash health-check.sh --timeout 60 # per-check timeout in seconds (default: 120)
#   VERBOSE=1 CHECK_TIMEOUT=60 bash health-check.sh

set -uo pipefail
cd "$(dirname "$0")"

# Auto-load .env if present (so API key checks work without manual export)
[[ -f .env ]] && { set -a; source .env; set +a; }

# ─── ARGS ─────────────────────────────────────────────────────────────────────
VERBOSE=${VERBOSE:-0}
CHECK_TIMEOUT=${CHECK_TIMEOUT:-120}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose|-v) VERBOSE=1; shift ;;
    --timeout|-t) CHECK_TIMEOUT="${2:-120}"; shift 2 ;;
    *) shift ;;
  esac
done

# ─── HELPERS ──────────────────────────────────────────────────────────────────
PASS=0; FAIL=0; WARN=0; SKIP=0
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
skip() { echo -e "  ${DIM}–${NC} $1 ${DIM}(skipped: timeout ${CHECK_TIMEOUT}s)${NC}"; SKIP=$((SKIP+1)); }
section() { echo -e "\n${BOLD}$1${NC}"; }
vlog()  { [[ "$VERBOSE" == "1" ]] && echo -e "  ${CYAN}…${NC} $1" || true; }

# Per-check timeout: run $@ in background, kill after $1 seconds.
# Prints elapsed every 10s in verbose mode. Returns exit code of command.
run_timed() {
  local timeout_s="$1"; shift
  local tmpout; tmpout=$(mktemp)
  local tmperr; tmperr=$(mktemp)

  "$@" >"$tmpout" 2>"$tmperr" &
  local pid=$!
  local elapsed=0
  local interval=2

  while kill -0 "$pid" 2>/dev/null; do
    sleep $interval
    elapsed=$((elapsed + interval))
    if [[ "$VERBOSE" == "1" ]] && (( elapsed % 10 == 0 )); then
      echo -ne "\r  ${CYAN}…${NC} ${elapsed}s elapsed...          "
    fi
    if (( elapsed >= timeout_s )); then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
      [[ "$VERBOSE" == "1" ]] && echo -ne "\r"
      cat "$tmpout" "$tmperr" >/dev/null  # drain
      rm -f "$tmpout" "$tmperr"
      return 124  # timeout exit code
    fi
  done

  wait "$pid"
  local exit_code=$?
  [[ "$VERBOSE" == "1" ]] && (( elapsed > 0 )) && echo -ne "\r"
  TIMED_STDOUT=$(<"$tmpout")
  TIMED_STDERR=$(<"$tmperr")
  rm -f "$tmpout" "$tmperr"
  return $exit_code
}

# Run a bun inline script with per-check timeout + verbose progress.
# Script must print OK:, WARN:, or FAIL: prefix on stdout.
# Usage: run_bun_check "name" "script" [timeout_override_s]
run_bun_check() {
  local name="$1" script="$2" per_timeout="${3:-$CHECK_TIMEOUT}"
  vlog "$name"

  TIMED_STDOUT=""; TIMED_STDERR=""
  run_timed "$per_timeout" bun -e "$script"
  local exit_code=$?

  if (( exit_code == 124 )); then
    echo -e "  ${DIM}–${NC} $name ${DIM}(skipped: timeout ${per_timeout}s)${NC}"; SKIP=$((SKIP+1))
    return
  fi

  local result="$TIMED_STDOUT"
  [[ -z "$result" ]] && result="$TIMED_STDERR"

  if echo "$result" | grep -q "^OK:"; then
    ok "$name — $(echo "$result" | grep '^OK:' | head -1 | sed 's/^OK: *//')"
  elif echo "$result" | grep -q "^WARN:"; then
    warn "$name — $(echo "$result" | grep '^WARN:' | head -1 | sed 's/^WARN: *//')"
  else
    fail "$name — $(echo "$result" | grep -v '^$' | tail -2 | head -1 | cut -c1-100)"
  fi
}

# ─── HEADER ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dexter Health Check — $(date '+%Y-%m-%d %H:%M')"
[[ "$VERBOSE" == "1" ]] && echo "  Mode: VERBOSE | Per-check timeout: ${CHECK_TIMEOUT}s" || echo "  Per-check timeout: ${CHECK_TIMEOUT}s  (--verbose for detail)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── 1. ENV VARS ──────────────────────────────────────────────────────────────
section "1. Environment Variables"

for var in ANTHROPIC_API_KEY OPENAI_API_KEY; do
  if [[ -n "${!var:-}" ]]; then ok "$var set"; else warn "$var not set (LLM fallback may apply)"; fi
done

if [[ -n "${EXASEARCH_API_KEY:-}" ]]; then
  ok "EXASEARCH_API_KEY set — Module 12 news sentiment active"
else
  warn "EXASEARCH_API_KEY not set — Module 12 degrades to unemployment-only"
fi

for var in BLOOMBERG_API_KEY BLOOMBERG_API_URL; do
  if [[ -n "${!var:-}" ]]; then ok "$var set — CDS/SBN premium data active"
  else warn "$var not set — sovereign risk uses TE fallback"; fi
done

if [[ -n "${EODHD_API_KEY:-}" ]]; then ok "EODHD_API_KEY set — USDIDR tertiary FX fallback active"
else warn "EODHD_API_KEY not set — USDIDR fallback chain ends at open.er-api.com"; fi

if [[ -n "${KEMENDAG_API_KEY:-}" ]]; then ok "KEMENDAG_API_KEY set — Kemendag EWS Tier 3 PIHPS active"
else warn "KEMENDAG_API_KEY not set — Tier 3 PIHPS fallback inactive (register at ews.kemendag.go.id)"; fi

for var in REFINITIV_APP_KEY BPS_API_KEY; do
  if [[ -n "${!var:-}" ]]; then ok "$var set"; else warn "$var not set (optional)"; fi
done

# ─── 2. RUNTIME ───────────────────────────────────────────────────────────────
section "2. Runtime & Dependencies"

if command -v bun &>/dev/null; then ok "bun $(bun --version)"
else fail "bun not found — install from bun.sh"; fi

if [[ -d node_modules ]]; then ok "node_modules present"
else fail "node_modules missing — run: bun install"; fi

# ─── 3. PLAYWRIGHT ────────────────────────────────────────────────────────────
section "3. Playwright / Chromium"

vlog "Launching Chromium (headless)..."
TIMED_STDOUT=""; TIMED_STDERR=""
run_timed "$CHECK_TIMEOUT" bun -e "
import { chromium } from 'playwright';
try {
  const b = await chromium.launch({ headless: true });
  await b.newPage();
  await b.close();
  console.log('ok');
} catch(e) { console.log('fail:' + String(e).slice(0,100)); }
"
PW_EXIT=$?

if (( PW_EXIT == 124 )); then
  skip "Chromium launch — timed out after ${CHECK_TIMEOUT}s"
elif echo "$TIMED_STDOUT" | grep -q "^ok$"; then
  ok "Chromium launch OK"
elif echo "$TIMED_STDOUT" | grep -q "^fail:"; then
  fail "Chromium launch — $(echo "$TIMED_STDOUT" | sed 's/^fail://')"
else
  fail "Chromium launch — $(echo "$TIMED_STDERR" | tail -1 | cut -c1-80)"
fi

# ─── 4. SQLITE ────────────────────────────────────────────────────────────────
section "4. SQLite Macro DB"

DB_PATH=".dexter/macro/macro.db"
if [[ -f "$DB_PATH" ]]; then
  vlog "Querying macro_series row count..."
  DB_CHECK=$(bun -e "
import Database from 'bun:sqlite';
const db = new Database('$DB_PATH');
try {
  const r = db.query('SELECT COUNT(*) as n FROM macro_series').get();
  console.log('ok:' + r.n);
} catch(e) { console.log('fail:' + String(e).slice(0,80)); }
db.close();
" 2>&1 || true)
  if echo "$DB_CHECK" | grep -q "^ok:"; then
    ok "macro.db — $(echo "$DB_CHECK" | sed 's/^ok://') rows in macro_series"
  else
    fail "macro.db — $(echo "$DB_CHECK" | grep '^fail:' | sed 's/^fail://')"
  fi
else
  warn "macro.db not found at $DB_PATH — created on first module run"
fi

# ─── 5. NETWORK ───────────────────────────────────────────────────────────────
section "5. Network Reachability"

check_url() {
  local name="$1" url="$2" on_fail="${3:-fail}"
  vlog "$name — $url"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 6 "$url" 2>/dev/null || echo "000")
  if [[ "${code:0:1}" == "2" ]] || [[ "${code:0:1}" == "3" ]]; then
    ok "$name (HTTP $code)"
  elif [[ "${code:0:1}" == "0" ]]; then
    $on_fail "$name — timeout / unreachable ($url)"
  elif [[ "$code" == "403" ]] || [[ "$code" == "429" ]]; then
    warn "$name — HTTP $code (blocked without auth/JS — expected for curl)"
  else
    warn "$name — HTTP $code"
  fi
}

check_url "Yahoo Finance API"            "https://query1.finance.yahoo.com/v8/finance/chart/USDIDR%3DX?interval=1d&range=1d"
check_url "open.er-api.com (FX T2)"     "https://open.er-api.com/v6/latest/USD"
check_url "Trading Economics"           "https://tradingeconomics.com/indonesia/currency"
check_url "hargapangan.id  (PIHPS T1A)" "https://hargapangan.id" warn
check_url "bi.go.id/hargapangan (T1B)"  "https://www.bi.go.id/hargapangan"
check_url "infopangan Jakarta (PIHPS T2A)" "https://infopangan.jakarta.go.id/api2/v1/public/master-data/commodities?name=&date="
check_url "panelharga BPN    (PIHPS T2B)" "https://panelharga.badanpangan.go.id"
check_url "panelharga BPN dev (T2 alt)"  "https://dev-panelharga.badanpangan.go.id"
check_url "ews.kemendag.go.id (PIHPS T3)" "https://ews.kemendag.go.id/api/harga"
check_url "BPS Indonesia"               "https://bps.go.id"
check_url "Bank Indonesia"              "https://bi.go.id"
check_url "BI SULNI (ULN hedging)"     "https://www.bi.go.id/id/statistik/statistik-utang-luar-negeri-indonesia/Default.aspx" warn
check_url "World Bank API (ULN DSR)"   "https://api.worldbank.org/v2/country/ID/indicator/DT.TDS.DECT.EX.ZS?format=json&mrv=1"
check_url "Exa Search API"              "https://api.exa.ai"
[[ -n "${BLOOMBERG_API_URL:-}" ]] && check_url "Bloomberg API" "$BLOOMBERG_API_URL"

# ─── 6. SCRAPER SMOKE TESTS ───────────────────────────────────────────────────
section "6. Scraper Smoke Tests (timeout: ${CHECK_TIMEOUT}s each)"

run_bun_check "Yahoo Finance USDIDR" "
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
try {
  const q = await yf.quote('USDIDR=X', {}, { validateResult: false });
  const p = q?.regularMarketPrice;
  const t = q?.regularMarketTime ? new Date(q.regularMarketTime) : null;
  const ageH = t ? ((Date.now() - t.getTime()) / 3600000).toFixed(1) : 'unknown';
  if (p && p > 10000) console.log('OK: USDIDR =', p.toLocaleString(), '| data age:', ageH + 'h');
  else console.log('WARN: price returned =', p);
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "EODHD USDIDR fallback" "
const key = process.env.EODHD_API_KEY;
if (!key) { console.log('WARN: EODHD_API_KEY not set — tertiary fallback inactive'); process.exit(0); }
try {
  const res = await fetch('https://eodhd.com/api/real-time/IDR.FOREX?api_token=' + key + '&fmt=json', { signal: AbortSignal.timeout(8000) });
  const d = await res.json();
  if (d?.close && d.close !== 'NA' && d.close > 10000) console.log('OK: USDIDR (EODHD) =', d.close.toLocaleString());
  else console.log('WARN: EODHD returned close =', d?.close);
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "SBN 10Y yield (TE Playwright)" "
import { fetchSbn10yTradingEconomics } from './src/tools/macro/sources/sovereign-scraper.js';
try {
  const r = await fetchSbn10yTradingEconomics();
  if (r && r.value > 0) console.log('OK: SBN 10Y =', r.value + '%');
  else console.log('WARN: returned null/zero');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "BI Rate (TE Playwright)" "
import { fetchBiRateTradingEconomics } from './src/tools/macro/sources/sovereign-scraper.js';
try {
  const r = await fetchBiRateTradingEconomics();
  if (r && r.value > 0) console.log('OK: BI Rate =', r.value + '%');
  else console.log('WARN: returned null/zero');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "Food inflation (TE Playwright)" "
import { fetchFoodInflationTe } from './src/tools/macro/sources/pihps.js';
try {
  const r = await fetchFoodInflationTe();
  if (r && r.value !== null) console.log('OK: food inflation =', r.value + '%');
  else console.log('WARN: returned null');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "Unemployment rate (TE Playwright)" "
import { fetchUnemploymentTe } from './src/tools/macro/sources/political-risk.js';
try {
  const r = await fetchUnemploymentTe();
  if (r && r.value > 0) console.log('OK: unemployment =', r.value + '%');
  else console.log('WARN: returned null/zero');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "PIHPS commodities (fallback chain)" "
import { fetchPihpsCommodities } from './src/tools/macro/sources/pihps.js';
try {
  const r = await fetchPihpsCommodities();
  if (r.length >= 5) {
    const src = r[0]?.source ?? 'unknown';
    console.log('OK:', r.length + '/10 commodities — source: ' + src);
  } else if (r.length > 0) {
    const src = r[0]?.source ?? 'unknown';
    console.log('WARN:', r.length + '/10 partial — source: ' + src + ' (other tiers offline)');
  } else {
    console.log('WARN: 0 commodities — all PIHPS tiers offline; TE food-inflation aggregate active');
  }
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
" 240

run_bun_check "OJK banking data (Playwright)" "
import { fetchBankingRatiosOjk } from './src/tools/macro/sources/ojk.js';
try {
  const r = await fetchBankingRatiosOjk();
  if (r && (r.nplGrossPct || r.ldr || r.car)) console.log('OK: NPL', r.nplGrossPct, 'LDR', r.ldr, 'CAR', r.car);
  else console.log('WARN: OJK empty — session cookies required (expected)');
} catch(e) { console.log('WARN: OJK scrape failed (session required): ' + String(e).slice(0,50)); }
"

run_bun_check "ULN DSR — World Bank API (Module 13)" "
import { fetchUlnDsrWorldBank } from './src/tools/macro/sources/sovereign-scraper.js';
try {
  const r = await fetchUlnDsrWorldBank();
  if (r && r.value > 0) console.log('OK: DSR =', r.value.toFixed(2) + '% (IMF threshold 25%)');
  else console.log('WARN: DSR returned null/zero — WB API may be lagged');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "ULN short-term % — World Bank API (Module 13)" "
import { fetchUlnShorttermPctWorldBank } from './src/tools/macro/sources/sovereign-scraper.js';
try {
  const r = await fetchUlnShorttermPctWorldBank();
  if (r && r.value > 0) console.log('OK: ST% =', r.value.toFixed(2) + '% of total ULN');
  else console.log('WARN: ST% returned null/zero — WB API may be lagged');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "ULN hedging compliance — BI SULNI (Module 13, graceful degrade OK)" "
import { fetchHedgingComplianceBi } from './src/tools/macro/sources/bi.js';
try {
  const r = await fetchHedgingComplianceBi();
  if (r && r.value > 0) console.log('OK: hedging compliance =', r.value.toFixed(1) + '%');
  else console.log('WARN: null — BI SULNI regex no match; engine degrades to ×1.10 amplifier (expected)');
} catch(e) { console.log('WARN: BI SULNI scrape failed (graceful degrade active): ' + String(e).slice(0,60)); }
"

# ─── 7. EXA API ───────────────────────────────────────────────────────────────
section "7. Exa Search API"

if [[ -n "${EXASEARCH_API_KEY:-}" ]]; then
  run_bun_check "Exa search" "
import Exa from 'exa-js';
const exa = new Exa(process.env.EXASEARCH_API_KEY);
try {
  const r = await exa.search('Indonesia economy 2026', { type: 'auto', numResults: 2 });
  if (r.results.length > 0) console.log('OK:', r.results.length, 'results');
  else console.log('WARN: 0 results returned');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"
else
  warn "Exa API — skipped (EXASEARCH_API_KEY not set)"
fi

# ─── 8. TYPECHECK ─────────────────────────────────────────────────────────────
section "8. TypeScript"

vlog "Running tsc --noEmit..."
TS_OUT=$(bun run typecheck 2>&1 || true)
if echo "$TS_OUT" | grep -q "error TS"; then
  TS_ERRORS=$(echo "$TS_OUT" | grep -c "error TS" || true)
  fail "TypeScript: $TS_ERRORS error(s) — run: bun run typecheck"
else
  ok "TypeScript clean"
fi

# ─── SUMMARY ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✓${NC} $PASS pass  ${YELLOW}⚠${NC} $WARN warn  ${RED}✗${NC} $FAIL fail  ${DIM}–${NC} $SKIP skipped"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if (( FAIL > 0 )); then
  echo -e "  ${RED}Action required: $FAIL check(s) failed.${NC}"
  exit 1
elif (( SKIP > 0 )); then
  echo -e "  ${YELLOW}$SKIP check(s) timed out — rerun with --verbose to debug, --timeout N to extend.${NC}"
elif (( WARN > 0 )); then
  echo -e "  ${YELLOW}$WARN warning(s) — optional APIs not configured.${NC}"
else
  echo -e "  ${GREEN}All systems operational.${NC}"
fi
echo ""
