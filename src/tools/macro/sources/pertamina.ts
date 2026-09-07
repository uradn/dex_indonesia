/**
 * Domestic fuel prices — Pertamina / Kepmen ESDM
 *
 * REGULATORY BASIS:
 *   Kepmen ESDM No. 245.K/MG.01/MEM.M/2022 — amends Kepmen No. 62.K/12/MEM/2020
 *   "Formula Harga Dasar Dalam Perhitungan Harga Jual Eceran Jenis BBM Umum"
 *   Effective Sep 3, 2022. Pertalite IDR 10,000 — CONFIRMED VALID per June 2026.
 *   Source: https://jdih.esdm.go.id/dokumen/view?id=2307
 *
 * GOVERNMENT COMMITMENT (2026):
 *   Menteri ESDM Bahlil Lahadalia, State Palace, Apr 16 2026:
 *   "harga BBM untuk subsidi tidak akan dinaikkan sampai dengan akhir tahun"
 *   Conditional on ICP staying below $100/bbl (APBN safety threshold).
 *   Source: https://www.esdm.go.id/id/media-center/arsip-berita/menteri-bahlil-harga-bbm-subsidi-tak-naik-hingga-akhir-tahun
 *
 * GEOPOLITICAL CONTEXT (2026):
 *   Strait of Hormuz partially blocked since ~Feb 28 2026 (Iran-US conflict).
 *   Brent spiked to $120+/bbl in Mar 2026, ICP avg ~$77/bbl YTD as of Apr 2026.
 *   Margin to $100 safety threshold: ~$23/bbl — narrowing with each Hormuz escalation.
 *   Source: https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis
 *
 * EMERGENCY OVERRIDE (for rapid response to hike announcement):
 *   Set env vars — no redeployment needed:
 *     PERTALITE_PRICE_IDR=10000        (override subsidized Pertalite price)
 *     SOLAR_PRICE_IDR=6800             (override subsidized Solar price)
 *     PERTAMAX_PRICE_IDR=15950         (override Pertamax RON 92 — rollback 1 Agu 2026)
 *     PERTAMAX_GREEN_PRICE_IDR=19150   (override Pertamax Green RON 95 — hike +Rp2,550 efektif 2 Sep 2026)
 *     SOLAR_BLEND_RATIO=0.50           (override B-blend; 0.40=B40 default, 0.50=B50 Jul 2026 mandate)
 *
 * COST RECOVERY FORMULA:
 *   cost_recovery = (Brent_USD / 158.987 L/bbl) × USDIDR × 1.40
 *   Factor 1.40: crude 100% + refining 20% + distribution 10% + margin+tax 10%
 *   At APBN baseline ($70/bbl, IDR 16,500): cost recovery ≈ IDR 10,200/liter
 *
 * ICP THRESHOLD WATCH:
 *   < $80/bbl   → GREEN  (comfortable margin to commitment)
 *   $80–90/bbl  → YELLOW (Hormuz risk zone — monitor closely)
 *   $90–100/bbl → ORANGE (approaching government commitment threshold)
 *   > $100/bbl  → RED    (APBN commitment breaking point — hike imminent)
 *
 * SUBSIDY GAP WATCH (cost recovery − Pertalite pump price):
 *   < IDR 2,000/liter → GREEN  (manageable)
 *   IDR 2,000–4,000   → YELLOW (burden building)
 *   IDR 4,000–7,000   → ORANGE (hike pressure HIGH — analogous to mid-2022)
 *   > IDR 7,000       → RED    (politically untenable, hike imminent)
 */

import type { MacroDataPoint, AlertLevel } from '../types.js';

const LITERS_PER_BARREL = 158.987;
const COST_RECOVERY_FACTOR = 1.40;

export const APBN_ICP_ASSUMPTION    = 70;   // USD/bbl — UU No. 17 Tahun 2025
export const ICP_SAFETY_THRESHOLD   = 100;  // USD/bbl — Bahlil commitment ceiling, Apr 2026
export const HORMUZ_WATCH_THRESHOLD = 90;   // USD/bbl — Hormuz escalation risk zone

function envPrice(key: string, fallback: number): number {
  const val = parseInt(process.env[key] ?? '', 10);
  return isNaN(val) || val <= 0 ? fallback : val;
}

// Prices as of Sep 2026 — update via env vars for instant response to hike
export const DOMESTIC_FUEL_PRICES = {
  pertalite_price_idr_liter:       envPrice('PERTALITE_PRICE_IDR',       10_000), // RON 90, subsidized — unchanged
  solar_price_idr_liter:           envPrice('SOLAR_PRICE_IDR',             6_800), // Biosolar B40, subsidized — unchanged
  pertamax_price_idr_liter:        envPrice('PERTAMAX_PRICE_IDR',         15_950), // RON 92 — rollback 1 Agu 2026 dari Rp16,250
  pertamax_green_price_idr_liter:  envPrice('PERTAMAX_GREEN_PRICE_IDR',   19_150), // RON 95 — hike +Rp2,550 efektif 2 Sep 2026
} as const;

export function computeCostRecovery(brentUsd: number, usdIdr: number): number {
  return Math.round((brentUsd / LITERS_PER_BARREL) * usdIdr * COST_RECOVERY_FACTOR);
}

// Solar Biosolar cost recovery — blended MOPS Gasoil + FAME (CPO-based biodiesel).
//
// REGULATORY BASIS:
//   Perpres 191/2014 jo. Perpres 43/2018: Solar = BBM Jenis Tertentu (subsidized), Rp6.800/L.
//   B40 mandate: efektif 2025 (40% FAME / 60% MOPS Gasoil).
//   B50 mandate: Jul 1 2026 (50% FAME / 50% MOPS) per Permen ESDM; industry de-facto B45.
//   Set SOLAR_BLEND_RATIO=0.50 di .env saat B50 terkonfirmasi penuh.
//
// COST COMPONENTS:
//   MOPS Gasoil Singapore ≈ Brent + $10/bbl (diesel crack spread; wider under Hormuz).
//   FAME (biodiesel dari CPO): 1 MT CPO → ~1,143 liter FAME (yield 100% by mass, density 0.875 kg/L)
//     + $50/bbl processing (transesterifikasi + additif).
//     Pada CPO $1,117/MT: FAME ≈ $205/bbl — jauh lebih mahal dari MOPS $106/bbl.
//   Factor 1.35: kilang/blending 20% + distribusi 10% + margin+pajak 5%.
//
// IMPLICATION: B50 MENAIKKAN cost recovery Solar, bukan menurunkan.
//   B40 (0.4×FAME + 0.6×MOPS): ~$149/bbl blended → CR ~Rp14,700/L
//   B50 (0.5×FAME + 0.5×MOPS): ~$155/bbl blended → CR ~Rp15,300/L
//   vs Solar pump price Rp6.800/L → gap makin lebar saat blending naik.

export const MOPS_GASOIL_CRACK_SPREAD_USD = 10;
// MOPS Gasoil dan FAME sudah refined/processed — factor lebih rendah dari bensin (1.40).
// 1.15 = distribusi 10% + margin+pajak 5% (tidak ada refinery 20% karena sudah di-proses).
const SOLAR_COST_FACTOR = 1.15;
const CPO_LITERS_PER_MT = 1120;       // FAME yield: 1 MT CPO → ~1,120 L (density 0.875 kg/L, yield 98%)
const FAME_PROCESSING_USD_BBL = 50;    // transesterifikasi + additives (blending plant cost)

export function computeSolarCostRecovery(
  brentUsd: number,
  usdIdr: number,
  blendRatio: number = 0.40,           // 0.40=B40, 0.50=B50; from SOLAR_BLEND_RATIO env
  cpoPriceUsdMt: number | null = null, // from DB cpo_price_myr (stored as USD/MT)
): number {
  const mopsUsd = brentUsd + MOPS_GASOIL_CRACK_SPREAD_USD;
  // FAME cost in $/bbl — use CPO price if available, else conservative proxy
  const fameUsd = cpoPriceUsdMt !== null
    ? (cpoPriceUsdMt / CPO_LITERS_PER_MT) * LITERS_PER_BARREL + FAME_PROCESSING_USD_BBL
    : mopsUsd * 1.80;  // fallback: FAME ≈ 1.8× MOPS (empiris ratio saat CPO unavailable)
  const blendedUsd = blendRatio * fameUsd + (1 - blendRatio) * mopsUsd;
  return Math.round((blendedUsd / LITERS_PER_BARREL) * usdIdr * SOLAR_COST_FACTOR);
}

export function bbmHikeAlert(gapIdr: number): AlertLevel {
  if (gapIdr > 7_000) return 'red';
  if (gapIdr > 4_000) return 'orange';
  if (gapIdr > 2_000) return 'yellow';
  return 'green';
}

export function icpHikeAlert(icpUsd: number): AlertLevel {
  if (icpUsd > ICP_SAFETY_THRESHOLD)   return 'red';
  if (icpUsd > HORMUZ_WATCH_THRESHOLD) return 'orange';
  if (icpUsd > 80)                     return 'yellow';
  return 'green';
}

export function getFuelPricePoints(): MacroDataPoint[] {
  const date      = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const source = [
    process.env.PERTALITE_PRICE_IDR ? 'env_override' : null,
    'kepmen_esdm_245_2022',
  ].filter(Boolean).join('+');

  const pertaminaSource = 'pertamina_jun10_2026';
  return [
    { indicator: 'pertalite_price_idr_liter',      category: 'pangan', date, value: DOMESTIC_FUEL_PRICES.pertalite_price_idr_liter,      unit: 'IDR/liter', source, fetchedAt },
    { indicator: 'solar_price_idr_liter',           category: 'pangan', date, value: DOMESTIC_FUEL_PRICES.solar_price_idr_liter,           unit: 'IDR/liter', source, fetchedAt },
    { indicator: 'pertamax_price_idr_liter',        category: 'pangan', date, value: DOMESTIC_FUEL_PRICES.pertamax_price_idr_liter,        unit: 'IDR/liter', source: pertaminaSource, fetchedAt },
    { indicator: 'pertamax_green_price_idr_liter',  category: 'pangan', date, value: DOMESTIC_FUEL_PRICES.pertamax_green_price_idr_liter,  unit: 'IDR/liter', source: pertaminaSource, fetchedAt },
  ];
}
