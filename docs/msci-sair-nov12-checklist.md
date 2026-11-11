# MSCI SAIR Nov 12 2026 — Operator Checklist

**Event:** MSCI November 2026 Semi-Annual Index Review (SAIR)  
**Expected announcement:** ~17:00 ET Nov 12 = **05:00 WIB Nov 13**  
**What MSCI will announce:** Standalone consultation parameters confirmation + any free-float exclusions

---

## Nov 12 — SAIR Day (auto-handled by cron)

Pre-SAIR Brief cron fires at **07:00 WIB** (registered in `.dexter/cron/jobs.json`):
- Runs all 13 modules + MSCI positioning analysis
- Delivered via WhatsApp gateway

No manual action needed unless gateway is down.

**Key tripwires to watch manually:**
| Metric | Watch Level | Signal |
|--------|------------|--------|
| CDS 5Y | Jump >10bps intraday | Morris-Shin revelation event |
| USDIDR | Cross 18,500 | M3 Confidence Gate tips ATTACK zone |
| IHSG A/D ratio | A/D < 0.3 | Forced sell vs panic panic |
| EIDO volume | Unusual pre-close | Active pre-positioning |

---

## Nov 13 — Post-SAIR (cron fires 11:00 WIB)

Post-SAIR Reaction cron fires at **11:00 WIB Nov 13** (registered in `.dexter/cron/jobs.json`).

Auto env-updater also fires at **23:30 WIB daily** via crontab (Scenario A auto-detected via Exa).

---

## Three Scenarios + Required .env Changes

### Scenario A — Standalone Confirmed (Base Case, P≈86%)
> MSCI confirms Standalone consultation proceeds; standard parameter language; stock exclusions announced.

```bash
# Auto-applied by update-msci-post-sair.ts (Exa detects no B/C language)
MSCI_SAIR_DATE=2027-05-08           # advance to May 2027 SAIR (verify exact date from MSCI press release)
MSCI_REVIEW_DATE=2027-04-30         # consultation closes Apr 30 2027
# MSCI_CLASSIFICATION_STATUS stays downgrade_risk
# MSCI_REVERSAL_PROBABILITY_OVERRIDE stays UNSET (auto-formula: ~13% → 5% by Apr 2027)
```

**Manual check:** Verify exact May 2027 SAIR date from MSCI press release. Update if ≠ 2027-05-08.

---

### Scenario B — Language Softens (P≈10%)
> MSCI acknowledges progress, conditional language, "open to reconsider" — Standalone status uncertain.

```bash
# Semi-auto: update-msci-post-sair.ts detects and applies, but verify before accepting
MSCI_SAIR_DATE=2027-05-08
MSCI_REVIEW_DATE=2027-04-30
MSCI_CLASSIFICATION_STATUS=under_review     # ← changes from downgrade_risk
MSCI_REVERSAL_PROBABILITY_OVERRIDE=0.20     # ← P(reversal) rises from 14% → 20%
```

**Manual action required:** Read MSCI press release carefully. If Scenario B confirmed:
1. Accept the auto-applied changes (or run `bun scripts/update-msci-post-sair.ts --scenario=B`)
2. Update Thesis #14 notes: "KS#2 candidate strengthened — Standalone uncertain"
3. Run `bun scripts/morning-check.ts` — M5 score should drop (downgrade_risk → under_review)

---

### Scenario C — Consultation Withdrawn/EM Retained (P≈4%)
> MSCI explicitly reverses: Indonesia remains EM, Standalone consultation halted.

```bash
# Semi-auto, but MUST manually confirm before applying
MSCI_SAIR_DATE=2027-05-08
MSCI_REVIEW_DATE=2027-04-30
MSCI_CLASSIFICATION_STATUS=confirmed        # ← EM status retained = no downgrade
# MSCI_REVERSAL_PROBABILITY_OVERRIDE removed
```

**Manual action required:**
1. Read MSCI press release — confirm "reaffirms Emerging Market" or "withdraws Standalone consultation"
2. Run `bun scripts/update-msci-post-sair.ts --scenario=C` after manual confirm
3. **Kill Thesis #14 KS#2** (`POST /api/thesis/kill/14` via dashboard `/bs`) — BI coordination effective
4. Run `bun scripts/morning-check.ts` — M5 score should drop significantly
5. Update CLAUDE.md MSCI section notes

---

## Passive Outflow Estimates (Bryant phases)

| Phase | Trigger | Estimated Outflow |
|-------|---------|-------------------|
| Fast money (done) | T+0 to T+30d | ~$200-400M (EIDO/active mandates) |
| ETF (active T+90d) | MSCI Nov review | ~$600-900M (EEM/EEMV rebalance) |
| Mandate rebalancing | Implementation Sep-Dec 2027 | ~$2-4B (EM ex-Indonesia mandates) |

IHSG floor formula: `P(reversal) × 12x + P(downgrade) × 5.5x = target PE → implied index level`  
At P(reversal)=14%: floor ≈ **4,391** (−14% from 5,119 Nov 11 close).  
If Scenario B (P=20%): floor ≈ **4,610** (less downside).

---

## Post-Update Verification Sequence

```bash
# 1. Verify .env changes correct
grep -E "MSCI_SAIR_DATE|MSCI_REVIEW_DATE|MSCI_CLASSIFICATION|MSCI_REVERSAL" .env

# 2. Run morning check — confirm M5 score recalibrated
bun scripts/morning-check.ts

# 3. Run MSCI countdown — should show new milestone (Apr 30 2027 consultation close)
bun scripts/msci-countdown.ts

# 4. Health check — all 56+ fresh
bun scripts/health-check.ts

# 5. Dashboard — confirm M5 panel shows updated status
# GET http://localhost:6080  → Foreign Flow panel → MSCI row
```

---

## SULNI Q3 2026 (Dec 2026)

BI expected to publish SULNI Q3 2026 press release in **December 2026** (~6 weeks after Q3 end Sep 30).

When published, update `.env`:
```bash
ULN_DSR_PCT=XX.XX          # from SULNI press release (IMF threshold 25%; current Q4 2024: 24.69%)
ULN_SHORTTERM_PCT=XX.XX    # short-term debt % of total ULN (current Q4 2024: 15.47%)
```

Also check: `indonesia_external_debt_bn` via `bun scripts/health-check.ts` — should auto-refresh from BI SULNI source.

---

*Last updated: 11 November 2026 | victor@sadasa.id*
