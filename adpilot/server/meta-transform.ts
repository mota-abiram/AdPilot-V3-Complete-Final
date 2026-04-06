/**
 * normalizeMetaAnalysis
 *
 * Maps field names from the Python meta_ads_agent_v2.py output to the
 * canonical shape the dashboard (dashboard.tsx) expects, and recomputes
 * the account health score from the cadence-window data so switching
 * cadences (1D / 2×wk / Wkly / Bi-wk / Mo) reflects the actual window.
 */

// ── Scoring helpers (mirrors scoring_engine.py) ──────────────────────────────

function scoreLinear(actual: number, target: number, weight: number, lowerIsBetter: boolean): number {
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

function normalizeScore(scores: Record<string, number>): number {
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  return Math.round(Math.max(0, Math.min(100, total)) * 10) / 10;
}

/**
 * Recomputes account_health_score and account_health_breakdown from
 * the cadence-window account_pulse metrics.
 *
 * Weights (same as Python scoring_engine.py calculate_meta_health):
 *   CPSV 25 · Budget 25 · CPQL 20 · CPL 20 · Creative 10
 */
function recomputeHealthScore(data: any): { score: number; breakdown: Record<string, number> } {
  const ap = data.account_pulse || {};
  const mp = data.monthly_pacing || {};
  const thresholds = data.dynamic_thresholds || data.sop_benchmarks || {};
  const targets = mp.targets || {};

  // Cadence-window totals (recalculated from daily arrays)
  const dailySpends: number[] = ap.daily_spends || [];
  const dailyLeads: number[] = ap.daily_leads || [];
  const totalSpend = dailySpends.reduce((s: number, v: number) => s + v, 0);
  const totalLeads = dailyLeads.reduce((s: number, v: number) => s + v, 0);
  const windowCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  // CPL target
  const cplTarget = thresholds.cpl_target || targets.cpl || 850;

  // CPL score (weight 20, lower is better)
  const cplScore = scoreLinear(windowCpl, cplTarget, 20, true);

  // Budget pacing score (weight 25): how close spend pacing is to 100%
  const pacingPct = mp.pacing?.spend_pct ?? 100;
  const pacingDev = Math.abs(pacingPct / 100 - 1);
  const budgetScore = Math.round(25 * Math.max(0, 1 - pacingDev * 2) * 100) / 100;

  // CPQL score (weight 20): use existing breakdown if cadence-specific data unavailable
  // (qualified leads aren't in daily arrays, so carry over from existing breakdown)
  const existingBreakdown = data.account_health_breakdown || {};
  const cpqlScore = existingBreakdown.cpql ?? scoreLinear(0, targets.cpql || 1500, 20, true);

  // CPSV score (weight 25): carry from existing (site visits not in daily arrays)
  const cpsvScore = existingBreakdown.cpsv ?? 25 * 0.5;

  // Creative score (weight 10): average of creative_health scores in this cadence window
  const creativeHealth: any[] = data.creative_health || [];
  let creativeScore = existingBreakdown.creative ?? 0;
  if (creativeHealth.length > 0) {
    const validScores = creativeHealth
      .map((c: any) => c.creative_score ?? c.performance_score ?? 0)
      .filter((s: number) => s > 0);
    if (validScores.length > 0) {
      const avgCreative = validScores.reduce((s: number, v: number) => s + v, 0) / validScores.length;
      creativeScore = Math.round(avgCreative * (10 / 100) * 100) / 100;
    }
  }

  const breakdown = {
    cpsv: cpsvScore,
    budget: budgetScore,
    cpql: cpqlScore,
    cpl: cplScore,
    creative: creativeScore,
  };

  return { score: normalizeScore(breakdown), breakdown };
}

// ── Main normalizer ───────────────────────────────────────────────────────────

export function normalizeMetaAnalysis(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  const data = { ...raw };

  // ── 1. Account health score — recompute from cadence-window data ─────
  // The Python agent writes the same score to all cadence files (computed
  // from MTD data). We recompute it here from the per-cadence daily arrays
  // so the score changes when the user switches cadences.
  const recomputed = recomputeHealthScore(data);
  data.account_health_score = recomputed.score;
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
