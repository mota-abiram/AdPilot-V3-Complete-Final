export type Classification = "WINNER" | "WATCH" | "UNDERPERFORMER";

/**
 * Mojo AdCortex Classification Logic
 * WINNER: Health ≥ 75, CPL ≤ target
 * WATCH: Health 50–74
 * UNDERPERFORMER: Health < 50 OR CPL > 1.3× target
 */
export function getClassification(
  healthScore: number, 
  cpl?: number | null, 
  targetCpl?: number
): Classification {
  if (healthScore >= 75 && (targetCpl === undefined || cpl === undefined || cpl === null || cpl <= targetCpl)) {
    return "WINNER";
  }
  
  if (healthScore < 50 || (targetCpl !== undefined && targetCpl > 0 && cpl !== undefined && cpl !== null && cpl > targetCpl * 1.3)) {
    return "UNDERPERFORMER";
  }
  
  return "WATCH";
}
