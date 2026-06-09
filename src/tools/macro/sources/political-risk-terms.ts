/**
 * Shared keyword lists for Module 12 political risk scoring.
 * Used by both Exa news sentiment and X social feed sources.
 */

export const NEGATIVE_TERMS = [
  'protes', 'demo', 'unjuk rasa', 'phk', 'naik', 'mahal', 'krisis', 'darurat',
  'kelangkaan', 'tuntut', 'kekacauan', 'risiko', 'berisiko', 'gejolak', 'otoriter',
  'mogok', 'aksi massa', 'ancaman', 'gagal', 'tidak terjangkau', 'tak terjangkau',
  'kerusuhan', 'rusuh', 'bakar', 'anarkis',
  'protest', 'unrest', 'crisis', 'chaotic', 'authoritarian', 'volatile', 'layoff',
  'strike', 'surge', 'soaring', 'unstable', 'risk', 'threat', 'concern',
  'riot', 'violence', 'clash',
];

export const POSITIVE_TERMS = [
  'stabil', 'terkendali', 'turun', 'normal', 'aman', 'terjangkau', 'surplus',
  'stable', 'controlled', 'decrease', 'recovery', 'growth', 'improved',
];

// Count 2× — structural / international attention signals
export const HIGH_SEVERITY_TERMS = [
  'economist', 'internasional', 'otoriter', 'authoritarian', 'chaos', 'kekacauan',
  'darurat', 'emergency', 'krisis politik', 'political crisis', 'perbatasan krisis',
  'berisiko', 'jalur berisiko', 'gejolak mata uang',
  'rusuh', 'kerusuhan', 'riot', 'bakar', 'anarkis', 'anarchy',
];
