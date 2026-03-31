import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Users,
  AlertTriangle,
  Eye,
  Image,
  Video,
  Layers,
  BarChart3,
  TrendingUp,
  Play,
  Timer,
  Info,
  RefreshCw,
} from "lucide-react";
import { formatINR, formatPct, formatNumber, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

interface DgAd {
  ad_name: string;
  ad_type: "IMAGE" | "VIDEO" | "CAROUSEL" | string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  leads: number;
  cpl: number;
  tsr?: number; // Thumb Stop Rate = 3s views / impressions
  vhr?: number; // Video Hold Rate = 15s proxy
  video_metrics?: {
    video_views: number;
    video_view_rate: number;
    video_quartile_25: number;
    video_quartile_50: number;
    video_quartile_75: number;
    video_quartile_100: number;
  };
  cpm?: number;
  performance_score?: number;
  status?: "winner" | "performer" | "underperformer" | "pause_candidate";
  creative_age_days?: number;
  ctr_change_pct?: number; // negative = drop, e.g. -35 means 35% drop
}

interface AudienceSegment {
  segment_name: string;
  impressions: number;
  leads: number;
  cpl: number;
  ctr: number;
  spend?: number;
  performance_rank?: number;
  recommendation: "scale" | "maintain" | "trim" | "pause";
}

interface AudienceVsOptimized {
  audience_pct: number;
  optimized_pct: number;
  audience_cpl: number;
  optimized_cpl: number;
  better_performer: "audience" | "optimized";
  recommendation?: string;
}

interface DgCampaign {
  campaign_id?: string;
  campaign_name: string;
  campaign_type?: string;
  audience_type?: string;
  cpm?: number;
  cpm_vs_baseline?: string;
  ctr?: number;
  cpc?: number;
  frequency_7d?: number;
  frequency_14d?: number;
  frequency_28d?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  leads?: number;
  conversions?: number;
  cpl?: number;
  optimized_targeting?: boolean;
  ads?: DgAd[];
  audience_analysis?: {
    audience_vs_optimized_targeting?: AudienceVsOptimized;
    per_audience_segment?: AudienceSegment[];
    audience_pruning?: {
      top_30_pct?: string[];
      bottom_30_pct?: string[];
      action?: string;
    };
    overlap_detection?: string;
  };
  placement_analysis?: {
    placements_to_exclude?: string[];
    youtube_retarget_cohorts?: string[];
  };
}

interface DgSummary {
  campaign_count?: number;
  total_spend?: number;
  total_impressions?: number;
  total_clicks?: number;
  total_conversions?: number;
  avg_cpm?: number;
  avg_ctr?: number;
  avg_cpl?: number;
  avg_frequency?: number;
  video_metrics_aggregate?: {
    avg_tsr?: number;
    avg_vhr?: number;
    total_video_views?: number;
  };
}

interface FrequencyAuditEntry {
  campaign_name?: string;
  campaign_id?: string;
  frequency_7d?: number;
  frequency_14d?: number;
  frequency_28d?: number;
  status?: string;
  recommendation?: string;
}

type Tab = "overview" | "ads" | "audiences" | "frequency";

// ─── Helpers ─────────────────────────────────────────────────────────

function adTypeBadge(type: string): { label: string; cls: string; Icon: typeof Image } {
  switch (type?.toUpperCase()) {
    case "VIDEO": return { label: "Video", cls: "bg-violet-500/15 text-violet-400", Icon: Video };
    case "CAROUSEL": return { label: "Carousel", cls: "bg-blue-500/15 text-blue-400", Icon: Layers };
    default: return { label: "Image", cls: "bg-emerald-500/15 text-emerald-400", Icon: Image };
  }
}

function creativeStatusBadge(status?: string): { label: string; cls: string } {
  switch (status) {
    case "winner": return { label: "Winner", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "performer": return { label: "Performer", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "underperformer": return { label: "Under", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "pause_candidate": return { label: "Pause", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
    default: return { label: status || "—", cls: "bg-gray-500/15 text-gray-400 border-gray-700" };
  }
}

function audienceRecBadge(rec: string): { label: string; cls: string } {
  switch (rec) {
    case "scale": return { label: "Scale", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "maintain": return { label: "Maintain", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "trim": return { label: "Trim", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "pause": return { label: "Pause", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
    default: return { label: rec || "—", cls: "bg-gray-500/15 text-gray-400 border-gray-700" };
  }
}

function freqColor(freq: number): string {
  if (freq >= 6) return "text-red-400";
  if (freq >= 4) return "text-amber-400";
  return "text-emerald-400";
}

function tsrColor(tsr: number): string {
  if (tsr >= 30) return "text-emerald-400";
  if (tsr >= 15) return "text-amber-400";
  return "text-red-400";
}

function vhrColor(vhr: number): string {
  if (vhr >= 15) return "text-emerald-400";
  if (vhr >= 8) return "text-amber-400";
  return "text-red-400";
}

function quartile100Color(pct: number): string {
  if (pct > 20) return "text-emerald-400";
  if (pct >= 10) return "text-amber-400";
  return "text-red-400";
}

function creativeAgeColor(days: number): string {
  if (days < 21) return "text-emerald-400";
  if (days <= 40) return "text-amber-400";
  return "text-red-400";
}

function audienceRecText(rec: string): string {
  switch (rec) {
    case "scale": return "Increase budget allocation by 15-25%";
    case "maintain": return "Keep current allocation";
    case "trim": return "Reduce budget by 10-15%, reallocate to top performers";
    case "pause": return "Pause and reallocate budget to better segments";
    default: return "—";
  }
}

function isDemandGenCampaignType(value?: string): boolean {
  const normalized = String(value || "").toLowerCase();
  return normalized.includes("demand_gen") || normalized === "demand gen";
}

function normalizeDgCampaign(raw: any): DgCampaign {
  return {
    campaign_id: raw.campaign_id || raw.id,
    campaign_name: raw.campaign_name || raw.name || "Unnamed campaign",
    campaign_type: raw.campaign_type || raw.type || raw.campaign_subtype || raw.channel_type,
    audience_type: raw.audience_type,
    cpm: raw.cpm ?? raw.avg_cpm ?? 0,
    cpm_vs_baseline: raw.cpm_vs_baseline,
    ctr: raw.ctr ?? 0,
    cpc: raw.cpc ?? raw.avg_cpc ?? 0,
    frequency_7d: raw.frequency_7d,
    frequency_14d: raw.frequency_14d,
    frequency_28d: raw.frequency_28d,
    spend: raw.spend ?? raw.cost ?? 0,
    impressions: raw.impressions ?? 0,
    clicks: raw.clicks ?? 0,
    leads: raw.leads ?? raw.conversions ?? 0,
    conversions: raw.conversions ?? raw.leads ?? 0,
    cpl: raw.cpl ?? 0,
    optimized_targeting: raw.optimized_targeting,
    ads: Array.isArray(raw.ads) ? raw.ads : [],
    audience_analysis: raw.audience_analysis,
    placement_analysis: raw.placement_analysis,
  };
}

function normalizeDgSummary(rawSummary: any, campaigns: DgCampaign[]): DgSummary | null {
  if (!rawSummary && campaigns.length === 0) return null;

  const totalSpend = rawSummary?.total_spend ?? rawSummary?.spend ?? campaigns.reduce((sum, campaign) => sum + (campaign.spend || 0), 0);
  const totalImpressions = rawSummary?.total_impressions ?? campaigns.reduce((sum, campaign) => sum + (campaign.impressions || 0), 0);
  const totalClicks = rawSummary?.total_clicks ?? campaigns.reduce((sum, campaign) => sum + (campaign.clicks || 0), 0);
  const totalConversions = rawSummary?.total_conversions ?? rawSummary?.leads ?? campaigns.reduce((sum, campaign) => sum + (campaign.leads || campaign.conversions || 0), 0);

  return {
    campaign_count: rawSummary?.campaign_count ?? campaigns.length,
    total_spend: totalSpend,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    total_conversions: totalConversions,
    avg_cpm: rawSummary?.avg_cpm ?? rawSummary?.cpm ?? (totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0),
    avg_ctr: rawSummary?.avg_ctr ?? rawSummary?.ctr ?? (totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0),
    avg_cpl: rawSummary?.avg_cpl ?? rawSummary?.cpl ?? (totalConversions > 0 ? totalSpend / totalConversions : 0),
    avg_frequency: rawSummary?.avg_frequency,
    video_metrics_aggregate: rawSummary?.video_metrics_aggregate,
  };
}

// ─── Component ───────────────────────────────────────────────────────

export default function GoogleDemandGenPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [sortKey, setSortKey] = useState<string>("cpl");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const dgCampaigns: DgCampaign[] = useMemo(() => {
    if (!data) return [];
    const summaryCampaigns = Array.isArray((data as any).dg_summary?.campaigns)
      ? (data as any).dg_summary.campaigns
      : [];
    if (summaryCampaigns.length > 0) {
      return summaryCampaigns.map(normalizeDgCampaign);
    }

    const allCampaigns = ((data as any).campaigns || []).filter((campaign: any) =>
      isDemandGenCampaignType(campaign.campaign_type || campaign.type || campaign.campaign_subtype || campaign.channel_type)
    );
    if (allCampaigns.length > 0) return allCampaigns.map(normalizeDgCampaign);

    const dga = (data as any).demand_gen_analysis;
    return Array.isArray(dga?.campaigns) ? dga.campaigns.map(normalizeDgCampaign) : [];
  }, [data]);

  // Read from dg_summary (new) or demand_gen_analysis (old)
  const dgSummary: DgSummary | null = useMemo(() => {
    if (!data) return null;
    return normalizeDgSummary((data as any).dg_summary, dgCampaigns);
  }, [data, dgCampaigns]);

  // DG frequency audit entries
  const freqAudit: FrequencyAuditEntry[] = useMemo(() => {
    if (!data) return [];
    const fa = (data as any).frequency_audit;
    if (!fa) return [];
    const dgCampaignNames = new Set(dgCampaigns.map((campaign) => campaign.campaign_name));
    // frequency_audit may be keyed by campaign name or be an array
    if (Array.isArray(fa)) {
      return fa.filter((entry: any) =>
        isDemandGenCampaignType(entry.campaign_type) ||
        dgCampaignNames.has(entry.campaign_name || entry.campaign || "")
      );
    }
    // Object keyed by campaign name
    return Object.entries(fa).map(([name, v]: [string, any]) => ({
      campaign_name: name,
      ...v,
    })).filter((entry) => dgCampaignNames.has(entry.campaign_name || ""));
  }, [data, dgCampaigns]);

  // Flatten all ads
  const allAds = useMemo(() => {
    const ads: (DgAd & { campaign_name: string })[] = [];
    dgCampaigns.forEach((c) => {
      (c.ads || []).forEach((ad) => ads.push({ ...ad, campaign_name: c.campaign_name }));
    });
    const dga = (data as any)?.demand_gen_analysis;
    (dga?.creative_health || []).forEach((ad: DgAd) => {
      if (!ads.find((a) => a.ad_name === ad.ad_name)) {
        ads.push({ ...ad, campaign_name: "—" });
      }
    });
    return ads;
  }, [dgCampaigns, data]);

  // Flatten audiences
  const allAudiences = useMemo(() => {
    const dga = (data as any)?.demand_gen_analysis;
    if (dga?.audience_analysis?.length > 0) return dga.audience_analysis;
    const segs: (AudienceSegment & { campaign_name?: string })[] = [];
    dgCampaigns.forEach((c) => {
      (c.audience_analysis?.per_audience_segment || []).forEach((s) =>
        segs.push({ ...s, campaign_name: c.campaign_name })
      );
    });
    return segs;
  }, [dgCampaigns, data]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  // Loading
  if (isLoading || !data) {
    return (
      <div className="p-6" data-testid="demand-gen-loading">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-[500px] rounded-md" />
      </div>
    );
  }

  // Empty state
  if (dgCampaigns.length === 0 && !dgSummary) {
    return (
      <div className="p-6 space-y-4 max-w-[1800px]" data-testid="demand-gen-empty">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users className="w-5 h-5" />
            Demand Gen
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Campaign performance, audience analysis, and creative health for Demand Gen
          </p>
        </div>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="w-10 h-10 text-gray-500 mb-3" />
            <p className="text-sm text-gray-400">
              Demand Gen data will be available after the next Google Ads agent run.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Compute summary from dgSummary or dgCampaigns
  const totalSpend = dgSummary?.total_spend ?? dgCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalImpr = dgSummary?.total_impressions ?? dgCampaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalLeads = dgSummary?.total_conversions ?? dgCampaigns.reduce((s, c) => s + (c.leads || c.conversions || 0), 0);
  const avgCpm = dgSummary?.avg_cpm ?? (dgCampaigns.length > 0 ? dgCampaigns.reduce((s, c) => s + (c.cpm || 0), 0) / dgCampaigns.length : 0);
  const avgCtr = dgSummary?.avg_ctr ?? (dgCampaigns.length > 0 ? dgCampaigns.reduce((s, c) => s + (c.ctr || 0), 0) / dgCampaigns.length : 0);
  const avgFreq = dgSummary?.avg_frequency ?? (dgCampaigns.length > 0
    ? dgCampaigns.filter((c) => c.frequency_28d).reduce((s, c) => s + (c.frequency_28d || 0), 0) / Math.max(dgCampaigns.filter((c) => c.frequency_28d).length, 1)
    : 0);
  const videoAgg = dgSummary?.video_metrics_aggregate;

  // GDG-04: CPM alert — campaigns with CPM > 200 AND weak CPL (>1200 or no leads)
  const highCpmWeakCplCampaigns = dgCampaigns.filter(
    (c) => (c.cpm || 0) > 200 && ((c.cpl || 0) > 1200 || (c.leads || c.conversions || 0) === 0)
  );

  // GDG-05: total DG spend for Budget % calculation
  const totalAudienceSpend = allAudiences.reduce((s: number, seg: any) => s + (seg.spend || 0), 0);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "ads", label: `Ads (${allAds.length})` },
    { key: "audiences", label: `Audiences (${allAudiences.length})` },
    { key: "frequency", label: "Frequency" },
  ];

  return (
    <div className="p-6 space-y-4 max-w-[1800px]" data-testid="demand-gen-page">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Users className="w-5 h-5" />
          Demand Gen
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          {dgCampaigns.length} DG campaign{dgCampaigns.length !== 1 ? "s" : ""} · {formatNumber(totalLeads)} leads · {formatINR(totalSpend, 0)} spend
        </p>
      </div>

      {/* Top-level KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="dg-summary-cards">
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Spend</p>
            <p className="text-xl font-bold text-white tabular-nums">{formatINR(totalSpend, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Impressions</p>
            <p className="text-xl font-bold text-white tabular-nums">{formatNumber(totalImpr)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">CPM</p>
            <p className={cn("text-xl font-bold tabular-nums", avgCpm > 200 ? "text-red-400" : avgCpm > 120 ? "text-amber-400" : "text-emerald-400")}>
              {formatINR(avgCpm, 0)}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">Baseline ₹120 · Alert ₹200</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">CTR</p>
            <p className={cn("text-xl font-bold tabular-nums", avgCtr < 0.5 ? "text-red-400" : avgCtr >= 1 ? "text-emerald-400" : "text-amber-400")}>
              {avgCtr.toFixed(2)}%
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">Target 0.5–1%</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Leads</p>
            <p className="text-xl font-bold text-white tabular-nums">{formatNumber(totalLeads)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Frequency</p>
            <p className={cn("text-xl font-bold tabular-nums", freqColor(avgFreq))}>
              {avgFreq > 0 ? `${avgFreq.toFixed(1)}×` : "—"}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">Warn 4× · Severe 6×</p>
          </CardContent>
        </Card>
      </div>

      {/* Video Metrics Row (TSR/VHR) */}
      {videoAgg && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="dg-video-metrics">
          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Play className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400">Thumb Stop Rate (TSR)</p>
                <p className={cn("text-lg font-bold tabular-nums", tsrColor(videoAgg.avg_tsr || 0))}>
                  {videoAgg.avg_tsr != null ? `${videoAgg.avg_tsr.toFixed(1)}%` : "—"}
                </p>
                <p className="text-[10px] text-gray-500">3s views / impressions</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Timer className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400">Video Hold Rate (VHR)</p>
                <p className={cn("text-lg font-bold tabular-nums", vhrColor(videoAgg.avg_vhr || 0))}>
                  {videoAgg.avg_vhr != null ? `${videoAgg.avg_vhr.toFixed(1)}%` : "—"}
                </p>
                <p className="text-[10px] text-gray-500">15s proxy / 3s views</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Video className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400">Total Video Views</p>
                <p className="text-lg font-bold text-white tabular-nums">
                  {videoAgg.total_video_views != null ? formatNumber(videoAgg.total_video_views) : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Frequency alert */}
      {avgFreq >= 4 && (
        <Card className={cn("border", avgFreq >= 6 ? "bg-red-500/5 border-red-500/30" : "bg-amber-500/5 border-amber-500/30")} data-testid="dg-freq-alert">
          <CardContent className="p-4">
            <p className={cn("text-xs font-medium flex items-center gap-1.5", avgFreq >= 6 ? "text-red-400" : "text-amber-400")}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Frequency at {avgFreq.toFixed(1)}× — {avgFreq >= 6 ? "severe audience fatigue risk" : "approaching fatigue threshold"}.
              Consider refreshing creatives or expanding audience targeting.
            </p>
          </CardContent>
        </Card>
      )}

      {/* GDG-04: CPM benchmark alert card */}
      {highCpmWeakCplCampaigns.length > 0 && (
        <Card className="bg-amber-500/5 border-amber-500/30" data-testid="dg-cpm-alert">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {highCpmWeakCplCampaigns.length} campaign{highCpmWeakCplCampaigns.length !== 1 ? "s" : ""} with CPM &gt; ₹200 — SOP recommends creative refresh when CPM exceeds benchmark with weak CPL
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                  {highCpmWeakCplCampaigns.map((c, idx) => (
                <span key={idx} className="text-[10px] text-gray-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                  {truncate(c.campaign_name || "—", 28)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "border-[#F0BC00] text-white"
                : "border-transparent text-gray-400 hover:text-white"
            )}
            onClick={() => setActiveTab(tab.key)}
            data-testid={`tab-dg-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab - Campaign Table */}
      {activeTab === "overview" && (
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    {[
                      { key: "campaign_name", label: "Campaign", align: "left" },
                      { key: "spend", label: "Spend", align: "right" },
                      { key: "cpm", label: "CPM", align: "right" },
                      { key: "ctr", label: "CTR", align: "right" },
                      { key: "cpc", label: "CPC", align: "right" },
                      { key: "leads", label: "Leads", align: "right" },
                      { key: "cpl", label: "CPL", align: "right" },
                      { key: "frequency_28d", label: "Freq (28d)", align: "right" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={cn(
                          "p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 cursor-pointer select-none whitespace-nowrap",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          <SortIcon col={col.key} />
                        </span>
                      </th>
                    ))}
                    <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-center whitespace-nowrap">
                      Opt. Targeting
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...dgCampaigns]
                    .sort((a, b) => {
                      const aVal = (a as any)[sortKey];
                      const bVal = (b as any)[sortKey];
                      if (typeof aVal === "number" && typeof bVal === "number") {
                        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
                      }
                      return sortDir === "asc"
                        ? String(aVal || "").localeCompare(String(bVal || ""))
                        : String(bVal || "").localeCompare(String(aVal || ""));
                    })
                    .map((c, idx) => (
                    <tr
                      key={c.campaign_id || idx}
                      className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                      data-testid={`row-dg-campaign-${idx}`}
                    >
                      <td className="p-3 max-w-[220px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-white truncate block cursor-default">
                              {truncate(c.campaign_name, 32)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{c.campaign_name}</p></TooltipContent>
                        </Tooltip>
                        {c.audience_type && (
                          <span className="text-[10px] text-gray-600 block mt-0.5">{c.audience_type}</span>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums text-white">
                        {c.spend != null ? formatINR(c.spend, 0) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {c.cpm != null ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className={cn(c.cpm > 200 ? "text-red-400" : c.cpm > 120 ? "text-amber-400" : "text-emerald-400")}>
                              {formatINR(c.cpm, 0)}
                            </span>
                            {c.cpm > 200 && ((c.cpl || 0) > 1200 || (c.leads || c.conversions || 0) === 0) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5 cursor-default whitespace-nowrap">
                                    <RefreshCw className="w-2.5 h-2.5" />
                                    Creative refresh recommended
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">CPM &gt; ₹200 with weak CPL. SOP recommends refreshing creatives.</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {c.ctr != null ? (
                          <span className={cn(c.ctr < 0.5 ? "text-red-400" : c.ctr >= 1 ? "text-emerald-400" : "text-white")}>
                            {c.ctr.toFixed(2)}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums text-gray-400">
                        {c.cpc != null ? formatINR(c.cpc, 2) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums font-medium text-white">
                        {formatNumber(c.leads || c.conversions || 0)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {c.cpl != null ? (
                          <span className={cn(c.cpl > 1200 ? "text-red-400" : c.cpl < 600 ? "text-emerald-400" : "text-white")}>
                            {formatINR(c.cpl, 0)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {c.frequency_28d != null ? (
                          <span className={freqColor(c.frequency_28d)}>
                            {c.frequency_28d.toFixed(1)}×
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-center">
                        {c.optimized_targeting != null ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0 border",
                              c.optimized_targeting ? "bg-violet-500/10 text-violet-400 border-violet-500/30" : "bg-gray-500/10 text-gray-400 border-gray-700"
                            )}
                          >
                            {c.optimized_targeting ? "On" : "Off"}
                          </Badge>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {dgCampaigns.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-xs text-gray-500">
                        No Demand Gen campaigns found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ads Tab - DG-specific creatives with TSR/VHR */}
      {activeTab === "ads" && (
        <div className="space-y-4">
          {/* Video vs Static split */}
          {allAds.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Video className="w-3 h-3" />
                {allAds.filter((a) => a.ad_type?.toUpperCase() === "VIDEO").length} Video
              </span>
              <span className="flex items-center gap-1">
                <Image className="w-3 h-3" />
                {allAds.filter((a) => a.ad_type?.toUpperCase() === "IMAGE" || !a.ad_type).length} Image
              </span>
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {allAds.filter((a) => a.ad_type?.toUpperCase() === "CAROUSEL").length} Carousel
              </span>
            </div>
          )}

          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Ad</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Type</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">Impr</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">CTR</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">Leads</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">CPL</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">TSR</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">VHR</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">P25%</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">P50%</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">P75%</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">P100%</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-center">Status</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-center whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">Age</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">SOP: Refresh DG creatives every 21-40 days</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allAds.map((ad, idx) => {
                      const typeBadge = adTypeBadge(ad.ad_type);
                      const statusBdg = creativeStatusBadge(ad.status);
                      const isVideo = ad.ad_type?.toUpperCase() === "VIDEO";
                      const adTsr = ad.tsr ?? (ad.video_metrics ? (ad.video_metrics.video_views / Math.max(ad.impressions, 1)) * 100 : null);
                      const adVhr = ad.vhr ?? (ad.video_metrics?.video_quartile_25 ? (ad.video_metrics.video_quartile_25 / Math.max(ad.video_metrics.video_views, 1)) * 100 : null);

                      // GDG-02: video quartile percentages (as % of impressions)
                      const vm = ad.video_metrics;
                      const imprBase = Math.max(ad.impressions, 1);
                      const q25 = vm ? (vm.video_quartile_25 / imprBase) * 100 : null;
                      const q50 = vm ? (vm.video_quartile_50 / imprBase) * 100 : null;
                      const q75 = vm ? (vm.video_quartile_75 / imprBase) * 100 : null;
                      const q100 = vm ? (vm.video_quartile_100 / imprBase) * 100 : null;

                      // GDG-08: creative age and refresh flag
                      const ageDays = ad.creative_age_days ?? null;
                      const ctrDropped = ad.ctr_change_pct != null && ad.ctr_change_pct <= -30;
                      const weakCpl = (ad.cpl || 0) > 1200 || ad.leads === 0;
                      const needsRefresh = ageDays != null && (ageDays > 40 || ctrDropped || ((ad.cpm || 0) > 200 && weakCpl));

                      return (
                        <tr
                          key={idx}
                          className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                          data-testid={`row-dg-ad-${idx}`}
                        >
                          <td className="p-3 max-w-[200px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-white truncate block cursor-default">
                                  {truncate(ad.ad_name, 28)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">{ad.ad_name}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">{ad.campaign_name}</p>
                                {isVideo && vm && (
                                  <div className="mt-2 space-y-1">
                                    <p className="text-[10px] text-gray-400 font-medium">Video Quartile Funnel</p>
                                    {([
                                      { label: "P25", val: q25 },
                                      { label: "P50", val: q50 },
                                      { label: "P75", val: q75 },
                                      { label: "P100", val: q100 },
                                    ] as { label: string; val: number | null }[]).map(({ label, val }) => (
                                      <div key={label} className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-500 w-8">{label}</span>
                                        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                          <div
                                            className={cn("h-full rounded-full", val == null ? "" : val > 20 ? "bg-emerald-500" : val >= 10 ? "bg-amber-500" : "bg-red-500")}
                                            style={{ width: val != null ? `${Math.min(val, 100)}%` : "0%" }}
                                          />
                                        </div>
                                        <span className="text-[10px] tabular-nums w-10 text-right">{val != null ? `${val.toFixed(1)}%` : "—"}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                            <span className="text-[10px] text-gray-600 block mt-0.5 truncate">{truncate(ad.campaign_name, 30)}</span>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", typeBadge.cls)}>
                              {typeBadge.label}
                            </Badge>
                          </td>
                          <td className="p-3 text-right tabular-nums text-gray-400">{formatNumber(ad.impressions)}</td>
                          <td className="p-3 text-right tabular-nums">
                            <span className={cn(ad.ctr < 0.5 ? "text-red-400" : ad.ctr >= 1 ? "text-emerald-400" : "text-white")}>
                              {ad.ctr.toFixed(2)}%
                            </span>
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium text-white">{formatNumber(ad.leads)}</td>
                          <td className="p-3 text-right tabular-nums text-gray-400">
                            {ad.cpl != null ? formatINR(ad.cpl, 0) : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {adTsr != null ? (
                              <span className={tsrColor(adTsr)}>{adTsr.toFixed(1)}%</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {adVhr != null ? (
                              <span className={vhrColor(adVhr)}>{adVhr.toFixed(1)}%</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          {/* GDG-02: Video quartile columns */}
                          <td className="p-3 text-right tabular-nums">
                            {isVideo && q25 != null ? (
                              <span className="text-gray-300">{q25.toFixed(1)}%</span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {isVideo && q50 != null ? (
                              <span className="text-gray-300">{q50.toFixed(1)}%</span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {isVideo && q75 != null ? (
                              <span className="text-gray-300">{q75.toFixed(1)}%</span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {isVideo && q100 != null ? (
                              <span className={quartile100Color(q100)}>{q100.toFixed(1)}%</span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                          <td className="p-3 text-center">
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", statusBdg.cls)}>
                              {statusBdg.label}
                            </Badge>
                          </td>
                          {/* GDG-08: Age column */}
                          <td className="p-3 text-center">
                            {ageDays != null ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={cn("inline-flex items-center gap-1 cursor-default", creativeAgeColor(ageDays))}>
                                    {needsRefresh && <RefreshCw className="w-3 h-3" />}
                                    {ageDays}d
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">Creative age: {ageDays} days</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">SOP: Refresh DG creatives every 21-40 days</p>
                                  {needsRefresh && (
                                    <p className="text-[10px] text-amber-400 mt-0.5">
                                      {ageDays > 40 ? "Age exceeds 40-day threshold" : ctrDropped ? "CTR dropped ≥30%" : "High CPM with weak CPL"}
                                    </p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-gray-700">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {allAds.length === 0 && (
                      <tr>
                        <td colSpan={14} className="p-8 text-center text-xs text-gray-500">
                          No DG ad creative data available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* TSR/VHR methodology note */}
          <Card className="bg-[#1a1a2e]/40 border-gray-800/60">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-gray-500 space-y-1">
                <p><span className="text-gray-400 font-medium">TSR (Thumb Stop Rate)</span> = 3-second video views / impressions. Measures initial creative hook strength. Target: &gt;20%.</p>
                <p><span className="text-gray-400 font-medium">VHR (Video Hold Rate)</span> = 15-second views / 3-second views. Measures content retention. Target: &gt;15%.</p>
                <p><span className="text-gray-400 font-medium">Quartile columns (P25–P100)</span> show what % of impressions watched to each video milestone. P100 color: <span className="text-emerald-400">&gt;20% green</span> · <span className="text-amber-400">10-20% amber</span> · <span className="text-red-400">&lt;10% red</span>. Hover ad name for funnel bar chart.</p>
                <p><span className="text-gray-400 font-medium">Age</span> = days since creative was created. <span className="text-emerald-400">&lt;21d healthy</span> · <span className="text-amber-400">21-40d caution</span> · <span className="text-red-400">&gt;40d refresh</span>. <RefreshCw className="inline w-3 h-3" /> icon shown when refresh is recommended.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Audiences Tab */}
      {activeTab === "audiences" && (
        <div className="space-y-4">
          {/* Audience vs Optimized Targeting comparison */}
          {dgCampaigns.some((c) => c.audience_analysis?.audience_vs_optimized_targeting) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dgCampaigns
                .filter((c) => c.audience_analysis?.audience_vs_optimized_targeting)
                .map((c, idx) => {
                  const avot = c.audience_analysis?.audience_vs_optimized_targeting;
                  if (!avot) return null;
                  return (
                    <Card key={idx} className="bg-[#1a1a2e]/60 border-gray-800" data-testid={`card-audience-vs-optimized-${idx}`}>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-white mb-3 truncate">
                          {truncate(c.campaign_name || "—", 40)}
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className={cn(
                            "p-3 rounded-md border",
                            avot.better_performer === "audience" ? "border-emerald-500/30 bg-emerald-500/5" : "border-gray-800"
                          )}>
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Audience</p>
                            <p className="text-sm font-bold tabular-nums text-white">{formatINR(avot.audience_cpl, 0)} CPL</p>
                            <p className="text-[10px] text-gray-500">{avot.audience_pct?.toFixed(0)}% traffic</p>
                          </div>
                          <div className={cn(
                            "p-3 rounded-md border",
                            avot.better_performer === "optimized" ? "border-emerald-500/30 bg-emerald-500/5" : "border-gray-800"
                          )}>
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Optimized</p>
                            <p className="text-sm font-bold tabular-nums text-white">{formatINR(avot.optimized_cpl, 0)} CPL</p>
                            <p className="text-[10px] text-gray-500">{avot.optimized_pct?.toFixed(0)}% traffic</p>
                          </div>
                        </div>
                        {avot.recommendation && (
                          <p className="text-[10px] text-amber-400 mt-2">{avot.recommendation}</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}

          {/* Audience segments table */}
          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Segment</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">Impressions</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">Leads</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">CPL</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">CTR</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">Budget %</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-center">Action</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allAudiences.map((seg: any, idx: number) => {
                      const recBadge = audienceRecBadge(seg.recommendation);
                      const budgetPct = totalAudienceSpend > 0 && seg.spend != null
                        ? (seg.spend / totalAudienceSpend) * 100
                        : null;
                      return (
                        <tr
                          key={idx}
                          className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                          data-testid={`row-audience-${idx}`}
                        >
                          <td className="p-3 text-white font-medium">{seg.segment_name}</td>
                          <td className="p-3 text-right tabular-nums text-gray-400">{formatNumber(seg.impressions)}</td>
                          <td className="p-3 text-right tabular-nums font-medium text-white">{formatNumber(seg.leads)}</td>
                          <td className="p-3 text-right tabular-nums">
                            <span className={cn(seg.cpl > 1200 ? "text-red-400" : seg.cpl < 600 ? "text-emerald-400" : "text-white")}>
                              {formatINR(seg.cpl, 0)}
                            </span>
                          </td>
                          <td className="p-3 text-right tabular-nums text-gray-400">{seg.ctr?.toFixed(2)}%</td>
                          {/* GDG-05: Budget % column */}
                          <td className="p-3 text-right tabular-nums">
                            {budgetPct != null ? (
                              <span className="text-gray-300">{budgetPct.toFixed(1)}%</span>
                            ) : (
                              <span className="text-gray-700">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", recBadge.cls)}>
                              {recBadge.label}
                            </Badge>
                          </td>
                          {/* GDG-05: Recommendation text */}
                          <td className="p-3 max-w-[240px]">
                            <span className="text-[10px] text-gray-400">{audienceRecText(seg.recommendation)}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {allAudiences.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-xs text-gray-500">
                          No audience segment data available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Audience overlap warnings */}
          {dgCampaigns.some((c) => c.audience_analysis?.overlap_detection) && (
            <Card className="bg-amber-500/5 border-amber-500/30" data-testid="audience-overlap-alert">
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Audience Overlap Detected
                </p>
                {dgCampaigns
                  .filter((c) => c.audience_analysis?.overlap_detection)
                  .map((c, idx) => (
                    <p key={idx} className="text-[10px] text-gray-400 ml-5">
                      {c.campaign_name}: {c.audience_analysis?.overlap_detection}
                    </p>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Frequency Tab */}
      {activeTab === "frequency" && (
        <div className="space-y-4">
          {/* Per-campaign frequency table */}
          <Card className="bg-[#1a1a2e]/60 border-gray-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Campaign</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">7d Freq</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">14d Freq</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-right">28d Freq</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-center">Status</th>
                      <th className="p-3 text-[10px] font-medium uppercase tracking-wider text-gray-500 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((freqAudit.length > 0 ? freqAudit : dgCampaigns.map((c): FrequencyAuditEntry => ({
                      campaign_name: c.campaign_name,
                      frequency_7d: c.frequency_7d,
                      frequency_14d: c.frequency_14d,
                      frequency_28d: c.frequency_28d,
                    }))) as FrequencyAuditEntry[]).map((entry, idx) => {
                      const f28 = entry.frequency_28d || 0;
                      const isOver = f28 >= 6;
                      const isWarn = f28 >= 4;
                      return (
                        <tr
                          key={idx}
                          className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                          data-testid={`row-dg-frequency-${idx}`}
                        >
                          <td className="p-3 max-w-[220px]">
                            <span className="text-white truncate block">{truncate(entry.campaign_name || "—", 32)}</span>
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {entry.frequency_7d != null ? (
                              <span className={freqColor(entry.frequency_7d)}>{entry.frequency_7d.toFixed(1)}×</span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {entry.frequency_14d != null ? (
                              <span className={freqColor(entry.frequency_14d)}>{entry.frequency_14d.toFixed(1)}×</span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {entry.frequency_28d != null ? (
                              <span className={freqColor(entry.frequency_28d)}>{entry.frequency_28d.toFixed(1)}×</span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="p-3 text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0 border",
                                isOver ? "bg-red-500/10 text-red-400 border-red-500/30"
                                  : isWarn ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              )}
                            >
                              {isOver ? "Over Cap" : isWarn ? "Warning" : "Healthy"}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <span className="text-[10px] text-gray-400">
                              {entry.recommendation || (isOver ? "Refresh creatives, expand audiences" : isWarn ? "Monitor closely" : "No action needed")}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Methodology note */}
          <Card className="bg-[#1a1a2e]/40 border-gray-800/60">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-gray-500 space-y-1">
                <p>Frequency thresholds: <span className="text-emerald-400">Healthy &lt;4×</span> · <span className="text-amber-400">Warning 4-6×</span> · <span className="text-red-400">Severe &gt;6×</span></p>
                <p>High frequency leads to audience fatigue, increased CPM, and declining CTR. Recommended cap for DG: 4× per 28-day window.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
