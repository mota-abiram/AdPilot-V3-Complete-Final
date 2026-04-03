import { db } from "./db";
import { biddingRecommendations, clients as clientTable, analysisSnapshots } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { log } from "./index";

export async function generateBiddingRecommendations(clientId: string) {
  log(`Bidding Intelligence: Generating recommendations for ${clientId}...`, "bidding");

  // 1. Fetch latest Google Ads analysis snapshot
  const [snapshot] = await db
    .select()
    .from(analysisSnapshots)
    .where(and(
      eq(analysisSnapshots.clientId, clientId),
      eq(analysisSnapshots.platform, "google")
    ))
    .orderBy(desc(analysisSnapshots.createdAt))
    .limit(1);

  if (!snapshot) {
    log(`Bidding Intelligence: No Google snapshot found for ${clientId}`, "bidding");
    return;
  }

  const data = snapshot.data as any;
  const campaigns = data.campaigns || [];
  const targets = data.targets || {};
  const targetCpa = targets.cpl || 850;

  for (const camp of campaigns) {
    if (camp.status !== "ENABLED") continue;

    const currentStrategy = camp.bidding_strategy || "UNKNOWN";
    const avgCpc = camp.avg_cpc || 0;
    const cvr = (camp.cvr || 0) / 100; // Convert percentage to decimal
    const conversions = camp.conversions || 0;
    const costPerConversion = camp.cpl || 0;
    const clicks = camp.clicks || 0;
    const searchIs = camp.search_impression_share || 0;
    const lostIsRank = camp.search_rank_lost_is || 0;
    const lostIsBudget = camp.search_budget_lost_is || 0;

    let recommendation: "stay_max_clicks" | "switch_tcpa" | "hold" = "stay_max_clicks";
    let reasons: string[] = [];
    let confidence: "low" | "medium" | "high" = "medium";
    let computed_bid_limit: number | null = null;
    let suggested_tcpa: number | null = null;
    let alerts: { severity: "critical" | "warning" | "info"; message: string }[] = [];

    // ─── Alerts ───────────────────────────────────────────────────
    if (avgCpc > targetCpa * 0.1 && cvr < 0.01) {
      alerts.push({ severity: "critical", message: "CPC too high vs CVR" });
    }
    if (lostIsRank > 40) {
      alerts.push({ severity: "critical", message: "Low impression share due to rank" });
    }
    if (lostIsBudget > 20) {
      alerts.push({ severity: "warning", message: "Budget limited — consider scaling" });
    }

    // ─── Logic ────────────────────────────────────────────────────
    const isMaxClicks = currentStrategy === "MAXIMIZE_CLICKS" || currentStrategy === "UNKNOWN";
    const isTargetCpa = currentStrategy === "TARGET_CPA" || currentStrategy === "MAXIMIZE_CONVERSIONS" && camp.target_cpa;

    if (isMaxClicks && conversions >= 15) {
      recommendation = "switch_tcpa";
      suggested_tcpa = targetCpa;
      reasons.push(`${conversions.toFixed(1)} conversions in last 7 days detected.`);
      reasons.push("CVR stable at " + (cvr * 100).toFixed(1) + "%.");
      reasons.push("Cost/Conv is predictable.");
      confidence = conversions >= 30 ? "high" : "medium";
      alerts.push({ severity: "info", message: "Eligible for tCPA switch" });
    } else if (isMaxClicks) {
      recommendation = "stay_max_clicks";
      // Bid Limit = MIN(Avg CPC * 1.35, Target CPA * CVR)
      const bidByCpc = avgCpc * 1.35;
      const bidByTarget = targetCpa * cvr;
      
      if (cvr > 0) {
        computed_bid_limit = Math.min(bidByCpc, bidByTarget);
        reasons.push(`Maintain Max Clicks with bid limit ₹${Math.round(computed_bid_limit)}.`);
        reasons.push(`CVR at ${(cvr * 100).toFixed(1)}% supports current math.`);
      } else {
        computed_bid_limit = bidByCpc;
        reasons.push(`Maintain Max Clicks. Data insufficient for CPA math.`);
        confidence = "low";
      }
    } else if (isTargetCpa) {
      if (costPerConversion > targetCpa * 1.4 && conversions < 10) {
        recommendation = "stay_max_clicks";
        computed_bid_limit = avgCpc * 1.2;
        reasons.push(`CPL (₹${Math.round(costPerConversion)}) too high vs target (₹${targetCpa}).`);
        reasons.push("Reverting to Max Clicks with bid limit to stabilize.");
        confidence = "high";
      } else {
        recommendation = "hold";
        suggested_tcpa = targetCpa;
        reasons.push("Performance within target range.");
        confidence = "high";
      }
    }

    // Guardrail: Budget
    if (lostIsBudget > 20 && recommendation === "switch_tcpa") {
      recommendation = "hold";
      reasons.push("Hold switch: Low impression share due to budget.");
      confidence = "medium";
    }

    // Save to DB
    await db.insert(biddingRecommendations).values({
      campaignId: camp.id,
      clientId,
      campaignName: camp.name,
      currentStrategy,
      recommendedStrategy: recommendation === "switch_tcpa" ? "TARGET_CPA" : "MAXIMIZE_CLICKS",
      currentBidLimit: camp.bid_limit ? String(camp.bid_limit) : null,
      recommendedBidLimit: computed_bid_limit ? String(Math.round(computed_bid_limit)) : null,
      currentTCPA: camp.target_cpa ? String(camp.target_cpa) : null,
      recommendedTCPA: suggested_tcpa ? String(Math.round(suggested_tcpa)) : (recommendation === "hold" && isTargetCpa ? String(targetCpa) : null),
      avgCpc: String(avgCpc),
      ctr: String(camp.ctr),
      cvr: String(camp.cvr),
      costPerConversion: String(costPerConversion),
      searchImpressionShare: camp.search_impression_share ? String(camp.search_impression_share) : null,
      lostIsRank: camp.search_rank_lost_is ? String(camp.search_rank_lost_is) : null,
      lostIsBudget: camp.search_budget_lost_is ? String(camp.search_budget_lost_is) : null,
      conversions: String(conversions),
      clicks: String(clicks),
      confidenceLevel: confidence,
      reason: JSON.stringify({ reasons, alerts, recommendation }), // Store structured in reason field
      status: "pending",
    });
  }

  log(`Bidding Intelligence: Completed for ${clientId}`, "bidding");
}
