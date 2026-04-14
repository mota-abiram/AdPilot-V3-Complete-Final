/**
 * normalizeMetaAnalysis
 *
 * Maps field names from the Python meta_ads_agent_v2.py output to the
 * canonical shape the dashboard (dashboard.tsx) expects, and recomputes
 * the account health score from the cadence-window data so switching
 * cadences (1D / 2×wk / Wkly / Bi-wk / Mo) reflects the actual window.
 */

import fs from "fs";
import path from "path";
import { getClassification } from "../shared/classification";
import {
  scoreStagedCostDynamic,
  scoreStagedBudgetDynamic,
  getMetricWeights,
  scoreWeightedCostMetric,
  scoreWeightedBudgetMetric,
  sumMetricScores,
  computeMinRatio,
  computeDualGateStatus,
} from "./scoring-config";

function resolveMetaBenchmarks(data: any): Record<string, any> {
  const base = {
    ...(data.sop_benchmarks_fallback || {}),
    ...(data.dynamic_thresholds || {}),
    ...(data.sop_benchmarks || {}),
  };

  const sourcePath = data.benchmarks_source;
  if (typeof sourcePath === "string" && sourcePath) {
    const candidates = [
      sourcePath,
      sourcePath.replace(/benchmarks\.json$/, "benchmarks_meta.json"),
    ];

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (!fs.existsSync(resolved)) continue;

      try {
        return {
          ...base,
          ...JSON.parse(fs.readFileSync(resolved, "utf-8")),
        };
      } catch {
        // Ignore malformed external benchmark files and fall back to attached data.
      }
    }
  }

  return base;
}

function getCreativeAgeFactor(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0 || ageDays < 30) return 100;
  if (ageDays >= 45) return 0;
  return ((45 - ageDays) / 15) * 100;
}

function scoreWeightedMetaCreativeMetric(creatives: any[], weight: number): number {
  const liveCreatives = (creatives || []).filter(
    (creative: any) =>
      (creative?.status === "ACTIVE" || creative?.status === undefined || creative?.status === null) &&
      (creative?.spend ?? 0) > 0
  );

  if (liveCreatives.length === 0) return 0;

  const totalSpend = liveCreatives.reduce((sum: number, creative: any) => sum + (creative?.spend ?? 0), 0);
  if (totalSpend <= 0) return 0;

  const weightedHealth = liveCreatives.reduce((sum: number, creative: any) => {
    const performance = creative?.performance_score ?? creative?.creative_score ?? creative?.health_score ?? 0;
    const ageDays = creative?.creative_age_days ?? creative?.age_days ?? 0;
    const ageFactor = getCreativeAgeFactor(ageDays);
    const health = performance * 0.6 + ageFactor * 0.4;
    return sum + health * (creative?.spend ?? 0);
  }, 0);

  const hAvg = weightedHealth / totalSpend;
  const diversity = Math.min(1, liveCreatives.length / 4);
  return weight * (hAvg / 100) * diversity;
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
  status: string;
} {
  const ap = data.account_pulse || {};
  const mp = data.monthly_pacing || {};
  const benchmarks = resolveMetaBenchmarks(data);

  const weights = getMetricWeights("meta");

  // MTD deliverables (manually entered SVS, qualified leads)
  const mtdDeliverables = data.mtd_deliverables || {};

  // ── MTD-only actuals (never fall back to 30-day rolling data) ──────
  // Source priority: monthly_pacing.mtd (agent MTD) → mtd_pacing (alt field)
  const actualSpendMtd = mp.mtd?.spend ?? ap.mtd_pacing?.spend_mtd ?? 0;
  const actualLeadsMtd = mp.mtd?.leads ?? ap.mtd_pacing?.leads_mtd ?? 0;
  // Qualified leads from MTD deliverables (manually entered) — not in API
  const actualQLeadsMtd =
    mtdDeliverables.positive_leads_achieved ??
    mtdDeliverables.quality_lead_count ??
    mp.mtd?.qualified_leads ??
    0;
  // SVS from MTD deliverables (manually entered) — not in API
  const actualSvsMtd = mtdDeliverables.svs_achieved ?? mp.mtd?.svs ?? 0;
  // ─── CPL Score (Lower is better) ───
  // benchmarks.cpl = "CPL Target" field in Benchmarks tab
  const cplTarget = benchmarks.cpl || benchmarks.cpl_target || 800;
  const actualCplMtd = actualLeadsMtd > 0 ? actualSpendMtd / actualLeadsMtd : 0;
  const cplScore = scoreWeightedCostMetric(
    actualLeadsMtd > 0 ? actualCplMtd : (actualSpendMtd > 0 ? Number.POSITIVE_INFINITY : 0),
    cplTarget,
    weights.cpl
  );

  // ─── Budget/Pacing Score (MTD spend vs prorated monthly budget) ───
  const now = new Date();
  const derivedDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysInMonth = (mp.days_elapsed ?? 0) + (mp.days_remaining ?? 0) || derivedDaysInMonth;
  const daysElapsed = mp.days_elapsed ?? ap.mtd_pacing?.days_elapsed ?? Math.min(now.getDate(), daysInMonth);
  const monthlyBudget = mp.targets?.budget ?? ap.mtd_pacing?.target_budget ?? data.targets?.budget ?? 0;
  const budgetScore = scoreWeightedBudgetMetric(
    actualSpendMtd,
    monthlyBudget,
    daysElapsed,
    daysInMonth,
    weights.budget
  );

  // ─── CPQL Score (Lower is better: Staged) ───
  // benchmarks.cpql_target = "CPQL Target" field in Benchmarks tab
  const cpqlTarget = benchmarks.cpql_target || benchmarks.cpql || 1500;
  const actualCpqlMtd = actualQLeadsMtd > 0 ? actualSpendMtd / actualQLeadsMtd : 0;
  const cpqlScore = actualQLeadsMtd > 0
    ? scoreWeightedCostMetric(actualCpqlMtd, cpqlTarget, weights.cpql)
    : 10;

  // ─── CPSV Score (Lower is better: Staged) ───
  // benchmarks.cpsv_low = "CPSV Target Low" field in Benchmarks tab
  // actualSvsMtd from MTD deliverables (svs_achieved — manually entered)
  const cpsvTarget = benchmarks.cpsv_low || benchmarks.cpsv_target_low || 0;
  const actualCpsvMtd = actualSvsMtd > 0 ? actualSpendMtd / actualSvsMtd : 0;
  const cpsvScore = scoreWeightedCostMetric(
    actualSvsMtd > 0 ? actualCpsvMtd : (actualSpendMtd > 0 ? Number.POSITIVE_INFINITY : 0),
    cpsvTarget,
    weights.cpsv
  );

  // ─── Creative Score (Spend-weighted average + diversity factor) ───
  const creativeHealth: any[] = data.creative_health || [];
  const creativeScore = scoreWeightedMetaCreativeMetric(creativeHealth, weights.creative);

  // ─── Build Breakdown (weighted metric scores) ───
  const breakdown = {
    cpsv: Math.round(cpsvScore * 100) / 100,
    budget: Math.round(budgetScore * 100) / 100,
    cpql: Math.round(cpqlScore * 100) / 100,
    cpl: Math.round(cplScore * 100) / 100,
    creative: Math.round(creativeScore * 100) / 100,
  };

  // ─── Calculate Composite Score ───
  const compositeScore = Math.round(sumMetricScores(breakdown) * 100) / 100;

  // ─── Apply Dual-Gate Status Determination ───
  // Compute weakest-link ratio: min(score_i / weight_i) across all 5 metrics
  const minRatio = computeMinRatio(breakdown, weights);

  // Determine status using dual-gate (composite + veto)
  const dualGateStatus = computeDualGateStatus(compositeScore, minRatio);
  return { score: compositeScore, breakdown, status: dualGateStatus };
}

function scoreLinearMeta(actual: number, target: number, weight: number, lowerIsBetter: boolean): number {
  if (target <= 0) return weight * 0.5;
  const ratio = actual / target;
  if (lowerIsBetter) {
    // We proxy through the new continuous dynamic logic for cost metrics 
    // which scales 0-100, then we multiply by legacy weight (or we scale down weight).
    // Using the exact quadratic formula imported from scoring-config:
    const score100 = scoreStagedCostDynamic(actual, target);
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
  data.account_health_classification = recomputed.status;
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
