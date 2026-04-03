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
import { formatINR, formatNumber } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

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
  };
  status: {
    data_complete: boolean;
    manual_input_missing: boolean;
    tracking_issue_flag: boolean;
  };
  last_updated: string;
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
                  <p className="text-lg font-extrabold tabular-nums" style={{ color: entry.color }}>
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
  const { activeClientId, activeClient, activePlatform, apiBase } = useClient();
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<'volume' | 'efficiency'>('volume');
  const [svsAchieved, setSvsAchieved] = useState(0);
  const [positiveLeads, setPositiveLeads] = useState(0);
  const [closures, setClosures] = useState(0);
  const [qualityLeadCount, setQualityLeadCount] = useState(0);
  const [notes, setNotes] = useState("");
  const [userName, setUserName] = useState("Marketing Lead");
  const [hasChanges, setHasChanges] = useState(false);

  // 1. Fetch Consolidated MTD Data (Source of Truth)
  const { data: mtdData, isLoading: isLoadingMtd } = useQuery<ConsolidatedMtdData>({
    queryKey: ["/api/mtd-deliverables", activeClientId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/mtd-deliverables?client_id=${activeClientId}`);
      return res.json();
    },
    enabled: !!activeClientId,
    refetchInterval: 60000, // Sync every minute
  });

  // 2. Fetch Manual Entry for specific form fields
  const { data: deliverables, isLoading: isLoadingManual } = useQuery<ManualDeliverables>({
    queryKey: ["/api/clients", activeClientId, "mtd-deliverables"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/mtd-deliverables`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  // 3. Fetch History
  const { data: history = [], isLoading: isLoadingHistory } = useQuery<MtdHistoryEntry[]>({
    queryKey: ["/api/clients", activeClientId, "mtd-deliverables", "history"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/mtd-deliverables/history`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  // Populate form from fetched manual data
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

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<ManualDeliverables>) => {
      const res = await apiRequest("PUT", `/api/clients/${activeClientId}/mtd-deliverables`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, "mtd-deliverables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mtd-deliverables", activeClientId] });
      setHasChanges(false);
      toast({ title: "Saved", description: "MTD data updated successfully" });
    },
  });

  function handleSave() {
    saveMutation.mutate({
      svs_achieved: svsAchieved,
      positive_leads_achieved: positiveLeads,
      closures_achieved: closures,
      quality_lead_count: qualityLeadCount,
      notes,
      updated_by: userName,
    } as any);
  }

  function markChanged() { setHasChanges(true); }

  if (isLoadingMtd) {
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
      </div>
    );
  }

  const mtd = mtdData?.mtd;
  const status = mtdData?.status;
  const targets = activeClient?.targets?.[activePlatform];

  return (
    <div className="p-6 space-y-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">MTD Deliverables Master</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Activity className="w-3 h-3 text-emerald-400" />
              Unified Source of Truth (API + Manual) · Last Sync: {mtdData?.last_updated ? new Date(mtdData.last_updated).toLocaleTimeString() : 'Never'}
            </p>
          </div>
        </div>

        {status?.tracking_issue_flag && (
          <Badge variant="destructive" className="gap-1 px-3 py-1 animate-pulse">
            <AlertTriangle className="w-3 h-3" /> Tracking Issue Detected
          </Badge>
        )}
      </div>

      {/* ─── Performance Monitoring Section ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graph Card */}
        <Card className="lg:col-span-2 border-border/60 shadow-md">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Performance Snapshot ({viewMode.toUpperCase()})
              </CardTitle>
              <div className="flex bg-muted/30 p-1 rounded-md border border-border/40">
                <button 
                  onClick={() => setViewMode('volume')}
                  className={`px-3 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-all ${viewMode === 'volume' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Volume
                </button>
                <button 
                  onClick={() => setViewMode('efficiency')}
                  className={`px-3 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-all ${viewMode === 'efficiency' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Efficiency
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {mtd && <DeliverablesChart data={mtd} view={viewMode} />}
          </CardContent>
        </Card>

        {/* Anomaly & Status Panel */}
        <div className="space-y-4">
          <Card className="bg-card/40 border-border/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">MTD Anomalies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mtd && mtd.positive_pct < 15 && (
                <div className="p-3 rounded-lg bg-red-950/20 border border-red-500/30 text-xs text-red-300">
                  <p className="font-bold flex items-center gap-1.5 mb-1">
                    <TrendingDown className="w-3.5 h-3.5" /> Quality Alert
                  </p>
                  Positive % is only {mtd.positive_pct}% — leads may be low quality.
                </div>
              )}
              {mtd && mtd.cpl > (targets?.cpl || 1000) * 1.2 && (
                <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 text-xs text-amber-300">
                  <p className="font-bold flex items-center gap-1.5 mb-1">
                    <ArrowUpRight className="w-3.5 h-3.5" /> High CPL
                  </p>
                  Current CPL ₹{mtd.cpl} is {Math.round((mtd.cpl / (targets?.cpl || 1)) * 100 - 100)}% above target.
                </div>
              )}
              {status?.manual_input_missing && (
                <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-500/30 text-xs text-blue-300">
                  <p className="font-bold flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5" /> Input Missing
                  </p>
                  Qualified Leads or SV data hasn't been updated for this month.
                </div>
              )}
              {!status?.tracking_issue_flag && mtd && mtd.positive_pct >= 25 && (
                <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-300">
                  <p className="font-bold flex items-center gap-1.5 mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Optimal Delivery
                  </p>
                  Funnel quality is healthy ({mtd.positive_pct}% conversion).
                </div>
              )}
            </CardContent>
          </Card>

          {/* Efficiency Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-card/60 border border-border/60">
              <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Positive %</p>
              <p className={`text-xl font-black ${mtd && mtd.positive_pct > 25 ? 'text-emerald-400' : 'text-foreground'}`}>
                {mtd ? `${mtd.positive_pct}%` : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-card/60 border border-border/60">
              <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">SV %</p>
              <p className="text-xl font-black">
                {mtd ? `${mtd.sv_pct}%` : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Detailed Stats Summary ────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Spend', value: formatINR(mtd?.spend || 0, 0), icon: IndianRupee, color: 'text-blue-400' },
          { label: 'Total Leads', value: mtd?.leads || 0, icon: Users, color: 'text-emerald-400' },
          { label: 'Qualified Leads', value: mtd?.qualified_leads || 0, icon: TrendingUp, color: 'text-purple-400' },
          { label: 'Site Visits', value: mtd?.svs || 0, icon: Zap, color: 'text-amber-400' },
        ].map((kpi, i) => (
          <div key={i} className="bg-card p-4 rounded-xl border border-border/60 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-muted-foreground">{kpi.label}</span>
            </div>
            <p className="text-2xl font-black tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* ─── Input Master ─────────────────────────────────────────── */}
      <Card className="border-primary/20 shadow-lg overflow-hidden bg-gradient-to-br from-card to-card/60">
        <div className="h-1 bg-primary/40" />
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-black flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Manual Performance Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Updater Info */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-black text-primary uppercase tracking-[0.2em] px-1">Update Attribution</label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                <Input 
                  value={userName} 
                  onChange={e => { setUserName(e.target.value); markChanged(); }}
                  className="pl-10 h-12 bg-primary/5 font-black border-primary/20 focus:border-primary/50"
                  placeholder="Enter your name (e.g., Marketing Lead)"
                />
              </div>
            </div>

            {/* SVs */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Actual SVs Achieved</label>
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

            {/* Q Leads */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Qualified Leads (Positive)</label>
              <div className="relative">
                <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  type="number" 
                  value={positiveLeads} 
                  onChange={e => { setPositiveLeads(Number(e.target.value)); markChanged(); }}
                  className="pl-10 h-12 bg-background/50 text-base font-bold border-border/60 focus:border-primary/50"
                  placeholder="Enter QL count"
                />
              </div>
            </div>

            {/* Closures */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Closures (Deals Done)</label>
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

            {/* Notes */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Performance Feedback</label>
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
              <p className="text-[10px] text-muted-foreground">Manual inputs update real-time efficiency metrics above.</p>
            </div>
            {isAdmin ? (
              <Button 
                onClick={handleSave} 
                disabled={!hasChanges || saveMutation.isPending}
                className="px-8 shadow-lg shadow-primary/20 font-black uppercase tracking-widest gap-2"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Publish Updates
              </Button>
            ) : (
              <Badge variant="outline" className="h-10 px-4 bg-muted/30 border-border text-muted-foreground uppercase tracking-widest text-[10px]">
                Read Only
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Update History ────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-sm font-black flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Update Log & History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/30">
                  <th className="p-3 text-[10px] uppercase font-bold text-muted-foreground border-b border-border/40">Date</th>
                  <th className="p-3 text-[10px] uppercase font-bold text-muted-foreground border-b border-border/40">User</th>
                  <th className="p-3 text-[10px] uppercase font-bold text-muted-foreground border-b border-border/40">SVs</th>
                  <th className="p-3 text-[10px] uppercase font-bold text-muted-foreground border-b border-border/40">Pos Leads</th>
                  <th className="p-3 text-[10px] uppercase font-bold text-muted-foreground border-b border-border/40">Notes</th>
                </tr>
              </thead>
              <tbody>
                {history.length > 0 ? (
                  history.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/10 transition-colors border-b border-border/40">
                      <td className="p-3 text-xs tabular-nums text-muted-foreground">
                        {entry.updated_at ? new Date(entry.updated_at).toLocaleString() : '—'}
                      </td>
                      <td className="p-3 text-xs font-semibold text-foreground">
                        {entry.updated_by || 'System User'}
                      </td>
                      <td className="p-3 text-xs font-bold tabular-nums">
                        {entry.svs_achieved}
                      </td>
                      <td className="p-3 text-xs font-bold tabular-nums">
                        {entry.positive_leads_achieved}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate" title={entry.notes}>
                        {entry.notes || '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-xs text-muted-foreground">
                      No update history available for this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'CPL (Overall)', value: formatINR(mtd?.cpl || 0, 0), target: targets?.cpl },
          { label: 'CPQL (Qualified)', value: formatINR(mtd?.cpql || 0, 0), target: (targets?.cpl || 0) * 2.5 },
          { label: 'CPSV (Site Visit)', value: formatINR(mtd?.cpsv || 0, 0), target: targets?.cpsv?.high },
        ].map((eff, i) => (
          <div key={i} className="p-4 rounded-xl bg-card border border-border/60">
            <p className="text-[10px] uppercase font-extrabold text-muted-foreground mb-1">{eff.label}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-black">{eff.value}</p>
              {eff.target && (
                <span className="text-[10px] text-muted-foreground font-medium">Target: ₹{formatNumber(eff.target as number)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
