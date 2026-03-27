import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { formatINR, formatPct, getCplColor, truncate } from "@/lib/format";
import {
  BarChart3,
  Clock,
  AlertTriangle,
  DollarSign,
  Trophy,
  ThumbsDown,
  MapPin,
  Info,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Ban,
  Flag,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedActions, type UnifiedActionItem, type ActionState } from "@/components/unified-actions";

// ─── Meta types ─────────────────────────────────────────────────────

const META_TABS = ["Age", "Gender", "Placement", "Device", "Region"] as const;
type MetaTabType = (typeof META_TABS)[number];

interface BreakdownRow {
  dimension: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  cpl: number;
  classification?: string;
  is_target_location?: boolean;
}

interface BreakdownData {
  available: boolean;
  message?: string;
  breakdowns?: Record<string, BreakdownRow[]>;
  target_locations?: string[];
  geo_alerts?: Array<{
    region: string;
    spend: number;
    leads: number;
    cpl: number;
    alert: string;
  }>;
}

interface CampaignOption {
  id: string;
  name: string;
  cpl: number;
  spend: number;
  leads: number;
}

// ─── Score Calculation ──────────────────────────────────────────────

interface ScoreBreakdown {
  cplScore: number;
  ctrScore: number;
  volumeScore: number;
  efficiencyScore: number;
  total: number;
}

function computeBreakdownScore(
  row: BreakdownRow,
  cplTarget: number,
  ctrTarget: number,
  totalLeads: number,
  totalSpend: number
): ScoreBreakdown {
  // CPL Score (50% weight) — lower is better
  let cplScore = 0;
  if (row.cpl > 0 && cplTarget > 0) {
    const ratio = row.cpl / cplTarget;
    if (ratio <= 0.7) cplScore = 100;
    else if (ratio <= 1.0) cplScore = 70 + (1 - ratio) / 0.3 * 30;
    else if (ratio <= 1.3) cplScore = 40 + (1.3 - ratio) / 0.3 * 30;
    else if (ratio <= 1.6) cplScore = 10 + (1.6 - ratio) / 0.3 * 30;
    else cplScore = Math.max(0, 10 - (ratio - 1.6) * 20);
  } else if (row.leads === 0 && row.spend > 0) {
    cplScore = 0;
  } else {
    cplScore = 50; // no data
  }

  // CTR Score (20% weight) — higher is better
  let ctrScore = 0;
  if (row.ctr > 0 && ctrTarget > 0) {
    const ratio = row.ctr / ctrTarget;
    if (ratio >= 1.5) ctrScore = 100;
    else if (ratio >= 1.0) ctrScore = 60 + (ratio - 1) / 0.5 * 40;
    else if (ratio >= 0.7) ctrScore = 30 + (ratio - 0.7) / 0.3 * 30;
    else ctrScore = Math.max(0, ratio / 0.7 * 30);
  } else {
    ctrScore = 50;
  }

  // Volume Score (20% weight) — share of leads
  let volumeScore = 50;
  if (totalLeads > 0 && row.leads > 0) {
    const share = row.leads / totalLeads;
    volumeScore = Math.min(100, share * 500); // 20% share = 100
  } else if (row.leads === 0) {
    volumeScore = 0;
  }

  // Efficiency Score (10% weight) — spend efficiency
  let efficiencyScore = 50;
  if (totalSpend > 0 && totalLeads > 0 && row.spend > 0) {
    const spendShare = row.spend / totalSpend;
    const leadShare = totalLeads > 0 ? row.leads / totalLeads : 0;
    if (spendShare > 0) {
      const ratio = leadShare / spendShare;
      efficiencyScore = Math.min(100, Math.max(0, ratio * 50));
    }
  }

  const total = Math.round(
    cplScore * 0.5 + ctrScore * 0.2 + volumeScore * 0.2 + efficiencyScore * 0.1
  );

  return {
    cplScore: Math.round(cplScore),
    ctrScore: Math.round(ctrScore),
    volumeScore: Math.round(volumeScore),
    efficiencyScore: Math.round(efficiencyScore),
    total: Math.min(100, Math.max(0, total)),
  };
}

function getScoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function getScoreBg(score: number): string {
  if (score >= 70) return "bg-emerald-500/10 border-emerald-500/30";
  if (score >= 40) return "bg-amber-500/10 border-amber-500/30";
  return "bg-red-500/10 border-red-500/30";
}

function getRecommendationType(row: BreakdownRow, score: number, tab: MetaTabType, isTargetLocation?: boolean): {
  text: string;
  type: "scale" | "reduce" | "exclude" | "flag" | "monitor" | "none";
  color: string;
} {
  if (tab === "Region" && isTargetLocation === false && row.spend > 0) {
    return { text: "Outside target location — flag for review", type: "flag", color: "text-red-400" };
  }
  if (score >= 70 && row.leads > 0) {
    return { text: "Strong performer — scale this segment", type: "scale", color: "text-emerald-400" };
  }
  if (score < 30 && row.spend > 500) {
    if (tab === "Placement") {
      return { text: "Underperforming — exclude this placement", type: "exclude", color: "text-red-400" };
    }
    return { text: "Underperforming — reduce exposure", type: "reduce", color: "text-red-400" };
  }
  if (score < 50 && row.leads === 0 && row.spend > 300) {
    return { text: "No leads — consider excluding", type: "exclude", color: "text-red-400" };
  }
  if (score >= 40 && score < 70) {
    return { text: "Monitor — borderline performance", type: "monitor", color: "text-amber-400" };
  }
  return { text: "—", type: "none", color: "text-muted-foreground" };
}

// ─── Score Expansion Component ──────────────────────────────────────

function ScoreExpansion({ score, row, cplTarget, ctrTarget }: {
  score: ScoreBreakdown;
  row: BreakdownRow;
  cplTarget: number;
  ctrTarget: number;
}) {
  return (
    <div className="p-3 rounded-md bg-muted/30 border border-border/30 space-y-2">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Score Breakdown</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">CPL vs Target (50%)</span>
            <span className={cn("text-[10px] font-medium tabular-nums", getScoreColor(score.cplScore))}>{score.cplScore}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div className={cn("h-full rounded-full", score.cplScore >= 70 ? "bg-emerald-500" : score.cplScore >= 40 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${score.cplScore}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground">
            {row.cpl > 0 ? `${formatINR(row.cpl, 0)} vs ${formatINR(cplTarget, 0)}` : "No leads"}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">CTR vs Target (20%)</span>
            <span className={cn("text-[10px] font-medium tabular-nums", getScoreColor(score.ctrScore))}>{score.ctrScore}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div className={cn("h-full rounded-full", score.ctrScore >= 70 ? "bg-emerald-500" : score.ctrScore >= 40 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${score.ctrScore}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground">
            {formatPct(row.ctr)} vs {formatPct(ctrTarget)}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Volume/Leads (20%)</span>
            <span className={cn("text-[10px] font-medium tabular-nums", getScoreColor(score.volumeScore))}>{score.volumeScore}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div className={cn("h-full rounded-full", score.volumeScore >= 70 ? "bg-emerald-500" : score.volumeScore >= 40 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${score.volumeScore}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground">{row.leads} leads</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Spend Efficiency (10%)</span>
            <span className={cn("text-[10px] font-medium tabular-nums", getScoreColor(score.efficiencyScore))}>{score.efficiencyScore}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div className={cn("h-full rounded-full", score.efficiencyScore >= 70 ? "bg-emerald-500" : score.efficiencyScore >= 40 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${score.efficiencyScore}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground">{formatINR(row.spend, 0)} spend</span>
        </div>
      </div>
    </div>
  );
}

// ─── Google types ───────────────────────────────────────────────────

const GOOGLE_TABS = ["Device", "Network", "Day of Week", "Geographic", "Match Type", "Campaign Type"] as const;
type GoogleTabType = (typeof GOOGLE_TABS)[number];

const GOOGLE_TAB_KEYS: Record<GoogleTabType, string> = {
  "Device": "device",
  "Network": "network",
  "Day of Week": "day_of_week",
  "Geographic": "geographic",
  "Match Type": "match_type",
  "Campaign Type": "campaign_type",
};

function resolveDimension(r: any): string {
  return r.dimension || r.segment || r.age_range || r.gender || r.device_type || r.device || r.network || r.day_of_week || r.placement || r.region || r.name || "Unknown";
}

interface GoogleBreakdownRow {
  dimension: string;
  segment?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  spend?: number;
  conversions: number;
  cpl?: number;
  cpc?: number;
  cvr?: number;
  impression_share?: number;
  bid_adjustment?: number;
  recommendation?: string;
  insight?: string;
}

function computeGoogleBreakdownScore(row: GoogleBreakdownRow, totalCost: number, totalConv: number): {
  score: number;
  classification: "Winner" | "Watch" | "Underperformer" | "New";
  recommendation: string;
  recType: "scale" | "monitor" | "exclude" | "none";
} {
  const cvr = row.cvr || (row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0);
  const cpl = row.cpl || (row.conversions > 0 ? row.cost / row.conversions : 0);
  const costShare = totalCost > 0 ? row.cost / totalCost : 0;
  const convShare = totalConv > 0 ? row.conversions / totalConv : 0;

  // CPL score (40%)
  let cplScore = 50;
  if (cpl > 0) {
    if (cpl < 600) cplScore = 100;
    else if (cpl < 900) cplScore = 70;
    else if (cpl < 1200) cplScore = 40;
    else cplScore = 10;
  } else if (row.cost > 0 && row.conversions === 0) {
    cplScore = 0;
  }

  // CVR score (30%)
  let cvrScore = 50;
  if (cvr > 5) cvrScore = 100;
  else if (cvr > 3) cvrScore = 70;
  else if (cvr > 1) cvrScore = 40;
  else if (row.clicks > 0) cvrScore = 10;

  // CTR score (15%)
  let ctrScore = 50;
  if ((row.ctr || 0) > 3) ctrScore = 100;
  else if ((row.ctr || 0) > 1.5) ctrScore = 70;
  else if ((row.ctr || 0) > 0.5) ctrScore = 40;
  else if (row.impressions > 0) ctrScore = 10;

  // Efficiency (15%)
  let effScore = 50;
  if (costShare > 0 && convShare > 0) {
    const ratio = convShare / costShare;
    effScore = Math.min(100, Math.max(0, ratio * 50));
  }

  const total = Math.round(cplScore * 0.4 + cvrScore * 0.3 + ctrScore * 0.15 + effScore * 0.15);
  const score = Math.min(100, Math.max(0, total));

  let classification: "Winner" | "Watch" | "Underperformer" | "New" = "Watch";
  let recommendation = "Monitor performance";
  let recType: "scale" | "monitor" | "exclude" | "none" = "monitor";

  if (score >= 70 && row.conversions > 0) {
    classification = "Winner";
    recommendation = "Scale — increase bid/budget for this segment";
    recType = "scale";
  } else if (score < 30) {
    classification = "Underperformer";
    recommendation = row.cost > 500 ? "Exclude — reduce exposure to this segment" : "Monitor — low volume, watch for changes";
    recType = row.cost > 500 ? "exclude" : "monitor";
  } else if (row.conversions === 0 && row.cost === 0) {
    classification = "New";
    recommendation = "—";
    recType = "none";
  }

  return { score, classification, recommendation, recType };
}

interface GoogleBreakdownCampaign {
  campaign_name: string;
  campaign_id?: string;
  breakdowns: Record<string, GoogleBreakdownRow[]>;
}

const ACCOUNT_OVERVIEW = "__account__";

// ─── Main Component ─────────────────────────────────────────────────

export default function BreakdownsPage() {
  const { apiBase, analysisData, activePlatform, isLoadingAnalysis, activeCadence } = useClient();
  const isGoogle = activePlatform === "google";

  if (isGoogle) {
    return <GoogleBreakdowns />;
  }
  return <MetaBreakdowns apiBase={apiBase} analysisData={analysisData} isLoadingAnalysis={isLoadingAnalysis} activeCadence={activeCadence} />;
}

// ─── Google Breakdowns ──────────────────────────────────────────────

function GoogleBreakdowns() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();

  const [activeTab, setActiveTab] = useState<GoogleTabType>("Device");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");

  const breakdownData = useMemo(() => {
    if (!data) return null;
    return (data as any).demographic_breakdowns || (data as any).breakdowns || null;
  }, [data]);

  const campaigns = useMemo(() => {
    if (!breakdownData) return [];
    if (Array.isArray(breakdownData)) {
      return breakdownData.map((c: GoogleBreakdownCampaign) => ({
        name: c.campaign_name,
        id: c.campaign_id || c.campaign_name,
      }));
    }
    return Object.keys(breakdownData)
      .filter((k) => typeof breakdownData[k] === "object" && !Array.isArray(breakdownData[k]))
      .map((name) => ({ name, id: name }));
  }, [breakdownData]);

  const rows: GoogleBreakdownRow[] = useMemo(() => {
    if (!breakdownData) return [];
    const tabKey = GOOGLE_TAB_KEYS[activeTab];

    if (selectedCampaign === "all") {
      const allRows: GoogleBreakdownRow[] = [];
      const aggregate = (source: Record<string, GoogleBreakdownRow[]>) => {
        const tabRows = source[tabKey] || [];
        tabRows.forEach((r) => {
          const dimVal = resolveDimension(r);
          const existing = allRows.find((e) => e.dimension === dimVal);
          if (existing) {
            existing.impressions += r.impressions || 0;
            existing.clicks += r.clicks || 0;
            existing.cost += r.cost || r.spend || 0;
            existing.conversions += r.conversions || (r as any).leads || 0;
          } else {
            allRows.push({
              ...r,
              cost: r.cost || r.spend || 0,
              dimension: resolveDimension(r),
              conversions: r.conversions || (r as any).leads || 0,
            });
          }
        });
      };

      if (Array.isArray(breakdownData)) {
        breakdownData.forEach((c: GoogleBreakdownCampaign) => aggregate(c.breakdowns || {}));
      } else {
        Object.values(breakdownData).forEach((v: any) => {
          if (typeof v === "object" && !Array.isArray(v)) {
            aggregate(v);
          }
        });
        if (breakdownData[tabKey] && Array.isArray(breakdownData[tabKey])) {
          return breakdownData[tabKey].map((r: any) => ({
            ...r,
            cost: r.cost || r.spend || 0,
            dimension: resolveDimension(r),
          }));
        }
      }

      return allRows.map((r) => ({
        ...r,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
        cpc: r.clicks > 0 ? r.cost / r.clicks : 0,
        cpl: r.conversions > 0 ? r.cost / r.conversions : 0,
        cvr: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
      }));
    }

    let campaignData: Record<string, GoogleBreakdownRow[]> = {};
    if (Array.isArray(breakdownData)) {
      const found = breakdownData.find(
        (c: GoogleBreakdownCampaign) => c.campaign_name === selectedCampaign || c.campaign_id === selectedCampaign
      );
      campaignData = found?.breakdowns || {};
    } else {
      campaignData = breakdownData[selectedCampaign] || {};
    }

    return (campaignData[tabKey] || []).map((r: any) => ({
      ...r,
      cost: r.cost || r.spend || 0,
      dimension: resolveDimension(r),
    }));
  }, [breakdownData, activeTab, selectedCampaign]);

  const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const totalConversions = rows.reduce((s, r) => s + (r.conversions || 0), 0);
  const rowsWithConv = rows.filter((r) => r.conversions > 0);
  const best = rowsWithConv.length > 0 ? rowsWithConv.reduce((a, b) => ((a.cpl || Infinity) < (b.cpl || Infinity) ? a : b)) : null;
  const worst = rowsWithConv.length > 0 ? rowsWithConv.reduce((a, b) => ((a.cpl || 0) > (b.cpl || 0) ? a : b)) : null;

  if (isLoading || !data) {
    return (
      <div className="p-6" data-testid="breakdowns-loading">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  if (!breakdownData) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]" data-testid="breakdowns-empty">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-white" />
          <h1 className="text-lg font-semibold text-white">Breakdowns</h1>
        </div>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="w-10 h-10 text-gray-500 mb-3" />
            <p className="text-sm text-gray-400">
              Demographic breakdown data will be available after the next agent run with biweekly+ cadence.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px]" data-testid="breakdowns-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-white" />
          <div>
            <h1 className="text-lg font-semibold text-white">Breakdowns</h1>
            <p className="text-xs text-gray-400">Performance by demographic dimensions across Google campaigns</p>
          </div>
        </div>

        <select
          className="text-xs bg-[#1a1a2e] border border-gray-700 rounded-md px-3 py-1.5 text-white min-w-[250px]"
          value={selectedCampaign}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          data-testid="select-breakdown-campaign"
        >
          <option value="all">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{truncate(c.name, 45)}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="breakdowns-summary">
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-[#F0BC00]" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Total Cost</span>
            </div>
            <p className="text-sm font-semibold text-white tabular-nums">{formatINR(totalCost, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Best Performing</span>
            </div>
            {best ? (
              <p className="text-sm font-semibold text-emerald-400 truncate">
                {best.dimension} <span className="text-xs font-normal text-gray-500">CPL {formatINR(best.cpl || 0, 0)}</span>
              </p>
            ) : (
              <p className="text-sm text-gray-500">—</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <ThumbsDown className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Worst Performing</span>
            </div>
            {worst ? (
              <p className="text-sm font-semibold text-red-400 truncate">
                {worst.dimension} <span className="text-xs font-normal text-gray-500">CPL {formatINR(worst.cpl || 0, 0)}</span>
              </p>
            ) : (
              <p className="text-sm text-gray-500">—</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Segments</span>
            </div>
            <p className="text-sm font-semibold text-white tabular-nums">{rows.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-800 pb-px">
        {GOOGLE_TABS.map((tab) => (
          <button
            key={tab}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors border-b-2",
              activeTab === tab
                ? "text-white border-[#F0BC00]"
                : "text-gray-400 border-transparent hover:text-white"
            )}
            onClick={() => setActiveTab(tab)}
            data-testid={`tab-breakdown-${tab.toLowerCase().replace(/ /g, "-")}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-12 text-center">
            <Clock className="w-10 h-10 mx-auto text-gray-600 mb-3" />
            <p className="text-sm text-gray-400">
              No {activeTab.toLowerCase()} breakdown data available
              {selectedCampaign !== "all" ? " for this campaign" : ""}.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Data will be available after next agent run with this breakdown dimension enabled.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">{activeTab}</th>
                    <th className="text-center p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Score</th>
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Class</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Cost</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Cost %</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Impr</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Clicks</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">CTR</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">Conv</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">CVR</th>
                    <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500">CPL</th>
                    <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 min-w-[160px]">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const costPct = totalCost > 0 ? ((row.cost || 0) / totalCost) * 100 : 0;
                    const cpl = row.cpl || (row.conversions > 0 ? row.cost / row.conversions : 0);
                    const cvr = row.cvr || (row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0);
                    const ctr = row.ctr || (row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0);
                    const scored = computeGoogleBreakdownScore(row, totalCost, totalConversions);

                    return (
                      <tr
                        key={i}
                        className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                        data-testid={`row-breakdown-${i}`}
                      >
                        <td className="p-3 font-medium text-white">
                          <div className="flex items-center gap-1.5">
                            <span>{row.dimension}</span>
                            {row.bid_adjustment != null && row.bid_adjustment !== 0 && (
                              <Badge variant="outline" className={cn(
                                "text-[9px] px-1 py-0 border",
                                row.bid_adjustment > 0
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : "bg-red-500/10 text-red-400 border-red-500/30"
                              )}>
                                {row.bid_adjustment > 0 ? "+" : ""}{row.bid_adjustment}%
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn(
                                "inline-flex items-center justify-center w-7 h-7 rounded-full border text-[10px] font-bold cursor-help",
                                scored.score >= 70 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                                scored.score >= 40 ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                                "bg-red-500/10 border-red-500/30 text-red-400"
                              )}>
                                {scored.score}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[200px]">
                              <div className="text-xs space-y-0.5">
                                <p className="font-medium">Score: {scored.score}/100</p>
                                <p className="text-muted-foreground">CPL (40%) + CVR (30%) + CTR (15%) + Efficiency (15%)</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border",
                            scored.classification === "Winner" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                            scored.classification === "Underperformer" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                            scored.classification === "New" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          )}>
                            {scored.classification}
                          </Badge>
                        </td>
                        <td className="p-3 text-right tabular-nums text-white">{formatINR(row.cost, 0)}</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-14 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#F0BC00]/60"
                                style={{ width: `${Math.min(costPct, 100)}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-gray-400 w-10 text-right">{costPct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-400">{row.impressions.toLocaleString()}</td>
                        <td className="p-3 text-right tabular-nums text-gray-400">{row.clicks.toLocaleString()}</td>
                        <td className="p-3 text-right tabular-nums text-gray-400">{ctr.toFixed(1)}%</td>
                        <td className="p-3 text-right tabular-nums">
                          <span className={row.conversions > 0 ? "text-emerald-400" : "text-gray-500"}>{row.conversions}</span>
                        </td>
                        <td className="p-3 text-right tabular-nums text-gray-400">{cvr > 0 ? `${cvr.toFixed(1)}%` : "—"}</td>
                        <td className={cn("p-3 text-right tabular-nums font-medium", cpl > 0 ? (cpl > 1500 ? "text-red-400" : cpl < 800 ? "text-emerald-400" : "text-white") : "text-gray-500")}>
                          {cpl > 0 ? formatINR(cpl, 0) : "—"}
                        </td>
                        <td className="p-3">
                          {scored.recType !== "none" ? (
                            <div className="flex items-center gap-1.5">
                              {scored.recType === "scale" && <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />}
                              {scored.recType === "exclude" && <Ban className="w-3 h-3 text-red-400 shrink-0" />}
                              {scored.recType === "monitor" && <Eye className="w-3 h-3 text-amber-400 shrink-0" />}
                              <span className={cn("text-[10px]",
                                scored.recType === "scale" ? "text-emerald-400" :
                                scored.recType === "exclude" ? "text-red-400" :
                                "text-amber-400"
                              )}>
                                {scored.recommendation}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-[#1a1a2e]/40 border-gray-800/60">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-gray-500 space-y-1">
            <p>Demographic breakdowns are collected from Google Ads via GAQL queries on biweekly+ cadence.</p>
            <p>Bid adjustment recommendations are based on relative CPL performance vs campaign average. Positive adjustments suggest increasing bids for high-performing segments.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Meta Breakdowns (enhanced with scoring) ────────────────────────

function MetaBreakdowns({ apiBase, analysisData, isLoadingAnalysis, activeCadence }: {
  apiBase: string;
  analysisData: any;
  isLoadingAnalysis: boolean;
  activeCadence: string;
}) {
  const [activeTab, setActiveTab] = useState<MetaTabType>("Age");
  const [selectedCampaign, setSelectedCampaign] = useState(ACCOUNT_OVERVIEW);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const thresholds = analysisData?.dynamic_thresholds;
  const cplTarget = thresholds?.cpl_target ?? 0;
  const ctrTarget = thresholds?.ctr_min ?? 0.7;

  const campaigns: CampaignOption[] = useMemo(() => {
    if (!analysisData?.campaign_audit) return [];
    return analysisData.campaign_audit
      .filter((c: any) => c.spend > 0)
      .map((c: any) => ({
        id: c.campaign_id,
        name: c.campaign_name,
        cpl: c.cpl,
        spend: c.spend,
        leads: c.leads,
      }))
      .sort((a: CampaignOption, b: CampaignOption) => b.spend - a.spend);
  }, [analysisData]);

  const breakdownUrl =
    selectedCampaign === ACCOUNT_OVERVIEW
      ? `${apiBase}/breakdowns?cadence=${activeCadence}`
      : `${apiBase}/breakdowns/${selectedCampaign}?cadence=${activeCadence}`;

  const { data, isLoading } = useQuery<BreakdownData>({
    queryKey: [apiBase, "breakdowns", selectedCampaign, activeCadence],
    queryFn: async () => {
      const res = await apiRequest("GET", breakdownUrl);
      return res.json();
    },
  });

  const tabKey = activeTab.toLowerCase();
  const rows: BreakdownRow[] =
    data?.available && data.breakdowns?.[tabKey] ? data.breakdowns[tabKey] : [];
  const geoAlerts = data?.geo_alerts || [];
  const targetLocations = data?.target_locations || [];

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  const rowsWithLeads = rows.filter((r) => r.leads > 0 && r.cpl > 0);
  const best = rowsWithLeads.length > 0 ? rowsWithLeads.reduce((a, b) => (a.cpl < b.cpl ? a : b)) : null;
  const worst = rowsWithLeads.length > 0 ? rowsWithLeads.reduce((a, b) => (a.cpl > b.cpl ? a : b)) : null;
  const outsideTargetSpend = geoAlerts.reduce((s, a) => s + a.spend, 0);

  // Compute scores for all rows
  const scoredRows = useMemo(() => {
    return rows.map((row) => ({
      row,
      score: computeBreakdownScore(row, cplTarget, ctrTarget, totalLeads, totalSpend),
      recommendation: getRecommendationType(row, computeBreakdownScore(row, cplTarget, ctrTarget, totalLeads, totalSpend).total, activeTab, row.is_target_location),
    }));
  }, [rows, cplTarget, ctrTarget, totalLeads, totalSpend, activeTab]);

  function handleActionStateChange(id: string, state: ActionState) {
    setActionStates(prev => ({ ...prev, [id]: state }));
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-[400px] rounded-md" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Breakdowns</h1>
            <p className="text-xs text-muted-foreground">Performance by demographic and placement dimensions · Scored 0-100</p>
          </div>
        </div>
        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
          <SelectTrigger className="w-[320px] h-9 text-xs bg-background">
            <SelectValue placeholder="Select campaign" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACCOUNT_OVERVIEW}>
              <span className="font-medium">Account Overview</span>
              <span className="ml-2 text-muted-foreground text-[10px]">(all campaigns)</span>
            </SelectItem>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[180px]">{truncate(c.name, 28)}</span>
                  <Badge variant="secondary" className={`text-[9px] ml-auto ${getCplColor(c.cpl, thresholds)}`}>
                    CPL {formatINR(c.cpl, 0)}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {geoAlerts.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-xs font-medium text-red-400">
              Geo-Spend Alert: Spend detected outside target locations ({targetLocations.join(", ")})
            </span>
          </div>
          <div className="space-y-1 pl-6">
            {geoAlerts.map((ga, i) => (
              <p key={i} className="text-[11px] text-red-300/80">
                {ga.region}: {formatINR(ga.spend, 0)} | {ga.leads} leads | CPL {ga.cpl > 0 ? formatINR(ga.cpl, 0) : "—"}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border/50 pb-px">
        {META_TABS.map((tab) => (
          <button
            key={tab}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors border-b-2",
              activeTab === tab
                ? "text-primary border-primary bg-primary/5"
                : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50"
            )}
            onClick={() => { setActiveTab(tab); setExpandedRow(null); }}
            data-testid={`tab-breakdown-${tab.toLowerCase()}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {!data?.available ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {data?.message || "Breakdown data will be available after the next agent run."}
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No {activeTab.toLowerCase()} breakdown data available{selectedCampaign !== ACCOUNT_OVERVIEW ? " for this campaign" : ""} yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Spend</span>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatINR(totalSpend, 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Best Performing</span>
                </div>
                {best ? (
                  <p className="text-sm font-semibold text-emerald-400 truncate">
                    {best.dimension} <span className="text-xs font-normal text-muted-foreground">CPL {formatINR(best.cpl, 0)}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ThumbsDown className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Worst Performing</span>
                </div>
                {worst ? (
                  <p className="text-sm font-semibold text-red-400 truncate">
                    {worst.dimension} <span className="text-xs font-normal text-muted-foreground">CPL {formatINR(worst.cpl, 0)}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Geo Status</span>
                </div>
                {geoAlerts.length === 0 ? (
                  <p className="text-sm font-semibold text-emerald-400">All spend within target</p>
                ) : (
                  <p className="text-sm font-semibold text-red-400">{formatINR(outsideTargetSpend, 0)} outside target</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{activeTab}</th>
                      <th className="text-center p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Score</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Spend</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Spend %</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Impr.</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Clicks</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">CTR</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">CPC</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">CPM</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Leads</th>
                      <th className="text-right p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">CPL</th>
                      <th className="text-left p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground min-w-[160px]">Recommendation</th>
                      <th className="text-center p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoredRows.map(({ row, score, recommendation: rec }, i) => {
                      const cplColor = getCplColor(row.cpl, thresholds);
                      const spendPct = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
                      const isExpanded = expandedRow === i;
                      const itemId = `breakdown-${activeTab}-${row.dimension}`;

                      const actionItem: UnifiedActionItem = {
                        id: itemId,
                        description: `${rec.type === "scale" ? "Scale" : rec.type === "reduce" ? "Reduce" : rec.type === "exclude" ? "Exclude" : "Review"} ${activeTab}: ${row.dimension}`,
                        autoExecutable: false,
                      };

                      return (
                        <tr key={i} className={cn("border-b border-border/30 hover:bg-muted/30 transition-colors", isExpanded && "bg-muted/20")} data-testid={`row-breakdown-${i}`}>
                          <td className="p-3 font-medium text-foreground">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                className="flex items-center gap-1 hover:text-primary transition-colors"
                                onClick={() => setExpandedRow(isExpanded ? null : i)}
                              >
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                <span>{row.dimension}</span>
                              </button>
                              {row.classification && (
                                <Badge variant="secondary" className={`text-[9px] ${row.classification === "WINNER" ? "text-emerald-400" : row.classification === "UNDERPERFORMER" ? "text-red-400" : "text-amber-400"}`}>
                                  {row.classification}
                                </Badge>
                              )}
                              {activeTab === "Region" && row.is_target_location === true && (
                                <Badge variant="secondary" className="text-[9px] text-emerald-400 bg-emerald-500/10">Target</Badge>
                              )}
                              {activeTab === "Region" && row.is_target_location === false && row.spend > 0 && (
                                <Badge variant="secondary" className="text-[9px] text-red-400 bg-red-500/10">Outside Target</Badge>
                              )}
                            </div>
                            {/* Expanded score breakdown */}
                            {isExpanded && (
                              <div className="mt-3 space-y-3">
                                <ScoreExpansion score={score} row={row} cplTarget={cplTarget} ctrTarget={ctrTarget} />
                                <UnifiedActions
                                  item={actionItem}
                                  entityId={itemId}
                                  entityName={`${activeTab}: ${row.dimension}`}
                                  entityType="adset"
                                  actionType="MANUAL_ACTION"
                                  recommendation={rec.text}
                                  onStateChange={handleActionStateChange}
                                  compact
                                />
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className={cn("inline-flex items-center justify-center w-8 h-8 rounded-full border text-xs font-bold cursor-pointer transition-colors", getScoreBg(score.total), getScoreColor(score.total))}
                                  onClick={() => setExpandedRow(isExpanded ? null : i)}
                                >
                                  {score.total}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[220px]">
                                <div className="text-xs space-y-1">
                                  <p className="font-medium">Score Breakdown</p>
                                  <p>CPL vs Target (50%): {score.cplScore}</p>
                                  <p>CTR vs Benchmark (20%): {score.ctrScore}</p>
                                  <p>Volume/Leads (20%): {score.volumeScore}</p>
                                  <p>Spend Efficiency (10%): {score.efficiencyScore}</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="p-3 text-right tabular-nums">{formatINR(row.spend, 0)}</td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                                <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(spendPct, 100)}%` }} />
                              </div>
                              <span className="tabular-nums text-muted-foreground w-10 text-right">{spendPct.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">{row.impressions.toLocaleString()}</td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">{row.clicks.toLocaleString()}</td>
                          <td className="p-3 text-right tabular-nums">{formatPct(row.ctr)}</td>
                          <td className="p-3 text-right tabular-nums">{formatINR(row.cpc, 2)}</td>
                          <td className="p-3 text-right tabular-nums">{formatINR(row.cpm, 0)}</td>
                          <td className="p-3 text-right tabular-nums font-medium">{row.leads}</td>
                          <td className={`p-3 text-right tabular-nums font-medium ${cplColor}`}>{row.cpl > 0 ? formatINR(row.cpl, 0) : "—"}</td>
                          <td className="p-3">
                            {rec.type !== "none" ? (
                              <div className="flex items-center gap-1.5">
                                {rec.type === "scale" && <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />}
                                {rec.type === "reduce" && <TrendingDown className="w-3 h-3 text-red-400 shrink-0" />}
                                {rec.type === "exclude" && <Ban className="w-3 h-3 text-red-400 shrink-0" />}
                                {rec.type === "flag" && <Flag className="w-3 h-3 text-red-400 shrink-0" />}
                                {rec.type === "monitor" && <Eye className="w-3 h-3 text-amber-400 shrink-0" />}
                                <span className={cn("text-[10px]", rec.color)}>{rec.text}</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {rec.type !== "none" && !isExpanded && (
                              <button
                                className="text-[10px] text-primary hover:underline"
                                onClick={() => setExpandedRow(i)}
                              >
                                Actions
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Scoring methodology */}
      <Card className="bg-muted/20 border-border/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Score Methodology (0-100):</strong> CPL vs Target (50%) + CTR vs Benchmark (20%) + Volume/Leads (20%) + Spend Efficiency (10%)</p>
            <p><strong>Actions:</strong> For age/gender: Scale or Reduce. For placements: Exclude underperformers. For regions: Flag if outside target location.</p>
            <p>Click any score badge or row chevron to expand the full breakdown and access action buttons.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
