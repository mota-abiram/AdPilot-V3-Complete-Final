/**
 * normalizeMetaAnalysis
 *
 * Maps field names from the Python meta_ads_agent_v2.py output to the
 * canonical shape the dashboard (dashboard.tsx) expects, and recomputes
 * the account health score from the cadence-window data so switching
 * cadences (1D / 2×wk / Wkly / Bi-wk / Mo) reflects the actual window.
 */

import { getClassification } from "../shared/classification";
import {
  scoreStagedCostDynamic,
  scoreStagedBudgetDynamic,
  getMetricWeights,
  computeMinRatio,
  computeDualGateStatus,
} from "./scoring-config";

function normalizeScore(scores: Record<string, number>, weights: Record<string, number>): number {
  let total = 0;
  for (const k in scores) {
    total += (scores[k] * (weights[k] || 0)) / 100;
  }
  return Math.round(Math.max(0, Math.min(100, total)) * 10) / 10;
}

/**
 * Recomputes account_health_score and account_health_breakdown from
 * the cadence-window account_pulse metrics using Mojo AdCortex v2.0 formulas.
 *
 * Weights (Mojo AdCortex Meta):
 *   CPSV 25% · Budget 25% · CPQL 20% · CPL 20% · Creative 10%
 *
 * Formulas:
 *   - Cost metrics (CPSV, CPL, CPQL): Quadratic decay with acceleration
 *   - Budget: Quadratic penalty for both overspend and underspend
 *   - Creative: Spend-weighted average with diversity factor
 *
 * Status determination: Dual-gate system
 *   - Composite gate: Total score threshold (GREEN ≥75, YELLOW ≥55, ORANGE ≥35, RED <35)
 *   - Veto gate: Weakest-link ratio (min(score/weight)), prevents weak metrics from hiding
 *   - Final status = WORSE of the two gates
 */
function recomputeHealthScore(data: any): {
  score: number;
  breakdown: Record<string, number>;
  classification: string;
} {
  const ap = data.account_pulse || {};
  const mp = data.monthly_pacing || {};
  const benchmarks = data.sop_benchmarks || data.dynamic_thresholds || data.sop_benchmarks_fallback || {};

  const weights = getMetricWeights("meta");

  // MTD deliverables (manually entered SVS, qualified leads)
  const mtdDeliverables = data.mtd_deliverables || {};

  // ── MTD-only actuals (never fall back to 30-day rolling data) ──────
  // Source priority: monthly_pacing.mtd (agent MTD) → mtd_pacing (alt field)
  const actualSpendMtd = mp.mtd?.spend ?? ap.mtd_pacing?.spend_mtd ?? 0;
  const actualLeadsMtd = mp.mtd?.leads ?? ap.mtd_pacing?.leads_mtd ?? 0;
  // Qualified leads from MTD deliverables (manually entered) — not in API
  const actualQLeadsMtd = mtdDeliverables.positive_leads_achieved ?? mp.mtd?.qualified_leads ?? 0;
  // SVS from MTD deliverables (manually entered) — not in API
  const actualSvsMtd = mtdDeliverables.svs_achieved ?? mp.mtd?.svs ?? 0;

  const existingBreakdown = data.account_health_breakdown || {};

  // ─── CPL Score (Lower is better) ───
  // benchmarks.cpl = "CPL Target" field in Benchmarks tab
  const cplTarget = benchmarks.cpl || 800;
  const actualCplMtd = actualLeadsMtd > 0 ? actualSpendMtd / actualLeadsMtd : 0;
  const cplScore = actualLeadsMtd > 0
    ? scoreStagedCostDynamic(actualCplMtd, cplTarget)
    : 50;

  // ─── Budget/Pacing Score (Custom formula: Staged) ───
  // Pacing deviation from 100%: perfect = 100%, penalize overspend/underspend
  const pacingPct = mp.pacing?.spend_pct ?? 100;
  const budgetScore = scoreStagedBudgetDynamic(pacingPct);

  // ─── CPQL Score (Lower is better: Staged) ───
  // benchmarks.cpql_target = "CPQL Target" field in Benchmarks tab
  const cpqlTarget = benchmarks.cpql_target || 1500;
  const actualCpqlMtd = actualQLeadsMtd > 0 ? actualSpendMtd / actualQLeadsMtd : 0;
  const cpqlScore = actualQLeadsMtd > 0
    ? scoreStagedCostDynamic(actualCpqlMtd, cpqlTarget)
    : 50; // Neutral when no qualified leads entered

  // ─── CPSV Score (Lower is better: Staged) ───
  // benchmarks.cpsv_low = "CPSV Target Low" field in Benchmarks tab
  // actualSvsMtd from MTD deliverables (svs_achieved — manually entered)
  const cpsvTarget = benchmarks.cpsv_low || 0;
  const actualCpsvMtd = actualSvsMtd > 0 ? actualSpendMtd / actualSvsMtd : 0;
  const cpsvScore = (actualSvsMtd > 0 && cpsvTarget > 0)
    ? scoreStagedCostDynamic(actualCpsvMtd, cpsvTarget)
    : 50; // Neutral when no SVS data entered

  // ─── Creative Score (Spend-weighted average + diversity factor) ───
  // Formula: score = (H_avg / 100) × D where
  //   H_avg = Σ(health_i × spend_i) / Σ(spend_i)  [spend-weighted average]
  //   D = min(1.0, active_count / 4)               [diversity penalty]
  const creativeHealth: any[] = data.creative_health || [];

  let creativeScore = existingBreakdown.creative ?? 50; // Start with existing or neutral

  // Only recompute if we have creative_health data
  if (creativeHealth.length > 0) {
    // Filter to active creatives with spend > 0
    const activeCreatives = creativeHealth.filter(
      (c: any) => (c.status === "ACTIVE" || !c.status) && (c.spend ?? 0) > 0
    );

    if (activeCreatives.length === 0) {
      // Zero active ads with spend = worst state (forces attention)
      creativeScore = 0;
    } else {
      // Compute spend-weighted average
      const totalSpend = activeCreatives.reduce((s: number, c: any) => s + (c.spend ?? 0), 0);
      const weightedSum = activeCreatives.reduce(
        (s: number, c: any) => s + (c.creative_score ?? c.performance_score ?? 0) * (c.spend ?? 0),
        0
      );
      const hAvg = totalSpend > 0 ? weightedSum / totalSpend : 0;

      // Apply diversity factor: min(1.0, count / 4)
      const diversity = Math.min(1.0, activeCreatives.length / 4);
      creativeScore = hAvg * diversity;

      // Clamp to 0-100
      creativeScore = Math.max(0, Math.min(100, creativeScore));
    }
  }

  // ─── Build Breakdown (raw 0-100 scores) ───
  const breakdown = {
    cpsv: Math.round(cpsvScore * 100) / 100,
    budget: Math.round(budgetScore * 100) / 100,
    cpql: Math.round(cpqlScore * 100) / 100,
    cpl: Math.round(cplScore * 100) / 100,
    creative: Math.round(creativeScore * 100) / 100,
  };

  // ─── Calculate Composite Score ───
  let compositeScore = normalizeScore(breakdown, weights);

  // ─── Apply Dual-Gate Status Determination ───
  // Compute weakest-link ratio: min(score_i / weight_i) across all 5 metrics
  const minRatio = computeMinRatio(breakdown, weights);

  // Determine status using dual-gate (composite + veto)
  const dualGateStatus = computeDualGateStatus(compositeScore, minRatio);

  // Map dual-gate status to a capped score for classification compatibility
  // This preserves the WINNER/WATCH/UNDERPERFORMER nomenclature
  let finalScore = compositeScore;
  if (dualGateStatus === "YELLOW") {
    // Cap to max of YELLOW range (to prevent showing as GREEN when veto forces YELLOW)
    finalScore = Math.min(compositeScore, 74);
  } else if (dualGateStatus === "ORANGE") {
    // Cap to max of ORANGE range (to prevent showing as YELLOW when veto forces ORANGE)
    finalScore = Math.min(compositeScore, 54);
  } else if (dualGateStatus === "RED") {
    // Cap to max of RED range
    finalScore = Math.min(compositeScore, 34);
  }

  const finalClassification = getClassification(finalScore, cplScore, cplTarget);

  return { score: finalScore, breakdown, classification: finalClassification };
}

function scoreLinearMeta(actual: number, target: number, weight: number, lowerIsBetter: boolean): number {
  if (target <= 0) return weight * 0.5;
  const ratio = actual / target;
  if (lowerIsBetter) {
    // Staged logic for CPL/CPC
    let score100 = 10;
    if (ratio <= 1.1) score100 = 100;
    else if (ratio <= 1.2) score100 = 70;
    else if (ratio <= 1.3) score100 = 40;
    return weight * (score100 / 100);
  } else {
    // Relaxed real-estate floor (0.3 instead of 0.5) for CTR/CVR
    if (actual >= target * 1.2) return weight;
    if (actual <= target * 0.3) return 0;
    const score_ratio = (ratio - 0.3) / (1.2 - 0.3);
    return weight * Math.max(0, Math.min(1, score_ratio));
  }
}

// ── Main normalizer ───────────────────────────────────────────────────────────

export function normalizeMetaAnalysis(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  const data = { ...raw };

  if (Array.isArray(data.campaign_audit)) {
    const weights: Record<string, number> = { cpl: 25, cvr: 15, ctr: 15, leads: 15, freq: 10, cpm: 10, budget: 10 };
    data.campaign_audit = data.campaign_audit.map((campaign: any) => {
      const breakdown = campaign.score_breakdown || {};
      const detailed: any = {};
      
      const ctrTarget = 0.45;
      const cvrTarget = 1.5;
      const cplTarget = data.targets?.cpl || 850;

      for (const k in weights) {
        let score = breakdown[k];
        if (k === 'ctr' && campaign.ctr > 0) {
          score = scoreLinearMeta(campaign.ctr, ctrTarget, 100, false);
        } else if (k === 'cvr' && (campaign.cvr > 0 || (campaign.clicks > 0 && campaign.leads > 0))) {
          const actualCvr = campaign.cvr || (campaign.leads / campaign.clicks) * 100;
          score = scoreLinearMeta(actualCvr, cvrTarget, 100, false);
        } else if (k === 'cpl' && campaign.cpl > 0) {
          score = scoreLinearMeta(campaign.cpl, cplTarget, 100, true);
        } else if (k === 'budget' && campaign.budget_utilization !== undefined) {
          score = scoreStagedBudgetDynamic(campaign.budget_utilization);
        }

        if (score !== undefined) {
          detailed[k] = {
            score: Math.round(score * 10) / 10,
            weight: weights[k],
            contribution: Math.round((score * weights[k] / 100) * 10) / 10
          };
        }
      }
      return {
        ...campaign,
        classification: getClassification(campaign.health_score),
        detailed_breakdown: detailed
      };
    });
  }

  if (Array.isArray(data.adset_analysis)) {
    const weights: Record<string, number> = { cpl: 25, cvr: 15, ctr: 15, leads: 15, freq: 10, cpm: 10, budget: 10 };
    data.adset_analysis = data.adset_analysis.map((adset: any) => {
      const breakdown = adset.score_breakdown || {};
      const detailed: any = {};
      
      // Determine targets (relaxed for Luxury Real Estate / Amara)
      const ctrTarget = 0.45;
      const cvrTarget = 1.5;
      const cplTarget = data.targets?.cpl || 850;

      for (const k in weights) {
        let score = breakdown[k];
        
        // RE-CALCULATE CTR and CVR locally if we suspect they are zeroed out by strict benchmarks
        if (k === 'ctr' && adset.ctr > 0) {
          score = scoreLinearMeta(adset.ctr, ctrTarget, 100, false);
        } else if (k === 'cvr' && (adset.cvr > 0 || (adset.clicks > 0 && adset.leads > 0))) {
          const actualCvr = adset.cvr || (adset.leads / adset.clicks) * 100;
          score = scoreLinearMeta(actualCvr, cvrTarget, 100, false);
        } else if (k === 'cpl' && adset.cpl > 0) {
          score = scoreLinearMeta(adset.cpl, cplTarget, 100, true);
        } else if (k === 'budget' && adset.budget_utilization !== undefined) {
          score = scoreStagedBudgetDynamic(adset.budget_utilization);
        }

        if (score !== undefined) {
          detailed[k] = {
            score: Math.round(score * 10) / 10,
            weight: weights[k],
            contribution: Math.round((score * weights[k] / 100) * 10) / 10
          };
        }
      }

      return {
        ...adset,
        classification: getClassification(adset.health_score),
        detailed_breakdown: detailed // Always use fresh re-computed detailed breakdown
      };
    });
  }

  if (Array.isArray(data.creative_health)) {
    // Creative weights (from scoring_engine.py): hook (25), hold (25), cpl (30), age (10), delivery (10)
    // Actually scoring_engine has: thumb_stop, hold_rate, cpl, age, cpc/delivery
    const weights: Record<string, number> = { thumb_stop_pct: 25, hold_rate_pct: 25, cpl: 30, ctr: 10, delivery: 10 };
    data.creative_health = data.creative_health.map((creative: any) => {
      const breakdown = creative.score_breakdown || {};
      const detailed: any = {};
      
      const ctrTarget = 0.45;
      const cplTarget = data.targets?.cpl || 850;

      for (const k in weights) {
        let score = breakdown[k];
        if (k === 'ctr' && creative.ctr > 0) {
          score = scoreLinearMeta(creative.ctr, ctrTarget, 100, false);
        } else if (k === 'thumb_stop_pct' && creative.thumb_stop_pct > 0) {
          score = scoreLinearMeta(creative.thumb_stop_pct, 25, 100, false);
        } else if (k === 'hold_rate_pct' && creative.hold_rate_pct > 0) {
          score = scoreLinearMeta(creative.hold_rate_pct, 25, 100, false);
        } else if (k === 'cpl' && creative.cpl > 0) {
          score = scoreLinearMeta(creative.cpl, cplTarget, 100, true);
        }

        if (score !== undefined) {
          detailed[k] = {
            score: Math.round(score * 10) / 10,
            weight: weights[k],
            contribution: Math.round((score * weights[k] / 100) * 10) / 10
          };
        }
      }
      return {
        ...creative,
        classification: getClassification(
          creative.health_score ?? creative.creative_score ?? creative.performance_score ?? 0
        ),
        detailed_breakdown: detailed
      };
    });
  }

  // ── 1. Account health score — recompute from cadence-window data ─────
  // The Python agent writes the same score to all cadence files (computed
  // from MTD data). We recompute it here from the per-cadence daily arrays
  // so the score changes when the user switches cadences.
  // Uses Mojo AdCortex v1.0 formulas with override rule for high-weight RED metrics.
  const recomputed = recomputeHealthScore(data);
  data.account_health_score = recomputed.score;
  data.account_health_classification = recomputed.classification;
  data.account_health_breakdown = recomputed.breakdown;

  // ── 2. playbooks_triggered ───────────────────────────────────────────
  // Dashboard reads: data.playbooks_triggered || data.sop_triggers
  // Agent writes:    data.active_playbooks
  if (!data.playbooks_triggered && !data.sop_triggers) {
    data.playbooks_triggered = data.active_playbooks || [];
  }

  // ── 3. auto_pause_candidates ─────────────────────────────────────────
  // Dashboard reads: data.auto_pause_candidates (flat array)
  // Agent writes:    creative_health[].should_pause / adset_analysis[].should_pause
  if (!data.auto_pause_candidates) {
    const candidates: any[] = [];

    (data.creative_health || []).forEach((ad: any) => {
      if (ad.should_pause) {
        candidates.push({
          type: "ad",
          id: ad.ad_id,
          name: ad.ad_name,
          entity: ad.ad_name,
          metric: ad.auto_pause_reasons?.join("; ") || "Low performance",
          rule: "auto_pause",
          spend: ad.spend,
          cpl: ad.cpl,
        });
      }
    });

    (data.adset_analysis || []).forEach((adset: any) => {
      if (adset.should_pause) {
        candidates.push({
          type: "adset",
          id: adset.adset_id,
          name: adset.adset_name,
          entity: adset.adset_name,
          metric: adset.auto_pause_reasons?.join("; ") || "Low performance",
          rule: "auto_pause",
          spend: adset.spend,
          cpl: adset.cpl,
        });
      }
    });

    data.auto_pause_candidates = candidates;
  }

  // ── 4. monthly_pacing.alerts ─────────────────────────────────────────
  // Dashboard reads: mp.alerts — agent doesn't write this into monthly_pacing
  if (data.monthly_pacing && !data.monthly_pacing.alerts) {
    data.monthly_pacing = {
      ...data.monthly_pacing,
      alerts: data.account_pulse?.alerts || [],
    };
  }

  // ── 5. summary counts ────────────────────────────────────────────────
  if (data.summary) {
    data.summary = {
      ...data.summary,
      immediate_actions: data.auto_pause_candidates?.length ?? 0,
      total_fatigue_alerts: data.fatigue_alerts?.length ?? 0,
    };
  }

  // ── 6. Daily leads correction ────────────────────────────────────────
  // The Python agent sometimes writes daily_leads arrays with inflated
  // values (commonly 2x) compared to the authoritative total_leads_30d.
  // Detect and correct this so charts, CPL calculations, and the health
  // score all use consistent numbers.
  if (data.account_pulse) {
    const ap = data.account_pulse;
    const dailyLeads: number[] = ap.daily_leads || [];
    const dailyLeadsSum = dailyLeads.reduce((s: number, v: number) => s + v, 0);
    const reportedTotal = ap.total_leads_30d ?? ap.total_leads ?? 0;

    if (reportedTotal > 0 && dailyLeadsSum > 0 && dailyLeadsSum !== reportedTotal) {
      const ratio = dailyLeadsSum / reportedTotal;
      // Only correct if the ratio is a clean multiplier (1.8x–2.2x, 2.8x–3.2x, etc.)
      // This avoids correcting minor rounding differences
      const roundedRatio = Math.round(ratio);
      if (roundedRatio >= 2 && Math.abs(ratio - roundedRatio) < 0.2) {
        // Scale daily_leads down by the detected multiplier
        data.account_pulse = {
          ...ap,
          daily_leads: dailyLeads.map((v: number) => Math.round(v / roundedRatio)),
          _leads_correction_applied: true,
          _leads_correction_factor: roundedRatio,
        };
      }
    }
  }

  // ── 7. Data verification — embed cross-source comparison ─────────────
  // Compare leads from multiple sources so the dashboard can surface
  // discrepancies: daily_leads (corrected), total_leads_30d,
  // creative_health sum, adset_analysis sum.
  if (!data.data_verification) {
    const ap = data.account_pulse || {};
    const correctedDailyLeads: number[] = ap.daily_leads || [];
    const correctedDailyLeadsSum = correctedDailyLeads.reduce((s: number, v: number) => s + v, 0);
    const reportedTotal = ap.total_leads_30d ?? ap.total_leads ?? 0;
    const dailySpends: number[] = ap.daily_spends || [];
    const totalSpend = dailySpends.reduce((s: number, v: number) => s + v, 0);
    const reportedSpend = ap.total_spend_30d ?? ap.total_spend ?? 0;

    // Sum leads from entity-level arrays
    const creativeLeads = (data.creative_health || [])
      .reduce((s: number, c: any) => s + (c.leads ?? 0), 0);
    const adsetLeads = (data.adset_analysis || [])
      .reduce((s: number, a: any) => s + (a.leads ?? 0), 0);

    // Entity-level leads are the most trustworthy cross-reference
    const entityLeads = Math.max(creativeLeads, adsetLeads);

    // Spend discrepancy
    const spendDiscrepancy = Math.abs(totalSpend - reportedSpend);
    const spendDiscrepancyPct = reportedSpend > 0
      ? (spendDiscrepancy / reportedSpend) * 100
      : 0;

    // Leads discrepancy: compare reported total vs entity-level total
    const leadsDiscrepancy = entityLeads > 0
      ? Math.abs(reportedTotal - entityLeads)
      : 0;
    const leadsDiscrepancyPct = entityLeads > 0
      ? (leadsDiscrepancy / entityLeads) * 100
      : 0;

    const verified = spendDiscrepancyPct < 5 && leadsDiscrepancyPct < 5;

    data.data_verification = {
      verified,
      verified_at: data.generated_at || new Date().toISOString(),
      // Spend verification
      api_spend: reportedSpend,
      daily_spend_sum: Math.round(totalSpend * 100) / 100,
      spend_discrepancy_pct: parseFloat(spendDiscrepancyPct.toFixed(2)),
      // Leads verification
      reported_leads: reportedTotal,
      daily_leads_sum: correctedDailyLeadsSum,
      entity_leads: entityLeads,
      creative_health_leads: creativeLeads,
      adset_analysis_leads: adsetLeads,
      leads_discrepancy: leadsDiscrepancy,
      leads_discrepancy_pct: parseFloat(leadsDiscrepancyPct.toFixed(2)),
      // Daily leads correction tracking
      leads_correction_applied: !!ap._leads_correction_applied,
      leads_correction_factor: ap._leads_correction_factor || 1,
    };
  }

  return data;
}
