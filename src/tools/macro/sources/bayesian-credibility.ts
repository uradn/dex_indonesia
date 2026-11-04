/**
 * Bayesian institutional credibility updater for M6 Narrative Divergence.
 *
 * Replaces symmetric Crawford-Sobel keyword counting (40%) with:
 *   - Prior P(credible) derived from announcement_outcomes DB track record
 *   - Likelihood table calibrated on Indonesia 2015–2026 institutional behaviour
 *   - Asymmetric fragile threshold: high-credibility institutions need larger divergence
 *     before a fragile equilibrium call fires
 *
 * Ref: Crawford & Sobel (1982), Vercelli (2009 Minsky open economy extension)
 */
import {
  computeCredibilityPrior,
  type InstitutionType,
  type AnnouncementType,
  type Specificity,
} from '../time-series-db.js';

export interface AnnouncementSignal {
  institution: InstitutionType;
  announcementType: AnnouncementType;
  specificity: Specificity;
  timebound: boolean;
  magnitude: 'small' | 'medium' | 'large';
  rawText: string;
}

export interface CredibilityResult {
  institution: InstitutionType;
  announcementType: AnnouncementType;
  prior: number;
  posterior: number;
  sampleSize: number;
  fragileThreshold: number;
  source: 'db_prior' | 'hard_coded_prior';
  interpretation: string;
}

type LikelihoodKey = `${AnnouncementType}:${Specificity}`;

// P(signal | credible) and P(signal | not credible) — calibrated from Indonesia 2015–2026
// data: BI RDG outcomes, Kemenkeu APBN targets vs realisasi, subsidi hike timelines.
const LIKELIHOOD_TABLE: Record<LikelihoodKey, { pGivenCredible: number; pGivenNotCredible: number }> = {
  'rate_guidance:verifiable':      { pGivenCredible: 0.70, pGivenNotCredible: 0.20 },
  'rate_guidance:specific':        { pGivenCredible: 0.60, pGivenNotCredible: 0.30 },
  'rate_guidance:general':         { pGivenCredible: 0.45, pGivenNotCredible: 0.45 },
  'rate_guidance:vague':           { pGivenCredible: 0.40, pGivenNotCredible: 0.60 },
  'deficit_ceiling:verifiable':    { pGivenCredible: 0.65, pGivenNotCredible: 0.15 },
  'deficit_ceiling:specific':      { pGivenCredible: 0.55, pGivenNotCredible: 0.25 },
  'deficit_ceiling:general':       { pGivenCredible: 0.50, pGivenNotCredible: 0.45 },
  'deficit_ceiling:vague':         { pGivenCredible: 0.35, pGivenNotCredible: 0.65 },
  'subsidi_commitment:verifiable': { pGivenCredible: 0.55, pGivenNotCredible: 0.10 },
  'subsidi_commitment:specific':   { pGivenCredible: 0.50, pGivenNotCredible: 0.20 },
  'subsidi_commitment:general':    { pGivenCredible: 0.40, pGivenNotCredible: 0.50 },
  'subsidi_commitment:vague':      { pGivenCredible: 0.35, pGivenNotCredible: 0.65 },
  'bbm_hike:verifiable':           { pGivenCredible: 0.65, pGivenNotCredible: 0.20 },
  'bbm_hike:specific':             { pGivenCredible: 0.60, pGivenNotCredible: 0.25 },
  'bbm_hike:general':              { pGivenCredible: 0.50, pGivenNotCredible: 0.40 },
  'bbm_hike:vague':                { pGivenCredible: 0.35, pGivenNotCredible: 0.60 },
  'policy_commitment:verifiable':  { pGivenCredible: 0.50, pGivenNotCredible: 0.15 },
  'policy_commitment:specific':    { pGivenCredible: 0.45, pGivenNotCredible: 0.25 },
  'policy_commitment:general':     { pGivenCredible: 0.40, pGivenNotCredible: 0.45 },
  'policy_commitment:vague':       { pGivenCredible: 0.30, pGivenNotCredible: 0.65 },
  'policy_reversal:verifiable':    { pGivenCredible: 0.05, pGivenNotCredible: 0.80 },
  'policy_reversal:specific':      { pGivenCredible: 0.05, pGivenNotCredible: 0.75 },
  'policy_reversal:general':       { pGivenCredible: 0.05, pGivenNotCredible: 0.75 },
  'policy_reversal:vague':         { pGivenCredible: 0.05, pGivenNotCredible: 0.80 },
};

// Hard-coded priors derived from domain knowledge (Indonesia 2015–2026).
// Used when DB has <3 tracked outcomes for the institution+type pair.
const HARD_CODED_PRIORS: Record<string, number> = {
  'bi_monetary:rate_guidance':          0.78,
  'kemenkeu_fiscal:deficit_ceiling':    0.42,
  'kemenkeu_subsidi:subsidi_commitment':0.55,
  'esdm_bbm:bbm_hike':                  0.68,
  'kemenkeu_mbg:policy_commitment':     0.35,
};

/**
 * Bayesian credibility update:
 *   P(credible | signal) = P(signal | credible) × P(credible) / P(signal)
 */
export function bayesianCredibilityUpdate(
  prior: number,
  announcementType: AnnouncementType,
  specificity: Specificity,
): number {
  const key: LikelihoodKey = `${announcementType}:${specificity}`;
  const likelihoods = LIKELIHOOD_TABLE[key];
  if (!likelihoods) return prior;
  const { pGivenCredible: pGC, pGivenNotCredible: pGNC } = likelihoods;
  const pSignal = pGC * prior + pGNC * (1 - prior);
  if (pSignal === 0) return prior;
  return (pGC * prior) / pSignal;
}

/**
 * Asymmetric fragile threshold.
 * High-credibility institution → needs larger divergence before fragile call fires.
 * Linear interpolation: posterior=0.2 → 12% CV threshold; posterior=0.8 → 25% CV threshold.
 */
export function computeFragileThreshold(posteriorCredibility: number): number {
  const p = Math.min(1, Math.max(0, posteriorCredibility));
  return 12 + (25 - 12) * p;
}

/**
 * Compute credibility result for a given announcement signal.
 * Loads prior from DB (lookback 730d), falls back to hard-coded priors.
 */
export async function computeCredibilityResult(
  signal: AnnouncementSignal,
): Promise<CredibilityResult> {
  const dbResult = await computeCredibilityPrior(signal.institution, signal.announcementType, 730);
  const hardKey = `${signal.institution}:${signal.announcementType}`;
  const hardPrior = HARD_CODED_PRIORS[hardKey] ?? 0.50;

  const prior = dbResult?.priorProbability ?? hardPrior;
  const sampleSize = dbResult?.sampleSize ?? 0;
  const source = dbResult ? 'db_prior' : 'hard_coded_prior';

  const posterior = bayesianCredibilityUpdate(prior, signal.announcementType, signal.specificity);
  const fragileThreshold = computeFragileThreshold(posterior);

  const interpretation = interpretCredibility(signal.institution, prior, posterior, sampleSize);

  return { institution: signal.institution, announcementType: signal.announcementType, prior, posterior, sampleSize, fragileThreshold, source, interpretation };
}

function interpretCredibility(
  institution: InstitutionType,
  prior: number,
  posterior: number,
  n: number,
): string {
  const delta = posterior - prior;
  const dir = delta > 0.05 ? '↑' : delta < -0.05 ? '↓' : '→';
  const nStr = n >= 3 ? `n=${n} DB records` : 'hard-coded prior';
  const credLabel = posterior >= 0.70 ? 'HIGH' : posterior >= 0.50 ? 'MEDIUM' : 'LOW';
  return `${institution} ${credLabel} credibility (${(posterior * 100).toFixed(0)}% ${dir}, ${nStr})`;
}

/** Compute M6 credibility bump (replaces rhetoricalNetSignal ±6 with ±12 Bayesian range). */
export function credibilityBump(posterior: number): number {
  if (posterior >= 0.80) return +12;
  if (posterior >= 0.70) return +8;
  if (posterior >= 0.60) return +4;
  if (posterior >= 0.50) return 0;
  if (posterior >= 0.40) return -4;
  if (posterior >= 0.30) return -8;
  return -12;
}
