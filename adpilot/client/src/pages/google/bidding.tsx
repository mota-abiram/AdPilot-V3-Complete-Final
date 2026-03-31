import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  IndianRupee,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Zap,
  Info,
  CircleDot,
  ShieldCheck,
  Clock,
  Target,
} from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useExecution } from "@/hooks/use-execution";
import { ExecutionButton } from "@/components/execution-button";

// ─── Types ───────────────────────────────────────────────────────────

interface AdGroupBid {
  ad_group_id: string;
  ad_group_name: string;
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  cvr: number;
  cpc: number;
  cpl: number;
  current_max_cpc?: number;
  recommended_max_cpc?: number;
  computed_max_cpc?: number;
  adjustment: "increase" | "decrease" | "hold";
  adjustment_pct?: number;
  rationale?: string;
  low_top_of_page_cpc?: number;
  target_cpa?: number;
}

interface SmartBiddingReadiness {
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string;
  conversions_30d: number;
  cvr_variance_14d?: number;
  tracking_stable?: boolean;
  recommendation: string;
  suggested_tcpa?: number;
  current_strategy?: string;
}

interface CampaignGroup {
  name: string;
  type: string;
  adGroups: AdGroupBid[];
  strategy: string;
  avgCpc: number;
  avgCvr: number;
  totalCost: number;
  totalConv: number;
  computedMaxCpc: number;
}

type CampaignSortKey = "campaign_name" | "cpc" | "cvr" | "cpl" | "computed_max_cpc" | "bidding_strategy";

// ─── Helpers ─────────────────────────────────────────────────────────

function bidStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "OPTIMAL": return { label: "Optimal", cls: "bg-emerald-500/15 text-emerald-400" };
    case "OVER_BID": return { label: "Over Bid", cls: "bg-red-500/15 text-red-400" };
    case "UNDER_BID": return { label: "Under Bid", cls: "bg-amber-500/15 text-amber-400" };
    default: return { label: status || "—", cls: "bg-gray-500/15 text-gray-400" };
  }
}

function adjustmentBadge(adj: string): { label: string; cls: string; icon: React.ReactNode } {
  switch (adj) {
    case "increase": return { label: "Increase", cls: "text-emerald-400", icon: <TrendingUp className="w-3 h-3" /> };
    case "decrease": return { label: "Decrease", cls: "text-red-400", icon: <TrendingDown className="w-3 h-3" /> };
    default: return { label: "Hold", cls: "text-muted-foreground", icon: <Minus className="w-3 h-3" /> };
  }
}

function smartBiddingBadge(recommendation: string): { label: string; cls: string } {
  if (recommendation === "switch_tcpa" || recommendation === "test_tcpa") {
    return { label: "Ready for tCPA", cls: "bg-emerald-500/15 text-emerald-400" };
  }
  if (recommendation === "stay_manual") {
    return { label: "Stay Manual", cls: "bg-gray-500/15 text-gray-400" };
  }
  if (recommendation === "needs_volume") {
    return { label: "Needs Volume", cls: "bg-amber-500/15 text-amber-400" };
  }
  return { label: recommendation.replace(/_/g, " "), cls: "bg-amber-500/15 text-amber-400" };
}

function getCpcStatus(avgCpc: number, maxCpc: number): { label: string; cls: string } {
  if (maxCpc <= 0) return { label: "N/A", cls: "text-muted-foreground" };
  const ratio = avgCpc / maxCpc;
  if (ratio > 1.1) return { label: "Above Max", cls: "text-red-400" };
  if (ratio < 0.7) return { label: "Well Below", cls: "text-emerald-400" };
  return { label: "Within Range", cls: "text-foreground" };
}

// ─── Component ───────────────────────────────────────────────────────

export default function GoogleBiddingPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();
  const { execute, isExecuting } = useExecution();

  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    type: "decrease_cpc" | "switch_tcpa" | "switch_max_conv";
    campaignId: string;
    campaignName: string;
    detail: string;
    params: Record<string, any>;
  } | null>(null);

  const biddingData = useMemo(() => {
    if (!data) return null;
    return (data as any).bidding_analysis || null;
  }, [data]);

  // Per-ad-group data
  const adGroupBids: AdGroupBid[] = useMemo(() => {
    if (!biddingData) return [];
    return biddingData.per_ad_group || [];
  }, [biddingData]);

  // Smart bidding readiness
  const smartBidding: SmartBiddingReadiness[] = useMemo(() => {
    if (!biddingData) return [];
    return biddingData.smart_bidding_readiness || [];
  }, [biddingData]);

  // Group ad groups by campaign
  const campaignGroups = useMemo(() => {
    const map = new Map<string, CampaignGroup>();
    for (const ag of adGroupBids) {
      const key = ag.campaign_id || ag.campaign_name;
      if (!map.has(key)) {
        map.set(key, {
          name: ag.campaign_name,
          type: ag.campaign_type || "",
          adGroups: [],
          strategy: "",
          avgCpc: 0,
          avgCvr: 0,
          totalCost: 0,
          totalConv: 0,
          computedMaxCpc: 0,
        });
      }
      map.get(key)!.adGroups.push(ag);
    }
    // Compute campaign-level aggregates
    for (const group of Array.from(map.values())) {
      const totalClicks = group.adGroups.reduce((s: number, ag: AdGroupBid) => s + (ag.clicks || 0), 0);
      group.totalCost = group.adGroups.reduce((s: number, ag: AdGroupBid) => s + (ag.cost || 0), 0);
      group.totalConv = group.adGroups.reduce((s: number, ag: AdGroupBid) => s + (ag.conversions || 0), 0);
      group.avgCpc = totalClicks > 0 ? group.totalCost / totalClicks : 0;
      group.avgCvr = totalClicks > 0 ? (group.totalConv / totalClicks) * 100 : 0;
      // Use median of recommended max CPC values
      const maxCpcs = group.adGroups
        .map((ag: AdGroupBid) => ag.recommended_max_cpc || ag.computed_max_cpc || 0)
        .filter((v: number) => v > 0);
      group.computedMaxCpc = maxCpcs.length > 0 ? maxCpcs.sort((a: number, b: number) => a - b)[Math.floor(maxCpcs.length / 2)] : 0;
    }
    // Also get campaigns data for strategy info
    const campaigns = (data as any)?.campaigns || [];
    for (const camp of campaigns) {
      const key = camp.id || camp.campaign_id || camp.name;
      const group = map.get(key) || Array.from(map.values()).find((g) => g.name === camp.name);
      if (group) {
        group.strategy = camp.bidding_strategy || "";
        group.type = camp.campaign_type || group.type;
      }
    }
    return map;
  }, [adGroupBids, data]);

  // ─── tCPA Readiness Assessment ─────────────────────────────────────
  // Compute per-campaign readiness using ad group data + smart_bidding_readiness
  const tcpaReadiness = useMemo(() => {
    if (!biddingData && adGroupBids.length === 0) return [];

    // If we already have smart_bidding_readiness, enrich it
    if (smartBidding.length > 0) {
      return smartBidding.map((sb) => {
        const campGroup = campaignGroups.get(sb.campaign_id) || Array.from(campaignGroups.values()).find((g) => g.name === sb.campaign_name);
        const totalConv = sb.conversions_30d;
        const currentCPA = campGroup && campGroup.totalConv > 0 ? campGroup.totalCost / campGroup.totalConv : 0;
        const cvrVariance = sb.cvr_variance_14d ?? null;
        const trackingStable = sb.tracking_stable ?? true;

        // Traffic light
        let readiness: "green" | "yellow" | "red" = "red";
        let readinessLabel = "Not ready — continue Max Clicks with cap";
        if (totalConv >= 50 && (cvrVariance === null || cvrVariance < 20) && trackingStable) {
          readiness = "green";
          readinessLabel = "Ready for tCPA";
        } else if (totalConv >= 30 && (cvrVariance === null || cvrVariance < 25)) {
          readiness = "yellow";
          readinessLabel = "Almost ready — monitor 1 more week";
        }

        return {
          campaignId: sb.campaign_id,
          campaignName: sb.campaign_name,
          campaignType: sb.campaign_type || campGroup?.type || "",
          conversions30d: totalConv,
          cvrVariance14d: cvrVariance,
          currentCPA,
          recommendedTCPA: currentCPA > 0 ? Math.round(currentCPA * 0.8) : sb.suggested_tcpa || 0,
          trackingStable,
          readiness,
          readinessLabel,
          currentStrategy: sb.current_strategy || campGroup?.strategy || "Manual CPC",
          suggestedTCPA: sb.suggested_tcpa || (currentCPA > 0 ? Math.round(currentCPA * 0.8) : 0),
        };
      });
    }

    // Fallback: compute from campaign groups
    return Array.from(campaignGroups.entries()).map(([campId, group]) => {
      const totalConv = group.totalConv;
      const currentCPA = totalConv > 0 ? group.totalCost / totalConv : 0;

      let readiness: "green" | "yellow" | "red" = "red";
      let readinessLabel = "Not ready — continue Max Clicks with cap";
      if (totalConv >= 50 && group.avgCvr >= 2) {
        readiness = "green";
        readinessLabel = "Ready for tCPA";
      } else if (totalConv >= 30) {
        readiness = "yellow";
        readinessLabel = "Almost ready — monitor 1 more week";
      }

      return {
        campaignId: campId,
        campaignName: group.name,
        campaignType: group.type,
        conversions30d: totalConv,
        cvrVariance14d: null as number | null,
        currentCPA,
        recommendedTCPA: currentCPA > 0 ? Math.round(currentCPA * 0.8) : 0,
        trackingStable: true,
        readiness,
        readinessLabel,
        currentStrategy: group.strategy || "Manual CPC",
        suggestedTCPA: currentCPA > 0 ? Math.round(currentCPA * 0.8) : 0,
      };
    });
  }, [biddingData, adGroupBids, smartBidding, campaignGroups]);

  // Summary counts
  const adjustmentCounts = useMemo(() => {
    const increase = adGroupBids.filter((ag) => ag.adjustment === "increase").length;
    const decrease = adGroupBids.filter((ag) => ag.adjustment === "decrease").length;
    const hold = adGroupBids.filter((ag) => ag.adjustment === "hold").length;
    return { increase, decrease, hold, total: adGroupBids.length };
  }, [adGroupBids]);

  function handleExecuteAction() {
    if (!actionDialog) return;
    execute({
      action: actionDialog.type === "decrease_cpc" ? "ADJUST_BID" :
              actionDialog.type === "switch_tcpa" ? "CHANGE_BIDDING_STRATEGY" :
              "CHANGE_BIDDING_STRATEGY",
      entityId: actionDialog.campaignId,
      entityName: actionDialog.campaignName,
      entityType: "campaign",
      params: actionDialog.params,
    });
    setActionDialog(null);
  }

  // Loading
  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-24 rounded-md mb-4" />
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  // Empty state
  if (!biddingData || adGroupBids.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <IndianRupee className="w-5 h-5" />
            Bidding Analysis
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            CPA formula breakdown, Max CPC calculations, and bid optimization
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Bidding data will be available after the next Google Ads agent run with weekly+ cadence.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The agent analyzes CPA = CPC / CVR and computes optimal Max CPC caps.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]">
      {/* Action Confirm Dialog */}
      <AlertDialog open={!!actionDialog?.open} onOpenChange={(o) => { if (!o) setActionDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bidding Action</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">{actionDialog?.detail}</span>
              <span className="block text-xs mt-2 text-muted-foreground">
                Campaign: {actionDialog?.campaignName}
              </span>
              <span className="block text-xs mt-1 text-amber-500">
                This will modify your Google Ads account settings.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-action-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleExecuteAction} disabled={isExecuting} data-testid="button-action-confirm">
              {isExecuting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
              Execute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <IndianRupee className="w-5 h-5" />
          Bidding Analysis
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {adjustmentCounts.total} ad groups across {campaignGroups.size} campaigns · CPA = CPC / CVR
        </p>
      </div>

      {/* ─── tCPA Readiness Assessment ──────────────────────────── */}
      <div data-testid="tcpa-readiness-section">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            tCPA Readiness Assessment
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <div className="text-xs space-y-1">
                <p className="font-medium">SOP: tCPA Transition Criteria</p>
                <p>Green: ≥50 conversions/30d + CVR variance &lt;20% + tracking confirmed</p>
                <p>Yellow: 30-50 conversions OR CVR variance 15-20%</p>
                <p>Red: &lt;30 conversions OR CVR unstable</p>
                <p className="text-muted-foreground">Seed tCPA at current CPA minus 20%</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        {tcpaReadiness.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tcpaReadiness.map((r, idx) => {
              const trafficLightColors = {
                green: {
                  border: "border-emerald-500/30",
                  bg: "bg-emerald-500",
                  bgLight: "bg-emerald-500/10",
                  text: "text-emerald-400",
                  icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
                },
                yellow: {
                  border: "border-amber-500/30",
                  bg: "bg-amber-500",
                  bgLight: "bg-amber-500/10",
                  text: "text-amber-400",
                  icon: <Clock className="w-4 h-4 text-amber-400" />,
                },
                red: {
                  border: "border-red-500/30",
                  bg: "bg-red-500",
                  bgLight: "bg-red-500/10",
                  text: "text-red-400",
                  icon: <AlertTriangle className="w-4 h-4 text-red-400" />,
                },
              };
              const colors = trafficLightColors[r.readiness];

              return (
                <Card key={idx} className={colors.border} data-testid={`card-tcpa-readiness-${idx}`}>
                  <CardContent className="p-4">
                    {/* Header: campaign name + traffic light */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs font-medium text-foreground truncate cursor-default">
                              {truncate(r.campaignName, 28)}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{r.campaignName}</p></TooltipContent>
                        </Tooltip>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {r.currentStrategy} · {r.campaignType}
                        </p>
                      </div>
                      <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium", colors.bgLight, colors.text)}>
                        {colors.icon}
                        <span className="hidden sm:inline">{r.readiness === "green" ? "Ready" : r.readiness === "yellow" ? "Almost" : "Not Ready"}</span>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">Conversions (30d)</span>
                        <span className={cn("tabular-nums font-medium", r.conversions30d >= 50 ? "text-emerald-400" : r.conversions30d >= 30 ? "text-amber-400" : "text-red-400")}>
                          {r.conversions30d}
                          <span className="text-muted-foreground ml-1">
                            (need ≥30-50)
                          </span>
                        </span>
                      </div>

                      {r.cvrVariance14d != null && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">CVR Stability (14d)</span>
                          <span className={cn("tabular-nums font-medium", r.cvrVariance14d < 20 ? "text-emerald-400" : "text-amber-400")}>
                            ±{r.cvrVariance14d.toFixed(1)}%
                            <span className="text-muted-foreground ml-1">
                              (need &lt;±20%)
                            </span>
                          </span>
                        </div>
                      )}

                      {r.currentCPA > 0 && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">Current CPA</span>
                          <span className="tabular-nums font-medium text-foreground">
                            {formatINR(r.currentCPA, 0)}
                          </span>
                        </div>
                      )}

                      {r.suggestedTCPA > 0 && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">Recommended tCPA Seed</span>
                          <span className="tabular-nums font-semibold text-primary">
                            {formatINR(r.suggestedTCPA, 0)}
                            <span className="text-muted-foreground font-normal ml-1">
                              (CPA × 0.8)
                            </span>
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">Tracking Stable</span>
                        <span className={r.trackingStable ? "text-emerald-400" : "text-red-400"}>
                          {r.trackingStable ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>

                    {/* Readiness label + action */}
                    <div className="mt-3 pt-3 border-t border-border/30">
                      <p className={cn("text-[10px] font-medium mb-2", colors.text)}>
                        {r.readinessLabel}
                      </p>

                      {r.readiness === "green" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-[10px] h-7 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          onClick={() => setActionDialog({
                            open: true,
                            type: "switch_tcpa",
                            campaignId: r.campaignId,
                            campaignName: r.campaignName,
                            detail: `Switch "${r.campaignName}" to Target CPA bidding.\n\nSeed tCPA: ₹${r.suggestedTCPA} (current CPA ₹${Math.round(r.currentCPA)} × 0.8)\n\nThis is a strategic bidding decision. Ensure conversion tracking is accurate before proceeding.`,
                            params: {
                              strategy: "TARGET_CPA",
                              target_cpa: r.suggestedTCPA,
                              reason: `tCPA readiness check passed: ${r.conversions30d} conv/30d${r.cvrVariance14d != null ? `, CVR variance ${r.cvrVariance14d.toFixed(1)}%` : ""}`,
                            },
                          })}
                          data-testid={`button-switch-tcpa-readiness-${idx}`}
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Switch to tCPA at {formatINR(r.suggestedTCPA, 0)}
                        </Button>
                      )}

                      {r.readiness === "yellow" && (
                        <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
                          <p>Continue monitoring. Once 50+ conversions accumulated with stable CVR, switch to tCPA.</p>
                        </div>
                      )}

                      {r.readiness === "red" && (
                        <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
                          <p>Keep Max Clicks with CPC cap. Focus on growing conversion volume before automated bidding.</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Run the agent with bidding analysis module enabled to see readiness data.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* GB-06: Auction Position Analysis — IS metrics per campaign */}
      {(() => {
        const campaigns = (data as any)?.campaigns || [];
        const searchCampaigns = campaigns.filter((c: any) =>
          c.channel_type === "SEARCH" || c.campaign_type === "search" || c.campaign_type === "branded" || c.campaign_type === "location"
        );
        if (searchCampaigns.length === 0) return null;
        return (
          <div data-testid="section-auction-insights">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">Auction Position Analysis</h2>
              <span className="text-[10px] text-muted-foreground">Impression Share & Position metrics per campaign</span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {searchCampaigns.map((c: any, idx: number) => {
                const isa = c.impression_share_analysis || {};
                const is = c.search_impression_share ?? isa.search_impression_share;
                const absTop = c.absolute_top_is ?? isa.absolute_top_is;
                const topIs = c.top_is ?? isa.top_is;
                const clickShare = c.click_share ?? isa.click_share;
                const exactIs = c.exact_match_is ?? isa.exact_match_is;
                const lostRank = c.search_rank_lost_is ?? isa.search_rank_lost_is;
                const lostBudget = c.search_budget_lost_is ?? isa.search_budget_lost_is;
                const actions: string[] = isa.actions || [];

                const isTarget = isa.is_target ?? 70;
                const isStatus = isa.is_status ?? (is >= isTarget ? "healthy" : is >= isTarget * 0.85 ? "warning" : "critical");
                const statusColor = isStatus === "healthy" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                  : isStatus === "warning" ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
                  : "text-red-400 bg-red-500/10 border-red-500/30";

                return (
                  <Card key={idx} data-testid={`card-auction-${idx}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{truncate(c.name, 50)}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground capitalize">{c.bidding_strategy?.replace(/_/g, " ") || "Manual CPC"}</span>
                            {c.campaign_type && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">{c.campaign_type}</Badge>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 shrink-0 border", statusColor)}>
                          {isStatus === "healthy" ? "Healthy" : isStatus === "warning" ? "Monitor" : "Action Needed"}
                        </Badge>
                      </div>

                      {/* IS Metrics Grid */}
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-3">
                        {[
                          { label: "Search IS", value: is, suffix: "%", target: isTarget, good: (v: number) => v >= isTarget },
                          { label: "Abs Top IS", value: absTop, suffix: "%", target: 50, good: (v: number) => v >= 50 },
                          { label: "Top IS", value: topIs, suffix: "%", target: 60, good: (v: number) => v >= 60 },
                          { label: "Click Share", value: clickShare, suffix: "%", target: 60, good: (v: number) => v >= 60 },
                          { label: "Exact IS", value: exactIs, suffix: "%", target: 75, good: (v: number) => v >= 75 },
                          { label: "Lost (Rank)", value: lostRank, suffix: "%", target: 15, good: (v: number) => v <= 15, inverse: true },
                        ].map((metric) => {
                          if (metric.value == null) return null;
                          const isGood = metric.good(metric.value);
                          const color = metric.inverse
                            ? (metric.value > 25 ? "text-red-400" : metric.value > 15 ? "text-amber-400" : "text-emerald-400")
                            : (isGood ? "text-emerald-400" : metric.value >= metric.target * 0.85 ? "text-amber-400" : "text-red-400");
                          return (
                            <div key={metric.label}>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{metric.label}</p>
                              <p className={cn("text-sm font-bold tabular-nums mt-0.5", color)}>
                                {metric.value.toFixed(1)}{metric.suffix}
                              </p>
                              {/* Mini bar */}
                              <div className="w-full h-1 bg-muted/40 rounded-full mt-1">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(metric.inverse ? (100 - metric.value) : metric.value, 100)}%`,
                                    backgroundColor: color.replace("text-", "").includes("emerald") ? "hsl(142, 70%, 45%)" : color.includes("amber") ? "hsl(38, 92%, 50%)" : "hsl(0, 72%, 55%)"
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* IS bar visualisation */}
                      {is != null && (
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Search Impression Share</span>
                            <span className="tabular-nums">{is.toFixed(1)}% / {isTarget}% target</span>
                          </div>
                          <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden">
                            <div className="h-full flex">
                              <div className="h-full rounded-l-full" style={{ width: `${Math.min(is, 100)}%`, backgroundColor: is >= isTarget ? "hsl(142, 70%, 45%)" : "hsl(38, 92%, 50%)" }} />
                              {lostRank != null && lostRank > 0 && (
                                <div className="h-full" style={{ width: `${Math.min(lostRank, 100 - is)}%`, backgroundColor: "hsl(0, 72%, 55%)" }} title={`Lost (Rank): ${lostRank.toFixed(1)}%`} />
                              )}
                              {lostBudget != null && lostBudget > 0 && (
                                <div className="h-full" style={{ width: `${Math.min(lostBudget, 100 - is - (lostRank || 0))}%`, backgroundColor: "hsl(38, 92%, 50%)" }} title={`Lost (Budget): ${lostBudget.toFixed(1)}%`} />
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-full bg-emerald-500 inline-block" />Won</span>
                            {lostRank != null && lostRank > 0 && <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-full bg-red-500 inline-block" />Lost Rank</span>}
                            {lostBudget != null && lostBudget > 0 && <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-full bg-amber-500 inline-block" />Lost Budget</span>}
                          </div>
                        </div>
                      )}

                      {/* Recommended actions */}
                      {actions.length > 0 && (
                        <div className="space-y-1">
                          {actions.slice(0, 2).map((action: string, ai: number) => (
                            <div key={ai} className="flex items-start gap-1.5 text-[11px] text-amber-400/80 bg-amber-500/5 rounded px-2 py-1.5 border border-amber-500/20">
                              <Info className="w-3 h-3 mt-0.5 shrink-0" />
                              {action}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* CPA Formula Explainer */}
      <Card className="border-primary/20" data-testid="card-formula">
        <CardContent className="p-4">
          <div className="flex items-start gap-6 flex-wrap">
            <div className="flex-1 min-w-[300px]">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bidding Formula</p>
              <p className="text-sm font-mono text-foreground">
                CPA = <span className="text-blue-400">CPC</span> / <span className="text-purple-400">CVR</span>
              </p>
              <p className="text-sm font-mono text-foreground mt-1">
                Max CPC = MIN(<span className="text-amber-400">Low Top-of-Page CPC × 1.35</span>, <span className="text-emerald-400">Target CPA × CVR</span>)
              </p>
              <p className="text-[10px] text-muted-foreground mt-2">
                Target CPA ₹850 · If your CPC exceeds Max CPC, you're paying more per click than the lead value justifies.
              </p>
            </div>
            <div className="h-12 w-px bg-border/50 hidden md:block self-center" />
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Need Decrease</p>
                <p className="text-xl font-bold text-red-400 tabular-nums">{adjustmentCounts.decrease}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Hold</p>
                <p className="text-xl font-bold text-emerald-400 tabular-nums">{adjustmentCounts.hold}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Can Increase</p>
                <p className="text-xl font-bold text-amber-400 tabular-nums">{adjustmentCounts.increase}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Over-bid alert */}
      {adjustmentCounts.decrease > 0 && (
        <Card className="border-red-500/30">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {adjustmentCounts.decrease} ad group{adjustmentCounts.decrease !== 1 ? "s" : ""} need bid decreases — CPC exceeds computed Max CPC. Review individual bids below.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── Section 1: Campaign Bidding Overview ─────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Campaign Bidding Overview</h2>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="table-campaign-bidding">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="p-3 w-8"></th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Campaign</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Type</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Strategy</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Avg CPC</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Computed Max CPC</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">CPC Status</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">CVR</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Ad Groups</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Recommendation</th>
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(campaignGroups.entries()).map(([campId, group]) => {
                    const isExpanded = expandedCampaign === campId;
                    const cpcStatus = getCpcStatus(group.avgCpc, group.computedMaxCpc);
                    const needsDecrease = group.adGroups.filter((ag: AdGroupBid) => ag.adjustment === "decrease").length;
                    const recommendation = needsDecrease > 0
                      ? `${needsDecrease} ad group${needsDecrease !== 1 ? "s" : ""} overbidding`
                      : "Bids within range";

                    return (
                      <>
                        <tr
                          key={campId}
                          className="border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => setExpandedCampaign(isExpanded ? null : campId)}
                          data-testid={`row-campaign-bidding-${campId}`}
                        >
                          <td className="p-3">
                            <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                          </td>
                          <td className="p-3 max-w-[200px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block text-foreground">{truncate(group.name, 30)}</span>
                              </TooltipTrigger>
                              <TooltipContent><p className="text-xs">{group.name}</p></TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="p-3">
                            <Badge variant="secondary" className="text-[10px]">{group.type || "—"}</Badge>
                          </td>
                          <td className="p-3">
                            <span className="text-[10px] text-muted-foreground">{group.strategy || "Manual CPC"}</span>
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">{formatINR(group.avgCpc, 2)}</td>
                          <td className="p-3 text-right tabular-nums font-medium text-foreground">
                            {group.computedMaxCpc > 0 ? formatINR(group.computedMaxCpc, 2) : "—"}
                          </td>
                          <td className="p-3">
                            <span className={cn("text-[10px] font-medium", cpcStatus.cls)}>{cpcStatus.label}</span>
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            <span className={cn(group.avgCvr < 2 ? "text-red-400" : group.avgCvr >= 5 ? "text-emerald-400" : "text-foreground")}>
                              {group.avgCvr.toFixed(1)}%
                            </span>
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">{group.adGroups.length}</td>
                          <td className="p-3 max-w-[180px]">
                            <span className={cn("text-[10px]", needsDecrease > 0 ? "text-red-400" : "text-emerald-400")}>
                              {recommendation}
                            </span>
                          </td>
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-center">
                              {needsDecrease > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-[10px] h-6 px-2 text-red-400 border-red-500/30 hover:bg-red-500/10"
                                  onClick={() => setActionDialog({
                                    open: true,
                                    type: "decrease_cpc",
                                    campaignId: campId,
                                    campaignName: group.name,
                                    detail: `Decrease CPC on ${needsDecrease} overbidding ad group(s) in "${group.name}" to their computed Max CPC values.`,
                                    params: {
                                      action_type: "decrease_cpc",
                                      ad_groups: group.adGroups
                                        .filter((ag: AdGroupBid) => ag.adjustment === "decrease")
                                        .map((ag: AdGroupBid) => ({ id: ag.ad_group_id, target_cpc: ag.recommended_max_cpc || ag.computed_max_cpc })),
                                      reason: "CPC exceeds computed Max CPC (CPA = CPC/CVR formula)",
                                    },
                                  })}
                                  data-testid={`button-decrease-cpc-${campId}`}
                                >
                                  <TrendingDown className="w-3 h-3 mr-1" />
                                  Decrease CPC
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* ─── Expanded: Ad Group Bidding Detail ───── */}
                        {isExpanded && (
                          <tr key={`${campId}-expanded`} className="border-b border-border/30 bg-muted/10">
                            <td colSpan={11} className="p-0">
                              <div className="px-6 py-3">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                  Ad Group Detail — {group.name}
                                </p>
                                <table className="w-full text-xs" data-testid={`table-adgroup-detail-${campId}`}>
                                  <thead>
                                    <tr className="border-b border-border/30">
                                      <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Ad Group</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">CVR</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Current CPC</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Target CPA</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Max CPC</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Formula</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">Adjustment</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">Adj %</th>
                                      <th className="py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">IS Lost</th>
                                      <th className="py-2 pl-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-center">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.adGroups.map((ag: AdGroupBid) => {
                                      const adj = adjustmentBadge(ag.adjustment);
                                      return (
                                        <tr key={ag.ad_group_id} className="border-b border-border/20 hover:bg-muted/20" data-testid={`row-adgroup-bid-${ag.ad_group_id}`}>
                                          <td className="py-2 pr-3 max-w-[180px]">
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="truncate block text-foreground">{truncate(ag.ad_group_name, 28)}</span>
                                              </TooltipTrigger>
                                              <TooltipContent><p className="text-xs">{ag.ad_group_name}</p></TooltipContent>
                                            </Tooltip>
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums">
                                            <span className={cn(ag.cvr < 2 ? "text-red-400" : ag.cvr >= 5 ? "text-emerald-400" : "text-foreground")}>
                                              {ag.cvr.toFixed(1)}%
                                            </span>
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums">{formatINR(ag.cpc, 2)}</td>
                                          <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                                            {ag.target_cpa ? formatINR(ag.target_cpa, 0) : "₹850"}
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums font-medium">
                                            {formatINR(ag.recommended_max_cpc || ag.computed_max_cpc || 0, 2)}
                                          </td>
                                          <td className="py-2 px-2">
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="text-[10px] text-muted-foreground cursor-help">
                                                  {ag.target_cpa || 850} × {(ag.cvr / 100).toFixed(3)} = {formatINR((ag.target_cpa || 850) * (ag.cvr / 100), 2)}
                                                </span>
                                              </TooltipTrigger>
                                              <TooltipContent side="top" className="max-w-xs">
                                                <p className="text-xs">Max CPC = Target CPA × Observed CVR</p>
                                                <p className="text-xs text-muted-foreground mt-1">= ₹{ag.target_cpa || 850} × {(ag.cvr / 100).toFixed(3)} = {formatINR((ag.target_cpa || 850) * (ag.cvr / 100), 2)}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </td>
                                          <td className="py-2 px-2">
                                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", adj.cls)}>
                                              {adj.icon} {adj.label}
                                            </span>
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums">
                                            {ag.adjustment_pct != null && ag.adjustment_pct !== 0 ? (
                                              <span className={cn(ag.adjustment === "decrease" ? "text-red-400" : "text-emerald-400")}>
                                                {ag.adjustment === "decrease" ? "-" : "+"}{Math.abs(ag.adjustment_pct).toFixed(0)}%
                                              </span>
                                            ) : "—"}
                                          </td>
                                          <td className="py-2 px-2">
                                            <div className="text-[10px] space-y-0.5">
                                              {(ag as any).is_lost_rank != null && (
                                                <div className="flex items-center gap-1">
                                                  <span className="text-muted-foreground">Rank:</span>
                                                  <span className={cn("tabular-nums", (ag as any).is_lost_rank > 10 ? "text-red-400" : "text-emerald-400")}>
                                                    {((ag as any).is_lost_rank).toFixed(1)}%
                                                  </span>
                                                  {(ag as any).is_lost_rank > 10 && <span className="text-amber-400">↑ bid</span>}
                                                </div>
                                              )}
                                              {(ag as any).is_lost_budget != null && (
                                                <div className="flex items-center gap-1">
                                                  <span className="text-muted-foreground">Budget:</span>
                                                  <span className={cn("tabular-nums", (ag as any).is_lost_budget > 10 ? "text-red-400" : "text-emerald-400")}>
                                                    {((ag as any).is_lost_budget).toFixed(1)}%
                                                  </span>
                                                  {(ag as any).is_lost_budget > 10 && <span className="text-amber-400">↑ budget</span>}
                                                </div>
                                              )}
                                              {(ag as any).is_lost_rank == null && (ag as any).is_lost_budget == null && (
                                                <span className="text-muted-foreground">—</span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2 pl-2 text-center">
                                            <div className="flex items-center gap-1 justify-center">
                                              <ExecutionButton
                                                action="ADJUST_BID"
                                                entityId={ag.ad_group_id}
                                                entityName={ag.ad_group_name}
                                                entityType="ad_group"
                                                label=""
                                                variant="ghost"
                                                size="icon"
                                                icon={<TrendingUp className="w-3 h-3 text-emerald-400" />}
                                                confirmMessage={`Increase bid by 10% on "${ag.ad_group_name}"?\nCurrent CPC: ${formatINR(ag.cpc, 2)}`}
                                                params={{ adjustment: "increase", adjustmentPct: 10, reason: "Manual bid increase from Bidding page" }}
                                                className="h-6 w-6"
                                                data-testid={`button-bid-up-${ag.ad_group_id}`}
                                              />
                                              <ExecutionButton
                                                action="ADJUST_BID"
                                                entityId={ag.ad_group_id}
                                                entityName={ag.ad_group_name}
                                                entityType="ad_group"
                                                label=""
                                                variant="ghost"
                                                size="icon"
                                                icon={<TrendingDown className="w-3 h-3 text-red-400" />}
                                                confirmMessage={`Decrease bid by 10% on "${ag.ad_group_name}"?\nCurrent CPC: ${formatINR(ag.cpc, 2)}`}
                                                params={{ adjustment: "decrease", adjustmentPct: -10, reason: "Manual bid decrease from Bidding page" }}
                                                className="h-6 w-6"
                                                data-testid={`button-bid-down-${ag.ad_group_id}`}
                                              />
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {campaignGroups.size === 0 && (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-xs text-muted-foreground">
                        No bidding data available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Section 3: Smart Bidding Readiness ───────────────────── */}
      {smartBidding.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Smart Bidding Readiness</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">Campaigns need 30+ conversions in 30 days, stable CVR, and reliable tracking to qualify for Target CPA automation.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {smartBidding.map((sb, idx) => {
              const badge = smartBiddingBadge(sb.recommendation);
              const isReady = sb.recommendation === "switch_tcpa" || sb.recommendation === "test_tcpa";
              return (
                <Card key={idx} data-testid={`card-smart-bidding-${idx}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
                        {truncate(sb.campaign_name, 30)}
                      </span>
                      <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", badge.cls)}>
                        {badge.label}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">Conversions (30d)</span>
                        <span className={cn("tabular-nums", sb.conversions_30d >= 30 ? "text-emerald-400" : "text-amber-400")}>
                          {sb.conversions_30d} {sb.conversions_30d >= 30 ? "✓" : "< 30"}
                        </span>
                      </div>
                      {sb.cvr_variance_14d != null && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">CVR Variance (14d)</span>
                          <span className={cn("tabular-nums", sb.cvr_variance_14d < 30 ? "text-emerald-400" : "text-amber-400")}>
                            {sb.cvr_variance_14d.toFixed(1)}%
                          </span>
                        </div>
                      )}
                      {sb.tracking_stable != null && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">Tracking Stable</span>
                          <span className={sb.tracking_stable ? "text-emerald-400" : "text-red-400"}>
                            {sb.tracking_stable ? "Yes" : "No"}
                          </span>
                        </div>
                      )}
                      {sb.suggested_tcpa != null && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted-foreground">Suggested tCPA</span>
                          <span className="tabular-nums font-medium text-foreground">{formatINR(sb.suggested_tcpa, 0)}</span>
                        </div>
                      )}
                    </div>
                    {/* Executable actions */}
                    {isReady && (
                      <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-6 px-2 flex-1 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          onClick={() => setActionDialog({
                            open: true,
                            type: "switch_tcpa",
                            campaignId: sb.campaign_id,
                            campaignName: sb.campaign_name,
                            detail: `Switch "${sb.campaign_name}" to Target CPA bidding at ₹${sb.suggested_tcpa || 850}.`,
                            params: {
                              strategy: "TARGET_CPA",
                              target_cpa: sb.suggested_tcpa || 850,
                              reason: `Smart bidding readiness check passed: ${sb.conversions_30d} conv/30d, CVR variance ${sb.cvr_variance_14d?.toFixed(1)}%`,
                            },
                          })}
                          data-testid={`button-switch-tcpa-${idx}`}
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Switch to tCPA
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-6 px-2 flex-1 text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                          onClick={() => setActionDialog({
                            open: true,
                            type: "switch_max_conv",
                            campaignId: sb.campaign_id,
                            campaignName: sb.campaign_name,
                            detail: `Switch "${sb.campaign_name}" to Maximize Conversions bidding strategy.`,
                            params: {
                              strategy: "MAXIMIZE_CONVERSIONS",
                              reason: "Smart bidding transition — Maximize Conversions as stepping stone to tCPA",
                            },
                          })}
                          data-testid={`button-switch-maxconv-${idx}`}
                        >
                          <TrendingUp className="w-3 h-3 mr-1" />
                          Max Conversions
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
