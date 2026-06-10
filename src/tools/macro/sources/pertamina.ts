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
 *     PERTAMAX_PRICE_IDR=16250         (override Pertamax RON 92 — +Rp3,950 Jun 10 2026)
 *     PERTAMAX_GREEN_PRICE_IDR=17000   (override Pertamax Green RON 95 — +Rp4,100 Jun 10 2026)
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

// Prices as of June 10, 2026 — update via env vars for instant response to hike
export const DOMESTIC_FUEL_PRICES = {
  pertalite_price_idr_liter:       envPrice('PERTALITE_PRICE_IDR',       10_000), // RON 90, subsidized, Kepmen 245/2022 — unchanged
  solar_price_idr_liter:           envPrice('SOLAR_PRICE_IDR',             6_800), // Biosolar B40, subsidized — unchanged
  pertamax_price_idr_liter:        envPrice('PERTAMAX_PRICE_IDR',         16_250), // RON 92, non-subsidized, +Rp3,950 Jun 10 2026
  pertamax_green_price_idr_liter:  envPrice('PERTAMAX_GREEN_PRICE_IDR',   17_000), // RON 95, non-subsidized, +Rp4,100 Jun 10 2026
} as const;

export function computeCostRecovery(brentUsd: number, usdIdr: number): number {
  return Math.round((brentUsd / LITERS_PER_BARREL) * usdIdr * COST_RECOVERY_FACTOR);
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
