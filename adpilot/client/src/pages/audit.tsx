import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Target,
  Activity,
  Calendar,
  CalendarDays,
  CalendarRange,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Eye,
  Zap,
  BarChart3,
  Users,
  IndianRupee,
  Palette,
  Radio,
  Search,
  Layers,
  Shuffle,
  RefreshCw,
  Scale,
  FlaskConical,
  RotateCcw,
  Megaphone,
  PieChart,
  FileText,
} from "lucide-react";
import { formatINR, formatPct, getCplColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UnifiedActions, type UnifiedActionItem, type ActionState } from "@/components/unified-actions";

// ─── SOP Checklist Definitions ──────────────────────────────────────

type CheckStatus = "pass" | "fail" | "warning" | "na" | "loading";

interface ChecklistItem {
  id: string;
  sopText: string;
  icon: typeof Target;
  /** Extract current data from analysis */
  getData: (data: any) => {
    status: CheckStatus;
    currentValue: string;
    detail: string;
    recommendation?: string;
    autoExecutable?: boolean;
    actionConfig?: Partial<UnifiedActionItem>;
  };
}

interface ChecklistSection {
  title: string;
  icon: typeof Target;
  items: ChecklistItem[];
}

// ─── Helper Functions ───────────────────────────────────────────────

function getSpendVsPlan(data: any): { actual: number; plan: number; pct: number } {
  const budget = data?.dynamic_thresholds?.budget ?? data?.benchmarks?.budget ?? 0;
  const totalSpend = data?.total_spend ?? data?.account_summary?.spend ?? 0;
  const dailyBudget = budget / 30;
  const daysSoFar = new Date().getDate();
  const expectedSpend = dailyBudget * daysSoFar;
  return { actual: totalSpend, plan: expectedSpend, pct: expectedSpend > 0 ? ((totalSpend - expectedSpend) / expectedSpend) * 100 : 0 };
}

function getNonSpendingAdsets(data: any): any[] {
  if (!data?.adset_analysis) return [];
  return data.adset_analysis.filter((a: any) => (a.spend ?? 0) === 0 && a.status?.toUpperCase() === "ACTIVE");
}

function getCostStack(data: any): { cpm: number; ctr: number; cpc: number; cpl: number; cpmStatus: CheckStatus; ctrStatus: CheckStatus; cpcStatus: CheckStatus; cplStatus: CheckStatus } {
  const t = data?.dynamic_thresholds || {};
  const s = data?.account_summary || {};
  const cpm = s.cpm ?? 0;
  const ctr = s.ctr ?? 0;
  const cpc = s.cpc ?? 0;
  const cpl = s.cpl ?? 0;
  return {
    cpm, ctr, cpc, cpl,
    cpmStatus: cpm > (t.cpm_max ?? 600) ? "fail" : cpm > (t.cpm_max ?? 600) * 0.8 ? "warning" : "pass",
    ctrStatus: ctr < (t.ctr_min ?? 0.7) ? "fail" : ctr < (t.ctr_min ?? 0.7) * 1.2 ? "warning" : "pass",
    cpcStatus: cpc > (t.cpc_max ?? 50) ? "fail" : cpc > (t.cpc_max ?? 50) * 0.8 ? "warning" : "pass",
    cplStatus: cpl > (t.cpl_target ?? 1500) * 1.3 ? "fail" : cpl > (t.cpl_target ?? 1500) ? "warning" : "pass",
  };
}

function getCreativeHealth(data: any): { adsAnalyzed: number; tsrFailing: number; vhrFailing: number; ffrFailing: number; details: any[] } {
  const ads = data?.creative_health || [];
  const t = data?.dynamic_thresholds || {};
  const tsrMin = t.tsr_min ?? 30;
  const vhrMin = t.vhr_min ?? 25;
  const ffrMin = 90;
  const tsrFailing = ads.filter((a: any) => (a.tsr ?? a.thumb_stop_rate ?? 0) < tsrMin).length;
  const vhrFailing = ads.filter((a: any) => (a.vhr ?? a.hold_rate ?? 0) < vhrMin).length;
  const ffrFailing = ads.filter((a: any) => (a.ffr ?? a.first_frame_rate ?? 100) < ffrMin).length;
  return { adsAnalyzed: ads.length, tsrFailing, vhrFailing, ffrFailing, details: ads };
}

function getTrackingSanity(data: any): { todayLeads: number; monthlyTarget: number; onTrack: boolean } {
  const todayLeads = data?.tracking_sanity?.today_leads ?? data?.account_summary?.leads_today ?? 0;
  const monthlyTarget = data?.dynamic_thresholds?.leads ?? data?.benchmarks?.leads ?? 0;
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const expectedDaily = monthlyTarget / daysInMonth;
  return { todayLeads, monthlyTarget, onTrack: todayLeads >= expectedDaily * 0.5 };
}

// ─── Google Helpers ────────────────────────────────────────────────

function getGoogleSpendVsPlan(data: any): { actual: number; plan: number; pct: number } {
  const ap = data?.account_pulse || {};
  const budget = data?.dynamic_thresholds?.budget ?? ap.target_budget ?? 0;
  const totalSpend = ap.total_spend_30d ?? ap.total_spend ?? 0;
  const dailyBudget = budget / 30;
  const daysSoFar = new Date().getDate();
  const expectedSpend = dailyBudget * daysSoFar;
  return { actual: totalSpend, plan: expectedSpend, pct: expectedSpend > 0 ? ((totalSpend - expectedSpend) / expectedSpend) * 100 : 0 };
}

function getGoogleCvrOutliers(data: any): any[] {
  const campaigns = data?.campaigns || [];
  const adGroups = campaigns.flatMap((c: any) => (c.ad_groups || []).map((ag: any) => ({ ...ag, campaign_name: c.name })));
  // Flag ad groups with CVR < 50% of overall avg
  const totalClicks = adGroups.reduce((s: number, ag: any) => s + (ag.clicks || 0), 0);
  const totalConv = adGroups.reduce((s: number, ag: any) => s + (ag.conversions || 0), 0);
  const avgCvr = totalClicks > 0 ? (totalConv / totalClicks) * 100 : 0;
  return adGroups.filter((ag: any) => {
    const agCvr = ag.clicks > 0 ? ((ag.conversions || 0) / ag.clicks) * 100 : 0;
    return ag.clicks > 50 && agCvr < avgCvr * 0.5;
  });
}

function getGoogleISData(data: any, type: string): { is: number; lostRank: number; lostBudget: number } {
  const campaigns = data?.campaigns || [];
  const filtered = campaigns.filter((c: any) => (c.campaign_type || c.theme || "") === type);
  if (filtered.length === 0) return { is: 0, lostRank: 0, lostBudget: 0 };
  const avgIS = filtered.reduce((s: number, c: any) => s + (c.search_impression_share || c.impression_share || 0), 0) / filtered.length;
  const avgLostRank = filtered.reduce((s: number, c: any) => s + (c.search_is_lost_rank || c.is_lost_rank || 0), 0) / filtered.length;
  const avgLostBudget = filtered.reduce((s: number, c: any) => s + (c.search_is_lost_budget || c.is_lost_budget || 0), 0) / filtered.length;
  return { is: avgIS, lostRank: avgLostRank, lostBudget: avgLostBudget };
}

function getGoogleDGCPM(data: any): number {
  const dgSummary = data?.dg_summary;
  if (dgSummary?.cpm) return dgSummary.cpm;
  const campaigns = data?.campaigns || [];
  const dg = campaigns.filter((c: any) => (c.campaign_type || "") === "demand_gen");
  if (dg.length === 0) return 0;
  const totalImpr = dg.reduce((s: number, c: any) => s + (c.impressions || 0), 0);
  const totalCost = dg.reduce((s: number, c: any) => s + (c.cost || c.spend || 0), 0);
  return totalImpr > 0 ? (totalCost / totalImpr) * 1000 : 0;
}

function getGoogleQSData(data: any): { avgQS: number; below6Count: number; total: number; details: any[] } {
  const campaigns = data?.campaigns || [];
  const adGroups = campaigns.flatMap((c: any) => (c.ad_groups || []).map((ag: any) => ({ ...ag, campaign_name: c.name })));
  const withQS = adGroups.filter((ag: any) => ag.quality_score != null && ag.quality_score > 0);
  const avgQS = withQS.length > 0 ? withQS.reduce((s: number, ag: any) => s + ag.quality_score, 0) / withQS.length : 0;
  const below6 = withQS.filter((ag: any) => ag.quality_score < 6);
  return { avgQS, below6Count: below6.length, total: withQS.length, details: below6 };
}

function getGoogleKeywordPerformance(data: any): { zeroConvCount: number; totalKeywords: number; wastedSpend: number } {
  const campaigns = data?.campaigns || [];
  const cplTarget = data?.dynamic_thresholds?.cpl_target ?? 850;
  let zeroConvCount = 0, totalKeywords = 0, wastedSpend = 0;
  campaigns.forEach((c: any) => {
    (c.ad_groups || []).forEach((ag: any) => {
      (ag.keywords || []).forEach((kw: any) => {
        totalKeywords++;
        if ((kw.conversions || 0) === 0 && (kw.cost || kw.spend || 0) > cplTarget * 1.5) {
          zeroConvCount++;
          wastedSpend += (kw.cost || kw.spend || 0);
        }
      });
    });
  });
  return { zeroConvCount, totalKeywords, wastedSpend };
}

// ─── Daily/2x-Weekly Checklist ──────────────────────────────────────

const DAILY_CHECKLIST: ChecklistSection[] = [
  {
    title: "Account Pulse",
    icon: Activity,
    items: [
      {
        id: "daily-spend-vs-plan",
        sopText: "Spend vs plan (±20%) → adjust budgets",
        icon: IndianRupee,
        getData: (data) => {
          const { actual, plan, pct } = getSpendVsPlan(data);
          const status: CheckStatus = Math.abs(pct) > 20 ? "fail" : Math.abs(pct) > 10 ? "warning" : "pass";
          return {
            status,
            currentValue: `${formatINR(actual, 0)} vs ${formatINR(plan, 0)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
            detail: status === "pass" ? "Spend is within 20% of plan" : `Spend is ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "over" : "under"} plan`,
            recommendation: status !== "pass" ? (pct > 0 ? "Consider reducing daily budgets to stay on plan" : "Consider increasing budgets or checking delivery issues") : undefined,
          };
        },
      },
      {
        id: "daily-delivery",
        sopText: "Delivery: any ad sets not spending? → Add fresh creatives, widen signals, check exclusions, or duplicate & restart",
        icon: Radio,
        getData: (data) => {
          const nonSpending = getNonSpendingAdsets(data);
          const status: CheckStatus = nonSpending.length > 0 ? "fail" : "pass";
          return {
            status,
            currentValue: nonSpending.length > 0 ? `${nonSpending.length} non-spending ad set(s)` : "All ad sets spending",
            detail: nonSpending.length > 0 ? nonSpending.map((a: any) => a.adset_name || a.name).join(", ") : "All active ad sets have spend",
            recommendation: nonSpending.length > 0 ? "Add fresh creatives, widen signals in the same campaign, ensure no over-exclusions, or duplicate & restart" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Cost Stack & Quick Triage (by layer)",
    icon: BarChart3,
    items: [
      {
        id: "daily-cost-stack",
        sopText: "Check CPM → CTR → CPC → CPL. Diagnose: CPM↑ & CTR↓ = creative fatigue; CPM flat & CTR↓ = weak hook; CPM/CTR stable & CPL↑ = audience/form issue",
        icon: TrendingUp,
        getData: (data) => {
          const cs = getCostStack(data);
          const failCount = [cs.cpmStatus, cs.ctrStatus, cs.cpcStatus, cs.cplStatus].filter(s => s === "fail").length;
          const warnCount = [cs.cpmStatus, cs.ctrStatus, cs.cpcStatus, cs.cplStatus].filter(s => s === "warning").length;
          const status: CheckStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warning" : "pass";
          let recommendation: string | undefined;
          if (cs.cpmStatus === "fail" && cs.ctrStatus === "fail") {
            recommendation = "Creative fatigue suspected — check frequency. If TOFU/MOFU freq > 2.5 or BOFU > 4, refresh creative";
          } else if (cs.cpmStatus === "pass" && cs.ctrStatus === "fail") {
            recommendation = "Offer/hook weak — sharpen headline/first 3 sec; try new angle (price/USP/FAQ/FOMO)";
          } else if (cs.cplStatus === "fail" && cs.cpmStatus === "pass" && cs.ctrStatus === "pass") {
            recommendation = "Audience not right or form too extensive — review targeting and form friction";
          }
          return {
            status,
            currentValue: `CPM ${formatINR(cs.cpm, 0)} · CTR ${cs.ctr.toFixed(2)}% · CPC ${formatINR(cs.cpc, 0)} · CPL ${formatINR(cs.cpl, 0)}`,
            detail: `${failCount} metric(s) failing, ${warnCount} warning`,
            recommendation,
          };
        },
      },
    ],
  },
  {
    title: "Creative Health (Video & Image)",
    icon: Palette,
    items: [
      {
        id: "daily-tsr",
        sopText: "Thumb-stop ratio (3s views ÷ impressions) ≥ 30% — improve hook if below",
        icon: Eye,
        getData: (data) => {
          const ch = getCreativeHealth(data);
          const status: CheckStatus = ch.tsrFailing > 0 ? "fail" : "pass";
          return {
            status,
            currentValue: ch.tsrFailing > 0 ? `${ch.tsrFailing}/${ch.adsAnalyzed} ads below 30% TSR` : `All ${ch.adsAnalyzed} ads ≥ 30% TSR`,
            detail: "Target ≥ 30%. If low: fix hook, thumbnail, contrast, add motion in first 1s",
            recommendation: ch.tsrFailing > 0 ? "Improve hooks — add motion/face in first 3s, brighter contrast, pattern interrupts" : undefined,
          };
        },
      },
      {
        id: "daily-vhr",
        sopText: "Video Hold Rate (3s→15s) ≥ 25% — tighten middle if drop steep",
        icon: Eye,
        getData: (data) => {
          const ch = getCreativeHealth(data);
          const status: CheckStatus = ch.vhrFailing > 0 ? "fail" : "pass";
          return {
            status,
            currentValue: ch.vhrFailing > 0 ? `${ch.vhrFailing}/${ch.adsAnalyzed} ads below 25% VHR` : `All ${ch.adsAnalyzed} ads ≥ 25% VHR`,
            detail: "Target ≥ 25%. If low: add jump-cuts, pattern-interrupts, motion text",
            recommendation: ch.vhrFailing > 0 ? "Re-script first 5-7s; add jump-cuts/pattern-interrupts/motion text" : undefined,
          };
        },
      },
      {
        id: "daily-ffr",
        sopText: "First Frame Rate ≥ 90% — fix thumbnails, contrast, first 3 words",
        icon: Eye,
        getData: (data) => {
          const ch = getCreativeHealth(data);
          const status: CheckStatus = ch.ffrFailing > 0 ? "fail" : "pass";
          return {
            status,
            currentValue: ch.ffrFailing > 0 ? `${ch.ffrFailing}/${ch.adsAnalyzed} ads below 90% FFR` : `All ${ch.adsAnalyzed} ads ≥ 90% FFR`,
            detail: "Target ≥ 90%. If low: improve contrast, thumbnail, motion, first 3 words",
            recommendation: ch.ffrFailing > 0 ? "Fix thumbnails, add contrast/motion in first frame, improve headline at 0-1s" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Tracking Sanity",
    icon: Search,
    items: [
      {
        id: "daily-tracking",
        sopText: "Leads captured today — no sudden drop to zero. Spot-check UTMs/click IDs in CRM",
        icon: Target,
        getData: (data) => {
          const ts = getTrackingSanity(data);
          const status: CheckStatus = ts.todayLeads === 0 ? "fail" : ts.onTrack ? "pass" : "warning";
          return {
            status,
            currentValue: `${ts.todayLeads} leads today · ${ts.monthlyTarget} monthly target`,
            detail: ts.todayLeads === 0 ? "Zero leads today — check tracking immediately" : ts.onTrack ? "Lead flow normal" : "Below expected daily pace",
            recommendation: ts.todayLeads === 0 ? "Check pixel/CAPI integration, form submissions, and UTM parameters" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Quick Actions Board",
    icon: Zap,
    items: [
      {
        id: "daily-creative-queue",
        sopText: "Queue 2 new creative variants per struggling ad set (reuse best motifs: price on image, benefits, testimonials, memes, collage)",
        icon: Palette,
        getData: (data) => {
          const struggling = (data?.adset_analysis || []).filter((a: any) => a.classification === "UNDERPERFORMER" || a.classification === "WATCH");
          const status: CheckStatus = struggling.length > 0 ? "warning" : "pass";
          return {
            status,
            currentValue: struggling.length > 0 ? `${struggling.length} struggling ad set(s) need fresh creatives` : "No struggling ad sets",
            detail: struggling.length > 0 ? struggling.map((a: any) => a.adset_name || a.name).slice(0, 3).join(", ") : "All ad sets performing well",
            recommendation: struggling.length > 0 ? "Queue 2 new creative variants per struggling ad set — reuse winning motifs" : undefined,
          };
        },
      },
    ],
  },
];

// ─── Weekly Checklist ───────────────────────────────────────────────

const WEEKLY_CHECKLIST: ChecklistSection[] = [
  {
    title: "Quality Control Loop (Lead Form)",
    icon: Users,
    items: [
      {
        id: "weekly-quality-bucket",
        sopText: "Pull MTD leads → bucket: Low Budget / Wrong Location / Fake / No-Pickup / Good. Adjust forms accordingly",
        icon: Users,
        getData: (data) => {
          const quality = data?.lead_quality || data?.quality_control;
          const hasData = quality && Object.keys(quality).length > 0;
          return {
            status: hasData ? "pass" : "warning",
            currentValue: hasData ? `Good: ${quality.good || 0} · Low Budget: ${quality.low_budget || 0} · Wrong Location: ${quality.wrong_location || 0} · Fake: ${quality.fake || 0}` : "No lead quality data yet — requires manual input",
            detail: "Low Budget↑ → add/tighten Budget MCQ; Wrong Location↑ → add geo MCQ; Fake↑ → switch to Higher Intent form",
            recommendation: !hasData ? "Pull MTD leads, bucket into quality categories, and update lead form MCQs" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Apples-to-Apples Performance Review",
    icon: Scale,
    items: [
      {
        id: "weekly-layer-comparison",
        sopText: "Compare TOFU vs TOFU, MOFU vs MOFU, BOFU vs BOFU. Don't cross-compare. Slash bottom 30% in every stage",
        icon: Layers,
        getData: (data) => {
          const campaigns = data?.campaign_audit || [];
          const byLayer: Record<string, any[]> = {};
          campaigns.forEach((c: any) => {
            const layer = c.layer || c.funnel_stage || "UNKNOWN";
            if (!byLayer[layer]) byLayer[layer] = [];
            byLayer[layer].push(c);
          });
          const layers = Object.keys(byLayer);
          const underperformers = campaigns.filter((c: any) => c.classification === "UNDERPERFORMER").length;
          return {
            status: underperformers > 0 ? "warning" : "pass",
            currentValue: `${layers.length} funnel layers active · ${underperformers} underperformer(s) to review`,
            detail: layers.map(l => `${l}: ${byLayer[l].length} campaigns`).join(" · "),
            recommendation: underperformers > 0 ? "Review bottom 30% in each funnel stage — consider pausing or restructuring" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Audience Management",
    icon: Users,
    items: [
      {
        id: "weekly-audience",
        sopText: "Prospecting (Adv+): keep signals light. MOFU: test lookalikes. BOFU: tight windows, split by recency, A+ OFF",
        icon: Target,
        getData: (data) => {
          const adsets = data?.adset_analysis || [];
          const bofu = adsets.filter((a: any) => (a.layer || "").toUpperCase().includes("BOFU"));
          const mofu = adsets.filter((a: any) => (a.layer || "").toUpperCase().includes("MOFU"));
          return {
            status: "warning",
            currentValue: `TOFU/MOFU: ${adsets.length - bofu.length} ad sets · BOFU: ${bofu.length} ad sets`,
            detail: "Prospecting → Advantage+ with signals. MOFU → test lookalikes from generate_lead, video viewers. BOFU → tight windows (7/14/30d), A+ OFF",
            recommendation: "Review audience settings per funnel stage — ensure BOFU has Advantage+ OFF with tight retargeting windows",
          };
        },
      },
    ],
  },
  {
    title: "Lead Form Tuning",
    icon: FileText,
    items: [
      {
        id: "weekly-lead-form",
        sopText: "CPL too high & quality OK → remove one MCQ. CPL OK & quality poor → add one MCQ. Keep TY screen pushing WhatsApp/SV booking",
        icon: FileText,
        getData: (data) => {
          const cpl = data?.account_summary?.cpl ?? 0;
          const cplTarget = data?.dynamic_thresholds?.cpl_target ?? 0;
          const isHigh = cplTarget > 0 && cpl > cplTarget * 1.2;
          return {
            status: isHigh ? "warning" : "pass",
            currentValue: `Current CPL: ${formatINR(cpl, 0)} vs target ${formatINR(cplTarget, 0)}`,
            detail: isHigh ? "CPL above target — consider reducing form friction" : "CPL within target range",
            recommendation: isHigh ? "If quality is OK, remove one MCQ to reduce friction. If quality is poor, add budget/location MCQ" : "Keep TY screen pushing WhatsApp or Site-Visit booking",
          };
        },
      },
    ],
  },
];

// ─── Bi-Weekly Checklist ────────────────────────────────────────────

const BIWEEKLY_CHECKLIST: ChecklistSection[] = [
  {
    title: "Creative Refresh Cadence",
    icon: RefreshCw,
    items: [
      {
        id: "biweekly-creative-refresh",
        sopText: "Replace top 20% high-freq ads; mirror winning creative before inventing from scratch. Micro-tweaks can reset creative learning",
        icon: RefreshCw,
        getData: (data) => {
          const ads = data?.creative_health || [];
          const highFreq = ads.filter((a: any) => (a.frequency ?? 0) > 2.5);
          const status: CheckStatus = highFreq.length > 0 ? "warning" : "pass";
          return {
            status,
            currentValue: highFreq.length > 0 ? `${highFreq.length} ads with frequency > 2.5` : "No high-frequency ads detected",
            detail: "Replace high-freq ads. Mirror winners before creating new. Micro-tweaks (button/stripes/border) can reset learning",
            recommendation: highFreq.length > 0 ? "Refresh creatives for high-frequency ads — borrow winning elements from other campaigns" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Breakdown Analysis → Type-2 Reallocations",
    icon: PieChart,
    items: [
      {
        id: "biweekly-breakdown",
        sopText: "Inspect age/gender/location/time/placement — reallocate budget to best segments in a new campaign (not within old)",
        icon: BarChart3,
        getData: (data) => {
          const breakdowns = data?.breakdown_insights || data?.breakdowns;
          const hasData = breakdowns && Object.keys(breakdowns).length > 0;
          return {
            status: hasData ? "warning" : "na",
            currentValue: hasData ? "Breakdown data available — review for reallocation opportunities" : "No breakdown data yet",
            detail: "Inspect age / gender / location / time-of-day / placement. Re-allocate budget to best segments in a new campaign",
            recommendation: "Review breakdowns page and reallocate budget to top-performing segments in separate campaigns",
          };
        },
      },
    ],
  },
  {
    title: "Scale Plan",
    icon: TrendingUp,
    items: [
      {
        id: "biweekly-scale",
        sopText: "Raise budgets on winning campaigns post-stability; keep creative refresh pipeline primed so freq stays healthy",
        icon: TrendingUp,
        getData: (data) => {
          const winners = (data?.campaign_audit || []).filter((c: any) => c.classification === "WINNER");
          return {
            status: winners.length > 0 ? "warning" : "pass",
            currentValue: `${winners.length} winning campaign(s) eligible for scaling`,
            detail: winners.map((w: any) => `${w.campaign_name}: CPL ${formatINR(w.cpl || 0, 0)}`).slice(0, 3).join(", "),
            recommendation: winners.length > 0 ? "Scale winners by 20% with creative refresh pipeline primed" : undefined,
            autoExecutable: winners.length > 0,
            actionConfig: winners.length > 0 ? {
              actionType: "SCALE_BUDGET_UP",
              entityType: "campaign",
              entityId: winners[0]?.campaign_id,
              entityName: winners[0]?.campaign_name,
            } : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Creative R&D",
    icon: FlaskConical,
    items: [
      {
        id: "biweekly-creative-rd",
        sopText: "Maintain an always-on experiment campaign testing new creatives on best audience — stock a reservoir of proven ads",
        icon: FlaskConical,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Review experiment campaign pipeline",
          detail: "Always-on experiment campaign tests new creatives on your best audience to build a reservoir of proven ads",
          recommendation: "Ensure experiment campaign is running with 2-3 new creative variants per week",
        }),
      },
    ],
  },
  {
    title: "Revive Playbook (If Winners Fall)",
    icon: RotateCcw,
    items: [
      {
        id: "biweekly-revive",
        sopText: "Confirm 7-day trend → check freq/CTR/CPM → Fatigue = refresh. Offer weak = change promo. All same but CPL↑ = duplicate & restart",
        icon: RotateCcw,
        getData: (data) => {
          const declining = (data?.campaign_audit || []).filter((c: any) => c.trend === "DECLINING" || c.classification === "DECLINING");
          return {
            status: declining.length > 0 ? "fail" : "pass",
            currentValue: declining.length > 0 ? `${declining.length} campaign(s) in decline` : "No declining campaigns",
            detail: "Fatigue → refresh creative. Offer weak → change promo/angle. CPL↑ with all else same → Duplicate campaign & restart",
            recommendation: declining.length > 0 ? "Diagnose: check frequency & CTR. If fatigue, refresh. If offer weak, change angle. If unexplained, duplicate campaign" : undefined,
          };
        },
      },
    ],
  },
];

// ─── Monthly Checklist ──────────────────────────────────────────────

const MONTHLY_CHECKLIST: ChecklistSection[] = [
  {
    title: "Structure Move — Club Winners (Type-1)",
    icon: Layers,
    items: [
      {
        id: "monthly-club-winners",
        sopText: "For each layer, club winning audiences into one ad set (TOFU with TOFU; MOFU with MOFU). Keep BOFU separate",
        icon: Layers,
        getData: (data) => {
          const winners = (data?.adset_analysis || []).filter((a: any) => a.classification === "WINNER");
          const byLayer: Record<string, number> = {};
          winners.forEach((w: any) => {
            const layer = w.layer || "UNKNOWN";
            byLayer[layer] = (byLayer[layer] || 0) + 1;
          });
          return {
            status: winners.length > 2 ? "warning" : "pass",
            currentValue: `${winners.length} winning ad set(s) across layers`,
            detail: Object.entries(byLayer).map(([l, c]) => `${l}: ${c} winners`).join(" · ") || "No winners to club yet",
            recommendation: winners.length > 2 ? "Club winning audiences into consolidated ad sets per funnel layer. Keep BOFU separate" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Budget Mix by Maturity",
    icon: PieChart,
    items: [
      {
        id: "monthly-budget-mix",
        sopText: "New account: TOFU 55% / MOFU 35% / BOFU 10%. Mature: TOFU 30% / MOFU 50% / BOFU 20%",
        icon: PieChart,
        getData: (data) => {
          const campaigns = data?.campaign_audit || [];
          const totalSpend = campaigns.reduce((s: number, c: any) => s + (c.spend || 0), 0);
          const byLayer: Record<string, number> = {};
          campaigns.forEach((c: any) => {
            const layer = c.layer || c.funnel_stage || "UNKNOWN";
            byLayer[layer] = (byLayer[layer] || 0) + (c.spend || 0);
          });
          const layerPcts = Object.entries(byLayer).map(([l, s]) => `${l}: ${totalSpend > 0 ? ((s as number / totalSpend) * 100).toFixed(0) : 0}%`);
          return {
            status: "warning" as CheckStatus,
            currentValue: layerPcts.join(" · ") || "No spend data",
            detail: "New account guide: TOFU 55% / MOFU 35% / BOFU 10%. Mature: TOFU 30% / MOFU 50% / BOFU 20%",
            recommendation: "Review if budget allocation matches account maturity. Adjust TOFU/MOFU/BOFU split accordingly",
          };
        },
      },
    ],
  },
  {
    title: "Reporting & Learnings",
    icon: FileText,
    items: [
      {
        id: "monthly-reporting",
        sopText: "MoM comparison: annotate changes (audience, targeting, copy, offers, budgets, creatives). Produce 3 actions for next month",
        icon: FileText,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Monthly review due — compare current vs previous month",
          detail: "Compare MoM: good vs bad months. Annotate changes (audience, targeting, copy, offers, budgets, creatives, LP, CTR, CPC, CVR, CPM)",
          recommendation: "Produce 3 specific actions to improve CPL/CPA next month — not just observations",
        }),
      },
    ],
  },
];

// ─── Google Daily Checklist ─────────────────────────────────────────

const GOOGLE_DAILY_CHECKLIST: ChecklistSection[] = [
  {
    title: "Account Pulse",
    icon: Activity,
    items: [
      {
        id: "g-daily-spend-vs-plan",
        sopText: "Spend vs plan (±20%) → adjust budgets if off-track",
        icon: IndianRupee,
        getData: (data) => {
          const { actual, plan, pct } = getGoogleSpendVsPlan(data);
          const status: CheckStatus = Math.abs(pct) > 20 ? "fail" : Math.abs(pct) > 10 ? "warning" : "pass";
          return {
            status,
            currentValue: `${formatINR(actual, 0)} vs ${formatINR(plan, 0)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
            detail: status === "pass" ? "Spend within 20% of plan" : `Spend ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "over" : "under"} plan`,
            recommendation: status !== "pass" ? (pct > 0 ? "Reduce daily budgets" : "Increase budgets or check delivery") : undefined,
          };
        },
      },
      {
        id: "g-daily-disapprovals",
        sopText: "Disapprovals & Policy: any ads/keywords disapproved? Check and fix",
        icon: AlertTriangle,
        getData: (data) => {
          const disapproved = (data as any).disapproved_entities || [];
          const count = disapproved.length;
          return {
            status: count > 0 ? "fail" : "pass",
            currentValue: count > 0 ? `${count} disapproved ad(s)/keyword(s)` : "No disapprovals detected",
            detail: count > 0 ? disapproved.slice(0, 3).map((d: any) => d.name || d.id).join(", ") : "All ads and keywords are approved",
            recommendation: count > 0 ? "Review and fix disapproved ads — check policy violations and resubmit" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "CVR & Impression Share",
    icon: Target,
    items: [
      {
        id: "g-daily-cvr-outliers",
        sopText: "CVR outliers: flag ad groups with CVR < 50% of trailing 7-day average",
        icon: TrendingDown,
        getData: (data) => {
          const outliers = getGoogleCvrOutliers(data);
          return {
            status: outliers.length > 0 ? "fail" : "pass",
            currentValue: outliers.length > 0 ? `${outliers.length} ad group(s) with CVR below 50% of average` : "No CVR outliers",
            detail: outliers.slice(0, 3).map((ag: any) => `${ag.name}: CVR ${((ag.conversions || 0) / Math.max(ag.clicks, 1) * 100).toFixed(1)}%`).join(", ") || "All ad groups within normal CVR range",
            recommendation: outliers.length > 0 ? "Review targeting, ad copy, and landing pages for low-CVR ad groups" : undefined,
          };
        },
      },
      {
        id: "g-daily-branded-is",
        sopText: "Branded IS target >70%. If IS Lost (Rank) >40% → CPC bump +20-25%",
        icon: Eye,
        getData: (data) => {
          const isData = getGoogleISData(data, "branded");
          const status: CheckStatus = isData.is < 50 ? "fail" : isData.is < 70 ? "warning" : "pass";
          return {
            status,
            currentValue: `IS: ${isData.is.toFixed(1)}% · Lost Rank: ${isData.lostRank.toFixed(1)}% · Lost Budget: ${isData.lostBudget.toFixed(1)}%`,
            detail: isData.lostRank > 40 ? "IS Lost (Rank) high — CPC bump needed" : "Branded impression share within target",
            recommendation: isData.lostRank > 40 ? "Increase branded CPC by 20-25% to recover impression share" : undefined,
            autoExecutable: isData.lostRank > 40,
            actionConfig: isData.lostRank > 40 ? { actionType: "INCREASE_BID", entityType: "campaign" } : undefined,
          };
        },
      },
      {
        id: "g-daily-location-is",
        sopText: "Location IS target >20%. If IS Lost (Rank) >60% → CPC bump",
        icon: Eye,
        getData: (data) => {
          const isData = getGoogleISData(data, "location");
          const status: CheckStatus = isData.is < 10 ? "fail" : isData.is < 20 ? "warning" : "pass";
          return {
            status,
            currentValue: `IS: ${isData.is.toFixed(1)}% · Lost Rank: ${isData.lostRank.toFixed(1)}%`,
            detail: isData.lostRank > 60 ? "IS Lost (Rank) critical — CPC bump recommended" : "Location IS acceptable",
            recommendation: isData.lostRank > 60 ? "Increase location campaign CPC to improve impression share" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Demand Gen & Tracking",
    icon: Megaphone,
    items: [
      {
        id: "g-daily-dg-cpm",
        sopText: "DG CPM baseline ~₹120. If CPM +50% (>₹180), queue creative refresh",
        icon: BarChart3,
        getData: (data) => {
          const cpm = getGoogleDGCPM(data);
          const status: CheckStatus = cpm > 180 ? "fail" : cpm > 150 ? "warning" : cpm > 0 ? "pass" : "na";
          return {
            status,
            currentValue: cpm > 0 ? `DG CPM: ${formatINR(cpm, 0)}` : "No Demand Gen data",
            detail: cpm > 180 ? "CPM 50%+ above baseline — creative fatigue likely" : "CPM within acceptable range",
            recommendation: cpm > 180 ? "Queue creative refresh for Demand Gen campaigns" : undefined,
          };
        },
      },
      {
        id: "g-daily-tracking",
        sopText: "Tracking sanity: GA4 conversions matching Google Ads? Spot-check 3 leads in CRM",
        icon: Search,
        getData: (data) => {
          const sanity = (data as any).conversion_sanity;
          const match = sanity?.ga4_match_status;
          const alerts = sanity?.tracking_alerts || [];
          const status: CheckStatus = alerts.length > 0 ? "fail" : match === "mismatch" ? "warning" : "pass";
          return {
            status,
            currentValue: match ? `GA4 status: ${match}` : "Conversion tracking status unknown",
            detail: alerts.length > 0 ? alerts.join("; ") : "Conversion tracking appears healthy",
            recommendation: status !== "pass" ? "Verify GA4 linking, conversion actions, and spot-check UTMs in CRM" : undefined,
          };
        },
      },
    ],
  },
];

const GOOGLE_WEEKLY_CHECKLIST: ChecklistSection[] = [
  {
    title: "Bid Review",
    icon: IndianRupee,
    items: [
      {
        id: "g-weekly-bid-review",
        sopText: "Max CPC cap = Target CPA × Observed CVR per ad group. Flag ad groups exceeding cap",
        icon: IndianRupee,
        getData: (data) => {
          const campaigns = data?.campaigns || [];
          const cplTarget = data?.dynamic_thresholds?.cpl_target ?? 850;
          let overBidCount = 0;
          campaigns.forEach((c: any) => {
            (c.ad_groups || []).forEach((ag: any) => {
              const cvr = ag.clicks > 0 ? (ag.conversions || 0) / ag.clicks : 0;
              const maxCpc = cplTarget * cvr;
              if (maxCpc > 0 && (ag.avg_cpc || ag.cpc || 0) > maxCpc) overBidCount++;
            });
          });
          return {
            status: overBidCount > 0 ? "warning" : "pass",
            currentValue: overBidCount > 0 ? `${overBidCount} ad group(s) exceeding computed Max CPC cap` : "All bids within CPA formula",
            detail: "Formula: Max CPC = Target CPA × CVR",
            recommendation: overBidCount > 0 ? "Review and reduce bids for ad groups exceeding Max CPC cap" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Quality Score Doctor",
    icon: Target,
    items: [
      {
        id: "g-weekly-qs",
        sopText: "Target QS ≥6. For QS <6: identify factor (Ad Relevance, Expected CTR, LP Experience)",
        icon: Target,
        getData: (data) => {
          const qs = getGoogleQSData(data);
          const status: CheckStatus = qs.below6Count > 0 ? "fail" : qs.avgQS >= 6 ? "pass" : "warning";
          return {
            status,
            currentValue: qs.total > 0 ? `Avg QS: ${qs.avgQS.toFixed(1)} · ${qs.below6Count}/${qs.total} below 6` : "No QS data available",
            detail: qs.below6Count > 0 ? qs.details.slice(0, 3).map((ag: any) => `${ag.name}: QS ${ag.quality_score}`).join(", ") : "All ad groups ≥6 QS",
            recommendation: qs.below6Count > 0 ? "For low QS: Ad relevance → inject keywords in headlines. Expected CTR → add action hooks. LP experience → check LCP <2.5s" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Keyword & Search Terms",
    icon: Search,
    items: [
      {
        id: "g-weekly-keywords",
        sopText: "Pause zero-conversion keywords with >1.5× CPL spend over 14 days",
        icon: Search,
        getData: (data) => {
          const kw = getGoogleKeywordPerformance(data);
          const status: CheckStatus = kw.zeroConvCount > 0 ? "fail" : "pass";
          return {
            status,
            currentValue: kw.zeroConvCount > 0 ? `${kw.zeroConvCount} keywords, ${formatINR(kw.wastedSpend, 0)} wasted` : `${kw.totalKeywords} keywords reviewed — all performing`,
            detail: "Pause keywords with zero conversions and spend >1.5× CPL threshold",
            recommendation: kw.zeroConvCount > 0 ? "Pause wasteful zero-conversion keywords to recover budget" : undefined,
          };
        },
      },
      {
        id: "g-weekly-rsa",
        sopText: "RSA asset optimization: flag bottom 25% CTR/CVR assets. Ensure ≥4 keyword-inclusive headlines per RSA",
        icon: Palette,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Review RSA asset performance labels",
          detail: "Check asset performance labels (Best/Good/Low). Replace bottom 25% CTR/CVR assets",
          recommendation: "Review RSA assets — replace Low-performing headlines and descriptions. Ensure ≥4 keyword-inclusive headlines",
        }),
      },
      {
        id: "g-weekly-search-terms",
        sopText: "Search terms deep dive: add exact matches for converting terms, negatives via n-gram analysis",
        icon: Search,
        getData: (data) => {
          const st = (data as any).search_terms_analysis;
          const negCount = st?.negative_candidates?.length || 0;
          const promoCount = st?.promotion_candidates?.length || 0;
          return {
            status: negCount > 0 ? "warning" : "pass",
            currentValue: st ? `${negCount} negative candidates · ${promoCount} promotion candidates` : "Search term data not available",
            detail: "Add negatives for irrelevant terms, promote high-converting terms to exact match",
            recommendation: negCount > 0 ? "Add negative keywords and promote converting search terms" : undefined,
          };
        },
      },
    ],
  },
  {
    title: "Audience & Placements",
    icon: Users,
    items: [
      {
        id: "g-weekly-audience",
        sopText: "Trim bottom 30% audiences by CPL, scale top 30%",
        icon: Users,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Review audience segment performance",
          detail: "Trim bottom 30% by CPL, scale top 30%. Check in-market, custom intent, and remarketing segments",
          recommendation: "Remove underperforming audience segments and increase bids on winners",
        }),
      },
      {
        id: "g-weekly-placements",
        sopText: "Placement/brand safety: exclude kids/gaming/poor sites. Review new placements",
        icon: Eye,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Review placement report for brand safety",
          detail: "Exclude kids content, gaming, and low-quality sites from DG campaigns",
          recommendation: "Run placement report, exclude unsafe/irrelevant placements",
        }),
      },
    ],
  },
];

const GOOGLE_BIWEEKLY_CHECKLIST: ChecklistSection[] = [
  {
    title: "CRO Sprint",
    icon: TrendingUp,
    items: [
      {
        id: "g-biweekly-cro",
        sopText: "Pull Clarity data, GA4 funnel: session_start → page_view → form_start → form_submit → generate_lead",
        icon: TrendingUp,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "CRO sprint review due",
          detail: "Key targets: form-start rate +20-30%, above-fold visibility >85%, rage clicks down 50%, LCP <2.5s, INP <200ms",
          recommendation: "Pull Clarity heatmaps and GA4 funnel data. Identify biggest drop-off point and fix",
        }),
      },
    ],
  },
  {
    title: "A/B Test Review",
    icon: FlaskConical,
    items: [
      {
        id: "g-biweekly-ab-test",
        sopText: "Check active experiments. Declare winners/losers based on statistical significance",
        icon: FlaskConical,
        getData: (data) => {
          const experiments = (data as any).experiments || (data as any).ab_tests || [];
          return {
            status: experiments.length > 0 ? "warning" : "na",
            currentValue: experiments.length > 0 ? `${experiments.length} active experiment(s)` : "No active experiments detected",
            detail: "Review experiments with sufficient data. Declare winners and apply learnings",
            recommendation: experiments.length > 0 ? "Review experiment results and apply winning variants" : "Consider setting up A/B tests for ad copy and landing pages",
          };
        },
      },
    ],
  },
  {
    title: "Demand Gen Optimization",
    icon: Megaphone,
    items: [
      {
        id: "g-biweekly-dg-opt",
        sopText: "DG creative refresh cadence: flag ads >21-40 days old or CTR dropped ≥30% or CPM >₹200",
        icon: RefreshCw,
        getData: (data) => {
          const dgCpm = getGoogleDGCPM(data);
          const status: CheckStatus = dgCpm > 200 ? "fail" : dgCpm > 150 ? "warning" : dgCpm > 0 ? "pass" : "na";
          return {
            status,
            currentValue: dgCpm > 0 ? `DG CPM: ${formatINR(dgCpm, 0)}` : "No DG data available",
            detail: "Refresh DG creatives older than 21 days or with declining CTR. Check audience segment performance",
            recommendation: dgCpm > 200 ? "Refresh DG creatives — CPM exceeds ₹200 threshold" : "Review DG creative ages and audience segments",
          };
        },
      },
    ],
  },
];

const GOOGLE_MONTHLY_CHECKLIST: ChecklistSection[] = [
  {
    title: "MoM Comparison",
    icon: Calendar,
    items: [
      {
        id: "g-monthly-mom",
        sopText: "MoM comparison for all key metrics. Annotate what changed — audiences, bids, copy, budgets",
        icon: BarChart3,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Monthly comparison review due",
          detail: "Compare this month vs last month: spend, leads, CPL, CTR, CVR, IS, QS. Annotate changes",
          recommendation: "Produce 3 specific actions for next month based on MoM trends",
        }),
      },
    ],
  },
  {
    title: "Remarketing Review",
    icon: Users,
    items: [
      {
        id: "g-monthly-remarketing",
        sopText: "Review BOFU Pre-Lead (website visitors, video viewers) and BOFU Post-Lead (visitors + positive leads)",
        icon: Users,
        getData: (data) => {
          const campaigns = data?.campaigns || [];
          const remarketing = campaigns.filter((c: any) => (c.campaign_type || "").includes("remarketing") || (c.name || "").toLowerCase().includes("remarket"));
          return {
            status: remarketing.length > 0 ? "warning" : "na",
            currentValue: remarketing.length > 0 ? `${remarketing.length} remarketing campaign(s) active` : "No remarketing campaigns detected",
            detail: "Review BOFU performance. Retarget video viewers at 25%/50%/75% watch cohorts",
            recommendation: "Ensure remarketing campaigns are running with updated audience lists",
          };
        },
      },
    ],
  },
  {
    title: "Bidding Mode Review",
    icon: IndianRupee,
    items: [
      {
        id: "g-monthly-bidding",
        sopText: "If CPL stable and volume ≥30-50 conversions/30d → test tCPA. Seed at current CPA minus 20%",
        icon: IndianRupee,
        getData: (data) => {
          const ap = data?.account_pulse || {};
          const totalConv = ap.total_leads_30d ?? ap.total_leads ?? 0;
          const cpl = ap.overall_cpl ?? 0;
          const ready = totalConv >= 30;
          return {
            status: ready ? "warning" : "pass",
            currentValue: `${totalConv} conversions in window · CPL ${formatINR(cpl, 0)}`,
            detail: ready ? "Volume sufficient for tCPA testing" : "Need ≥30 conversions before testing tCPA",
            recommendation: ready ? `Consider switching to tCPA. Seed at ${formatINR(cpl * 0.8, 0)} (current CPA minus 20%)` : "Continue with manual/max conversions bidding until volume builds",
          };
        },
      },
    ],
  },
  {
    title: "Funnel, Budget & Geo",
    icon: PieChart,
    items: [
      {
        id: "g-monthly-funnel",
        sopText: "Pull Lead → Visit → Attend → Booking by campaign/ad group. Shift budget to best CPSV-Booked",
        icon: PieChart,
        getData: () => ({
          status: "warning" as CheckStatus,
          currentValue: "Funnel review due",
          detail: "Analyze full funnel: Lead → Site Visit → Attendance → Booking per campaign",
          recommendation: "Shift budget toward campaigns with best CPSV and booking rates",
        }),
      },
      {
        id: "g-monthly-geo-device",
        sopText: "Geo/Device/Day-Part: apply ±10-20% bid adjustments where CVR differs materially",
        icon: Shuffle,
        getData: (data) => {
          const breakdowns = data?.breakdowns;
          const hasData = breakdowns && Object.keys(breakdowns).length > 0;
          return {
            status: hasData ? "warning" : "na",
            currentValue: hasData ? "Breakdown data available for bid adjustments" : "No breakdown data",
            detail: "Review geo, device, and day-part performance. Apply bid adjustments where CVR differs >20%",
            recommendation: "Apply +10-20% bid adjustments for high-CVR segments, -10-20% for low-CVR",
          };
        },
      },
    ],
  },
];

// ─── Tab Configuration ──────────────────────────────────────────────

type AuditFrequency = "daily" | "weekly" | "biweekly" | "monthly";

const FREQUENCY_TABS: { key: AuditFrequency; label: string; description: string; icon: typeof Calendar }[] = [
  { key: "daily", label: "Daily (2x/wk)", description: "Account pulse, cost stack, creative health, tracking", icon: Calendar },
  { key: "weekly", label: "Weekly", description: "Quality control, layer comparison, audience, lead forms", icon: CalendarDays },
  { key: "biweekly", label: "Bi-Weekly", description: "Creative refresh, breakdowns, scale plan, experiments", icon: CalendarRange },
  { key: "monthly", label: "Monthly", description: "Structure moves, budget mix, reporting & learnings", icon: CalendarCheck },
];

const META_CHECKLISTS: Record<AuditFrequency, ChecklistSection[]> = {
  daily: DAILY_CHECKLIST,
  weekly: WEEKLY_CHECKLIST,
  biweekly: BIWEEKLY_CHECKLIST,
  monthly: MONTHLY_CHECKLIST,
};

const GOOGLE_CHECKLISTS: Record<AuditFrequency, ChecklistSection[]> = {
  daily: GOOGLE_DAILY_CHECKLIST,
  weekly: GOOGLE_WEEKLY_CHECKLIST,
  biweekly: GOOGLE_BIWEEKLY_CHECKLIST,
  monthly: GOOGLE_MONTHLY_CHECKLIST,
};

// ─── Checklist Item Component ───────────────────────────────────────

function StatusIndicator({ status }: { status: CheckStatus }) {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "fail":
      return <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />;
    case "warning":
      return <Clock className="w-4 h-4 text-amber-400 shrink-0" />;
    case "loading":
      return <div className="w-4 h-4 rounded-full bg-gray-600 animate-pulse shrink-0" />;
    default:
      return <div className="w-4 h-4 rounded-full bg-gray-700 shrink-0" />;
  }
}

function ChecklistItemCard({
  item,
  data,
  actionStates,
  onActionStateChange,
}: {
  item: ChecklistItem;
  data: any;
  actionStates: Record<string, ActionState>;
  onActionStateChange: (id: string, state: ActionState, strategicCall?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const result = item.getData(data);
  const Icon = item.icon;

  const statusBorder = result.status === "fail" ? "border-red-500/30 bg-red-500/5" :
    result.status === "warning" ? "border-amber-500/20 bg-amber-500/5" :
    result.status === "pass" ? "border-emerald-500/20 bg-emerald-500/5" : "border-border/50";

  const unifiedItem: UnifiedActionItem = {
    id: item.id,
    description: item.sopText,
    autoExecutable: result.autoExecutable ?? false,
    ...(result.actionConfig || {}),
  };

  return (
    <div
      className={cn("rounded-lg border p-3 transition-all", statusBorder)}
    >
      <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <StatusIndicator status={result.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">{item.sopText}</p>
          </div>
          <p className="text-sm font-medium text-foreground">{result.currentValue}</p>
          {result.detail && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{result.detail}</p>
          )}
        </div>
        <Badge variant="secondary" className={cn("text-[9px] shrink-0",
          result.status === "pass" ? "text-emerald-400 bg-emerald-500/10" :
          result.status === "fail" ? "text-red-400 bg-red-500/10" :
          result.status === "warning" ? "text-amber-400 bg-amber-500/10" : ""
        )}>
          {result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : result.status === "warning" ? "REVIEW" : "N/A"}
        </Badge>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
          {result.recommendation && (
            <div className="rounded-md p-2.5 bg-primary/5 border border-primary/10">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-medium text-primary uppercase tracking-wider">Recommended Action</span>
              </div>
              <p className="text-[11px] text-foreground/80">{result.recommendation}</p>
            </div>
          )}
          <UnifiedActions
            item={unifiedItem}
            entityId={unifiedItem.entityId || item.id}
            entityName={unifiedItem.entityName || item.sopText}
            entityType={unifiedItem.entityType || "adset"}
            actionType={unifiedItem.actionType || "MANUAL_ACTION"}
            isAutoExecutable={result.autoExecutable ?? false}
            recommendation={result.recommendation}
            onStateChange={onActionStateChange}
            compact
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Audit Page ────────────────────────────────────────────────

export default function AuditPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform } = useClient();
  const [activeFrequency, setActiveFrequency] = useState<AuditFrequency>("daily");
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [_, forceUpdate] = useState(0);

  function handleActionStateChange(id: string, state: ActionState, strategicCall?: string) {
    setActionStates(prev => ({ ...prev, [id]: state }));
    forceUpdate(n => n + 1);
  }

  function toggleSection(title: string) {
    setExpandedSections(prev => ({ ...prev, [title]: prev[title] === false ? true : prev[title] === true ? false : false }));
  }

  const isGoogle = activePlatform === "google";
  const checklist = (isGoogle ? GOOGLE_CHECKLISTS : META_CHECKLISTS)[activeFrequency];

  // Compute summary
  const allItems = useMemo(() => {
    return checklist.flatMap(section => section.items);
  }, [checklist]);

  const summary = useMemo(() => {
    if (!data) return { pass: 0, fail: 0, warning: 0, total: 0 };
    let pass = 0, fail = 0, warning = 0;
    allItems.forEach(item => {
      const result = item.getData(data);
      if (result.status === "pass") pass++;
      else if (result.status === "fail") fail++;
      else if (result.status === "warning") warning++;
    });
    return { pass, fail, warning, total: allItems.length };
  }, [data, allItems]);

  const completedCount = Object.values(actionStates).filter(s => s === "completed" || s === "rejected" || s === "deferred" || s === "auto-executed").length;

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1200px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">SOP Audit Panel</h1>
            <p className="text-xs text-muted-foreground">
              Structured audit checklist aligned to {isGoogle ? "Google Ads" : "Meta Ads"} SOPs · Review each item, execute or dismiss
            </p>
          </div>
        </div>
      </div>

      {/* Frequency Tabs */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-px overflow-x-auto">
        {FREQUENCY_TABS.map(tab => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.key}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2",
                activeFrequency === tab.key
                  ? "text-primary border-primary bg-primary/5"
                  : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => setActiveFrequency(tab.key)}
              data-testid={`tab-audit-${tab.key}`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Checks</span>
            <p className="text-lg font-bold tabular-nums">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-3">
            <span className="text-[10px] text-emerald-400 uppercase tracking-wider">Passing</span>
            <p className="text-lg font-bold tabular-nums text-emerald-400">{summary.pass}</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="p-3">
            <span className="text-[10px] text-red-400 uppercase tracking-wider">Failing</span>
            <p className="text-lg font-bold tabular-nums text-red-400">{summary.fail}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-3">
            <span className="text-[10px] text-amber-400 uppercase tracking-wider">Review Needed</span>
            <p className="text-lg font-bold tabular-nums text-amber-400">{summary.warning}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Actioned</span>
            <p className="text-lg font-bold tabular-nums text-blue-400">{completedCount}/{summary.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Description for current frequency */}
      <div className="rounded-md p-3 bg-muted/30 border border-border/50">
        <p className="text-xs text-muted-foreground">
          {activeFrequency === "daily" && (isGoogle
            ? "Daily Google audit: Spend vs plan, disapprovals, CVR outliers, impression share (branded/location), DG CPM check, tracking sanity."
            : "Daily / 2x-per-week audit: Account pulse, cost stack triage, creative health metrics, tracking sanity, and quick action queue.")}
          {activeFrequency === "weekly" && (isGoogle
            ? "Weekly Google audit: Bid review per CPA formula, Quality Score doctor, RSA asset optimization, keyword performance, placements, audiences, search terms."
            : "Weekly audit: Lead quality control loop, apples-to-apples layer comparison, audience management review, and lead form tuning.")}
          {activeFrequency === "biweekly" && (isGoogle
            ? "Bi-weekly Google audit: CRO sprint, A/B test review, Demand Gen creative refresh and optimization."
            : "Bi-weekly audit: Creative refresh cadence, breakdown analysis for Type-2 reallocations, scale plan for winners, creative R&D pipeline, and revive playbook.")}
          {activeFrequency === "monthly" && (isGoogle
            ? "Monthly Google audit: MoM comparison, remarketing review, bidding mode assessment, funnel analysis, geo/device/day-part optimizations."
            : "Monthly audit: Structure moves (club winners per layer), budget mix by account maturity, and full reporting with learnings.")}
        </p>
      </div>

      {/* Checklist Sections */}
      {checklist.map((section) => {
        const SectionIcon = section.icon;
        const isCollapsed = expandedSections[section.title] === false;

        return (
          <div key={section.title} className="space-y-3">
            <button
              className="flex items-center gap-2 w-full text-left group"
              onClick={() => toggleSection(section.title)}
            >
              <SectionIcon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground">{section.title}</span>
              <Badge variant="secondary" className="text-[10px] ml-1">{section.items.length}</Badge>
              <span className="ml-auto">
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </span>
            </button>

            {!isCollapsed && (
              <div className="space-y-2 pl-6">
                {section.items.map(item => (
                  <ChecklistItemCard
                    key={item.id}
                    item={item}
                    data={data}
                    actionStates={actionStates}
                    onActionStateChange={handleActionStateChange}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Audit Methodology */}
      <Card className="bg-muted/20 border-border/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Activity className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Data Source:</strong> Analysis generated at 9 AM IST daily. All metrics reflect the selected cadence window.</p>
            <p><strong>SOP Alignment:</strong> This checklist maps directly to the {isGoogle ? "Google Ads" : "Meta Ads"} SOP for each frequency. Items marked FAIL need immediate attention.</p>
            <p><strong>Actions:</strong> Auto-Execute runs the action via API. Mark Complete for manually handled items. Reject with strategic rationale. Defer moves to next cycle.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
