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

# Per-check timeout: run $@ in background, kill after CHECK_TIMEOUT seconds.
# Prints elapsed every 10s in verbose mode. Returns exit code of command.
run_timed() {
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
    if (( elapsed >= CHECK_TIMEOUT )); then
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
run_bun_check() {
  local name="$1" script="$2"
  vlog "$name"

  TIMED_STDOUT=""; TIMED_STDERR=""
  run_timed bun -e "$script"
  local exit_code=$?

  if (( exit_code == 124 )); then
    skip "$name — timed out after ${CHECK_TIMEOUT}s"
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
run_timed bun -e "
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
  local name="$1" url="$2"
  vlog "$name — $url"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 6 "$url" 2>/dev/null || echo "000")
  if [[ "${code:0:1}" == "2" ]] || [[ "${code:0:1}" == "3" ]]; then
    ok "$name (HTTP $code)"
  elif [[ "${code:0:1}" == "0" ]]; then
    fail "$name — timeout / unreachable ($url)"
  elif [[ "$code" == "403" ]] || [[ "$code" == "429" ]]; then
    warn "$name — HTTP $code (blocked without auth/JS — expected for curl)"
  else
    warn "$name — HTTP $code"
  fi
}

check_url "Yahoo Finance API"      "https://query1.finance.yahoo.com/v8/finance/chart/USDIDR%3DX?interval=1d&range=1d"
check_url "Trading Economics"      "https://tradingeconomics.com/indonesia/currency"
check_url "hargapangan.id (PIHPS)" "https://hargapangan.id"
check_url "BPS Indonesia"          "https://bps.go.id"
check_url "Bank Indonesia"         "https://bi.go.id"
check_url "Exa Search API"         "https://api.exa.ai"
[[ -n "${BLOOMBERG_API_URL:-}" ]] && check_url "Bloomberg API" "$BLOOMBERG_API_URL"

# ─── 6. SCRAPER SMOKE TESTS ───────────────────────────────────────────────────
section "6. Scraper Smoke Tests (timeout: ${CHECK_TIMEOUT}s each)"

run_bun_check "Yahoo Finance USDIDR" "
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
try {
  const q = await yf.quote('USDIDR=X', {}, { validateResult: false });
  const p = q?.regularMarketPrice;
  if (p && p > 10000) console.log('OK: USDIDR =', p.toLocaleString());
  else console.log('WARN: price returned =', p);
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

run_bun_check "PIHPS commodities (hargapangan.id)" "
import { fetchPihpsCommodities } from './src/tools/macro/sources/pihps.js';
try {
  const r = await fetchPihpsCommodities();
  if (r.length > 0) console.log('OK:', r.length, 'commodities fetched');
  else console.log('WARN: 0 commodities — hargapangan.id offline (TE fallback active)');
} catch(e) { console.log('FAIL: ' + String(e).slice(0,80)); }
"

run_bun_check "OJK banking data (Playwright)" "
import { fetchBankingRatiosOjk } from './src/tools/macro/sources/ojk.js';
try {
  const r = await fetchBankingRatiosOjk();
  if (r && (r.nplGrossPct || r.ldr || r.car)) console.log('OK: NPL', r.nplGrossPct, 'LDR', r.ldr, 'CAR', r.car);
  else console.log('WARN: OJK empty — session cookies required (expected)');
} catch(e) { console.log('WARN: OJK scrape failed (session required): ' + String(e).slice(0,50)); }
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
