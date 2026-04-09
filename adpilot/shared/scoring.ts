import { Classification, getClassification } from "./classification";

/**
 * Shared Scoring Engine
 * Standardizes categorization based on Mojo spec.
 */

/**
 * Linear score mapping (0-100)
 */
export function scoreLinear(actual: number, target: number, weight: number, lowerIsBetter: boolean): number {
  if (target <= 0) return weight * 0.5;
  if (lowerIsBetter) {
    if (actual <= target * 0.8) return weight;
    if (actual >= target * 1.5) return 0;
    const ratio = actual / target;
    return Math.round(weight * Math.max(0, Math.min(1, (1.5 - ratio) / (1.5 - 0.8))) * 100) / 100;
  } else {
    if (actual >= target * 1.2) return weight;
    if (actual <= target * 0.5) return 0;
    const ratio = actual / target;
    return Math.round(weight * Math.max(0, Math.min(1, (ratio - 0.5) / (1.2 - 0.5))) * 100) / 100;
  }
}

/**
 * Google Impression Share Scorer
 */
export function scoreImpressionShare(actualIS: number, targetIS: number): number {
  if (targetIS <= 0) return 50;
  const ratio = actualIS / targetIS;
  if (ratio >= 1.0) return 100;
  if (ratio >= 0.7) return 75 + ((ratio - 0.7) / (1.0 - 0.7)) * 25;
  if (ratio >= 0.5) return 40 + ((ratio - 0.5) / (0.7 - 0.5)) * 35;
  return Math.max(10, 10 + (ratio / 0.5) * 30);
}

/**
 * Search Campaign Health Weights:
 * CPL vs target → 30
 * CVR → 22
 * CPC vs target → 15
 * QS avg → 13
 * CTR → 10
 * IS → 5
 * RSA → 5
 */
export function calculateSearchCampaignHealth(data: {
  cpl: number;
  cvr: number;
  cpc: number;
  qs_avg: number;
  ctr: number;
  is: number;
  rsa_count: number;
}, targets: {
  cpl: number;
  cpc: number;
  is_target: number;
}): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targets.cpl, 30, true),
    cvr: scoreLinear(data.cvr, 5.0, 22, false),
    cpc: scoreLinear(data.cpc, targets.cpc, 15, true),
    qs: (data.qs_avg / 10) * 13,
    ctr: scoreLinear(data.ctr, 2.0, 10, false),
    is: (scoreImpressionShare(data.is, targets.is_target) / 100) * 5,
    rsa: Math.min(1, data.rsa_count / 3) * 5
  };

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Demand Gen Campaign Weights:
 * CPL 30, CPM 20, CVR 15, CTR 15, TSR 10, Frequency 10
 */
export function calculateDGHealth(data: {
  cpl: number;
  cpm: number;
  cvr: number;
  ctr: number;
  tsr: number;
  frequency: number;
}, targetCpl: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 30, true),
    cpm: scoreLinear(data.cpm, 120, 20, true),
    cvr: scoreLinear(data.cvr, 3.0, 15, false),
    ctr: scoreLinear(data.ctr, 0.8, 15, false),
    tsr: scoreLinear(data.tsr, 3.5, 10, false),
    frequency: scoreLinear(data.frequency, 4.0, 10, true)
  };

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Search Ad Group Health Weights:
 * CPL 30, CVR 25, CTR 15, QS 15, IS 10, CPC 5
 */
export function calculateSearchAdGroupHealth(data: {
  cpl: number;
  cvr: number;
  ctr: number;
  qs_avg: number;
  is: number;
  cpc: number;
}, targets: {
  cpl: number;
  cpc: number;
  is_target: number;
}): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targets.cpl, 30, true),
    cvr: scoreLinear(data.cvr, 5.0, 25, false),
    ctr: scoreLinear(data.ctr, 2.0, 15, false),
    qs: (data.qs_avg / 10) * 15,
    is: (scoreImpressionShare(data.is, targets.is_target) / 100) * 10,
    cpc: scoreLinear(data.cpc, targets.cpc, 5, true)
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Search Ad Health Weights:
 * CPL 35, CTR 25, CVR 20, Ad Strength 10, Expected CTR 10
 */
export function calculateSearchAdHealth(data: {
  cpl: number;
  ctr: number;
  cvr: number;
  adStrengthScore: number; // 0 to 10
  expectedCtrScore: number; // 0 to 10
}, targetCpl: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 35, true),
    ctr: scoreLinear(data.ctr, 2.0, 25, false),
    cvr: scoreLinear(data.cvr, 5.0, 20, false),
    adStrength: data.adStrengthScore,
    expectedCtr: data.expectedCtrScore,
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Demand Gen Ad (Video) Health Weights:
 * CPL 35, CPM 20, CTR 15, TSR 15, VHR 15
 */
export function calculateDGVideoAdHealth(data: {
  cpl: number;
  cpm: number;
  ctr: number;
  tsr: number;
  vhr: number;
}, targetCpl: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 35, true),
    cpm: scoreLinear(data.cpm, 120, 20, true),
    ctr: scoreLinear(data.ctr, 0.8, 15, false),
    tsr: scoreLinear(data.tsr, 3.5, 15, false),
    vhr: scoreLinear(data.vhr, 1.0, 15, false), // Example target VHR
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}

/**
 * Demand Gen Ad (Static) Health Weights:
 * CPL 45, CPM 25, CTR 20, CPC 10
 */
export function calculateDGStaticAdHealth(data: {
  cpl: number;
  cpm: number;
  ctr: number;
  cpc: number;
}, targetCpl: number, targetCpc: number): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    cpl: scoreLinear(data.cpl, targetCpl, 45, true),
    cpm: scoreLinear(data.cpm, 120, 25, true),
    ctr: scoreLinear(data.ctr, 0.8, 20, false),
    cpc: scoreLinear(data.cpc, targetCpc, 10, true), 
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(total * 10) / 10, breakdown };
}
