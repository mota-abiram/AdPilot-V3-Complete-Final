import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useClient } from "@/lib/client-context";
import { useAuth } from "@/lib/auth-context";
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
  Zap,
  Activity,
  ArrowUpRight,
  TrendingDown,
  Info,
  LayoutDashboard,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  ReferenceLine,
} from "recharts";
import { formatINR, formatNumber, formatPct } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ───────────────────────────────────────────────────────

interface ConsolidatedMtdData {
  client_id: string;
  month: string;
  mtd: {
    spend: number;
    leads: number;
    qualified_leads: number;
    svs: number;
    cpl: number;
    cpql: number;
    cpsv: number;
    positive_pct: number;
    sv_pct: number;
    closures: number;
  };
  status: {
    data_complete: boolean;
    manual_input_missing: boolean;
    tracking_issue_flag: boolean;
  };
  last_updated: string;
}

interface PacingRow {
  metric: string;
  monthly_target: number | string | null;
  mtd_target: number | string | null;
  mtd_delivered: number | string | null;
  projected: number | string | null;
  daily_needed: number | string | null;
  status: string;
  format: "inr" | "number";
}

interface PacingResponse {
  client_id: string;
  platform: string;
  month: string;
  days_elapsed: number;
  days_remaining: number;
  total_days: number;
  pct_through_month: number;
  rows: PacingRow[];
  alerts: string[];
  data_integrity: {
    manual_input_missing: boolean;
    tracking_issue: boolean;
  };
}

interface ManualDeliverables {
  svs_achieved: number;
  positive_leads_achieved: number;
  closures_achieved: number;
  quality_lead_count: number;
  notes: string;
  updated_at: string | null;
  updated_by?: string;
}

interface MtdHistoryEntry extends ManualDeliverables {
  id: number;
  mtd?: ConsolidatedMtdData['mtd']; // Snapshot of computed metrics
}

const KPI_META: Record<string, { description: string; source: string; type: string }> = {
  Spend: {
    description: "Month-to-date media spend against the planned pacing curve.",
    source: "Backend Pacing",
    type: "COMPUTED",
  },
  Leads: {
    description: "Month-to-date lead volume against the current monthly target.",
    source: "Backend Pacing",
    type: "COMPUTED",
  },
  Conversions: {
    description: "Month-to-date conversion volume against the current monthly target.",
    source: "Backend Pacing",
    type: "COMPUTED",
  },
  CPL: {
    description: "Month-to-date cost per lead benchmarked against the configured target.",
    source: "Backend Pacing",
    type: "EFFICIENCY",
  },
  "Cost/Conv.": {
    description: "Month-to-date cost per conversion benchmarked against the configured target.",
    source: "Backend Pacing",
    type: "EFFICIENCY",
  },
  "Qualified Leads": {
    description: "Manually synced qualified leads against the configured monthly target.",
    source: "Backend Pacing",
    type: "MANUAL",
  },
  "Qualified Conversions": {
    description: "Manually synced qualified conversions against the configured monthly target.",
    source: "Backend Pacing",
    type: "MANUAL",
  },
  CPQL: {
    description: "Month-to-date cost per qualified lead benchmarked against the configured target.",
    source: "Backend Pacing",
    type: "EFFICIENCY",
  },
  SVs: {
    description: "Manually synced site visits against the configured monthly target range.",
    source: "Backend Pacing",
    type: "MANUAL",
  },
  "Site Visits (SVs)": {
    description: "Manually synced site visits against the configured monthly target range.",
    source: "Backend Pacing",
    type: "MANUAL",
  },
  CPSV: {
    description: "Month-to-date cost per site visit benchmarked against the configured target range.",
    source: "Backend Pacing",
    type: "EFFICIENCY",
  },
  CPM: {
    description: "Month-to-date CPM benchmarked against the configured target.",
    source: "Backend Pacing",
    type: "EFFICIENCY",
  },
  CPC: {
    description: "Month-to-date CPC benchmarked against the configured target.",
    source: "Backend Pacing",
    type: "EFFICIENCY",
  },
  Closures: {
    description: "Month-to-date closures manually tracked by the delivery team.",
    source: "Manual",
    type: "MANUAL",
  },
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPacingValue(value: number | string | null | undefined, format: PacingRow["format"]): string {
  if (typeof value === "string") return value;
  if (!isFiniteNumber(value)) return "—";
  return format === "inr" ? formatINR(value, 0) : formatNumber(value);
}

function getPacingBadge(status: string): { label: string; variant: "success" | "warning" | "destructive" | "secondary" } {
  const normalized = status.toUpperCase();

  if (["ON TRACK", "ON TARGET", "TRACKING"].includes(normalized)) {
    return { label: status, variant: "success" };
  }

  if (["SLIGHTLY BEHIND", "SLIGHTLY HIGH", "SLIGHTLY UNDER", "TIGHTEN SPEND", "AWAITING DATA"].includes(normalized)) {
    return { label: status, variant: "warning" };
  }

  if (["OFF TRACK", "OFF TARGET", "OVERSPENT", "UNDERSPENT", "PACING DRIFT", "OUT OF CONTROL"].includes(normalized)) {
    return { label: status, variant: "destructive" };
  }

  return { label: status || "Awaiting", variant: "secondary" };
}

// ─── Chart Component ─────────────────────────────────────────────

function DeliverablesChart({ data, view }: { data: ConsolidatedMtdData['mtd'], view: 'volume' | 'efficiency' }) {
  const chartData = useMemo(() => {
    if (view === 'volume') {
      return [
        { name: 'Spend (₹)', value: data.spend, color: 'hsl(215, 60%, 60%)', isCurrency: true },
        { name: 'Leads', value: data.leads, color: 'hsl(146, 40%, 60%)' },
        { name: 'Qual. Leads', value: data.qualified_leads, color: 'hsl(262, 60%, 65%)' },
        { name: 'SVs', value: data.svs, color: 'hsl(35, 70%, 60%)' },
      ];
    } else {
      return [
        { name: 'CPL', value: data.cpl, color: 'hsl(146, 40%, 60%)' },
        { name: 'CPQL', value: data.cpql, color: 'hsl(262, 60%, 65%)' },
        { name: 'CPSV', value: data.cpsv, color: 'hsl(35, 70%, 60%)' },
      ];
    }
  }, [data, view]);

  return (
    <div className="h-[300px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.3)" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          />
          <YAxis
            hide={view === 'volume'} // Volumes vary too much for a single axis (Spend vs Count)
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          />
          <RechartsTooltip
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const entry = payload[0].payload;
              return (
                <div className="rounded-md border border-border/50 bg-card p-2 shadow-xl backdrop-blur-sm">
                  <p className="text-xs font-bold text-foreground mb-1">{entry.name}</p>
                  <p className="t-page-title tabular-nums" style={{ color: entry.color }}>
                    {entry.isCurrency ? formatINR(entry.value, 0) : formatNumber(entry.value)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={50}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function MtdDeliverablesPage() {
  const { activeClientId, activePlatform, benchmarks } = useClient();
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<'volume' | 'efficiency'>('volume');
  const [svsAchieved, setSvsAchieved] = useState(0);
  const [closures, setClosures] = useState(0);
  const [qualityLeadCount, setQualityLeadCount] = useState(0);
  const [notes, setNotes] = useState("");
  const [userName, setUserName] = useState("Marketing Lead");
  const [hasChanges, setHasChanges] = useState(false);

  // 1. Fetch Consolidated MTD Data (Source of Truth)
  const { data: mtdData, isLoading: isLoadingMtd } = useQuery<ConsolidatedMtdData>({
    queryKey: ["/api/mtd-deliverables", activeClientId, activePlatform],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mtd-deliverables?client_id=${activeClientId}&platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
    refetchInterval: 60000, // Sync every minute
  });

  const { data: pacingData, isLoading: isLoadingPacing } = useQuery<PacingResponse>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "pacing"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/pacing?platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId && !!activePlatform,
    refetchInterval: 60000,
  });

  // 2. Fetch Manual Entry for specific form fields
  const { data: deliverables, isLoading: isLoadingManual } = useQuery<ManualDeliverables>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "mtd-deliverables"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/mtd-deliverables?platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  // 3. Fetch History
  const { data: history = [], isLoading: isLoadingHistory } = useQuery<MtdHistoryEntry[]>({
    queryKey: ["/api/clients", activeClientId, activePlatform, "mtd-deliverables", "history"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/mtd-deliverables/history?platform=${activePlatform}`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  // Populate form from fetched manual data
  useEffect(() => {
    if (deliverables) {
      setSvsAchieved(deliverables.svs_achieved || 0);
      setClosures(deliverables.closures_achieved || 0);
      setQualityLeadCount(deliverables.positive_leads_achieved || deliverables.quality_lead_count || 0);
      setNotes(deliverables.notes || "");
      setHasChanges(false);
    }
  }, [deliverables]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<ManualDeliverables>) => {
      const res = await apiRequest("PUT", `/api/clients/${activeClientId}/mtd-deliverables?platform=${activePlatform}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, activePlatform, "mtd-deliverables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, activePlatform, "mtd-deliverables", "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, activePlatform, "pacing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mtd-deliverables", activeClientId, activePlatform] });
      setHasChanges(false);
      toast({ title: "Saved", description: "MTD data updated successfully" });
    },
  });

  function handleSave() {
    saveMutation.mutate({
      svs_achieved: svsAchieved,
      positive_leads_achieved: qualityLeadCount,
      closures_achieved: closures,
      quality_lead_count: qualityLeadCount,
      notes,
      updated_by: userName,
    } as any);
  }

  function markChanged() { setHasChanges(true); }

  if (isLoadingMtd || isLoadingPacing) {
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
      </div>
    );
  }

  const mtd = mtdData?.mtd;
  const status = mtdData?.status;
  const pacingRows = pacingData?.rows || [];
  const positivePctTarget = Number((benchmarks as any)?.positive_pct_target ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">MTD Deliverables Master</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Marketing-to-Sales Performance Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="bg-card py-1 text-xs border-border/60">Updated: {mtdData?.last_updated ? new Date(mtdData.last_updated).toLocaleTimeString() : 'Never'}</Badge>
          {status?.tracking_issue_flag && (
            <Badge variant="destructive" className="gap-1 px-3 py-1 animate-pulse">
              <AlertTriangle className="w-3 h-3" /> Tracking Alert
            </Badge>
          )}
        </div>
      </div>

      <Card className="border-border/60 shadow-xl bg-card/40 backdrop-blur-md overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary/40 to-primary/5" />
        <CardContent className="card-content-premium p-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-x divide-y divide-border/20">
            {pacingRows.map((row, i) => {
              const meta = KPI_META[row.metric] || {
                description: `${row.metric} calculated by the backend pacing engine.`,
                source: "Backend Pacing",
                type: row.daily_needed === null ? "EFFICIENCY" : "PACING",
              };
              const kpiStatus = getPacingBadge(row.status);
              const numericMtdTarget = isFiniteNumber(row.mtd_target) ? row.mtd_target : null;
              const numericMtdDelivered = isFiniteNumber(row.mtd_delivered) ? row.mtd_delivered : null;
              const hasProgress = numericMtdTarget !== null && numericMtdTarget > 0 && numericMtdDelivered !== null && row.daily_needed !== null;
              const progressPct = hasProgress ? Math.min((numericMtdDelivered / numericMtdTarget) * 100, 100) : 0;
              return (
                <div key={i} className="p-6 hover:bg-muted/5 transition-all group relative">
                  <div className="flex items-center justify-between mb-4">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors overflow-hidden truncate max-w-[120px]">
                          {row.metric}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-3 space-y-2 bg-card border-border shadow-2xl">
                          <p className="font-bold border-b border-border/50 pb-1 pl-5">{row.metric} Pacing</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
                          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50 text-xs">
                            <div><span className="opacity-50">Source:</span> <br />{meta.source}</div>
                            <div><span className="opacity-50">Type:</span> <br />{meta.type}</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Badge variant={kpiStatus.variant as any} className="t-micro px-1.5 py-0 font-bold uppercase tabular-nums">
                      {kpiStatus.label}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold tabular-nums tracking-tight mb-1">
                      {formatPacingValue(row.mtd_delivered, row.format)}
                    </h3>
                    <div className="space-y-1">
                      {row.mtd_target !== null ? (
                        <p className="text-xs text-muted-foreground font-medium">
                          Expected: <span className="text-foreground">{formatPacingValue(row.mtd_target, row.format)}</span>
                        </p>
                      ) : null}
                      {row.monthly_target !== null ? (
                        <p className="text-xs text-muted-foreground font-medium">
                          Monthly: <span className="text-foreground">{formatPacingValue(row.monthly_target, row.format)}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground font-medium">Manual Tracking</p>
                      )}
                    </div>
                  </div>
                  {hasProgress && (
                    <div className="absolute bottom-0 left-0 w-full h-0.5 bg-muted/30">
                      <div
                        className={cn("h-full transition-all", kpiStatus.variant === 'success' ? 'bg-emerald-500' : kpiStatus.variant === 'warning' ? 'bg-amber-400' : 'bg-red-500')}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Input Master */}
          <Card className="border-primary/20 shadow-lg overflow-hidden bg-gradient-to-br from-card to-card/60">
            <div className="h-1 bg-primary/40" />
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Manual Performance Sync
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-primary uppercase tracking-[0.2em] px-1">Update Attribution</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                    <Input
                      value={userName}
                      onChange={e => { setUserName(e.target.value); markChanged(); }}
                      className="pl-10 h-12 bg-primary/5 font-bold border-primary/20 focus:border-primary/50"
                      placeholder="Enter your name (e.g., Marketing Lead)"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="t-label">Actual SVs Achieved</label>
                  <div className="relative">
                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={svsAchieved}
                      onChange={e => { setSvsAchieved(Number(e.target.value)); markChanged(); }}
                      className="pl-10 h-12 bg-background/50 text-base font-bold border-border/60 focus:border-primary/50"
                      placeholder="Enter site visits count"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="t-label">Qualified Leads (Positive)</label>
                  <div className="relative">
                    <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={qualityLeadCount}
                      onChange={e => { setQualityLeadCount(Number(e.target.value)); markChanged(); }}
                      className="pl-10 h-12 bg-background/50 text-base font-bold border-border/60 focus:border-primary/50"
                      placeholder="Enter QL count"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="t-label">Closures (Deals Done)</label>
                  <div className="relative">
                    <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={closures}
                      onChange={e => { setClosures(Number(e.target.value)); markChanged(); }}
                      className="pl-10 h-12 bg-background/50 text-base font-bold border-border/60 focus:border-primary/50"
                      placeholder="Enter closures count"
                    />
                  </div>
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="t-label">Performance Feedback</label>
                  <Textarea
                    value={notes}
                    onChange={e => { setNotes(e.target.value); markChanged(); }}
                    className="bg-background/50 border-border/60 min-h-[48px] focus:border-primary/50"
                    placeholder="Marketing context, feedback, or observations..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-border/40">
                <div className="flex items-center gap-2">
                  {hasChanges && <Badge variant="warning" className="animate-pulse">Unsaved Changes</Badge>}
                  <p className="t-label">Manual inputs update real-time efficiency metrics above.</p>
                </div>
                {isAdmin ? (
                  <Button
                    onClick={handleSave}
                    disabled={!hasChanges || saveMutation.isPending}
                    className="px-8 shadow-lg shadow-primary/20 font-bold uppercase tracking-widest gap-2"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Publish Updates
                  </Button>
                ) : (
                  <Badge variant="outline" className="h-10 px-4 bg-muted/30 border-border text-muted-foreground uppercase tracking-widest text-xs">
                    Read Only
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Funnel Health Audit */}
          <Card className="bg-gradient-to-br from-card to-card/50 border-border/60 shadow-xl overflow-hidden mt-6">
            <div className="h-1 bg-primary/20" />
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Funnel Health Audit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40 group hover:border-primary/20 transition-colors">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Positive %</p>
                  </div>
                  <p className={`text-2xl font-bold tabular-nums ${positivePctTarget > 0 && mtd && (mtd.positive_pct || 0) >= positivePctTarget ? 'text-emerald-400' : 'text-foreground'}`}>
                    {mtd ? `${(mtd.positive_pct || 0).toFixed(1)}%` : '—'}
                  </p>
                  {positivePctTarget > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Target: {positivePctTarget.toFixed(1)}%</p>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40 group hover:border-primary/20 transition-colors">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3 h-3 text-amber-400" />
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">SV %</p>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">
                    {mtd ? `${(mtd.sv_pct || 0).toFixed(1)}%` : '—'}
                  </p>
                </div>
              </div>

              {/* Update History Log */}
              <div className="space-y-2 pt-4 border-t border-border/40">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Update History</p>
                  <Clock className="w-3 h-3 text-muted-foreground" />
                </div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {history.length > 0 ? (
                    history.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="p-3 rounded-xl border border-border/40 bg-muted/10 space-y-2">
                        <div className="flex justify-between items-center text-xs uppercase font-bold tracking-tight">
                          <span className="text-primary">{entry.updated_by || 'System'}</span>
                          <span className="text-muted-foreground">{entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '—'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-xs font-bold tabular-nums">
                          <div className="text-emerald-400">QL: {entry.quality_lead_count}</div>
                          <div className="text-amber-400">SV: {entry.svs_achieved}</div>
                          <div className="text-blue-400">D: {entry.closures_achieved}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-center text-muted-foreground py-4">No recent updates</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
