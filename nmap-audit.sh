#!/usr/bin/env bash

set -uo pipefail

# ============================================================
# NMAP ENTERPRISE AUDIT SCRIPT - macOS
# Requires: nmap
#
# Usage:
#   ./nmap-audit.sh <target>
#
# Examples:
#   ./nmap-audit.sh 192.168.1.1
#   ./nmap-audit.sh 192.168.1.0/24
#   ./nmap-audit.sh server.example.com
# ============================================================

VERSION="1.0"

# -----------------------------
# Colors
# -----------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

# -----------------------------
# Functions
# -----------------------------
usage() {
    echo
    echo "Nmap Enterprise Audit Script v${VERSION}"
    echo
    echo "Usage:"
    echo "  $0 <target>"
    echo
    echo "Examples:"
    echo "  $0 192.168.1.1"
    echo "  $0 192.168.1.0/24"
    echo "  $0 server.example.com"
    echo
}

banner() {
    echo
    echo -e "${CYAN}"
    echo "============================================================"
    echo "              NMAP ENTERPRISE AUDIT"
    echo "============================================================"
    echo -e "${NC}"
}

die() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

ok() {
    echo -e "${GREEN}[ OK ]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# -----------------------------
# Argument validation
# -----------------------------
if [[ $# -lt 1 ]]; then
    usage
    exit 1
fi

TARGET="$1"

# -----------------------------
# Check Nmap
# -----------------------------
command -v nmap >/dev/null 2>&1 \
    || die "Nmap tidak ditemukan. Install dengan: brew install nmap"

NMAP_VERSION=$(nmap --version | head -n 1)

# -----------------------------
# Timestamp
# -----------------------------
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Sanitise target untuk nama folder
SAFE_TARGET=$(echo "$TARGET" | tr '/:' '__')

OUTDIR="nmap_${SAFE_TARGET}_${TIMESTAMP}"

mkdir -p "$OUTDIR" \
    || die "Tidak bisa membuat output directory."

# -----------------------------
# Header
# -----------------------------
banner

echo "Target       : $TARGET"
echo "Nmap         : $NMAP_VERSION"
echo "Started      : $(date)"
echo "Output       : $OUTDIR"
echo

# -----------------------------
# Save scan metadata
# -----------------------------
cat > "${OUTDIR}/scan-info.txt" <<EOF
Nmap Enterprise Audit
=====================

Target:
$TARGET

Nmap:
$NMAP_VERSION

Started:
$(date)

Host:
$(hostname)

macOS:
$(sw_vers -productVersion)

Architecture:
$(uname -m)
EOF

# ============================================================
# PHASE 1
# Host discovery
# ============================================================

echo
echo -e "${CYAN}========== PHASE 1: HOST DISCOVERY ==========${NC}"

info "Discovering live hosts..."

nmap \
    -sn \
    --reason \
    -oA "${OUTDIR}/01-host-discovery" \
    "$TARGET"

ok "Host discovery selesai."

# ============================================================
# PHASE 2
# Full TCP Port Scan
# ============================================================

echo
echo -e "${CYAN}========== PHASE 2: FULL TCP PORT SCAN ==========${NC}"

info "Scanning TCP ports 1-65535..."

nmap \
    -Pn \
    -sS \
    -p- \
    --reason \
    --max-retries 2 \
    --scan-delay 100ms \
    --max-rate 50 \
    -oA "${OUTDIR}/02-full-tcp" \
    "$TARGET"

ok "Full TCP scan selesai."

# ============================================================
# PHASE 3
# Service Detection
# ============================================================

echo
echo -e "${CYAN}========== PHASE 3: SERVICE DETECTION ==========${NC}"

info "Fingerprinting service/version..."

nmap \
    -Pn \
    -sS \
    -sV \
    --version-intensity 7 \
    --reason \
    --max-retries 2 \
    --scan-delay 100ms \
    --max-rate 50 \
    -p- \
    -oA "${OUTDIR}/03-service-detection" \
    "$TARGET"

ok "Service detection selesai."

# ============================================================
# PHASE 4
# OS Detection
# ============================================================

echo
echo -e "${CYAN}========== PHASE 4: OS DETECTION ==========${NC}"

info "Detecting operating system..."

nmap \
    -Pn \
    -O \
    --osscan-guess \
    --reason \
    --max-retries 2 \
    --scan-delay 100ms \
    --max-rate 50 \
    -oA "${OUTDIR}/04-os-detection" \
    "$TARGET"

ok "OS detection selesai."

# ============================================================
# PHASE 5
# Default + Safe NSE
# ============================================================

echo
echo -e "${CYAN}========== PHASE 5: NSE SAFE ENUMERATION ==========${NC}"

info "Running default + safe NSE scripts..."

nmap \
    -Pn \
    -sV \
    --script "default,safe" \
    --reason \
    --max-retries 2 \
    --scan-delay 100ms \
    --max-rate 30 \
    -oA "${OUTDIR}/05-nse-safe" \
    "$TARGET"

ok "NSE safe enumeration selesai."

# ============================================================
# PHASE 6
# Traceroute
# ============================================================

echo
echo -e "${CYAN}========== PHASE 6: NETWORK PATH ==========${NC}"

info "Running traceroute..."

nmap \
    -Pn \
    --traceroute \
    --reason \
    -oA "${OUTDIR}/06-traceroute" \
    "$TARGET"

ok "Traceroute selesai."

# ============================================================
# PHASE 7
# Comprehensive Summary
# ============================================================

echo
echo -e "${CYAN}========== PHASE 7: COMPREHENSIVE SUMMARY ==========${NC}"

info "Generating consolidated report..."

nmap \
    -Pn \
    -sS \
    -sV \
    -O \
    --osscan-guess \
    --reason \
    --traceroute \
    --script "default,safe" \
    --version-intensity 7 \
    --max-retries 2 \
    --scan-delay 100ms \
    --max-rate 30 \
    -p- \
    -oA "${OUTDIR}/07-comprehensive" \
    "$TARGET"

ok "Comprehensive scan selesai."

# ============================================================
# Extract useful information
# ============================================================

echo
echo -e "${CYAN}========== EXTRACTING RESULTS ==========${NC}"

# Open ports
if [[ -f "${OUTDIR}/07-comprehensive.nmap" ]]; then

    grep -E "^[0-9]+/(tcp|udp)" \
        "${OUTDIR}/07-comprehensive.nmap" \
        > "${OUTDIR}/open-ports.txt" \
        || true

    # Services
    grep -E "^[0-9]+/(tcp|udp).*open" \
        "${OUTDIR}/07-comprehensive.nmap" \
        > "${OUTDIR}/services.txt" \
        || true

fi

# ============================================================
# Final report
# ============================================================

echo
echo -e "${GREEN}"
echo "============================================================"
echo "                 SCAN COMPLETED"
echo "============================================================"
echo -e "${NC}"

echo "Target : $TARGET"
echo "Output : $OUTDIR"
echo

if [[ -s "${OUTDIR}/open-ports.txt" ]]; then
    echo -e "${YELLOW}Open ports:${NC}"
    cat "${OUTDIR}/open-ports.txt"
else
    echo "Tidak ditemukan open TCP ports pada hasil comprehensive scan."
fi

echo
echo "Files:"
find "$OUTDIR" -maxdepth 1 -type f -print | sort

echo
echo "Finished : $(date)"
echo

ok "Audit selesai."
