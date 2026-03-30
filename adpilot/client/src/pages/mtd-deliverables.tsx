import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Target,
  Save,
  Loader2,
  CheckCircle2,
  TrendingUp,
  Users,
  IndianRupee,
  BarChart3,
  FileText,
  Clock,
  AlertTriangle,
  Search,
  Layers,
} from "lucide-react";
import { formatINR } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

interface MtdDeliverables {
  svs_achieved: number;
  positive_leads_achieved: number;
  closures_achieved: number;
  quality_lead_count: number;
  notes: string;
  updated_at: string | null;
}

export default function MtdDeliverablesPage() {
  const { activeClientId, activeClient, activePlatform, analysisData: data, apiBase } = useClient();
  const { toast } = useToast();

  const [svsAchieved, setSvsAchieved] = useState(0);
  const [positiveLeads, setPositiveLeads] = useState(0);
  const [closures, setClosures] = useState(0);
  const [qualityLeadCount, setQualityLeadCount] = useState(0);
  const [notes, setNotes] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch existing deliverables
  const { data: deliverables, isLoading } = useQuery<MtdDeliverables>({
    queryKey: ["/api/clients", activeClientId, "mtd-deliverables"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/mtd-deliverables`);
      return res.json();
    },
  });

  // Populate form from fetched data
  useEffect(() => {
    if (deliverables) {
      setSvsAchieved(deliverables.svs_achieved || 0);
      setPositiveLeads(deliverables.positive_leads_achieved || 0);
      setClosures(deliverables.closures_achieved || 0);
      setQualityLeadCount(deliverables.quality_lead_count || 0);
      setNotes(deliverables.notes || "");
      setHasChanges(false);
    }
  }, [deliverables]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<MtdDeliverables>) => {
      const res = await apiRequest("PUT", `/api/clients/${activeClientId}/mtd-deliverables`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, "mtd-deliverables"] });
      setHasChanges(false);
      toast({ title: "Saved", description: "MTD deliverables updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save", variant: "destructive" });
    },
  });

  function handleSave() {
    saveMutation.mutate({
      svs_achieved: svsAchieved,
      positive_leads_achieved: positiveLeads,
      closures_achieved: closures,
      quality_lead_count: qualityLeadCount,
      notes,
    });
  }

  // Auto-calculated metrics from analysis data
  const autoMetrics = useMemo(() => {
    if (!data) return { totalLeads: 0, totalSpend: 0, cpl: 0, cpsv: 0 };

    const mp = data.monthly_pacing || {} as any;
    const summary = data.summary || {} as any;

    const totalLeads = mp.mtd?.leads ?? (mp as any).leads_mtd ?? summary.total_leads ?? 0;
    const totalSpend = mp.mtd?.spend ?? (mp as any).spend_mtd ?? summary.total_spend ?? 0;
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const cpsv = svsAchieved > 0 ? totalSpend / svsAchieved : 0;

    return { totalLeads, totalSpend, cpl, cpsv };
  }, [data, svsAchieved]);

  const targets = activeClient?.targets;
  // GMTD-01: use activePlatform for platform-specific targets
  const platformTargets = targets?.[activePlatform] || targets?.["meta"];

  // GMTD-03: Campaign type split data (Google only)
  const campaignSplit = useMemo(() => {
    if (activePlatform !== "google" || !data) return null;
    const searchSummary = (data as any).search_summary;
    const dgSummary = (data as any).dg_summary;
    if (!searchSummary && !dgSummary) return null;

    const searchSpend = searchSummary?.spend ?? 0;
    const searchLeads = searchSummary?.leads ?? 0;
    const searchCpl = searchLeads > 0 ? searchSpend / searchLeads : 0;

    const dgSpend = dgSummary?.spend ?? 0;
    const dgLeads = dgSummary?.leads ?? 0;
    const dgCpl = dgLeads > 0 ? dgSpend / dgLeads : 0;

    const totalSpend = searchSpend + dgSpend;
    const totalLeads = searchLeads + dgLeads;

    const searchSpendPct = totalSpend > 0 ? (searchSpend / totalSpend) * 100 : 0;
    const dgSpendPct = totalSpend > 0 ? (dgSpend / totalSpend) * 100 : 0;
    const searchLeadsPct = totalLeads > 0 ? (searchLeads / totalLeads) * 100 : 0;
    const dgLeadsPct = totalLeads > 0 ? (dgLeads / totalLeads) * 100 : 0;

    return {
      search: { spend: searchSpend, leads: searchLeads, cpl: searchCpl, spendPct: searchSpendPct, leadsPct: searchLeadsPct },
      dg: { spend: dgSpend, leads: dgLeads, cpl: dgCpl, spendPct: dgSpendPct, leadsPct: dgLeadsPct },
    };
  }, [data, activePlatform]);

  // GMTD-04: Pacing alerts
  const pacingAlerts = useMemo(() => {
    const alerts: Array<{ message: string; severity: "amber" | "red" }> = [];
    if (!data) return alerts;

    const mp = (data as any).monthly_pacing || {};
    const totalSpend = autoMetrics.totalSpend;
    const totalLeads = autoMetrics.totalLeads;
    const targetBudget = platformTargets?.budget ?? 0;
    const targetLeads = platformTargets?.leads ?? 0;
    const targetCpl = platformTargets?.cpl ?? 0;

    // Spend pacing
    const spendPacingPct = mp.spend_pacing_pct ?? (targetBudget > 0 && mp.days_elapsed && mp.total_days
      ? (totalSpend / targetBudget) / (mp.days_elapsed / mp.total_days) * 100
      : 0);
    if (spendPacingPct > 110) {
      alerts.push({ message: "Budget will exhaust before month end at current rate", severity: "red" });
    }

    // Leads pacing
    const leadsPacingPct = mp.leads_pacing_pct ?? (targetLeads > 0 && mp.days_elapsed && mp.total_days
      ? (totalLeads / targetLeads) / (mp.days_elapsed / mp.total_days) * 100
      : 0);
    if (leadsPacingPct > 0 && leadsPacingPct < 80) {
      const behind = (100 - leadsPacingPct).toFixed(0);
      alerts.push({ message: `Leads behind pace by ${behind}%`, severity: "amber" });
    }

    // CPL vs target
    if (targetCpl > 0 && autoMetrics.cpl > 0 && autoMetrics.cpl > targetCpl * 1.1) {
      const overPct = (((autoMetrics.cpl - targetCpl) / targetCpl) * 100).toFixed(0);
      alerts.push({ message: `Overall CPL trending ${overPct}% above target`, severity: "amber" });
    }

    // Google-specific: Search budget exhausting faster than DG
    if (activePlatform === "google" && campaignSplit) {
      const searchSpend = campaignSplit.search.spend;
      const dgSpend = campaignSplit.dg.spend;
      const searchBudgetShare = platformTargets ? (searchSpend / (targetBudget || 1)) : 0;
      const dgBudgetShare = platformTargets ? (dgSpend / (targetBudget || 1)) : 0;
      // If search is consuming disproportionately more (more than 15pp above DG's share)
      if (searchBudgetShare > 0 && dgBudgetShare > 0 && (searchSpend / (searchSpend + dgSpend)) > 0.7) {
        alerts.push({ message: "Search budget exhausting faster than Demand Gen", severity: "amber" });
      }
    }

    return alerts;
  }, [data, autoMetrics, platformTargets, activePlatform, campaignSplit]);

  // GMTD-05: Daily needed calculation
  const dailyNeeded = useMemo(() => {
    if (!data) return null;
    const mp = (data as any).monthly_pacing || {};

    const daysRemaining: number = mp.days_remaining ?? (() => {
      const now = new Date();
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      return Math.max(1, lastDay - now.getDate());
    })();

    if (daysRemaining <= 0) return null;

    const targetBudget = platformTargets?.budget ?? 0;
    const targetLeads = platformTargets?.leads ?? 0;

    const remainingSpend = Math.max(0, targetBudget - autoMetrics.totalSpend);
    const remainingLeads = Math.max(0, targetLeads - autoMetrics.totalLeads);

    const dailySpendNeeded = remainingSpend / daysRemaining;
    const dailyLeadsNeeded = remainingLeads / daysRemaining;

    // Estimate current daily avg from days elapsed
    const daysElapsed: number = mp.days_elapsed ?? (() => {
      const now = new Date();
      return Math.max(1, now.getDate() - 1);
    })();

    const currentDailySpend = daysElapsed > 0 ? autoMetrics.totalSpend / daysElapsed : 0;
    const currentDailyLeads = daysElapsed > 0 ? autoMetrics.totalLeads / daysElapsed : 0;

    // Color coding
    const spendFeasibility = currentDailySpend > 0
      ? dailySpendNeeded / currentDailySpend
      : (dailySpendNeeded > 0 ? 999 : 0);
    const leadsFeasibility = currentDailyLeads > 0
      ? dailyLeadsNeeded / currentDailyLeads
      : (dailyLeadsNeeded > 0 ? 999 : 0);

    const overallFeasibility = Math.max(spendFeasibility, leadsFeasibility);
    const color: "green" | "amber" | "red" =
      overallFeasibility <= 1.2 ? "green" :
      overallFeasibility <= 1.5 ? "amber" : "red";

    return {
      daysRemaining,
      dailySpendNeeded,
      dailyLeadsNeeded,
      currentDailySpend,
      currentDailyLeads,
      color,
    };
  }, [data, autoMetrics, platformTargets]);

  function markChanged() { setHasChanges(true); }

  // GMTD-01: Platform label for header
  const platformLabel = activePlatform === "google" ? "Google Ads" : "Meta Ads";

  return (
    <div className="p-6 space-y-6 max-w-[900px]">
      {/* Header — GMTD-01: platform-specific title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">MTD Deliverables — {platformLabel}</h1>
            <p className="text-xs text-muted-foreground">
              Enter your month-to-date achieved metrics that can't be auto-calculated
            </p>
          </div>
        </div>
        {deliverables?.updated_at && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            Last updated: {new Date(deliverables.updated_at).toLocaleString("en-IN")}
          </div>
        )}
      </div>

      {/* Auto-Calculated Metrics (Read Only) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Auto-Calculated from Analysis Data
            <Badge variant="secondary" className="text-[10px]">Read Only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">MTD Total Leads</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{autoMetrics.totalLeads}</p>
              {platformTargets && (
                <p className="text-[10px] text-muted-foreground">Target: {platformTargets.leads}</p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">MTD Total Spend</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{formatINR(autoMetrics.totalSpend, 0)}</p>
              {platformTargets && (
                <p className="text-[10px] text-muted-foreground">Budget: {formatINR(platformTargets.budget, 0)}</p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">MTD CPL</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{formatINR(autoMetrics.cpl, 0)}</p>
              {platformTargets && (
                <p className="text-[10px] text-muted-foreground">Target: {formatINR(platformTargets.cpl, 0)}</p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">MTD CPSV</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">
                {svsAchieved > 0 ? formatINR(autoMetrics.cpsv, 0) : "—"}
              </p>
              {platformTargets && (
                <p className="text-[10px] text-muted-foreground">
                  Target: {formatINR(platformTargets.cpsv?.low || 0, 0)}–{formatINR(platformTargets.cpsv?.high || 0, 0)}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GMTD-03: Campaign Type Split — Google only */}
      {activePlatform === "google" && campaignSplit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Campaign Type Split
              <Badge variant="secondary" className="text-[10px]">Read Only</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Search */}
              <div className="p-3 rounded-lg border border-border/50 bg-blue-950/20 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-300">Search</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Spend</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums">{formatINR(campaignSplit.search.spend, 0)}</p>
                    <p className="text-[10px] text-muted-foreground">{campaignSplit.search.spendPct.toFixed(1)}% of total</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Leads</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums">{campaignSplit.search.leads}</p>
                    <p className="text-[10px] text-muted-foreground">{campaignSplit.search.leadsPct.toFixed(1)}% of total</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CPL</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {campaignSplit.search.leads > 0 ? formatINR(campaignSplit.search.cpl, 0) : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Demand Gen */}
              <div className="p-3 rounded-lg border border-border/50 bg-purple-950/20 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-medium text-purple-300">Demand Gen</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Spend</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums">{formatINR(campaignSplit.dg.spend, 0)}</p>
                    <p className="text-[10px] text-muted-foreground">{campaignSplit.dg.spendPct.toFixed(1)}% of total</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Leads</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums">{campaignSplit.dg.leads}</p>
                    <p className="text-[10px] text-muted-foreground">{campaignSplit.dg.leadsPct.toFixed(1)}% of total</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CPL</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {campaignSplit.dg.leads > 0 ? formatINR(campaignSplit.dg.cpl, 0) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-amber-400/80 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Blended totals can be misleading — review each channel independently
            </p>
          </CardContent>
        </Card>
      )}

      {/* GMTD-04: Pacing Alerts */}
      {pacingAlerts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Pacing Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pacingAlerts.map((alert, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                  alert.severity === "red"
                    ? "bg-red-950/30 border-red-500/40 text-red-300"
                    : "bg-amber-950/30 border-amber-500/40 text-amber-300"
                }`}
              >
                <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                  alert.severity === "red" ? "text-red-400" : "text-amber-400"
                }`} />
                <span>{alert.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* GMTD-05: Daily Needed Summary */}
      {dailyNeeded && (dailyNeeded.dailySpendNeeded > 0 || dailyNeeded.dailyLeadsNeeded > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Daily Needed to Hit Target
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className={`p-4 rounded-lg border text-sm font-medium ${
                dailyNeeded.color === "green"
                  ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                  : dailyNeeded.color === "amber"
                  ? "bg-amber-950/30 border-amber-500/40 text-amber-300"
                  : "bg-red-950/30 border-red-500/40 text-red-300"
              }`}
            >
              Need{" "}
              {dailyNeeded.dailyLeadsNeeded > 0
                ? `${dailyNeeded.dailyLeadsNeeded.toFixed(1)} leads/day`
                : ""}
              {dailyNeeded.dailyLeadsNeeded > 0 && dailyNeeded.dailySpendNeeded > 0 ? " and " : ""}
              {dailyNeeded.dailySpendNeeded > 0
                ? `${formatINR(dailyNeeded.dailySpendNeeded, 0)}/day spend`
                : ""}
              {" "}for remaining {dailyNeeded.daysRemaining} day{dailyNeeded.daysRemaining !== 1 ? "s" : ""}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {dailyNeeded.dailyLeadsNeeded > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Leads/Day Needed</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {dailyNeeded.dailyLeadsNeeded.toFixed(1)}
                  </p>
                  {dailyNeeded.currentDailyLeads > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Current avg: {dailyNeeded.currentDailyLeads.toFixed(1)}/day
                    </p>
                  )}
                </div>
              )}
              {dailyNeeded.dailySpendNeeded > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Spend/Day Needed</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {formatINR(dailyNeeded.dailySpendNeeded, 0)}
                  </p>
                  {dailyNeeded.currentDailySpend > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Current avg: {formatINR(dailyNeeded.currentDailySpend, 0)}/day
                    </p>
                  )}
                </div>
              )}
              <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Days Remaining</p>
                <p className="text-lg font-semibold text-foreground tabular-nums">{dailyNeeded.daysRemaining}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Input Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Your Input — Metrics That Require Manual Entry
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* SVs Achieved */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-blue-400" />
                    Site Visits (SVs) Achieved
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={svsAchieved}
                    onChange={(e) => { setSvsAchieved(Number(e.target.value) || 0); markChanged(); }}
                    className="bg-muted/30"
                  />
                  {platformTargets && (
                    <p className="text-[10px] text-muted-foreground">
                      Target: {platformTargets.svs?.low}–{platformTargets.svs?.high} SVs
                    </p>
                  )}
                </div>

                {/* Positive Leads */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    Positive Leads Achieved
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={positiveLeads}
                    onChange={(e) => { setPositiveLeads(Number(e.target.value) || 0); markChanged(); }}
                    className="bg-muted/30"
                  />
                </div>

                {/* Closures */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                    Closures Achieved
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={closures}
                    onChange={(e) => { setClosures(Number(e.target.value) || 0); markChanged(); }}
                    className="bg-muted/30"
                  />
                </div>

                {/* Quality Lead Count */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <IndianRupee className="w-3.5 h-3.5 text-amber-400" />
                    Quality Lead Count
                    <Badge variant="secondary" className="text-[9px]">Optional</Badge>
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={qualityLeadCount}
                    onChange={(e) => { setQualityLeadCount(Number(e.target.value) || 0); markChanged(); }}
                    className="bg-muted/30"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Notes</label>
                <Textarea
                  placeholder="Any context about this month's performance..."
                  className="min-h-[80px] resize-none bg-muted/30 text-sm"
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); markChanged(); }}
                />
              </div>

              {/* Save button */}
              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <p className="text-[10px] text-muted-foreground">
                  {hasChanges ? "You have unsaved changes" : "All changes saved"}
                </p>
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || saveMutation.isPending}
                  className="gap-2"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Deliverables
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Summary / Derived Metrics */}
      {svsAchieved > 0 || positiveLeads > 0 || closures > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Derived Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {autoMetrics.totalLeads > 0 && positiveLeads > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Positive %</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {((positiveLeads / autoMetrics.totalLeads) * 100).toFixed(1)}%
                  </p>
                </div>
              )}
              {autoMetrics.totalSpend > 0 && qualityLeadCount > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">CPQL</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {formatINR(autoMetrics.totalSpend / qualityLeadCount, 0)}
                  </p>
                </div>
              )}
              {closures > 0 && autoMetrics.totalSpend > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Cost per Closure</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {formatINR(autoMetrics.totalSpend / closures, 0)}
                  </p>
                </div>
              )}
              {svsAchieved > 0 && autoMetrics.totalLeads > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Leads per SV</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {(autoMetrics.totalLeads / svsAchieved).toFixed(1)}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
