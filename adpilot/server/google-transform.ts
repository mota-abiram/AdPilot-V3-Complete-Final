/**
 * Google Ads Analysis Data Normalization Layer
 *
 * Transforms raw Python agent JSON output into the canonical AnalysisData
 * shape expected by the frontend. This eliminates ad-hoc fallback chains
 * in every page component.
 */

// ─── Campaign Normalization ─────────────────────────────────────────

import { getClassification, scoreLinear } from "../shared/scoring";

function classifyScore(score: number): string {
  return getClassification(score);
}

function cleanCampaignName(name: string): string {
  // Strip Render/deploy hash suffixes like " #d2r|dt7-dm_branded_..."
  return name.replace(/\s*#[a-z0-9|]+[-–].*$/i, "").trim();
}

function deriveCpc(cost: number, clicks: number): number {
  if (clicks > 0) return Math.round((cost / clicks) * 100) / 100;
  return 0;
}

function deriveCpm(cost: number, impressions: number): number {
  if (impressions > 0) return Math.round((cost / impressions) * 1000 * 100) / 100;
  return 0;
}

function normalizeCampaign(c: any): any {
  const cost = c.cost || 0;
  const clicks = c.clicks || 0;
  const impressions = c.impressions || 0;
  const conversions = c.conversions || 0;

  // Derive CPC/CPM if the API returned 0 (common with auto-bidding strategies)
  const avg_cpc = c.avg_cpc > 0 ? c.avg_cpc : deriveCpc(cost, clicks);
  const avg_cpm = c.avg_cpm > 0 ? c.avg_cpm : deriveCpm(cost, impressions);

  // Map campaign_type to layer for cross-platform compatibility
  const layerMap: Record<string, string> = {
    branded: "Branded",
    location: "Location",
    demand_gen: "Demand Gen",
    demand_gen_lookalike: "DG Lookalike",
    demand_gen_inmarket: "DG InMarket",
    demand_gen_custom: "DG Custom",
    demand_gen_retarget: "DG Retarget",
  };

  const campaignType = c.campaign_type || "unknown";
  const layer = layerMap[campaignType] || campaignType;

  const healthScore = c.health_score ?? c.score ?? 0;
  const classification = c.classification || classifyScore(healthScore);

  // Calculate weighted TSR/VHR from nested ads if applicable
  let campaignTsr = 0;
  let campaignVhr = 0;
  let totalVideoImpressions = 0;

  for (const ag of c.ad_groups || []) {
    for (const ad of ag.ads || []) {
      const adImpressions = ad.impressions || 0;
      const isVideo = ad.ad_type === "VIDEO" || ad.type === "VIDEO" || (ad.video_views || 0) > 0;
      if (isVideo && adImpressions > 0) {
        campaignTsr += (ad.tsr || 0) * adImpressions;
        campaignVhr += (ad.vhr || 0) * adImpressions;
        totalVideoImpressions += adImpressions;
      }
    }
  }

  const finalTsr = totalVideoImpressions > 0 ? campaignTsr / totalVideoImpressions : (c.tsr || 0);
  const finalVhr = totalVideoImpressions > 0 ? campaignVhr / totalVideoImpressions : (c.vhr || 0);

  return {
    // Canonical CampaignAudit fields
    campaign_id: c.id || c.campaign_id || "",
    campaign_name: cleanCampaignName(c.name || c.campaign_name || ""),
    layer,
    objective: c.channel_type || c.objective || "",
    status: c.status || "UNKNOWN",
    health_score: healthScore,
    score_breakdown: c.score_breakdown || c.cost_stack?.statuses || {},
    score_bands: c.score_bands || {},
    classification,

    // Core metrics
    spend: cost,
    impressions,
    clicks,
    ctr: c.ctr || 0,
    cpc: avg_cpc,
    cpm: avg_cpm,
    frequency: c.frequency || 0,
    reach: c.reach || 0,
    leads: conversions,
    cpl: c.cpl || 0,
    cvr: c.cvr || 0,

    // Video metrics
    tsr: finalTsr,
    vhr: finalVhr,

    // Budget
    daily_budget: c.daily_budget || 0,
    budget_remaining: 0,
    budget_utilization_pct: 0,

    // Status flags
    is_lead_campaign: campaignType !== "demand_gen" || conversions > 0,
    is_awareness: false,
    delivery_status: c.status === "ENABLED" ? "active" : "paused",
    learning_status: "",

    // Google-specific fields (preserved for Google pages)
    campaign_type: campaignType,
    channel_type: c.channel_type || "",
    bidding_strategy: c.bidding_strategy || "",
    search_impression_share: c.search_impression_share ?? 0,
    search_budget_lost_is: c.search_budget_lost_is ?? 0,
    search_rank_lost_is: c.search_rank_lost_is ?? 0,
    absolute_top_is: c.absolute_top_is ?? 0,
    top_is: c.top_is ?? 0,
    click_share: c.click_share ?? 0,
    exact_match_is: c.exact_match_is ?? 0,
    all_conversions: c.all_conversions || conversions,
    cost_stack: c.cost_stack || null,
    impression_share_analysis: c.impression_share_analysis || null,
    dg_health: c.dg_health || null,
    benchmark_comparison: c.benchmark_comparison || null,

    // Nested ad groups (kept for pages that still need them)
    ad_group_count: c.ad_group_count || 0,
    ad_groups: c.ad_groups || [],
  };
}

// ─── Ad Group Extraction & Normalization ────────────────────────────

function extractAdGroups(campaigns: any[]): any[] {
  const adGroups: any[] = [];

  for (const campaign of campaigns) {
    const campaignName = cleanCampaignName(campaign.name || campaign.campaign_name || "");
    const campaignType = campaign.campaign_type || "unknown";
    const groups = campaign.ad_groups || [];

    for (const ag of groups) {
      const cost = ag.cost || 0;
      const clicks = ag.clicks || 0;
      const impressions = ag.impressions || 0;
      const conversions = ag.conversions || 0;
      const avg_cpc = ag.avg_cpc > 0 ? ag.avg_cpc : deriveCpc(cost, clicks);
      const healthScore = ag.health_score ?? ag.score ?? 0;

      adGroups.push({
        ad_group_id: ag.id || ag.ad_group_id || "",
        ad_group_name: ag.name || ag.ad_group_name || "",
        campaign_id: ag.campaign_id || campaign.id || "",
        campaign_name: campaignName,
        campaign_type: campaignType,
        status: ag.status || "UNKNOWN",
        health_score: healthScore,
        classification: ag.classification || classifyScore(healthScore),

        // Metrics
        impressions,
        clicks,
        spend: cost,
        ctr: ag.ctr || 0,
        avg_cpc,
        cpc: avg_cpc,
        cpl: ag.cpl || 0,
        cvr: ag.cvr || 0,
        conversions,
        leads: conversions,

        // QS (if available)
        quality_score: ag.quality_score || null,

        // Score details
        score_breakdown: ag.score_breakdown || {},
        score_bands: ag.score_bands || {},
      });
    }
  }

  return adGroups;
}

// ─── Creative Health Extraction ─────────────────────────────────────

function extractCreativeHealth(campaigns: any[], existingCreativeHealth: any[]): any[] {
  // If the agent already populated creative_health, use it
  if (existingCreativeHealth && existingCreativeHealth.length > 0) {
    return existingCreativeHealth;
  }

  // Otherwise extract from nested campaigns → ad_groups → ads
  const creatives: any[] = [];

  for (const campaign of campaigns) {
    const campaignName = cleanCampaignName(campaign.name || "");
    for (const ag of campaign.ad_groups || []) {
      for (const ad of ag.ads || []) {
        const cost = ad.cost || 0;
        const clicks = ad.clicks || 0;
        const impressions = ad.impressions || 0;
        const conversions = ad.conversions || 0;
        const isVideo = ad.ad_type === "VIDEO" || ad.type === "VIDEO" || (ad.video_views || 0) > 0;

        creatives.push({
          ad_id: ad.id || ad.ad_id || "",
          ad_name: ad.name || ad.ad_name || "",
          campaign_name: campaignName,
          adset_name: ag.name || ag.ad_group_name || "",
          ad_group_name: ag.name || ag.ad_group_name || "",

          spend: cost,
          impressions,
          clicks,
          leads: conversions,
          cpl: conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : 0,
          ctr: ad.ctr || (impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0),
          cpc: ad.cpc || ad.avg_cpc || deriveCpc(cost, clicks),
          cpm: ad.cpm || deriveCpm(cost, impressions),
          cvr: ad.cvr || (clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0),
          frequency: ad.frequency || 0,

          is_video: isVideo,
          creative_type: isVideo ? "video" : "static",
          thumb_stop_pct: ad.tsr || 0,
          hold_rate_pct: ad.vhr || 0,
          first_frame_rate: 0,
          video_p25: ad.video_quartile_25 || 0,
          video_p50: ad.video_quartile_50 || 0,
          video_p75: ad.video_quartile_75 || 0,
          video_p100: ad.video_quartile_100 || 0,
          avg_watch_sec: 0,

          creative_age_days: ad.creative_age_days || null,
          health_signals: [],
          creative_score: ad.health_score || ad.performance_score || 0,
          scoring_type: isVideo ? "video" : "static",
          score_breakdown: ad.score_breakdown || {},
          score_bands: {},
          classification: ad.classification || classifyScore(ad.health_score || 0),
          should_pause: ad.should_pause || false,
          auto_pause_reasons: ad.auto_pause_reasons || [],

          // Google-specific
          ad_type: ad.ad_type || ad.type || (isVideo ? "VIDEO" : "RSA"),
          ad_strength: ad.ad_strength || null,
        });
      }
    }
  }

  return creatives;
}

// ─── Monthly Pacing Normalization ───────────────────────────────────

function normalizeMonthlyPacing(accountPulse: any, targets: any): any {
  const mtd = accountPulse?.mtd_pacing;
  if (!mtd) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysElapsed = mtd.days_elapsed || Math.min(now.getDate(), totalDays);
  const daysRemaining = mtd.days_remaining || (totalDays - daysElapsed);
  const pctThrough = Math.round((daysElapsed / totalDays) * 100);

  const targetBudget = mtd.target_budget || targets?.budget || 0;
  const targetLeads = mtd.target_leads || targets?.leads || 0;
  const targetCpl = mtd.target_cpl || targets?.cpl || 0;
  const targetSvs = mtd.target_svs || targets?.svs || 0;

  const spendMtd = mtd.spend_mtd || accountPulse?.total_spend || 0;
  const leadsMtd = mtd.leads_mtd || accountPulse?.total_leads || 0;

  const projectedSpend = mtd.projected_spend || (daysElapsed > 0 ? (spendMtd / daysElapsed) * totalDays : 0);
  const projectedLeads = mtd.projected_leads || (daysElapsed > 0 ? (leadsMtd / daysElapsed) * totalDays : 0);

  const expectedSpend = (targetBudget / totalDays) * daysElapsed;
  const expectedLeads = (targetLeads / totalDays) * daysElapsed;

  const spendPct = mtd.pacing_spend_pct || (expectedSpend > 0 ? Math.round((spendMtd / expectedSpend) * 100) : 0);
  const leadsPct = mtd.pacing_leads_pct || (expectedLeads > 0 ? Math.round((leadsMtd / expectedLeads) * 100) : 0);

  const dailyNeededSpend = daysRemaining > 0 ? Math.round(((targetBudget - spendMtd) / daysRemaining) * 100) / 100 : 0;
  const dailyNeededLeads = daysRemaining > 0 ? Math.round(((targetLeads - leadsMtd) / daysRemaining) * 10) / 10 : 0;

  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    pct_through_month: pctThrough,
    targets: {
      budget: targetBudget,
      leads: targetLeads,
      cpl: targetCpl,
      svs: typeof targetSvs === "object" ? targetSvs : { low: targetSvs, high: targetSvs },
      cpsv: { low: 0, high: 0 },
    },
    data_source: "google_agent",
    mtd: {
      spend: spendMtd,
      leads: leadsMtd,
      cpl: leadsMtd > 0 ? Math.round((spendMtd / leadsMtd) * 100) / 100 : 0,
      ctr: accountPulse?.overall_ctr || 0,
      cpc: accountPulse?.overall_cpc || 0,
      cpm: accountPulse?.overall_cpm || 0,
      impressions: accountPulse?.total_impressions || 0,
      clicks: accountPulse?.total_clicks || 0,
    },
    expected: { spend: Math.round(expectedSpend), leads: Math.round(expectedLeads * 10) / 10 },
    projected_eom: {
      spend: Math.round(projectedSpend),
      leads: Math.round(projectedLeads),
      cpl: projectedLeads > 0 ? Math.round((projectedSpend / projectedLeads) * 100) / 100 : 0,
    },
    pacing: {
      spend_pct: spendPct,
      spend_status: spendPct >= 90 ? "on_track" : spendPct >= 70 ? "slightly_behind" : "behind",
      leads_pct: leadsPct,
      leads_status: leadsPct >= 90 ? "on_track" : leadsPct >= 70 ? "slightly_behind" : "behind",
      cpl_status: (accountPulse?.overall_cpl || 0) <= (targetCpl * 1.1) ? "on_track" : "above_target",
    },
    daily_needed: {
      spend: dailyNeededSpend,
      leads: dailyNeededLeads,
    },
    alerts: mtd.on_track === false
      ? [`Projected ${Math.round(projectedLeads)} leads vs ${targetLeads} target (gap: ${targetLeads - Math.round(projectedLeads)})`]
      : [],
  };
}

// ─── Recommendation Normalization ───────────────────────────────────

function normalizeRecommendation(rec: any): any {
  return {
    ...rec,
    // Ensure all expected fields exist
    id: rec.id || `R-${Math.random().toString(36).slice(2, 8)}`,
    insight: rec.insight || rec.description || "",
    action: rec.action || rec.action_type || "",
    impact: rec.impact || "",
    confidence: rec.confidence || "medium",
    category: rec.category || "general",
    campaign: rec.campaign ? cleanCampaignName(rec.campaign) : "",
    campaign_id: rec.campaign_id || "",
    ice_score: rec.ice_score || 5,
    action_type: rec.action_type || "manual_review",
    auto_executable: rec.auto_executable ?? false,
    sop_reference: rec.sop_reference || "",
    execution_status: rec.execution_status || "pending",
  };
}

// ─── Main Normalization Entry Point ─────────────────────────────────

export function normalizeGoogleAnalysis(raw: any): any {
  const campaigns = (raw.campaigns || []).map(normalizeCampaign);
  const adGroupAnalysis = extractAdGroups(raw.campaigns || []);
  const creativeHealth = extractCreativeHealth(raw.campaigns || [], raw.creative_health);
  const monthlyPacing = normalizeMonthlyPacing(raw.account_pulse, raw.targets);

  return {
    // Metadata
    platform: "google",
    status: raw.status || "OK",
    timestamp: raw.timestamp || new Date().toISOString(),
    cadence: raw.cadence || "twice_weekly",
    window: raw.window || null,

    // Scores (pre-computed by agent — NOT for frontend to recalculate)
    account_health_score: raw.account_health_score ?? 0,
    account_health_breakdown: raw.account_health_breakdown || {},

    // Canonical data keys (what frontend expects)
    account_pulse: raw.account_pulse || {},
    monthly_pacing: monthlyPacing,
    campaign_audit: campaigns,
    ad_group_analysis: adGroupAnalysis,
    creative_health: creativeHealth,

    // Google-specific summary sections
    search_summary: raw.search_summary || null,
    dg_summary: raw.dg_summary || null,

    // Deep analysis modules
    quality_score_analysis: raw.quality_score_analysis || { status: "DISABLED", keywords: [] },
    search_terms_analysis: raw.search_terms_analysis || { status: "DISABLED", all_terms: [] },
    bidding_analysis: raw.bidding_analysis || { per_ad_group: [], smart_bidding_readiness: [] },
    ad_group_restructuring: raw.ad_group_restructuring || { summary: {}, recommendations: [] },
    cvr_analysis: raw.cvr_analysis || null,
    conversion_sanity: raw.conversion_sanity || null,
    geo_analysis: raw.geo_analysis || null,
    demographic_breakdowns: raw.demographic_breakdowns || {},
    frequency_audit: raw.frequency_audit || null,

    // Intelligence
    recommendations: (raw.recommendations || []).map(normalizeRecommendation),
    auto_pause_candidates: raw.auto_pause_candidates || [],
    playbooks_triggered: raw.playbooks_triggered || [],
    intellect_insights: raw.intellect_insights || [],

    // Time series
    daily_trends: raw.daily_trends || [],

    // Config
    targets: raw.targets || {},
    thresholds: raw.thresholds || {},
    dynamic_thresholds: raw.dynamic_thresholds || {},
    benchmarks: raw.benchmarks || {},
    module_activation: raw.module_activation || {},
    data_verification: raw.data_verification || null,

    // Backwards-compat: keep raw campaigns for pages that still reference it
    campaigns: campaigns,
  };
}
