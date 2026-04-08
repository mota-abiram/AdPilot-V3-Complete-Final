/**
 * Shared Scoring Engine
 * Standardizes categorization across Campaigns, Adsets, and Ads.
 */

export type Classification = "WINNER" | "WATCH" | "UNDERPERFORMER";

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
 * Classification based on standardized score bands
 */
export function getClassification(score: number): Classification {
  if (score >= 70) return "WINNER";
  if (score >= 35) return "WATCH";
  return "UNDERPERFORMER";
}

/**
 * Calculate Performance Score (weighted average of core metrics)
 * CPL (35%) · CPM (20%) · CTR (15%) · CVR (15%) · Frequency (15%)
 */
export function calculatePerformanceScore(metrics: {
  cpl: number;
  cpm: number;
  ctr: number;
  cvr: number;
  frequency: number;
}, targets: {
  cpl: number;
  cpm: number;
  ctr: number;
  cvr: number;
  frequency: number;
}): { score: number; breakdown: Record<string, number> } {
  const weights = {
    cpl: 35,
    cpm: 20,
    ctr: 15,
    cvr: 15,
    frequency: 15
  };

  const scores = {
    cpl: scoreLinear(metrics.cpl, targets.cpl, 100, true),
    cpm: scoreLinear(metrics.cpm, targets.cpm, 100, true),
    ctr: scoreLinear(metrics.ctr, targets.ctr, 100, false),
    cvr: scoreLinear(metrics.cvr, targets.cvr, 100, false),
    frequency: scoreLinear(metrics.frequency, targets.frequency, 100, true)
  };

  let totalWeighted = 0;
  totalWeighted += (scores.cpl * weights.cpl) / 100;
  totalWeighted += (scores.cpm * weights.cpm) / 100;
  totalWeighted += (scores.ctr * weights.ctr) / 100;
  totalWeighted += (scores.cvr * weights.cvr) / 100;
  totalWeighted += (scores.frequency * weights.frequency) / 100;

  return {
    score: Math.round(totalWeighted * 10) / 10,
    breakdown: scores
  };
}

/**
 * Calculate Final Ad Score (weighted performance + age)
 * Perf (60%) + Age (40%)
 */
export function calculateFinalAdScore(
  performanceScore: number,
  ageDays: number,
  isPerformingWellThreshold: number = 70
): number {
  // Age Score: 0-100 (lower is better for age, so we invert)
  // Logic: <30d = 100, >45d = 0
  let ageScore = 100;
  if (ageDays > 45) ageScore = 0;
  else if (ageDays > 30) {
    ageScore = scoreLinear(ageDays, 30, 100, true);
  }

  // Override: if performance is excellent, dampen age penalty
  if (performanceScore >= isPerformingWellThreshold) {
    return Math.round((performanceScore * 0.8 + ageScore * 0.2) * 10) / 10;
  }

  return Math.round((performanceScore * 0.6 + ageScore * 0.4) * 10) / 10;
}
