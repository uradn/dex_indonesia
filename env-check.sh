#!/usr/bin/env bash
# env-check.sh — validate .env keys and live-ping each API endpoint
#
# Usage:
#   bash env-check.sh              # loads .env from project root
#   bash env-check.sh --verbose    # show HTTP response code + latency
#   bash env-check.sh --timeout 8  # curl timeout per ping (default: 10s)

set -o pipefail
cd "$(dirname "$0")"

# ─── ARGS ─────────────────────────────────────────────────────────────────────
VERBOSE=${VERBOSE:-0}
CURL_TIMEOUT=${CURL_TIMEOUT:-10}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose|-v) VERBOSE=1; shift ;;
    --timeout|-t) CURL_TIMEOUT="${2:-10}"; shift 2 ;;
    *) shift ;;
  esac
done

# ─── LOAD .env ────────────────────────────────────────────────────────────────
ENV_FILE=".env"
if [[ -f "$ENV_FILE" ]]; then
  # Export all non-comment, non-empty lines
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: .env not found at $(pwd)/$ENV_FILE"
  exit 1
fi

# ─── HELPERS ──────────────────────────────────────────────────────────────────
# macOS-safe millisecond timer
get_ms() {
  if command -v gdate &>/dev/null; then gdate +%s%3N
  elif command -v python3 &>/dev/null; then python3 -c "import time; print(int(time.time()*1000))"
  else echo $((SECONDS * 1000)); fi
}

PASS=0; FAIL=0; WARN=0; SKIP=0
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'
DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN+1)); }
skip() { echo -e "  ${DIM}–${NC} $1"; SKIP=$((SKIP+1)); }
section() { echo -e "\n${BOLD}$1${NC}"; }

# is_placeholder: returns true if value looks like the example placeholder
is_placeholder() {
  local val="$1"
  [[ "$val" == your-* ]] || [[ "$val" == "sk-placeholder"* ]] || [[ -z "$val" ]]
}

# ping_api NAME VAR_NAME URL METHOD HEADERS... — live curl ping
# Prints ok/fail/skip based on HTTP code.
# HEADERS format: "Header: value" (multiple args ok)
ping_api() {
  local name="$1" var="$2" url="$3" method="${4:-GET}"
  shift 4
  local headers=("$@")

  local val="${!var:-}"

  if [[ -z "$val" ]]; then
    skip "$name — NOT SET in .env"
    return
  fi
  if is_placeholder "$val"; then
    skip "$name — placeholder value (not configured)"
    return
  fi

  # Build curl header args
  local curl_headers=()
  for h in "${headers[@]}"; do
    curl_headers+=(-H "$h")
  done

  local t_start t_end latency code
  t_start=$(get_ms)
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time "$CURL_TIMEOUT" --connect-timeout 5 \
    -X "$method" "${curl_headers[@]}" "$url" 2>/dev/null || echo "000")
  t_end=$(get_ms)
  latency=$(( t_end - t_start ))

  local detail=""
  [[ "$VERBOSE" == "1" ]] && detail=" ${DIM}[HTTP $code | ${latency}ms]${NC}"

  local key_preview="${val:0:8}…"

  if [[ "${code:0:1}" == "2" ]]; then
    ok "$name — valid ${DIM}(${key_preview})${NC}${detail}"
  elif [[ "$code" == "401" ]] || [[ "$code" == "403" ]]; then
    fail "$name — key invalid or expired (HTTP $code) ${DIM}(${key_preview})${NC}"
  elif [[ "${code:0:1}" == "0" ]]; then
    fail "$name — unreachable (timeout after ${CURL_TIMEOUT}s)"
  elif [[ "${code:0:1}" == "4" ]]; then
    # 404/422 on a minimal endpoint is usually "endpoint wrong but auth OK"
    warn "$name — HTTP $code (auth likely OK but endpoint may have changed)${detail}"
  elif [[ "${code:0:1}" == "5" ]]; then
    warn "$name — HTTP $code (server error — key may be valid)${detail}"
  else
    warn "$name — HTTP $code${detail}"
  fi
}

# ping_post: same but sends a JSON body
ping_post() {
  local name="$1" var="$2" url="$3" body="$4"
  shift 4
  local headers=("$@")

  local val="${!var:-}"
  if [[ -z "$val" ]]; then skip "$name — NOT SET in .env"; return; fi
  if is_placeholder "$val"; then skip "$name — placeholder value"; return; fi

  local curl_headers=(-H "Content-Type: application/json")
  for h in "${headers[@]}"; do
    curl_headers+=(-H "$h")
  done

  local t_start t_end latency code
  t_start=$(get_ms)
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time "$CURL_TIMEOUT" --connect-timeout 5 \
    -X POST "${curl_headers[@]}" -d "$body" "$url" 2>/dev/null || echo "000")
  t_end=$(get_ms)
  latency=$(( t_end - t_start ))

  local detail=""
  [[ "$VERBOSE" == "1" ]] && detail=" ${DIM}[HTTP $code | ${latency}ms]${NC}"
  local key_preview="${val:0:8}…"

  if [[ "${code:0:1}" == "2" ]]; then
    ok "$name — valid ${DIM}(${key_preview})${NC}${detail}"
  elif [[ "$code" == "401" ]] || [[ "$code" == "403" ]]; then
    fail "$name — key invalid or expired (HTTP $code) ${DIM}(${key_preview})${NC}"
  elif [[ "${code:0:1}" == "0" ]]; then
    fail "$name — unreachable (timeout after ${CURL_TIMEOUT}s)"
  elif [[ "${code:0:1}" == "4" ]]; then
    warn "$name — HTTP $code (auth likely OK)${detail}"
  elif [[ "${code:0:1}" == "5" ]]; then
    warn "$name — HTTP $code (server error)${detail}"
  else
    warn "$name — HTTP $code${detail}"
  fi
}

# ─── HEADER ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dexter .env Health Check — $(date '+%Y-%m-%d %H:%M')"
[[ "$VERBOSE" == "1" ]] && echo "  Mode: VERBOSE | Curl timeout: ${CURL_TIMEOUT}s" \
  || echo "  Curl timeout: ${CURL_TIMEOUT}s  (--verbose for HTTP codes + latency)"
echo "  .env: $(pwd)/$ENV_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── 1. LLM PROVIDERS ─────────────────────────────────────────────────────────
section "1. LLM Providers"

# OpenAI — GET /v1/models is free, returns model list
ping_api "OpenAI" \
  "OPENAI_API_KEY" \
  "https://api.openai.com/v1/models" \
  "GET" \
  "Authorization: Bearer ${OPENAI_API_KEY:-}"

# Anthropic — GET /v1/models
ping_api "Anthropic" \
  "ANTHROPIC_API_KEY" \
  "https://api.anthropic.com/v1/models" \
  "GET" \
  "x-api-key: ${ANTHROPIC_API_KEY:-}" \
  "anthropic-version: 2023-06-01"

# Google Gemini — /v1beta/models?key=KEY
_GOOGLE_KEY="${GOOGLE_API_KEY:-}"
if [[ -z "$_GOOGLE_KEY" ]] || is_placeholder "$_GOOGLE_KEY"; then
  skip "Google Gemini — NOT SET / placeholder"
else
  ping_api "Google Gemini" \
    "GOOGLE_API_KEY" \
    "https://generativelanguage.googleapis.com/v1beta/models?key=${_GOOGLE_KEY}" \
    "GET"
fi

# xAI Grok — GET /v1/models
ping_api "xAI (Grok)" \
  "XAI_API_KEY" \
  "https://api.x.ai/v1/models" \
  "GET" \
  "Authorization: Bearer ${XAI_API_KEY:-}"

# OpenRouter — GET /v1/models (no auth needed, but key in header validates account)
ping_api "OpenRouter" \
  "OPENROUTER_API_KEY" \
  "https://openrouter.ai/api/v1/models" \
  "GET" \
  "Authorization: Bearer ${OPENROUTER_API_KEY:-}"

# Moonshot (Kimi)
ping_api "Moonshot (Kimi)" \
  "MOONSHOT_API_KEY" \
  "https://api.moonshot.cn/v1/models" \
  "GET" \
  "Authorization: Bearer ${MOONSHOT_API_KEY:-}"

# DeepSeek
ping_api "DeepSeek" \
  "DEEPSEEK_API_KEY" \
  "https://api.deepseek.com/models" \
  "GET" \
  "Authorization: Bearer ${DEEPSEEK_API_KEY:-}"

# Ollama (local) — /api/tags lists local models
_OLLAMA_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
if [[ "$_OLLAMA_URL" == "http://127.0.0.1:11434" ]] || [[ -n "${OLLAMA_BASE_URL:-}" ]]; then
  t_start=$(get_ms)
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${_OLLAMA_URL}/api/tags" 2>/dev/null || echo "000")
  t_end=$(get_ms); latency=$(( t_end - t_start ))
  detail=""; [[ "$VERBOSE" == "1" ]] && detail=" ${DIM}[HTTP $code | ${latency}ms]${NC}"
  if [[ "${code:0:1}" == "2" ]]; then
    ok "Ollama — running at ${_OLLAMA_URL}${detail}"
  elif [[ "${code:0:1}" == "0" ]]; then
    warn "Ollama — not running at ${_OLLAMA_URL} (start with: ollama serve)"
  else
    warn "Ollama — HTTP $code at ${_OLLAMA_URL}${detail}"
  fi
fi

# ─── 2. WEB SEARCH ────────────────────────────────────────────────────────────
section "2. Web Search APIs"

# Exa — POST /search with minimal query
ping_post "Exa Search" \
  "EXASEARCH_API_KEY" \
  "https://api.exa.ai/search" \
  '{"query":"test","numResults":1,"type":"auto"}' \
  "Authorization: Bearer ${EXASEARCH_API_KEY:-}"

# Perplexity — POST /chat/completions (cheapest: sonar-small-online, 1 token)
ping_post "Perplexity" \
  "PERPLEXITY_API_KEY" \
  "https://api.perplexity.ai/chat/completions" \
  '{"model":"sonar","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' \
  "Authorization: Bearer ${PERPLEXITY_API_KEY:-}"

# Tavily — POST /search
ping_post "Tavily" \
  "TAVILY_API_KEY" \
  "https://api.tavily.com/search" \
  "{\"api_key\":\"${TAVILY_API_KEY:-}\",\"query\":\"test\",\"max_results\":1}"

# LangSearch — GET /search (check their docs for actual endpoint)
_LANGSEARCH_KEY="${LANGSEARCH_API_KEY:-}"
if [[ -z "$_LANGSEARCH_KEY" ]] || is_placeholder "$_LANGSEARCH_KEY"; then
  skip "LangSearch — NOT SET / placeholder"
else
  ping_post "LangSearch" \
    "LANGSEARCH_API_KEY" \
    "https://api.langsearch.com/v1/web-search" \
    '{"query":"test","count":1}' \
    "Authorization: Bearer ${_LANGSEARCH_KEY}"
fi

# ─── 3. FINANCIAL DATA ────────────────────────────────────────────────────────
section "3. Financial Data APIs"

# FinancialDatasets.ai
ping_api "FinancialDatasets.ai" \
  "FINANCIAL_DATASETS_API_KEY" \
  "https://api.financialdatasets.ai/financial-metrics/?ticker=AAPL&limit=1" \
  "GET" \
  "X-API-KEY: ${FINANCIAL_DATASETS_API_KEY:-}"

# BPS WebAPI Indonesia
_BPS_KEY="${BPS_API_KEY:-}"
if [[ -z "$_BPS_KEY" ]] || is_placeholder "$_BPS_KEY"; then
  skip "BPS WebAPI — NOT SET / placeholder"
else
  ping_api "BPS WebAPI Indonesia" \
    "BPS_API_KEY" \
    "https://webapi.bps.go.id/v1/api/list/model/data/lang/ind/domain/0000/var/529/key/${_BPS_KEY}" \
    "GET"
fi

# Bloomberg (optional, custom proxy)
_BLOOM_URL="${BLOOMBERG_API_URL:-}"
_BLOOM_KEY="${BLOOMBERG_API_KEY:-}"
if [[ -z "$_BLOOM_URL" ]] || [[ -z "$_BLOOM_KEY" ]]; then
  skip "Bloomberg — BLOOMBERG_API_URL or BLOOMBERG_API_KEY not set"
else
  ping_api "Bloomberg (proxy)" \
    "BLOOMBERG_API_KEY" \
    "${_BLOOM_URL}/health" \
    "GET" \
    "Authorization: Bearer ${_BLOOM_KEY}"
fi

# Refinitiv / LSEG (optional)
_REFINITIV_KEY="${REFINITIV_APP_KEY:-}"
if [[ -z "$_REFINITIV_KEY" ]] || is_placeholder "$_REFINITIV_KEY"; then
  skip "Refinitiv/LSEG — REFINITIV_APP_KEY not set"
else
  # RDP auth endpoint — just check reachability
  ping_api "Refinitiv/LSEG RDP" \
    "REFINITIV_APP_KEY" \
    "https://api.refinitiv.com/auth/oauth2/v1/token" \
    "GET"
fi

# ─── 4. SOCIAL / TWITTER ──────────────────────────────────────────────────────
section "4. Social Media APIs"

# X/Twitter Bearer token
ping_api "X/Twitter (Bearer)" \
  "X_BEARER_TOKEN" \
  "https://api.twitter.com/2/tweets/search/recent?query=test&max_results=10" \
  "GET" \
  "Authorization: Bearer ${X_BEARER_TOKEN:-}"

# ─── 5. MONITORING / LANGSMITH ────────────────────────────────────────────────
section "5. Monitoring & Tracing"

# LangSmith
_LS_ENDPOINT="${LANGSMITH_ENDPOINT:-https://api.smith.langchain.com}"
ping_api "LangSmith" \
  "LANGSMITH_API_KEY" \
  "${_LS_ENDPOINT}/ok" \
  "GET" \
  "x-api-key: ${LANGSMITH_API_KEY:-}"

# ─── SUMMARY ──────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL+WARN+SKIP))
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✓${NC} $PASS valid  ${RED}✗${NC} $FAIL invalid  ${YELLOW}⚠${NC} $WARN warn  ${DIM}–${NC} $SKIP not configured"
echo -e "  Total: $TOTAL keys checked"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if (( FAIL > 0 )); then
  echo -e "  ${RED}$FAIL key(s) invalid or expired — update .env${NC}"
  exit 1
elif (( WARN > 0 )); then
  echo -e "  ${YELLOW}$WARN warning(s) — check endpoints above${NC}"
else
  echo -e "  ${GREEN}All configured keys valid.${NC}"
fi
echo ""
