/**
 * SOP Engine — deterministic marketing logic (Layer 2)
 *
 * Provides a set of rules to generate draft recommendations based on raw metric data.
 * Used as as input for the AI Reasoning layer and as a fallback.
 */

export interface SopInsight {
  issue: string;
  impact: string;
  recommendation: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entityId?: string;
  entityName?: string;
  entityType?: "campaign" | "adset" | "ad_group" | "ad" | "account";
  platform?: string;
  ice_score: number;
}

export function analyzeSop(analysisData: any, targets: any, platform: string): SopInsight[] {
  const insights: SopInsight[] = [];
  const targetCpl = targets?.cpl || 800;

  // 1. Account Level Pulse
  const ap = analysisData.account_pulse || {};
  if (ap.overall_cpl > targetCpl * 1.5) {
    insights.push({
      issue: "Critical CPL Deviation",
      impact: `Account CPL (₹${Math.round(ap.overall_cpl)}) is ${(ap.overall_cpl / targetCpl).toFixed(1)}x target.`,
      recommendation: "Immediate pause of bottom 20% underperforming entities required to stabilize budget.",
      priority: "CRITICAL",
      entityType: "account",
      ice_score: 9,
    });
  }

  // 2. Entity Level Analysis
  const campaigns = analysisData.campaign_audit || analysisData.campaign_performance || analysisData.campaigns || [];
  
  campaigns.forEach((c: any) => {
    const spend = c.spend || c.cost || 0;
    const leads = c.leads || c.conversions || 0;
    const clicks = c.clicks || 0;
    const imps = c.impressions || 0;
    const cpl = c.cpl || (leads > 0 ? spend / leads : spend > 500 ? 9999 : 0);
    const cvr = c.cvr || (clicks > 0 ? (leads / clicks) * 100 : 0);
    const cpc = c.avg_cpc || (clicks > 0 ? spend / clicks : 0);
    const ctr = c.ctr || (imps > 0 ? (clicks / imps) * 100 : 0);
    
    const name = c.campaign_name || c.name || "Unknown";
    const id = c.campaign_id || c.id;
    const platform_id = c.id || c.campaign_id;

    // 2.1 CPL & Efficiency (Imported from Python PIE)
    if (spend > targetCpl * 2 && leads === 0) {
      insights.push({
        issue: "Budget Drain (Zero Leads)",
        impact: `Campaign "${name}" has spent ₹${Math.round(spend)} with no results.`,
        recommendation: `Pause campaign "${name}" immediately.`,
        priority: "CRITICAL",
        entityId: id,
        entityName: name,
        entityType: "campaign",
        ice_score: 10,
      });
    } else if (cpl > targetCpl * 1.3) {
      const benchmarkCvr = platform === "google" ? 3.0 : 4.0;
      if (cvr < benchmarkCvr && leads > 0) {
         insights.push({
           issue: "Conversion Rate Floor Breach",
           impact: `CVR (${cvr.toFixed(2)}%) is below acceptable floor (${benchmarkCvr}%).`,
           recommendation: `Audit landing page experience for "${name}" or lead form friction.`,
           priority: "HIGH",
           entityId: id,
           entityName: name,
           entityType: "campaign",
           ice_score: 8
         });
      }
      if (cpc > 45) {
         insights.push({
           issue: "CPC Inflation",
           impact: `CPC (₹${cpc.toFixed(2)}) is pushing CPL above target boundaries.`,
           recommendation: "Review bidding strategy or negative keyword list to reduce auction friction.",
           priority: "MEDIUM",
           entityId: id,
           entityName: name,
           entityType: "campaign",
           ice_score: 6
         });
      }
    }

    // 2.2 Impression Share Loss (Google Specific - Imported from Python)
    if (platform === "google") {
       const lostBudget = c.search_budget_lost_is || 0;
       const lostRank = c.search_rank_lost_is || 0;
       if (lostBudget > 20) {
         insights.push({
           issue: "Budget-Constrained Delivery",
           impact: `Losing ${lostBudget.toFixed(0)}% of potential traffic due to daily budget caps.`,
           recommendation: `Increase daily budget for "${name}" by 20% to capture efficient volume.`,
           priority: "HIGH",
           entityId: id,
           entityName: name,
           entityType: "campaign",
           ice_score: 8
         });
       }
       if (lostRank > 40) {
         insights.push({
            issue: "Rank-Constrained Delivery",
            impact: `Losing ${lostRank.toFixed(0)}% of auction share due to low Ad Rank/Quality.`,
            recommendation: "Improve Ad Copy relevance or Quality Score to lower effective CPCs.",
            priority: "MEDIUM",
            entityId: id,
            entityName: name,
            entityType: "campaign",
            ice_score: 6
         });
       }
    }

    // 2.3 Algorithm Learning Trap (Imported from Python PDE)
    const daysActive = c.days_active || 0; // Provided by agents
    if (daysActive > 7 && leads < 5 && imps > 1000) {
       insights.push({
         issue: "Algorithm Learning Trap",
         impact: "Stuck in learning phase with insufficient conversion signals.",
         recommendation: "Reset campaign with broader targeting or switch to 'Clicks' focus temporarily.",
         priority: "HIGH",
         entityId: id,
         entityName: name,
         entityType: "campaign",
         ice_score: 7
       });
    }

    // Winner Scaling
    if (leads >= 5 && cpl < targetCpl * 0.7) {
      insights.push({
        issue: "Top Performer Opportunity",
        impact: `Consistent leads at ₹${Math.round(cpl)} CPL (30% below target).`,
        recommendation: `Scale budget for "${name}" by 20% to capture more volume.`,
        priority: "MEDIUM",
        entityId: id,
        entityName: name,
        entityType: "campaign",
        ice_score: 8,
      });
    }
  });

  // 3. Creative Health
  const creative = analysisData.creative_health || [];
  creative.forEach((ad: any) => {
    const ageDays = ad.creative_age_days ?? ad.age_days ?? 0;
    const score = ad.creative_score ?? ad.performance_score ?? 0;
    
    // Logic from creative-calendar.tsx
    const isOverdue = (ageDays > 35 && score < 70) || (ageDays > 45);
    const isCriticalFailure = (score > 0 && score < 35) || (ad.spend > targetCpl * 2.5 && (ad.leads || ad.conversions || 0) === 0);

    if (isCriticalFailure) {
      insights.push({
        issue: "Critical Creative Failure",
        impact: `Ad "${ad.ad_name}" has high spend but near-zero results (Score: ${score}).`,
        recommendation: `Pause ad "${ad.ad_name}" immediately to recapture budget.`,
        priority: "CRITICAL",
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        entityType: "ad",
        ice_score: 9,
      });
    } else if (isOverdue) {
      insights.push({
        issue: "Advanced Creative Fatigue",
        impact: `Ad "${ad.ad_name}" is ${ageDays} days old. CTR signals are decaying.`,
        recommendation: `Queue creative refresh for "${ad.ad_name}" with a fresh visual angle.`,
        priority: "HIGH",
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        entityType: "ad",
        ice_score: 7,
      });
    } else if (ad.frequency > 3.0) {
      insights.push({
        issue: "Audience Saturation",
        impact: `Ad "${ad.ad_name}" frequency (${ad.frequency.toFixed(1)}x) suggests audience saturation.`,
        recommendation: `Check frequency across all active ads; consider refreshing creatives.`,
        priority: "MEDIUM",
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        entityType: "ad",
        ice_score: 6,
      });
    }
  });

  // 4. Audit Checklist Rules (Consolidated from frontend)
  
  // Spend vs Plan
  const budget = targets?.budget || analysisData?.dynamic_thresholds?.budget || 0;
  if (budget > 0) {
    const totalSpend = ap.total_spend_30d || ap.total_spend || 0;
    const dayOfMonth = new Date().getDate();
    const expectedSpend = (budget / 30) * dayOfMonth;
    const diffPct = ((totalSpend - expectedSpend) / expectedSpend) * 100;
    
    if (Math.abs(diffPct) > 20) {
       insights.push({
         issue: "Pacing Deviation",
         impact: `Month-to-date spend is ${Math.abs(diffPct).toFixed(0)}% ${diffPct > 0 ? "ahead of" : "behind"} plan.`,
         recommendation: diffPct > 0 ? "Slow down daily spend to avoid budget depletion." : "Check for delivery bottlenecks or increase budgets.",
         priority: "HIGH",
         entityType: "account",
         ice_score: 7
       });
    }
  }

  // Tracking Sanity
  const todayLeads = ap.latest_daily_leads ?? 0;
  if (todayLeads === 0 && ap.total_leads_30d > 0) {
    insights.push({
      issue: "Tracking Anomaly",
      impact: "Zero leads recorded in the last 24 hours despite historical conversion flow.",
      recommendation: "Immediate check of pixel/CAPI status and form completion logs.",
      priority: "CRITICAL",
      entityType: "account",
      ice_score: 10
    });
  }

  // Quality Score (Google specific)
  if (platform === "google") {
    const adGroups = (analysisData.campaigns || []).flatMap((c: any) => c.ad_groups || []);
    const lowQS = adGroups.filter((ag: any) => ag.quality_score > 0 && ag.quality_score < 6);
    if (lowQS.length > 0) {
      insights.push({
        issue: "Low Quality Score Drain",
        impact: `${lowQS.length} ad groups have Quality Score < 6, inflating CPCs.`,
        recommendation: "Audit landing page relevance and improve ad copy alignment with keywords.",
        priority: "MEDIUM",
        entityType: "ad_group",
        ice_score: 5
      });
    }
  }

  return insights.sort((a, b) => b.ice_score - a.ice_score);
}
