#!/bin/bash
set -a
source /Users/victoriuselvino/Downloads/dexter/.env
set +a
exec /Users/victoriuselvino/.bun/bin/bun run --cwd /Users/victoriuselvino/Downloads/dexter gateway
