import { useMemo, useState } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatINR, formatNumber, truncate } from "@/lib/format";
import { AlertTriangle, Users, ChevronDown, ChevronRight, Zap, Eye } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DgAdGroup {
  id?: string;
  name: string;
  status?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  avg_cpc: number;
  cvr: number;
  cpl: number;
  health_score?: number;
}

interface DgHealth {
  cpm?: number;
  cpm_baseline?: number;
  cpm_status?: string;
  ctr?: number;
  cpc?: number;
  frequency_note?: string;
}

interface DgCampaign {
  id?: string;
  name: string;
  channel_type: string;
  campaign_type?: string;
  status?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  avg_cpc: number;
  cvr: number;
  cpl: number;
  daily_budget?: number;
  dg_health?: DgHealth;
  ad_groups?: DgAdGroup[];
  classification?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDgCampaignLabel(c: DgCampaign): string {
  const t = (c.campaign_type || "").toLowerCase();
  if (t.includes("lookalike")) return "Lookalike";
  if (t.includes("inmarket") || t.includes("in_market")) return "In-Market";
  if (t.includes("affinity")) return "Affinity";
  return "Demand Gen";
}

function classificationBadge(cls?: string): { label: string; cls: string } {
  switch ((cls || "").toUpperCase()) {
    case "WINNER": return { label: "Winner", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "MONITOR": return { label: "Monitor", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "PAUSE": return { label: "Pause", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
    default: return { label: cls || "—", cls: "bg-muted text-muted-foreground border-border" };
  }
}

function cplColor(cpl: number, targetCpl: number): string {
  if (cpl <= 0) return "text-muted-foreground";
  if (cpl <= targetCpl) return "text-emerald-400";
  if (cpl <= targetCpl * 1.3) return "text-amber-400";
  return "text-red-400";
}

function ctrColor(ctr: number): string {
  if (ctr >= 0.5) return "text-emerald-400";
  if (ctr >= 0.2) return "text-amber-400";
  return "text-red-400";
}

// ─── Campaign Row ─────────────────────────────────────────────────────────────

function DgCampaignRow({ camp, targetCpl }: { camp: DgCampaign; targetCpl: number }) {
  const [expanded, setExpanded] = useState(false);
  const cls = classificationBadge(camp.classification);
  const adGroups = camp.ad_groups || [];

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <div
        className="flex items-start gap-3 p-3 hover:bg-muted/10 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand chevron */}
        <div className="mt-0.5 shrink-0">
          {adGroups.length > 0 ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <span className="w-3.5 h-3.5 block" />
          )}
        </div>

        {/* Campaign name + type */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="t-page-title text-foreground">{truncate(camp.name, 60)}</span>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">{getDgCampaignLabel(camp)}</Badge>
            {camp.classification && (
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 border", cls.cls)}>
                {cls.label}
              </Badge>
            )}
          </div>
          {/* Frequency note */}
          {camp.dg_health?.frequency_note && (
            <p className="text-[10px] text-amber-400">{camp.dg_health.frequency_note}</p>
          )}
        </div>

        {/* Metrics */}
        <div className="flex items-center gap-5 shrink-0 text-xs">
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Impr.</p>
            <p className="font-bold tabular-nums">{formatNumber(camp.impressions)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Clicks</p>
            <p className="font-bold tabular-nums">{formatNumber(camp.clicks)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">CTR</p>
            <p className={cn("font-bold tabular-nums", ctrColor(camp.ctr))}>{camp.ctr.toFixed(2)}%</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Leads</p>
            <p className={cn("font-bold tabular-nums", camp.conversions >= 5 ? "text-emerald-400" : camp.conversions >= 1 ? "text-amber-400" : "text-red-400")}>
              {camp.conversions}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">CPL</p>
            <p className={cn("font-bold tabular-nums", cplColor(camp.cpl, targetCpl))}>
              {camp.cpl > 0 ? formatINR(camp.cpl, 0) : "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Spend</p>
            <p className="font-bold tabular-nums">{formatINR(camp.cost, 0)}</p>
          </div>
          {camp.dg_health?.cpm != null && (
            <div className="text-right">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">CPM</p>
              <p className={cn(
                "font-bold tabular-nums",
                camp.dg_health.cpm_status === "high" ? "text-red-400" :
                camp.dg_health.cpm_status === "ok" ? "text-emerald-400" : "text-amber-400"
              )}>
                {formatINR(camp.dg_health.cpm, 0)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Expanded: ad groups */}
      {expanded && adGroups.length > 0 && (
        <div className="ml-7 mr-3 mb-3 rounded-lg border border-border/30 overflow-hidden bg-muted/5">
          <p className="t-label font-bold uppercase tracking-wider text-muted-foreground px-3 py-2 border-b border-border/20">
            Ad Groups ({adGroups.length})
          </p>
          {adGroups.map((ag, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-2 border-b border-border/10 last:border-b-0 text-xs hover:bg-muted/10">
              <span className="flex-1 text-muted-foreground truncate">{truncate(ag.name, 50)}</span>
              <span className="tabular-nums text-muted-foreground">{formatNumber(ag.impressions)} impr.</span>
              <span className={cn("tabular-nums font-bold", ctrColor(ag.ctr))}>{ag.ctr.toFixed(2)}% CTR</span>
              <span className={cn("tabular-nums font-bold", ag.conversions > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                {ag.conversions} leads
              </span>
              <span className={cn("tabular-nums font-bold", cplColor(ag.cpl, targetCpl))}>
                {ag.cpl > 0 ? formatINR(ag.cpl, 0) : "—"} CPL
              </span>
              {ag.health_score != null && (
                <span className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded",
                  ag.health_score >= 70 ? "bg-emerald-500/15 text-emerald-400" :
                  ag.health_score >= 50 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"
                )}>
                  {ag.health_score.toFixed(0)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GoogleAudiencesPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activeClient } = useClient();

  const dgCampaigns = useMemo((): DgCampaign[] => {
    if (!data) return [];
    const campaigns: any[] = (data as any).campaigns || [];
    return campaigns
      .filter((c) => String(c.channel_type || "").toUpperCase() === "DEMAND_GEN")
      .map((c) => ({
        id: c.id,
        name: c.name || c.campaign_name || "Unnamed",
        channel_type: c.channel_type,
        campaign_type: c.campaign_type,
        status: c.status,
        impressions: c.impressions || 0,
        clicks: c.clicks || 0,
        cost: c.cost || 0,
        conversions: c.conversions || 0,
        ctr: c.ctr || 0,
        avg_cpc: c.avg_cpc || 0,
        cvr: c.cvr || 0,
        cpl: c.cpl || 0,
        daily_budget: c.daily_budget,
        dg_health: c.dg_health,
        ad_groups: c.ad_groups || [],
        classification: c.classification,
      }));
  }, [data]);

  const targetCpl: number = useMemo(() => {
    return (data as any)?.targets?.google?.target_cpa || (data as any)?.targets?.cpl || 850;
  }, [data]);

  // Summary stats
  const totalImpressions = dgCampaigns.reduce((s, c) => s + c.impressions, 0);
  const totalLeads = dgCampaigns.reduce((s, c) => s + c.conversions, 0);
  const totalSpend = dgCampaigns.reduce((s, c) => s + c.cost, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const avgCtr = dgCampaigns.length > 0
    ? dgCampaigns.reduce((s, c) => s + c.ctr, 0) / dgCampaigns.length
    : 0;

  const lookalikes = dgCampaigns.filter((c) => (c.campaign_type || "").toLowerCase().includes("lookalike")).length;
  const inMarket = dgCampaigns.filter((c) => {
    const t = (c.campaign_type || "").toLowerCase();
    return t.includes("inmarket") || t.includes("in_market");
  }).length;
  const affinity = dgCampaigns.filter((c) => (c.campaign_type || "").toLowerCase().includes("affinity")).length;

  const highCpmCampaigns = dgCampaigns.filter((c) => c.dg_health?.cpm_status === "high").length;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    );
  }

  if (!data || dgCampaigns.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Audiences · Demand Gen
          </h1>
          <p className="text-xs text-muted-foreground">Demand Gen audience performance across lookalike, in-market, and affinity campaigns.</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <AlertTriangle className="w-10 h-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-foreground">No Demand Gen data found</p>
              <p className="text-xs text-muted-foreground mt-1">
                No active Demand Gen campaigns for{" "}
                <span className="font-semibold">{activeClient?.shortName || activeClient?.name || "this client"}</span>.
                Run the Google Ads agent to populate data.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Audiences · Demand Gen
        </h1>
        <p className="text-xs text-muted-foreground">
          Demand Gen audience performance · Lookalike, In-Market, Affinity · Target CPL: {formatINR(targetCpl, 0)}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">DG Campaigns</p>
            <p className="text-2xl font-black text-foreground tabular-nums">{dgCampaigns.length}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Lookalike</p>
            <p className="text-2xl font-black text-blue-400 tabular-nums">{lookalikes}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">In-Market</p>
            <p className="text-2xl font-black text-purple-400 tabular-nums">{inMarket}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Affinity</p>
            <p className="text-2xl font-black text-amber-400 tabular-nums">{affinity}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Total Leads</p>
            <p className={cn("text-2xl font-black tabular-nums", totalLeads > 0 ? "text-emerald-400" : "text-foreground")}>
              {totalLeads}
            </p>
          </CardContent>
        </Card>
        <Card className={cn("border-border/50", avgCpl > 0 && avgCpl <= targetCpl ? "border-emerald-500/30" : avgCpl > targetCpl * 1.3 ? "border-red-500/30" : "")}>
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Avg CPL</p>
            <p className={cn("text-2xl font-black tabular-nums", cplColor(avgCpl, targetCpl))}>
              {avgCpl > 0 ? formatINR(avgCpl, 0) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className={cn("border-border/50", highCpmCampaigns > 0 && "border-amber-500/30 bg-amber-500/3")}>
          <CardContent className="card-content-premium">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">High CPM Alert</p>
            <p className={cn("text-2xl font-black tabular-nums", highCpmCampaigns > 0 ? "text-amber-400" : "text-foreground")}>
              {highCpmCampaigns}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <table className="t-table w-full" />
          <Eye className="w-4 h-4 text-primary" />
          <p className="text-sm font-bold text-foreground">Demand Gen Campaigns</p>
          <p className="text-[10px] text-muted-foreground ml-1">· Click to expand ad groups</p>
        </div>

        {/* Table header */}
        <div className="flex items-center gap-3 px-3 py-2 bg-muted/10 border-b border-border/20 text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
          <div className="w-3.5 shrink-0" />
          <div className="flex-1">Campaign</div>
          <div className="flex items-center gap-5 pr-1 shrink-0">
            <span className="w-16 text-right">Impressions</span>
            <span className="w-10 text-right">Clicks</span>
            <span className="w-10 text-right">CTR</span>
            <span className="w-10 text-right">Leads</span>
            <span className="w-16 text-right">CPL</span>
            <span className="w-16 text-right">Spend</span>
            <span className="w-14 text-right">CPM</span>
          </div>
        </div>

        <div>
          {dgCampaigns.map((camp, i) => (
            <DgCampaignRow key={camp.id || i} camp={camp} targetCpl={targetCpl} />
          ))}
        </div>
      </Card>

      {/* CPM notes */}
      {highCpmCampaigns > 0 && (
        <Card className="bg-amber-500/5 border-amber-500/30">
          <CardContent className="card-content-premium p-4 space-y-1">
            <p className="t-page-title text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              High CPM Detected
            </p>
            {dgCampaigns
              .filter((c) => c.dg_health?.cpm_status === "high")
              .map((c, i) => (
                <p key={i} className="t-label text-muted-foreground ml-5">
                  <span className="font-medium text-foreground">{truncate(c.name, 40)}</span>
                  {c.dg_health?.frequency_note ? ` — ${c.dg_health.frequency_note}` : " — CPM above baseline"}
                </p>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/30 pt-3">
        <span>
          {dgCampaigns.length} Demand Gen campaigns · {formatNumber(totalImpressions)} impressions · {totalLeads} leads · {formatINR(totalSpend, 0)} spend
        </span>
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-primary" />
          Avg CTR: {avgCtr.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
