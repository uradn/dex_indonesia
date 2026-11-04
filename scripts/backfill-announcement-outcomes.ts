/**
 * Seed `announcement_outcomes` table with known historical BI/Kemenkeu/ESDM
 * announcement → realized outcome pairs (2020–2026).
 *
 * Purpose: bootstrap Bayesian prior computation for M6 credibility engine.
 * Sources: BI RDG press releases, Kemenkeu APBN realisasi, OJK data, media archives.
 *
 * Usage:
 *   bun scripts/backfill-announcement-outcomes.ts          # run all seeds
 *   bun scripts/backfill-announcement-outcomes.ts --dry-run # print count, no DB write
 */

import { upsertAnnouncementOutcome, type AnnouncementOutcome } from '../src/tools/macro/time-series-db.js';

const DRY_RUN = process.argv.includes('--dry-run');

// ─────────────────────────────────────────────────────────────────────────────
// Historical records. followed_through: 1=yes, 0=no, -1=partial, null=pending
// ─────────────────────────────────────────────────────────────────────────────
const RECORDS: AnnouncementOutcome[] = [

  // ── BI Rate Guidance (bi_monetary:rate_guidance) ──────────────────────────
  // BI historical: strong guidance-action coherence (~78%)
  {
    date: '2020-02-20', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '4.75% — BI signals accommodative stance for growth',
    specificity: 'general', timebound: false,
    outcomeDate: '2020-03-19', outcomeText: 'BI cut 25bps to 4.50% (emergency COVID)',
    followedThrough: 1,
    source: 'BI RDG press release Feb 2020',
  },
  {
    date: '2020-06-18', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '4.25% — BI signals further space for easing',
    specificity: 'specific', timebound: false,
    outcomeDate: '2020-07-16', outcomeText: 'BI cut 25bps to 4.00%',
    followedThrough: 1,
    source: 'BI RDG press release Jun 2020',
  },
  {
    date: '2021-10-21', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '3.50% — BI will hold accommodative to support recovery',
    specificity: 'general', timebound: false,
    outcomeDate: '2022-05-23', outcomeText: 'BI held until May 2022, then emergency hike 25bps',
    followedThrough: -1,
    source: 'BI RDG Oct 2021 + May 2022 emergency RDG',
  },
  {
    date: '2022-08-23', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '4.25% — BI will stay data-dependent, front-load if needed',
    specificity: 'specific', timebound: false,
    outcomeDate: '2022-09-22', outcomeText: 'BI hiked 50bps to 4.75% (front-loaded)',
    followedThrough: 1,
    source: 'BI RDG Aug + Sep 2022',
  },
  {
    date: '2023-01-19', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '5.75% — BI signals pause after 225bps cumulative tightening',
    specificity: 'specific', timebound: false,
    outcomeDate: '2023-05-25', outcomeText: 'BI held at 5.75% — maintained pause as guided',
    followedThrough: 1,
    source: 'BI RDG Jan 2023 + Jan–May 2023 hold sequence',
  },
  {
    date: '2023-10-19', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: 'BI siap gunakan cadangan dan instrumen untuk jaga IDR',
    specificity: 'vague', timebound: false,
    outcomeDate: '2023-11-23', outcomeText: 'BI hiked 25bps to 6.00% (surprise); cadev turun $3.3bn',
    followedThrough: -1,
    source: 'BI Nov 2023 surprise hike; cadev data BI monthly',
  },
  {
    date: '2024-04-24', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '6.25% — BI hike 25bps surprise; pro-stability',
    specificity: 'verifiable', timebound: false,
    outcomeDate: '2024-06-19', outcomeText: 'BI cut 25bps to 6.00% at Jun RDG (IDR stabilized)',
    followedThrough: 1,
    source: 'BI Apr 2024 surprise hike + Jun 2024 cut',
  },
  {
    date: '2025-01-16', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '5.75% — BI cut 25bps; signals further easing in H1 2025',
    specificity: 'specific', timebound: true,
    outcomeDate: '2025-03-20', outcomeText: 'BI held at 5.75% — IDR weakened; no further cut H1',
    followedThrough: 0,
    source: 'BI Jan 2025 cut + Q1 2025 hold',
  },
  {
    date: '2026-05-21', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '5.75% — BI hold, dorong pertumbuhan sesuai APBN assumption 5.4%',
    specificity: 'general', timebound: false,
    outcomeDate: '2026-06-09', outcomeText: 'BI hiked 25bps to 5.75% — IDR defense (surprise)',
    followedThrough: -1,
    source: 'BI Jun 10 2026 emergency RDG',
  },
  {
    date: '2026-07-17', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '5.75% — BI tahan, Perry Warjiyo mundur; Destry Damayanti sebagai Plt',
    specificity: 'general', timebound: false,
    outcomeDate: '2026-08-20', outcomeText: 'BI tetap 5.75% di RDG Agu 2026',
    followedThrough: 1,
    source: 'BI Aug 2026 RDG',
  },
  {
    date: '2026-09-18', institution: 'bi_monetary', announcementType: 'rate_guidance',
    announcedValue: '5.75% — Destry perdana; BI tahan, sinyal pro-IDR stability',
    specificity: 'specific', timebound: false,
    outcomeDate: '2026-10-16', outcomeText: 'BI tetap 5.75% di RDG Okt 2026',
    followedThrough: 1,
    source: 'BI Sep + Oct 2026 RDG',
  },

  // ── Kemenkeu Fiscal / Deficit Ceiling (kemenkeu_fiscal:deficit_ceiling) ────
  // Kemenkeu track record: mixed — tends to miss on optimistic APBN
  {
    date: '2020-02-19', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '1.76% PDB — APBN 2020 deficit target',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2021-02-18', outcomeText: 'Realisasi deficit 6.09% PDB (COVID-19 extraordinary)',
    followedThrough: 0,
    source: 'APBN 2020 UU + Kemenkeu LKPP 2020',
  },
  {
    date: '2021-01-05', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '5.70% PDB — APBN 2021, Sri Mulyani komitmen konsolidasi',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2022-01-24', outcomeText: 'Realisasi deficit 4.65% PDB — lebih baik dari target',
    followedThrough: 1,
    source: 'APBN 2021 UU + Kemenkeu LKPP 2021',
  },
  {
    date: '2022-01-06', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '4.85% PDB → target kembali ke <3% pada 2023',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2023-01-24', outcomeText: 'Realisasi deficit 2.38% PDB — jauh lebih baik, fiskal pulih',
    followedThrough: 1,
    source: 'APBN 2022 + LKPP 2022',
  },
  {
    date: '2023-01-04', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '2.84% PDB — APBN 2023, disiplin fiskal post-COVID',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2024-01-15', outcomeText: 'Realisasi deficit 1.65% PDB — overperformed',
    followedThrough: 1,
    source: 'APBN 2023 + LKPP 2023',
  },
  {
    date: '2024-01-03', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '2.29% PDB — APBN 2024',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2025-01-20', outcomeText: 'Realisasi deficit 2.70% PDB (MBG prepayment Q4)',
    followedThrough: -1,
    source: 'APBN 2024 UU + Kemenkeu LKPP 2024',
  },
  {
    date: '2025-01-03', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '2.53% PDB — APBN 2025 (MBG full year Rp335T)',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2026-01-20', outcomeText: 'Realisasi deficit 3.11% PDB (MBG overrun + revenue miss)',
    followedThrough: 0,
    source: 'APBN 2025 UU + Kemenkeu LKPP 2025',
  },
  {
    date: '2026-01-02', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: '2.68% PDB — APBN 2026 (UU No.17/2025)',
    specificity: 'verifiable', timebound: true,
    outcomeDate: null, outcomeText: null,
    followedThrough: null,
    source: 'UU APBN 2026 No.17/2025; realisasi pending Des 2026',
  },
  {
    date: '2026-10-07', institution: 'kemenkeu_fiscal', announcementType: 'deficit_ceiling',
    announcedValue: 'Menkeu: defisit tetap terjaga, efisiensi belanja offset tekanan',
    specificity: 'vague', timebound: false,
    outcomeDate: null, outcomeText: 'Oct YTD implied ~4.1–4.5% annualized; pending official figure',
    followedThrough: null,
    source: 'Kemenkeu press release Oct 7 2026 + M10 engine estimate',
  },

  // ── Kemenkeu Subsidi / ESDM BBM ───────────────────────────────────────────
  {
    date: '2022-09-01', institution: 'esdm_bbm', announcementType: 'bbm_hike',
    announcedValue: 'Pertalite naik Rp 7,650→10,000; Solar Rp 5,150→6,800 (Sep 3 2022)',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2022-09-03', outcomeText: 'Hike dilaksanakan sesuai jadwal',
    followedThrough: 1,
    source: 'Kepmen ESDM No.245.K/MG.01/MEM.M/2022',
  },
  {
    date: '2023-07-01', institution: 'esdm_bbm', announcementType: 'bbm_hike',
    announcedValue: 'Pemerintah tidak akan naik Pertalite 2023',
    specificity: 'specific', timebound: true,
    outcomeDate: '2023-12-31', outcomeText: 'Pertalite tetap Rp 10,000 sepanjang 2023',
    followedThrough: 1,
    source: 'Menko Perekonomian statement Jul 2023',
  },
  {
    date: '2026-05-20', institution: 'esdm_bbm', announcementType: 'bbm_hike',
    announcedValue: 'Pertamax naik Rp 12,300→16,250 mulai 10 Jun 2026',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2026-06-10', outcomeText: 'Naik sesuai jadwal (Kepmen ESDM Jun 10 2026)',
    followedThrough: 1,
    source: 'ESDM Kepmen Jun 10 2026 + M11 engine',
  },
  {
    date: '2026-07-15', institution: 'esdm_bbm', announcementType: 'bbm_hike',
    announcedValue: 'Pertamax tetap Rp 16,250 — tidak ada rencana turun',
    specificity: 'specific', timebound: false,
    outcomeDate: '2026-08-01', outcomeText: 'Pertamax turun Rp 15,950 (1 Agu 2026) — reversal tak terduga',
    followedThrough: 0,
    source: 'ESDM update Agu 1 2026; .env PERTAMAX_PRICE_IDR=15950',
  },
  {
    date: '2026-09-01', institution: 'esdm_bbm', announcementType: 'bbm_hike',
    announcedValue: 'BBM nonsubsidi naik: Turbo Rp19,600 Dexlite Rp23,700 Dex Rp25,200 Green95 Rp19,150',
    specificity: 'verifiable', timebound: true,
    outcomeDate: '2026-09-02', outcomeText: 'Naik sesuai pengumuman',
    followedThrough: 1,
    source: 'ESDM Sep 2026 + .env PERTAMAX_GREEN_PRICE_IDR=19150',
  },

  // ── Kemenkeu MBG Policy Commitment ───────────────────────────────────────
  {
    date: '2024-10-01', institution: 'kemenkeu_mbg', announcementType: 'policy_commitment',
    announcedValue: 'MBG Rp335T/tahun; implementasi penuh 2025 Q1',
    specificity: 'specific', timebound: true,
    outcomeDate: '2025-04-01', outcomeText: 'MBG realisasi Q1 2025 ~40% dari target (Rp33T of Rp84T)',
    followedThrough: -1,
    source: 'BPMI Setpres Oct 2024 + M10 engine realisasi tracker',
  },
  {
    date: '2025-01-13', institution: 'kemenkeu_mbg', announcementType: 'policy_commitment',
    announcedValue: 'MBG: 3 juta penerima awal; target 82.9 juta akhir 2025',
    specificity: 'specific', timebound: true,
    outcomeDate: '2025-12-31', outcomeText: 'Realisasi ~19 juta penerima akhir 2025 (23% dari target)',
    followedThrough: 0,
    source: 'BPMI Setpres + BPS Susenas 2025',
  },
  {
    date: '2026-01-05', institution: 'kemenkeu_mbg', announcementType: 'policy_commitment',
    announcedValue: 'MBG 2026: Rp335T, 82.9 juta penerima, full scale Jan 2026',
    specificity: 'verifiable', timebound: true,
    outcomeDate: null, outcomeText: 'YTD Nov 4 realisasi ~Rp200T; penerima ~45 juta (pending official)',
    followedThrough: null,
    source: 'APBN 2026 + M10 MBG tracker Nov 4 2026',
  },
];

async function main() {
  console.log(`=== Backfill Announcement Outcomes ===`);
  console.log(`Total records: ${RECORDS.length}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would upsert:');
    const byInstitution: Record<string, number> = {};
    for (const r of RECORDS) {
      byInstitution[r.institution] = (byInstitution[r.institution] ?? 0) + 1;
    }
    for (const [inst, count] of Object.entries(byInstitution)) {
      console.log(`  ${inst}: ${count} records`);
    }
    const withOutcome = RECORDS.filter(r => r.followedThrough !== null).length;
    const followed = RECORDS.filter(r => r.followedThrough === 1).length;
    console.log(`\nWith outcomes: ${withOutcome}/${RECORDS.length}`);
    console.log(`Followed through: ${followed}/${withOutcome} = ${((followed / withOutcome) * 100).toFixed(0)}% overall`);
    return;
  }

  let saved = 0;
  for (const r of RECORDS) {
    try {
      await upsertAnnouncementOutcome(r);
      saved++;
    } catch (e) {
      console.error(`  SKIP ${r.date} ${r.institution}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n✓ Saved ${saved}/${RECORDS.length} records to announcement_outcomes table`);

  // Print per-institution priors
  const { computeCredibilityPrior } = await import('../src/tools/macro/time-series-db.js');
  console.log('\nComputed priors (from DB, 730d lookback):');
  const pairs: [Parameters<typeof computeCredibilityPrior>[0], Parameters<typeof computeCredibilityPrior>[1]][] = [
    ['bi_monetary', 'rate_guidance'],
    ['kemenkeu_fiscal', 'deficit_ceiling'],
    ['esdm_bbm', 'bbm_hike'],
    ['kemenkeu_mbg', 'policy_commitment'],
  ];
  for (const [inst, type] of pairs) {
    const r = await computeCredibilityPrior(inst, type, 730);
    if (r) {
      console.log(`  ${inst}:${type} → P(credible)=${(r.priorProbability * 100).toFixed(0)}% (n=${r.sampleSize})`);
    } else {
      console.log(`  ${inst}:${type} → <3 records (use hard-coded prior)`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
