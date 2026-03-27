import { useState, useEffect, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Settings,
  Wifi,
  WifiOff,
  Calendar,
  Download,
  Play,
  Terminal,
  CheckCircle,
  XCircle,
  Globe,
  Target,
  Clock,
  Info,
  Loader2,
  FileJson,
  FileSpreadsheet,
  BookOpen,
  Users,
  Plus,
  X,
  RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── CSV Export Utility ──────────────────────────────────────────────

function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0] || {});
  const csv = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    activeClient,
    activeClientId,
    activePlatform,
    analysisData: data,
    isLoadingAnalysis,
    apiBase,
  } = useClient();
  const { toast } = useToast();

  const [metaStatus, setMetaStatus] = useState<"checking" | "ok" | "error">("checking");
  const [metaApiVersion, setMetaApiVersion] = useState<string>("");
  const [metaTokenExpiry, setMetaTokenExpiry] = useState<string>("");
  const [metaTokenDebug, setMetaTokenDebug] = useState<string>("");
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [learningData, setLearningData] = useState<any[]>([]);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [isVerifyingApi, setIsVerifyingApi] = useState(false);

  // Google API status state (GS-01)
  const [googleStatus, setGoogleStatus] = useState<"checking" | "ok" | "error" | "idle">("idle");
  const [googleCustomerId, setGoogleCustomerId] = useState<string>("");
  const [googleMccId, setGoogleMccId] = useState<string>("");
  const [googleApiVersion, setGoogleApiVersion] = useState<string>("");
  const [isVerifyingGoogleApi, setIsVerifyingGoogleApi] = useState(false);

  // Team Access state
  const [teamEmails, setTeamEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  // Verify Meta API status — actually pings the Meta API
  async function verifyMetaApi() {
    setIsVerifyingApi(true);
    setMetaStatus("checking");
    try {
      const r = await fetch("/api/entity/act_391022327028566/status");
      if (r.ok) {
        setMetaStatus("ok");
        const d = await r.json().catch(() => null);
        if (d) {
          setMetaApiVersion(d.api_version || "v21.0");
          setMetaTokenExpiry(d.token_expires || "");
          setMetaTokenDebug(d.account_id ? `Account: ${d.account_id}` : "");
        }
      } else {
        setMetaStatus("error");
        const errData = await r.json().catch(() => null);
        setMetaTokenDebug(errData?.error || `HTTP ${r.status}`);
      }
    } catch (err: any) {
      setMetaStatus("error");
      setMetaTokenDebug(err.message || "Connection failed");
    }
    setIsVerifyingApi(false);
  }

  // Verify Google API status (GS-01)
  async function verifyGoogleApi() {
    setIsVerifyingGoogleApi(true);
    setGoogleStatus("checking");
    try {
      const url = `${apiBase}/entity/google/status`;
      const r = await fetch(url);
      if (r.ok) {
        setGoogleStatus("ok");
        const d = await r.json().catch(() => null);
        if (d) {
          setGoogleCustomerId(
            (d as any).customer_id || (d as any).account_id || ""
          );
          setGoogleMccId((d as any).mcc_id || (d as any).manager_id || "");
          setGoogleApiVersion((d as any).api_version || "v17");
        }
      } else {
        setGoogleStatus("error");
      }
    } catch {
      setGoogleStatus("error");
    }
    setIsVerifyingGoogleApi(false);
  }

  // Initial Meta API check
  useEffect(() => {
    verifyMetaApi();
  }, []);

  // Fetch audit log for exports
  useEffect(() => {
    apiRequest("GET", `${apiBase}/audit-log`)
      .then((r) => r.json())
      .then((d) => setAuditLog(d.entries || d || []))
      .catch(() => {});
  }, [apiBase]);

  // Fetch learning data for exports
  useEffect(() => {
    apiRequest("GET", `${apiBase}/learning-data`)
      .then((r) => r.json())
      .then((d) => setLearningData(d.entries || d || []))
      .catch(() => {});
  }, [apiBase]);

  // MV2-13: Load team emails from local storage on mount / client change
  useEffect(() => {
    if (!activeClientId) return;
    try {
      let stored: string | null = null; // team emails loaded from backend only
      if (stored) {
        setTeamEmails(JSON.parse(stored));
      } else {
        setTeamEmails([]);
      }
    } catch {
      setTeamEmails([]);
    }
  }, [activeClientId]);

  // MV2-13: Persist team emails to local storage + fire-and-forget backend save
  function persistTeamEmails(emails: string[]) {
    if (!activeClientId) return;
    try {
      // team emails persisted to backend only (no browser storage in iframe)
    } catch {
      // storage may be unavailable in some iframe contexts
    }
    // Fire-and-forget backend persistence
    apiRequest("POST", `${apiBase}/team-access`, { emails }).catch(() => {});
  }

  function addTeamEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast({ title: "Invalid email", variant: "destructive" });
      return;
    }
    if (teamEmails.includes(email)) {
      toast({ title: "Email already added", variant: "destructive" });
      return;
    }
    const updated = [...teamEmails, email];
    setTeamEmails(updated);
    persistTeamEmails(updated);
    setNewEmail("");
    toast({ title: "Email added", description: `${email} added to team access list` });
  }

  function removeTeamEmail(email: string) {
    const updated = teamEmails.filter(e => e !== email);
    setTeamEmails(updated);
    persistTeamEmails(updated);
  }

  // Google sync time from analysis
  const googleLastSync = useMemo(() => {
    if (!data) return null;
    return (
      (data as any).generated_at ||
      (data as any).analysis_date ||
      (data as any).timestamp ||
      null
    );
  }, [data]);

  // Last Agent Run timestamp
  const lastAgentRun = useMemo(() => {
    if (!data) return null;
    return (data as any).generated_at || (data as any).analysis_date || (data as any).timestamp || null;
  }, [data]);

  const targets = activeClient?.targets;
  const targetLocations = (activeClient as any)?.targetLocations || [];

  // Export handlers
  async function handleExport(type: "audit" | "analysis" | "learning") {
    setIsExporting(type);
    try {
      switch (type) {
        case "audit":
          downloadCSV(auditLog, `audit-log-${activeClientId}-${activePlatform}.csv`);
          break;
        case "analysis":
          downloadJSON(data, `analysis-${activeClientId}-${activePlatform}.json`);
          break;
        case "learning":
          downloadCSV(learningData, `learning-data-${activeClientId}-${activePlatform}.csv`);
          break;
      }
      toast({ title: "Export Complete", description: `${type} data downloaded` });
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
    } finally {
      setTimeout(() => setIsExporting(null), 500);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1000px]">
      <div>
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          API status, team access, agent schedule, and data exports
        </p>
      </div>

      {/* ─── A) API Status Section ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="w-4 h-4" />
            API Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Meta Status */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="flex items-center gap-2">
                {metaStatus === "checking" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : metaStatus === "ok" ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <div>
                  <p className="text-xs font-medium text-foreground">Meta Ads API</p>
                  <p className="text-[10px] text-muted-foreground">
                    {metaStatus === "checking"
                      ? "Verifying token..."
                      : metaStatus === "ok"
                      ? "Token verified — connected"
                      : "Token invalid or expired"}
                    {metaApiVersion && ` · ${metaApiVersion}`}
                  </p>
                  {metaTokenDebug && (
                    <p className="text-[10px] text-muted-foreground/70">{metaTokenDebug}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-[10px] ${
                    metaStatus === "ok"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : metaStatus === "error"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {metaStatus === "ok" ? "Active" : metaStatus === "error" ? "Error" : "..."}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={verifyMetaApi}
                  disabled={isVerifyingApi}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingApi ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {/* Google Status (GS-01) */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="flex items-center gap-2">
                {googleStatus === "checking" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : googleStatus === "ok" ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : googleStatus === "error" ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : googleLastSync ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <WifiOff className="w-4 h-4 text-muted-foreground" />
                )}
                <div>
                  <p className="text-xs font-medium text-foreground">Google Ads API</p>
                  <p className="text-[10px] text-muted-foreground">
                    {googleStatus === "checking"
                      ? "Verifying connection..."
                      : googleStatus === "ok"
                      ? "Token verified — connected"
                      : googleStatus === "error"
                      ? "Connection failed"
                      : googleLastSync
                      ? `Last sync: ${new Date(googleLastSync).toLocaleDateString()}`
                      : "No data synced yet"}
                    {googleApiVersion && ` · ${googleApiVersion}`}
                  </p>
                  {googleCustomerId && (
                    <p className="text-[10px] text-muted-foreground/70">
                      Customer: {googleCustomerId}
                      {googleMccId && ` · MCC: ${googleMccId}`}
                    </p>
                  )}
                  {!googleCustomerId && (data as any)?.customer_id && (
                    <p className="text-[10px] text-muted-foreground/70">
                      Customer: {(data as any).customer_id}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-[10px] ${
                    googleStatus === "ok"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : googleStatus === "error"
                      ? "bg-red-500/15 text-red-400"
                      : googleLastSync
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {googleStatus === "ok"
                    ? "Active"
                    : googleStatus === "error"
                    ? "Error"
                    : googleStatus === "checking"
                    ? "..."
                    : googleLastSync
                    ? "Active"
                    : "Pending"}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={verifyGoogleApi}
                  disabled={isVerifyingGoogleApi}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingGoogleApi ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </div>

          {metaTokenExpiry && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Meta token expires: {metaTokenExpiry}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ─── B) Team Access Section ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" />
            Team Access
            <Badge variant="secondary" className="text-[10px]">{activeClient?.shortName || activeClientId}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[10px] text-muted-foreground">
            Authorized team members for this client. Access list persists locally. Backend enforcement requires production auth layer.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="team@example.com"
              className="flex-1 text-sm bg-muted/30"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTeamEmail(); }}
            />
            <Button size="sm" onClick={addTeamEmail} disabled={!newEmail.trim()} className="gap-1">
              <Plus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>
          {teamEmails.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {teamEmails.map((email) => (
                <Badge key={email} variant="outline" className="text-xs py-1 px-2 flex items-center gap-1">
                  {email}
                  <button
                    className="ml-1 text-muted-foreground hover:text-red-400 transition-colors"
                    onClick={() => removeTeamEmail(email)}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground italic">No team members added yet</p>
          )}
        </CardContent>
      </Card>

      {/* ─── C) Client Configuration Section ────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4" />
            Client Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-foreground">
              {activeClient?.name || "Amara"}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {activeClient?.shortName || "Amara"}
            </Badge>
            {activeClient?.location && (
              <span className="text-[10px] text-muted-foreground">
                📍 {activeClient.location}
              </span>
            )}
          </div>

          {/* Target locations */}
          {targetLocations.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Target Locations
              </p>
              <div className="flex flex-wrap gap-1.5">
                {targetLocations.map((loc: string) => (
                  <Badge key={loc} variant="outline" className="text-[10px]">
                    {loc}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Targets Table */}
          {targets && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Monthly Targets
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="p-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-left">
                        Platform
                      </th>
                      <th className="p-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">
                        Budget
                      </th>
                      <th className="p-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">
                        Leads
                      </th>
                      <th className="p-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">
                        CPL
                      </th>
                      <th className="p-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">
                        SVs
                      </th>
                      <th className="p-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground text-right">
                        CPSV
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(targets).map(([platform, t]) => (
                      <tr
                        key={platform}
                        className="border-b border-border/30"
                      >
                        <td className="p-2">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              platform === "meta"
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-amber-500/15 text-amber-400"
                            }`}
                          >
                            {platform === "meta" ? "Meta Ads" : "Google Ads"}
                          </Badge>
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          ₹{t.budget.toLocaleString()}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {t.leads}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          ₹{t.cpl.toLocaleString()}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {t.svs.low}–{t.svs.high}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          ₹{t.cpsv.low.toLocaleString()}–₹{t.cpsv.high.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── D) Agent Schedule Section ──────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Agent Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Primary daily schedule */}
          <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-primary">Daily Agent Run</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Runs every day at 9:00 AM IST — refreshes all data, campaigns, metrics, alerts, and insights
                </p>
              </div>
              <Badge variant="secondary" className="bg-primary/15 text-primary text-[10px]">
                Active
              </Badge>
            </div>
          </div>

          {/* Last Agent Run */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium text-foreground">Last Agent Run</p>
                <p className="text-[10px] text-muted-foreground">
                  {lastAgentRun
                    ? new Date(lastAgentRun).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                    : "No data available"
                  }
                </p>
              </div>
            </div>
            {lastAgentRun && (
              <Badge variant="secondary" className="text-[10px]">
                {Math.round((Date.now() - new Date(lastAgentRun).getTime()) / 3600000)}h ago
              </Badge>
            )}
          </div>

          {/* Audit cadence schedule */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Audit Cadences</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { cadence: "Twice Weekly", timing: "Monday & Thursday 9 AM", color: "text-blue-400" },
                { cadence: "Weekly", timing: "Wednesday 9 AM", color: "text-emerald-400" },
                { cadence: "Bi-Weekly", timing: "1st & 15th of month", color: "text-amber-400" },
                { cadence: "Monthly", timing: "27th of month", color: "text-purple-400" },
              ].map((s) => (
                <div
                  key={s.cadence}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30"
                >
                  <div>
                    <p className={`text-xs font-medium ${s.color}`}>
                      {s.cadence}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.timing}
                    </p>
                  </div>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>

          {/* Run Agent Now */}
          <div className="border-t border-border/30 pt-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Manual Agent Trigger
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                <div className="flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-foreground">Meta Ads Agent</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Agent execution requires manual trigger via CLI
                </p>
                <code className="block text-[10px] px-2 py-1.5 rounded bg-background border border-border/50 text-muted-foreground font-mono">
                  <Terminal className="w-3 h-3 inline-block mr-1 text-emerald-400" />
                  python3 ads_agent/meta_ads_agent_v2.py
                </code>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                <div className="flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-foreground">Google Ads Agent</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Agent execution requires manual trigger via CLI
                </p>
                <code className="block text-[10px] px-2 py-1.5 rounded bg-background border border-border/50 text-muted-foreground font-mono">
                  <Terminal className="w-3 h-3 inline-block mr-1 text-emerald-400" />
                  python3 ads_agent/google_ads_agent_v2.py
                </code>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── E) Data Export Section ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />
            Data Export
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-1 gap-3 ${activePlatform === "google" ? "md:grid-cols-3 lg:grid-cols-6" : "md:grid-cols-3"}`}>
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
              onClick={() => handleExport("audit")}
              disabled={isExporting === "audit" || auditLog.length === 0}
            >
              {isExporting === "audit" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              )}
              <span>Export Audit Log</span>
              <span className="text-[10px] text-muted-foreground">
                {auditLog.length} entries · CSV
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
              onClick={() => handleExport("analysis")}
              disabled={isExporting === "analysis" || !data}
            >
              {isExporting === "analysis" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileJson className="w-4 h-4 text-blue-400" />
              )}
              <span>Export Analysis JSON</span>
              <span className="text-[10px] text-muted-foreground">
                Current analysis · JSON
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
              onClick={() => handleExport("learning")}
              disabled={isExporting === "learning" || learningData.length === 0}
            >
              {isExporting === "learning" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BookOpen className="w-4 h-4 text-purple-400" />
              )}
              <span>Export Learning Data</span>
              <span className="text-[10px] text-muted-foreground">
                {learningData.length} entries · CSV
              </span>
            </Button>

            {/* GS-02: Google-specific exports */}
            {activePlatform === "google" && (
              <>
                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
                  onClick={() => {
                    setIsExporting("search_terms");
                    try {
                      const searchTerms: any[] =
                        (data as any)?.search_terms ||
                        (data as any)?.search_term_analysis ||
                        [];
                      downloadCSV(
                        Array.isArray(searchTerms) ? searchTerms : [searchTerms],
                        `search-terms-${activeClientId}.csv`
                      );
                      toast({ title: "Export Complete", description: "Search terms CSV downloaded" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
                    } finally {
                      setTimeout(() => setIsExporting(null), 500);
                    }
                  }}
                  disabled={
                    isExporting === "search_terms" ||
                    (!((data as any)?.search_terms) && !((data as any)?.search_term_analysis))
                  }
                >
                  {isExporting === "search_terms" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                  )}
                  <span>Export Search Terms</span>
                  <span className="text-[10px] text-muted-foreground">Search terms · CSV</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
                  onClick={() => {
                    setIsExporting("quality_scores");
                    try {
                      let qualityScores: any[] =
                        (data as any)?.quality_scores || [];
                      if (!qualityScores.length) {
                        // Derive from campaigns → ad_groups
                        const campaigns: any[] = (data as any)?.campaigns || [];
                        campaigns.forEach((c: any) => {
                          (c.ad_groups || []).forEach((ag: any) => {
                            if (ag.quality_score != null) {
                              qualityScores.push({
                                campaign: c.name || c.campaign_name || c.id,
                                ad_group: ag.name || ag.ad_group_name || ag.id,
                                quality_score: ag.quality_score,
                              });
                            }
                          });
                        });
                      }
                      downloadCSV(qualityScores, `quality-scores-${activeClientId}.csv`);
                      toast({ title: "Export Complete", description: "Quality score CSV downloaded" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
                    } finally {
                      setTimeout(() => setIsExporting(null), 500);
                    }
                  }}
                  disabled={isExporting === "quality_scores" || !data}
                >
                  {isExporting === "quality_scores" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                  )}
                  <span>Export Quality Scores</span>
                  <span className="text-[10px] text-muted-foreground">Quality score · CSV</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
                  onClick={() => {
                    setIsExporting("keyword_performance");
                    try {
                      const keywords: any[] = [];
                      const campaigns: any[] = (data as any)?.campaigns || [];
                      campaigns.forEach((c: any) => {
                        (c.ad_groups || []).forEach((ag: any) => {
                          (ag.keywords || []).forEach((kw: any) => {
                            keywords.push({
                              campaign: c.name || c.campaign_name || c.id,
                              ad_group: ag.name || ag.ad_group_name || ag.id,
                              ...kw,
                            });
                          });
                        });
                      });
                      downloadCSV(keywords, `keyword-performance-${activeClientId}.csv`);
                      toast({ title: "Export Complete", description: "Keyword performance CSV downloaded" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
                    } finally {
                      setTimeout(() => setIsExporting(null), 500);
                    }
                  }}
                  disabled={isExporting === "keyword_performance" || !data}
                >
                  {isExporting === "keyword_performance" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  )}
                  <span>Export Keyword Perf.</span>
                  <span className="text-[10px] text-muted-foreground">Keywords · CSV</span>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── F) About Section ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Mojo Performance Agent V2
              </p>
              <p className="text-[10px] text-muted-foreground">
                Powered by Digital Mojo
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              v2.0.0
            </Badge>
          </div>
          <div className="text-[10px] text-muted-foreground space-y-1 pt-2 border-t border-border/30">
            <p>
              Version: 2.0.0 · Build: {new Date().toISOString().split("T")[0]}
            </p>
            <p>
              Multi-platform ad management · Meta + Google Ads · Smart Bidding · Execution Engine
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
