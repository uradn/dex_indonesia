#!/usr/bin/env bun
/**
 * One-shot refresh for the 3 indicators that drift stale between morning runs:
 *   srbi_bid_cover_ratio    (SRBI auction, Exa search)
 *   idx_advance_decline_ratio (IDX breadth, Yahoo / IDX scrape)
 *   pln_coal_secured_pct    (PLN coal DMO, Exa search)
 *
 * Run manually when health-check reports any of these as stale.
 */

import { fetchSrbiAuction } from '../src/tools/macro/sources/srbi-auction.js';
import { fetchIdxAdvanceDecline } from '../src/tools/macro/sources/ihsg.js';
import { fetchCoalDmoStatus } from '../src/tools/macro/sources/coal-dmo.js';
import { upsertPoints } from '../src/tools/macro/time-series-db.js';

const pad = (s: string) => s.padEnd(34);

async function run() {
  console.log('Refreshing 3 stale indicators...\n');

  const results = await Promise.allSettled([
    fetchSrbiAuction(),
    fetchIdxAdvanceDecline(),
    fetchCoalDmoStatus(),
  ]);

  // --- SRBI ---
  const srbi = results[0];
  if (srbi.status === 'fulfilled' && srbi.value) {
    console.log(`✅ ${pad('srbi_bid_cover_ratio')} ${srbi.value.bidCoverRatio?.toFixed(2) ?? '—'} (${srbi.value.date})`);
  } else {
    console.log(`❌ ${pad('srbi_bid_cover_ratio')} fetch failed — ${srbi.status === 'rejected' ? srbi.reason : 'no data'}`);
  }

  // --- A/D ratio — fetchIdxAdvanceDecline returns DataPoint, must upsert manually ---
  const ad = results[1];
  if (ad.status === 'fulfilled' && ad.value) {
    await upsertPoints([ad.value]);
    console.log(`✅ ${pad('idx_advance_decline_ratio')} ${ad.value.value.toFixed(3)} (${ad.value.date})`);
  } else {
    console.log(`❌ ${pad('idx_advance_decline_ratio')} fetch failed — ${ad.status === 'rejected' ? ad.reason : 'no data'}`);
  }

  // --- PLN coal ---
  const coal = results[2];
  if (coal.status === 'fulfilled' && coal.value) {
    console.log(`✅ ${pad('pln_coal_secured_pct')} ${coal.value.plnSecuredPct?.toFixed(1) ?? '—'}% (${coal.value.date})`);
    console.log(`   hba_price_usd_ton              $${coal.value.hbaUsdTon?.toFixed(1) ?? '—'}/ton`);
    console.log(`   coal_dmo_compliance_pct        ${coal.value.dmoCompliancePct?.toFixed(1) ?? '—'}%`);
  } else {
    console.log(`❌ ${pad('pln_coal_secured_pct')} fetch failed — ${coal.status === 'rejected' ? coal.reason : 'no data'}`);
  }

  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
