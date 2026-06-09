/**
 * Domestic fuel prices — Pertamina / Kepmen ESDM
 *
 * Subsidized prices (Pertalite, Solar) fixed by government decree.
 * Change only via Kepmen ESDM announcement — not scraped, hardcoded.
 * Last update: Pertalite IDR 10,000 since Sep 2022 (Kepmen ESDM 245.K/MG.01/MEM.M/2022).
 *
 * Cost recovery = (Brent_USD / 158.987 liters/bbl) × USDIDR × 1.40
 * Factor 1.40: crude 100% + refining 20% + distribution 10% + margin+tax 10%
 *
 * Gap interpretation:
 *   < IDR 2,000/liter → GREEN  (manageable, no hike pressure)
 *   IDR 2,000–4,000   → YELLOW (subsidi burden building)
 *   IDR 4,000–7,000   → ORANGE (hike pressure HIGH — 2022 analogue)
 *   > IDR 7,000       → RED    (politically untenable, hike imminent)
 */

import type { MacroDataPoint, AlertLevel } from '../types.js';

const LITERS_PER_BARREL = 158.987;
const COST_RECOVERY_FACTOR = 1.40;

// Update when Kepmen ESDM announces new prices
export const DOMESTIC_FUEL_PRICES = {
  pertalite_price_idr_liter: 10_000,  // RON 90, subsidized — unchanged since Sep 2022
  solar_price_idr_liter:      6_800,  // Biosolar B40, subsidized — heavily subsidized for logistics
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

export function getFuelPricePoints(): MacroDataPoint[] {
  const date = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  return Object.entries(DOMESTIC_FUEL_PRICES).map(([indicator, value]) => ({
    indicator,
    category: 'pangan' as const,
    date,
    value,
    unit: 'IDR/liter',
    source: 'kepmen_esdm',
    fetchedAt,
  }));
}
