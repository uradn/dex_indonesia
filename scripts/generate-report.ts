/**
 * Generate health check + dashboard audit report as .docx
 * Usage: bun scripts/generate-report.ts
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType,
} from 'docx';
import { writeFileSync } from 'fs';
import path from 'path';

const NOW = new Date();
const DATE_STR = NOW.toISOString().slice(0, 10).replace(/-/g, '');
const REPORT_DATE = NOW.toISOString().slice(0, 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function h1(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 100 } });
}

function h2(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 80 } });
}

function h3(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 60 } });
}

function para(text: string, opts?: { bold?: boolean; color?: string; size?: number }) {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts?.bold, color: opts?.color, size: opts?.size ?? 22 })],
    spacing: { after: 80 },
  });
}

function bullet(text: string, level = 0) {
  return new Paragraph({
    text,
    bullet: { level },
    spacing: { after: 60 },
    style: 'Normal',
  });
}

function hr() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
    spacing: { after: 160 },
  });
}

function colorCell(text: string, fill: string, textColor = 'FFFFFF') {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, color: textColor, bold: true, size: 18 })],
      alignment: AlignmentType.CENTER,
    })],
    shading: { type: ShadingType.SOLID, color: fill },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function cell(text: string, bold = false) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold, size: 18 })],
    })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

// ─── SCD scorecard data ───────────────────────────────────────────────────────

const MODULES = [
  { name: 'FX Defense',           score: 71,  level: 'RED',    weight: '16%' },
  { name: 'Commodity',            score: 81,  level: 'RED',    weight: '12%' },
  { name: 'Fiscal',               score: 100, level: 'RED',    weight: '10%' },
  { name: 'Domestic Pressure',    score: 89,  level: 'RED',    weight: '10%' },
  { name: 'Political Risk',       score: 100, level: 'RED',    weight: '12%' },
  { name: 'Narrative',            score: 50,  level: 'ORANGE', weight: '8%'  },
  { name: 'Banking',              score: 48,  level: 'YELLOW', weight: '10%' },
  { name: 'Sovereign Risk',       score: 33,  level: 'YELLOW', weight: '8%'  },
  { name: 'BoP / External',       score: 25,  level: 'GREEN',  weight: '6%'  },
  { name: 'Foreign Flow',         score: 28,  level: 'GREEN',  weight: '8%'  },
  { name: 'Market (IHSG)',        score: 4,   level: 'GREEN',  weight: '4%'  },
  { name: 'ULN / External Debt',  score: 12,  level: 'GREEN',  weight: '4%'  },
  { name: 'Regime',               score: 10,  level: 'GREEN',  weight: '0%'  },
  { name: 'ASEAN RV',             score: 21,  level: 'GREEN',  weight: '0%'  },
];

const LEVEL_FILL: Record<string, string> = {
  RED: 'C0392B',
  ORANGE: 'E67E22',
  YELLOW: 'F1C40F',
  GREEN: '27AE60',
};
const LEVEL_TEXT: Record<string, string> = {
  RED: 'FFFFFF', ORANGE: 'FFFFFF', YELLOW: '000000', GREEN: 'FFFFFF',
};

// ─── Bugs fixed ───────────────────────────────────────────────────────────────

const BUGS = [
  {
    id: 'Bug 22',
    commit: 'b5e5408',
    file: 'src/tools/macro/asean-rv-engine.ts',
    desc: 'alertFromScore(s) pairing',
    detail: 'Engine returned alertLevel based on hard-coded thresholds inconsistent with alertFromScore(). Fixed to always derive alertLevel = alertFromScore(stressScore).',
  },
  {
    id: 'Bug 22b',
    commit: '749c9b1',
    file: 'scripts/morning-check.ts',
    desc: 'ASEAN RV section header emoji used engine alertLevel',
    detail: 'Line 222: r.alertLevel (engine threshold) used for section header emoji while addScore at line 83 used alertFromScore(s). Fixed to alertFromScore(m7Score).',
  },
  {
    id: 'Bug 23',
    commit: '749c9b1',
    file: 'scripts/dashboard.ts',
    desc: '5 score-line panels always resolved to green',
    detail: 'Dashboard compared ms.alertLevel === \'RED\' (uppercase) but getLatestModuleScores() returns lowercase from DB. All 5 occurrences (BoP/Commodity/Narrative/Market/ULN panels, lines 1734/1794/1813/1840/1864) replaced with score-based threshold: ms.score >= 70 ? \'red\' : ...',
  },
  {
    id: 'Bug 24',
    commit: '26b776d',
    file: 'src/tools/macro/sources/at1-bonds.ts',
    desc: 'Env override missing DB upsert (DNDF pattern)',
    detail: 'fetchAt1Secondary() env path returned without upserting himbara_at1_secondary_pct to DB. health-check.ts reads DB directly → showed stale even when HIMBARA_AT1_SECONDARY_PCT env was set. Fixed: upsert follows DNDF pattern (all env-always-wins sources must upsert).',
  },
  {
    id: 'Bug 21',
    commit: 'e4ac469',
    file: 'src/tools/macro/regime-engine.ts',
    desc: 'Q2 score misaligned with YELLOW threshold',
    detail: 'Q2 score was 30 but YELLOW threshold is 33. Engine labeled Q2 as GREEN despite intended YELLOW. Fixed Q2 score to 35.',
  },
  {
    id: 'Bug 20',
    commit: '6cdef3c',
    file: 'src/tools/macro/sources/ojk-sjkpublic.ts',
    desc: 'fetchBankingRatiosSjkPublic returned null on freshness gate hit',
    detail: 'Cache freshness gate returned { car: null, ldr: null } instead of the cached values. All downstream callers received null and fell through to slower Playwright scrape.',
  },
];

// ─── Health check data (Nov 19 run) ───────────────────────────────────────────

const HEALTH = {
  date: '2026-11-19',
  summary: { fresh: 70, aging: 5, stale: 1, critical: 1, noData: 3 },
  issues: [
    { level: 'CRITICAL', indicator: 'm2_money_supply_idr_bn',         module: 'M8',  age: '323d', target: '≤35d',  value: '10,134,654' },
    { level: 'STALE',    indicator: 'bank_savings_deposito_ratio_pct', module: 'M8',  age: '80d',  target: '≤50d',  value: '52.5' },
    { level: 'AGING',    indicator: 'indonesia_external_debt_bn',      module: 'M13', age: '142d', target: '≤140d', value: '453.37' },
    { level: 'AGING',    indicator: 'bank_pdnl_pct',                   module: 'M8',  age: '67d',  target: '≤60d',  value: '1.77' },
    { level: 'AGING',    indicator: 'idx_short_sell_volume_idr_bn',    module: 'M9',  age: '9d',   target: '≤7d',   value: '0' },
    { level: 'AGING',    indicator: 'policy_response_level',           module: 'M3',  age: '2d',   target: '≤1d',   value: '1' },
    { level: 'AGING',    indicator: 'cpo_price_myr',                   module: 'M4',  age: '49d',  target: '≤35d',  value: '1120' },
    { level: 'NO DATA',  indicator: 'm1_m2_ratio_pct',                 module: 'M8',  age: '—',    target: '—',     value: '—' },
    { level: 'NO DATA',  indicator: 'indonesia_ihpr_yoy_pct',          module: 'M8',  age: '—',    target: '—',     value: '—' },
    { level: 'NO DATA',  indicator: 'fintech_lending_growth_yoy_pct',  module: 'M8',  age: '—',    target: '—',     value: '—' },
  ],
};

// ─── Build document ───────────────────────────────────────────────────────────

const doc = new Document({
  creator: 'Dexter — Indonesia Macro Intel',
  title: `Laporan Health Check & Dashboard Audit — ${REPORT_DATE}`,
  description: 'Dexter Silent Crisis Detector: data freshness audit + codebase bug fixes',
  sections: [{
    children: [
      // Cover
      new Paragraph({
        children: [new TextRun({ text: 'DEXTER MACRO INTEL', bold: true, size: 48, color: '1A1A2E' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 800, after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Health Check + Dashboard Audit Report', size: 28, color: '555555' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: REPORT_DATE, size: 24, color: '888888' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      }),
      hr(),

      // ── 1. Executive Summary ──────────────────────────────────────────────
      h1('1. Executive Summary'),
      para('Silent Crisis Detector score: 79% RED (2026-11-17). Synthetic Stability Score 100/100 — TRANSMISSION UNDERWAY. 6/13 modules in confirmed stress zone. Thesis #15 triggered (day 1, armed 2026-11-16).'),
      para('This report covers:'),
      bullet('Data freshness audit (health-check.ts run 2026-11-19): 70 fresh | 5 aging | 1 stale | 1 critical | 3 no-data'),
      bullet('Codebase bug audit (Bugs 1–24): all fixed, committed, pushed to uradn/dex_indonesia'),
      bullet('Dashboard correctness: 5 panels fixed (score color always-green bug)'),
      hr(),

      // ── 2. SCD Scorecard ─────────────────────────────────────────────────
      h1('2. SCD Module Scorecard (2026-11-17)'),
      para('SCD Composite: 79% RED | Synthetic Stability: 100/100 | Cross-confirmed: 6/13', { bold: true }),
      new Paragraph({ spacing: { after: 120 } }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              cell('Module', true),
              cell('Score', true),
              cell('Level', true),
              cell('Weight', true),
            ],
          }),
          ...MODULES.map(m => new TableRow({
            children: [
              cell(m.name),
              cell(String(m.score)),
              colorCell(m.level, LEVEL_FILL[m.level]!, LEVEL_TEXT[m.level]),
              cell(m.weight),
            ],
          })),
        ],
      }),
      new Paragraph({ spacing: { after: 160 } }),

      h2('Key Stress Vectors'),
      bullet('Fiscal 100/100 RED: deficit 4.23% GDP, subsidi run-rate 419%, S&P interest/revenue 20.5% (threshold 15%), Calvo debt trap active'),
      bullet('Political Risk 100/100 RED: polrisk=100, PHK YTD 90k workers, BBM langka nationwide, BBC Indonesia coverage of approval collapse'),
      bullet('Domestic Pressure 89/100 RED: Pertalite gap Rp7,685/L, Solar B50 gap Rp13,783/L, 4 food commodity spikes'),
      bullet('Commodity 81/100 RED: Brent $93 (+13% vs APBN), coal DMO compliance 50%, B50 mandate active'),
      bullet('FX Defense 71/100 RED: Obstfeld escape clause elevated, Morris-Shin attack zone (DC+35 > AC), SRBI sterilization 36% cadev'),
      bullet('Narrative 50/100 ORANGE: USDIDR +10.5% vs APBN, ICP +31.1% vs APBN'),
      hr(),

      // ── 3. Thesis Monitor ────────────────────────────────────────────────
      h1('3. Thesis #15 — TRIGGERED'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [cell('Armed', true), cell('2026-11-16')] }),
          new TableRow({ children: [cell('Status', true), colorCell('TRIGGERED', 'C0392B')] }),
          new TableRow({ children: [cell('Divergence', true), cell('political_financial_gap')] }),
          new TableRow({ children: [cell('CDS Target', true), cell('98 bps → 192 bps (+94 bps)')] }),
          new TableRow({ children: [cell('USDIDR Target', true), cell('18,240 → 20,327 (+11.4%)')] }),
          new TableRow({ children: [cell('SBN 10Y Target', true), cell('7.607% → 9.11% (+150 bps)')] }),
          new TableRow({ children: [cell('T+90 Milestone', true), cell('2027-02-14')] }),
          new TableRow({ children: [cell('T+180 Milestone', true), cell('2027-05-15')] }),
        ],
      }),
      new Paragraph({ spacing: { after: 160 } }),
      para('Triggers fired: (1) political_risk_score 100 > 75 threshold; (2) subsidi run-rate 419% > 135%.'),
      para('Kill switches: KS#1 not firing (polrisk 100/100), KS#3 not firing (SBN asing 13.05% < 15%), KS#4 not firing (CDS 98.3 bps > 75 bps threshold).'),
      hr(),

      // ── 4. Data Freshness ────────────────────────────────────────────────
      h1('4. Data Freshness Audit (2026-11-19)'),
      para(`Run date: ${HEALTH.date} | Result: ${HEALTH.summary.fresh} fresh | ${HEALTH.summary.aging} aging | ${HEALTH.summary.stale} stale | ${HEALTH.summary.critical} critical | ${HEALTH.summary.noData} no-data`, { bold: true }),
      new Paragraph({ spacing: { after: 120 } }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cell('Level', true), cell('Indicator', true), cell('Module', true), cell('Age', true), cell('Target', true), cell('Last Value', true)],
          }),
          ...HEALTH.issues.map(i => new TableRow({
            children: [
              colorCell(
                i.level,
                i.level === 'CRITICAL' ? 'C0392B' : i.level === 'STALE' ? 'E67E22' : i.level === 'AGING' ? 'F1C40F' : '95A5A6',
                i.level === 'AGING' ? '000000' : 'FFFFFF',
              ),
              cell(i.indicator),
              cell(i.module),
              cell(i.age),
              cell(i.target),
              cell(i.value),
            ],
          })),
        ],
      }),
      new Paragraph({ spacing: { after: 160 } }),

      h2('Critical Issue: m2_money_supply_idr_bn (323d)'),
      para('BI SEKI M2 data is 323 days stale (target ≤35d). Root cause: BI SEKI PDF scraper (bi-seki.ts) requires Playwright; WAF intermittently blocks. Fallback: pin via BI_M2_IDR_BN env var or manual monthly update from BI SEKI publication.'),
      para('Impact: M8 KLR M2/reserves ratio uses last-known value (10,134,654 bn IDR). Directionally correct but not month-fresh. KLR signal M2/reserves = 3.8x remains in watch zone (3–5x).'),

      h2('No-Data Indicators (M8 Banking)'),
      bullet('m1_m2_ratio_pct — BI SEKI Table 1.1; same Playwright path as M2; not populated since system init'),
      bullet('indonesia_ihpr_yoy_pct — OJK house price index; no automated scraper; pin manually from OJK SPI'),
      bullet('fintech_lending_growth_yoy_pct — OJK P2P growth; Exa/Tavily fetch yields coverage but growth calc requires 2-period comparison; engine handles gracefully'),
      hr(),

      // ── 5. Bug Audit ─────────────────────────────────────────────────────
      h1('5. Codebase Bug Audit — Bugs Fixed (Session Nov 17–19)'),
      para('Total bugs fixed across all audit sessions: Bugs 1–24. All committed and pushed to uradn/dex_indonesia main.'),
      new Paragraph({ spacing: { after: 120 } }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cell('ID', true), cell('Commit', true), cell('File', true), cell('Summary', true)],
          }),
          ...BUGS.map(b => new TableRow({
            children: [
              cell(b.id, true),
              cell(b.commit),
              cell(b.file),
              cell(b.desc),
            ],
          })),
        ],
      }),
      new Paragraph({ spacing: { after: 160 } }),

      h2('Bug 23 — Dashboard Panel Score Colors (Deep Dive)'),
      para('Root cause: getLatestModuleScores() in time-series-db.ts stores alert_level as lowercase (\'red\', \'orange\', \'yellow\', \'green\'). Dashboard was comparing ms.alertLevel === \'RED\' (uppercase). All comparisons resolved to false → panel always rendered green.'),
      para('Affected panels: BoP, Commodity, Narrative, Market, ULN (5 of 13 panels). Fixed to threshold-based: ms.score >= 70 ? \'red\' : ms.score >= 50 ? \'orange\' : ms.score >= 33 ? \'yellow\' : \'green\'. Consistent with alertFromScore() in scoring.ts.'),

      h2('Bug 24 — AT1 Bonds DNDF Pattern'),
      para('Every env-always-wins source must upsert to DB so health-check.ts freshness gate passes. at1-bonds.ts was the only source file missing this. Pattern: read env → validate → upsertPoints() → return. All other sources (ojk-pdn.ts, bi.ts, msci-classification.ts, ndf-offshore.ts, lps-deposit-coverage.ts, srbi-auction.ts) correctly implemented.'),
      hr(),

      // ── 6. Architecture Notes ─────────────────────────────────────────────
      h1('6. Architecture Notes'),

      h2('alertFromScore() Contract'),
      para('Canonical thresholds: RED ≥ 70, ORANGE ≥ 50, YELLOW ≥ 33, GREEN < 33. All 13 engines must derive alertLevel = alertFromScore(stressScore). Exceptions by design: fx_defense attack zone (score=40, alertLevel=orange override) and foreign_flow SSVI floor — both intentional, documented in engine comments.'),

      h2('DNDF Upsert Pattern'),
      para('All env-always-wins sources follow: (1) check env, (2) validate range, (3) upsertPoints() to DB, (4) return. Order: env BEFORE cache check. This ensures health-check.ts freshness gate sees fresh data even when env override is active.'),

      h2('Monthly Cache Gate'),
      para('Monthly sources (china-pmi, ikk, sakernas, bps, ojk-pdn) must gate on cached.date not cached.fetchedAt. fetchedAt blocks re-fetch even when source published new data for the month. Date-based gate fires on first run after publication month changes.'),

      h2('Dynamic Political Weight'),
      para('SCD runner applies dynamic weight for political_risk: 0.05 (score<75), 0.09 (score≥75), 0.12 (score≥90). scd-alert.ts uses identical weight map. At current polrisk=100, weight=0.12 (vs static 0.12 base).'),
      hr(),

      // ── 7. Env Variables Status ───────────────────────────────────────────
      h1('7. Environment Variables — Key Overrides Active'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: [cell('Variable', true), cell('Value', true), cell('Purpose', true)] }),
          new TableRow({ children: [cell('MSCI_CLASSIFICATION_STATUS'), cell('downgrade_risk'), cell('M5 — Standalone consultation active Oct 15 2026')] }),
          new TableRow({ children: [cell('MSCI_REVIEW_DATE'), cell('2027-04-30'), cell('M5 — Consultation closes Apr 30 2027')] }),
          new TableRow({ children: [cell('MSCI_SAIR_DATE'), cell('2027-05-08'), cell('M5/M7 — Next SAIR target May 2027')] }),
          new TableRow({ children: [cell('BI_DNDF_OUTSTANDING_BN'), cell('8.0'), cell('M3 — FX defense effective reserves adj')] }),
          new TableRow({ children: [cell('ULN_DSR_PCT'), cell('24.69'), cell('M13 — SULNI Q4 2024')] }),
          new TableRow({ children: [cell('ULN_SHORTTERM_PCT'), cell('15.47'), cell('M13 — SULNI Q4 2024')] }),
          new TableRow({ children: [cell('FINTECH_NPL_PCT'), cell('5.0'), cell('M8 — OJK Jun 2026')] }),
          new TableRow({ children: [cell('HIMBARA_AT1_SECONDARY_PCT'), cell('88.4'), cell('M8 — AT1 secondary watch')] }),
          new TableRow({ children: [cell('BI_GWM_PCT'), cell('7.0'), cell('M8 — GWM cut from 9% (Oct 23 2026)')] }),
          new TableRow({ children: [cell('APBN_DEFICIT_YTD_IDR_T'), cell('379.0'), cell('M10 — Oct 2026 KiTa')] }),
          new TableRow({ children: [cell('APBN_SPENDING_YTD_IDR_T'), cell('2763.1'), cell('M10 — Oct 2026 KiTa')] }),
        ],
      }),
      new Paragraph({ spacing: { after: 160 } }),
      hr(),

      // ── Footer ────────────────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: `Generated by Dexter • ${REPORT_DATE} • victor@sadasa.id`, size: 16, color: 'AAAAAA' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      }),
    ],
  }],
});

// Write file
const outPath = path.join(process.cwd(), 'docs', `Laporan_Dexter_HealthCheck_DashboardAudit_${DATE_STR}.docx`);
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`Written: ${outPath} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
