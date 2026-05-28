#!/usr/bin/env bash
# git-push.sh — push to uradn/dex_indonesia using GITHUB_TOKEN from .env
# Token stays in .env (gitignored), never hardcoded here.
#
# Usage:
#   bash git-push.sh           # push current branch
#   bash git-push.sh main      # push specific branch

set -euo pipefail
cd "$(dirname "$0")"

FORCE=""
BRANCH=""
for arg in "$@"; do
  if [[ "$arg" == "--force" ]] || [[ "$arg" == "-f" ]]; then
    FORCE="--force"
  else
    BRANCH="$arg"
  fi
done
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
REMOTE_REPO="github.com/uradn/dex_indonesia.git"

# Load .env
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found"
  exit 1
fi
set -a; source .env; set +a

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_TOKEN not set in .env"
  echo "Add: GITHUB_TOKEN=ghp_your_token_here"
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@${REMOTE_REPO}"

echo "Pushing branch '${BRANCH}' → uradn/dex_indonesia..."
git push "${REMOTE_URL}" "${BRANCH}:${BRANCH}" --follow-tags ${FORCE}

echo "Done. https://github.com/uradn/dex_indonesia/tree/${BRANCH}"
