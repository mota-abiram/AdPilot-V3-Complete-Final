import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, ChevronDown, ChevronUp, AlertTriangle, Activity, ShieldCheck } from "lucide-react";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ExecutionButton } from "@/components/execution-button";

type SeverityTier = "CRITICAL" | "MEDIUM" | "LOW";
type ExecutionClassification = "AUTO-EXECUTE" | "MANUAL" | "REJECT";

interface SolutionOption {
  classification: ExecutionClassification;
  title: string;
  rationale: string;
  steps: string[];
  risk: "Low" | "Medium" | "High";
  confidence: number;
  expectedOutcome: string;
  actionPayload?: {
    action?: { type: string; parameters?: any };
    strategic_rationale?: string;
  };
}

interface TieredSolutions {
  primary: SolutionOption;
  secondary: SolutionOption[];
  rejection: SolutionOption[];
}

interface RecommendationCardData {
  id: string;
  severity: SeverityTier;
  platform: "meta" | "google";
  entity: {
    id?: string;
    name: string;
    type: string;
    score: number;
    classification: string;
  };
  diagnosis: {
    symptom: string;
    problem: string;
    data: string[];
    rootCauseChain: string[];
  };
  layerAnalysis: {
    l1: { action: string; confidence: number; reasoning: string };
    l2: { action: string; confidence: number; reasoning: string };
    l3: { action: string; confidence: number; reasoning: string };
    l4: { action: string; confidence: number; reasoning: string };
    conflicts: string[];
  };
  solutions: SolutionOption[];
  tieredSolutions: TieredSolutions;
  expectedOutcome: string;
}

interface RecommendationsResponse {
  recommendation_tiers: Record<SeverityTier, RecommendationCardData[]>;
  conflicts: string[];
  layer_contributions?: Record<string, number | string>;
}

const SECTION_STYLE: Record<SeverityTier, { tone: string; bg: string; border: string }> = {
  CRITICAL: {
    tone: "text-red-700 dark:text-red-300",
    bg: "bg-red-500/6",
    border: "border-red-500/25",
  },
  MEDIUM: {
    tone: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/6",
    border: "border-amber-500/25",
  },
  LOW: {
    tone: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/6",
    border: "border-emerald-500/25",
  },
};

const EXECUTION_STYLE: Record<ExecutionClassification, string> = {
  "AUTO-EXECUTE": "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  MANUAL: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  REJECT: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

function SolutionTierDisplay({ solution, entityId, entityName, entityType }: { solution: SolutionOption; entityId?: string; entityName: string; entityType: string }) {
  return (
    <div className={cn("rounded-lg border p-3", EXECUTION_STYLE[solution.classification])}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge variant="outline" className={cn("text-xs font-black uppercase tracking-[0.14em]", EXECUTION_STYLE[solution.classification])}>
          {solution.classification}
        </Badge>
        <span className="text-xs text-muted-foreground">{solution.confidence}% confidence</span>
        <span className="text-xs text-muted-foreground">Risk: {solution.risk}</span>
      </div>
      <h4 className="text-sm font-semibold text-foreground">{solution.title}</h4>
      <p className="mt-2 text-xs leading-relaxed text-foreground/85">{solution.rationale}</p>
      {solution.steps.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">Steps</p>
          {solution.steps.map((step, index) => (
            <p key={index} className="text-xs leading-relaxed text-foreground/80">
              {index + 1}. {step}
            </p>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-foreground/85"><span className="font-semibold">Expected Outcome:</span> {solution.expectedOutcome}</p>
      {solution.classification === "AUTO-EXECUTE" && solution.actionPayload?.action?.type && (
        <div className="mt-4">
          <ExecutionButton
            action={solution.actionPayload.action.type}
            entityId={entityId || ""}
            entityName={entityName}
            entityType={entityType as any}
            params={solution.actionPayload.action.parameters}
            label="Execute Now"
            className="w-full text-xs font-black uppercase tracking-[0.16em]"
            size="sm"
          />
        </div>
      )}
    </div>
  );
}

function SectionCard({ severity, card }: { severity: SeverityTier; card: RecommendationCardData }) {
  const [showSecondary, setShowSecondary] = useState(false);
  const [showRejection, setShowRejection] = useState(false);
  const primary = card.tieredSolutions.primary;
  const secondary = card.tieredSolutions.secondary;
  const rejection = card.tieredSolutions.rejection;
  const style = SECTION_STYLE[severity];

  return (
    <Card className={cn("border shadow-sm", style.border, style.bg)}>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("text-xs font-black uppercase tracking-[0.16em]", style.border, style.tone)}>
                {severity}
              </Badge>
              <Badge variant="outline" className="text-xs font-black uppercase tracking-[0.16em] border-border/50 text-foreground/70">
                {card.platform}
              </Badge>
              <Badge variant="outline" className="text-xs font-black uppercase tracking-[0.16em] border-border/50 text-foreground/70">
                {card.entity.classification}
              </Badge>
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{card.entity.name}</h3>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {card.entity.type} · Score {card.entity.score.toFixed(1)}/100
              </p>
            </div>
            <p className="text-sm leading-relaxed text-foreground/85">{card.diagnosis.problem}</p>
          </div>

          <div className="min-w-[220px] space-y-2">
            <div className="rounded-xl border border-border/40 bg-background/50 px-3 py-2">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Root Cause</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground/85">{card.diagnosis.rootCauseChain.join(" → ")}</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 px-3 py-2">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Recommended Action</p>
              <p className="mt-1 text-xs font-semibold text-foreground">{primary.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-xs font-black uppercase tracking-[0.14em]", EXECUTION_STYLE[primary.classification])}>
                  {primary.classification}
                </Badge>
                <span className="text-xs text-muted-foreground">{primary.confidence}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Primary Solution (Recommended) */}
        <div className="space-y-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">PRIMARY RECOMMENDATION</p>
          <SolutionTierDisplay
            solution={primary}
            entityId={card.entity.id}
            entityName={card.entity.name}
            entityType={card.entity.type}
          />
        </div>

        {/* Secondary Solutions (Alternatives) */}
        {secondary.length > 0 && (
          <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-0 text-xs font-black uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300 justify-start"
              onClick={() => setShowSecondary(!showSecondary)}
            >
              {showSecondary ? <ChevronUp className="mr-2 h-3 w-3" /> : <ChevronDown className="mr-2 h-3 w-3" />}
              Alternative Approaches ({secondary.length})
            </Button>
            {showSecondary && (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {secondary.map((solution, index) => (
                  <SolutionTierDisplay
                    key={`secondary-${index}`}
                    solution={solution}
                    entityId={card.entity.id}
                    entityName={card.entity.name}
                    entityType={card.entity.type}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rejection Explanations */}
        {rejection.length > 0 && (
          <div className="space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-0 text-xs font-black uppercase tracking-[0.14em] text-red-700 dark:text-red-300 justify-start"
              onClick={() => setShowRejection(!showRejection)}
            >
              {showRejection ? <ChevronUp className="mr-2 h-3 w-3" /> : <ChevronDown className="mr-2 h-3 w-3" />}
              Why Not... ({rejection.length})
            </Button>
            {showRejection && (
              <div className="mt-3 grid gap-3">
                {rejection.map((solution, index) => (
                  <div key={`rejection-${index}`} className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className={cn("text-xs font-black uppercase tracking-[0.14em]", EXECUTION_STYLE[solution.classification])}>
                        {solution.classification}
                      </Badge>
                      <span className="text-xs text-red-700 dark:text-red-300">{solution.confidence}% certain this won't work</span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">{solution.title}</h4>
                    <p className="mt-2 text-xs leading-relaxed text-foreground/85">{solution.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Diagnosis & Layer Analysis */}
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Layer Analysis</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-black uppercase tracking-[0.14em] text-muted-foreground"
              onClick={() => setShowSecondary(!showSecondary)}
            >
              {showSecondary ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
              {showSecondary ? "Hide" : "Show"}
            </Button>
          </div>

          {showSecondary && (
            <>
              <div className="grid gap-2 lg:grid-cols-4 mb-4">
                {[
                  { label: "L1", layer: card.layerAnalysis.l1 },
                  { label: "L2", layer: card.layerAnalysis.l2 },
                  { label: "L3", layer: card.layerAnalysis.l3 },
                  { label: "L4", layer: card.layerAnalysis.l4 },
                ].map(({ label, layer }) => (
                  <div key={label} className="rounded-lg border border-border/30 bg-background/50 p-2.5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">{label}</p>
                    <p className="mt-1 text-xs font-semibold text-foreground">{layer.action}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{layer.reasoning}</p>
                  </div>
                ))}
              </div>

              {card.layerAnalysis.conflicts.length > 0 && (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Layer Conflicts</p>
                  <div className="mt-2 space-y-1.5">
                    {card.layerAnalysis.conflicts.map((conflict, index) => (
                      <p key={index} className="text-xs leading-relaxed text-amber-100/85">{conflict}</p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecommendationsPage() {
  const { activeClient, activePlatform, activePlatformInfo } = useClient();
  const [showContributions, setShowContributions] = useState(false);

  const { data, isLoading } = useQuery<RecommendationsResponse>({
    queryKey: ["/api/intelligence", activeClient?.id, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClient?.id}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClient?.id && !!activePlatform,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const tiers = data?.recommendation_tiers || { CRITICAL: [], MEDIUM: [], LOW: [] };
  const totalCards = tiers.CRITICAL.length + tiers.MEDIUM.length + tiers.LOW.length;

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="t-page-title text-foreground flex items-center gap-2">
            Mojo AdCortex Recommendations
            <Badge variant="outline" className="border-violet-500/30 text-violet-700 dark:text-violet-300 bg-violet-500/10 gap-1.5 py-1">
              <Brain className="w-3 h-3" /> Score-Driven Pipeline
            </Badge>
          </h1>
          <p className="t-label text-muted-foreground mt-1">
            {activeClient?.name} · {activePlatformInfo?.label} · {totalCards} document-qualified recommendation{totalCards === 1 ? "" : "s"}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-fit border-border/50 text-xs font-black uppercase tracking-[0.16em]"
          onClick={() => setShowContributions((value) => !value)}
        >
          <Activity className="mr-2 h-3.5 w-3.5" />
          {showContributions ? "Hide Layer Counts" : "Show Layer Counts"}
        </Button>
      </div>

      {showContributions && data?.layer_contributions && (
        <Card className="border-border/50 bg-card/50">
          <CardContent className="grid gap-3 p-4 md:grid-cols-5">
            {Object.entries(data.layer_contributions).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border/40 bg-background/50 px-3 py-2">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{key.replace(/_/g, " ")}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{String(value)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data?.conflicts?.length ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-black uppercase tracking-[0.18em]">Visible Layer Conflicts</p>
          </div>
          <div className="mt-3 space-y-2">
            {data.conflicts.map((conflict, index) => (
              <p key={index} className="text-xs leading-relaxed text-amber-100/85">{conflict}</p>
            ))}
          </div>
        </div>
      ) : null}

      {(["CRITICAL", "MEDIUM", "LOW"] as SeverityTier[]).map((severity) => {
        const cards = tiers[severity];
        if (!cards.length) return null;
        const style = SECTION_STYLE[severity];

        return (
          <section key={severity} className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={cn("h-2 w-2 rounded-full", severity === "CRITICAL" ? "bg-red-400" : severity === "MEDIUM" ? "bg-amber-400" : "bg-emerald-400")} />
              <h2 className={cn("text-sm font-black uppercase tracking-[0.18em]", style.tone)}>
                {severity} · {cards.length} item{cards.length === 1 ? "" : "s"}
              </h2>
              <div className="h-px flex-1 bg-border/40" />
            </div>
            <div className="space-y-4">
              {cards.map((card) => (
                <SectionCard key={card.id} severity={severity} card={card} />
              ))}
            </div>
          </section>
        );
      })}

      {totalCards === 0 && (
        <div className="py-24 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
            <ShieldCheck className="h-8 w-8 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">No Document-Qualified Problems</h3>
            <p className="text-sm text-muted-foreground">No entity currently meets the score-driven detection rules from the overhaul document.</p>
          </div>
        </div>
      )}
    </div>
  );
}
