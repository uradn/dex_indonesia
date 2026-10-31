#!/usr/bin/env bash
# Get GFW API key and write to .env
# Usage: bash scripts/get-gfw-apikey.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "GFW API Key Generator"
echo "─────────────────────"
read -p "Email: " EMAIL
read -s -p "Password: " PASSWORD
echo

echo "→ Getting access token..."
TOKEN_RESP=$(curl -s -X POST "https://data-api.globalforestwatch.org/auth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${EMAIL}&password=${PASSWORD}")

ACCESS_TOKEN=$(echo "$TOKEN_RESP" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "✗ Login failed. Response:"
  echo "$TOKEN_RESP"
  exit 1
fi
echo "✓ Token obtained"

echo "→ Generating API key..."
KEY_RESP=$(curl -s -X POST "https://data-api.globalforestwatch.org/auth/apikey" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"alias\":\"soens-indonesia\",\"email\":\"${EMAIL}\",\"organization\":\"SOENS Indonesia\"}")

API_KEY=$(echo "$KEY_RESP" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$API_KEY" ]; then
  echo "✗ Key generation failed. Response:"
  echo "$KEY_RESP"
  exit 1
fi

echo "✓ API key: $API_KEY"

# Write to .env
if grep -q "^GFW_API_KEY=" "$ENV_FILE" 2>/dev/null; then
  sed -i '' "s/^GFW_API_KEY=.*/GFW_API_KEY=${API_KEY}/" "$ENV_FILE"
  echo "✓ Updated GFW_API_KEY in .env"
else
  echo "GFW_API_KEY=${API_KEY}" >> "$ENV_FILE"
  echo "✓ Added GFW_API_KEY to .env"
fi
