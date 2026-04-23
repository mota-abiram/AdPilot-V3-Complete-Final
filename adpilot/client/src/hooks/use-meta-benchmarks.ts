import { useMemo } from "react";
import { useClient } from "@/lib/client-context";

export interface MetaBenchmarks {
  // Primary targets
  cplTarget: number;
  cpmTarget: number;
  ctrTarget: number;
  cvrTarget: number;
  
  // Thresholds for color coding
  cplAlert: number;
  cplCritical: number;
  cpmAlert: number;
  cpmCritical: number;
  ctrAlert: number;
  ctrCritical: number;
  cvrAlert: number;
  cvrCritical: number;
  
  // Frequency thresholds
  frequencyWarn: number;
  frequencySevere: number;

  // New primary targets
  cpsvTarget: number;
  cpqlTarget: number;
  budgetTarget: number;
  leadsTarget: number;

  // Raw benchmark data
  raw: Record<string, any>;
  isLoading: boolean;
}

export interface PlatformBenchmarkTargets {
  raw: Record<string, any>;
  budget: number;
  leads: number;
  cpl: number;
  cplMax: number;
  cpql: number;
  positiveLeadTarget: number;
  positivePctTarget: number;
  svPctTarget: number;
  ctrMin: number;
  cvrMin: number;
  cpmMin: number;
  cpmMax: number;
  cpcMax: number;
  tsrMin: number;
  vhrMin: number;
  ffrMin: number;
  frequencyMax: number;
  svs: { low: number; high: number };
  cpsv: { low: number; high: number };
  targetLocations: string[];
  googleSearchCtrTarget: number;
  googleSearchCvrTarget: number;
  googleSearchCpcMax: number;
  googleDgCtrTarget: number;
  googleDgCpmTarget: number;
  googleDgFrequencyMax: number;
}

/**
 * Hook to get centralized Meta benchmarks
 * Ensures all components use the same live benchmark values
 */
export function useMetaBenchmarks(): MetaBenchmarks {
  const { benchmarks, isLoadingBenchmarks, activePlatform } = useClient();

  return useMemo(() => {
    // Benchmarks are returned as a flat object for the active platform.
    // Normalize Google `google_*` fields into generic aliases so shared
    // dashboard pages never fall back to Meta-style defaults.
    const raw = (benchmarks as any) || {};
    const isGoogle = activePlatform === "google";

    const b = isGoogle
      ? {
          ...raw,
          leads: raw.google_leads ?? raw.leads,
          budget: raw.google_budget ?? raw.budget,
          cpl: raw.google_cpl ?? raw.cpl,
          cpl_target: raw.google_cpl ?? raw.cpl_target ?? raw.cpl,
          cpl_max: raw.google_cpl_max ?? raw.cpl_max,
          cpl_critical: raw.google_cpl_max ?? raw.cpl_critical ?? raw.cpl_max,
          cpql_target: raw.google_cpql_target ?? raw.cpql_target,
          svs_low: raw.google_svs_low ?? raw.svs_low,
          svs_high: raw.google_svs_high ?? raw.svs_high,
          cpsv_low: raw.google_cpsv_low ?? raw.cpsv_low,
          cpsv_high: raw.google_cpsv_high ?? raw.cpsv_high,
          positive_lead_target: raw.google_positive_lead_target ?? raw.positive_lead_target,
          positive_leads_mtd: raw.google_positive_leads_mtd ?? raw.positive_leads_mtd,
          svs_mtd: raw.google_svs_mtd ?? raw.svs_mtd,
          closures_mtd: raw.google_closures_mtd ?? raw.closures_mtd,
          ctr_target: raw.google_search_ctr_target ?? raw.google_dg_ctr_target ?? raw.ctr_target ?? raw.ctr_min,
          ctr_min: raw.google_search_ctr_target ?? raw.google_dg_ctr_target ?? raw.ctr_min ?? raw.ctr_target,
          cvr_target: raw.google_search_cvr_target ?? raw.cvr_target ?? raw.cvr_min,
          cvr_min: raw.google_search_cvr_target ?? raw.cvr_min ?? raw.cvr_target,
          cpc_max: raw.google_search_cpc_max ?? raw.cpc_max,
          cpm_max: raw.google_dg_cpm_target ?? raw.cpm_max,
          frequency_max: raw.google_dg_frequency_max ?? raw.frequency_max,
        }
      : raw;

    // CPL thresholds
    const cplTarget = b.cpl_target ?? b.cpl ?? (isGoogle ? 1500 : 800);
    const cplAlert = b.cpl_alert ?? cplTarget * 1.25;
    const cplCritical = b.cpl_critical ?? b.cpl_max ?? cplTarget * 1.5;

    // CPM thresholds
    const cpmTarget = b.cpm_target ?? b.cpm_max ?? (isGoogle ? 400 : 300);
    const cpmAlert = b.cpm_alert ?? cpmTarget * 1.3;
    const cpmCritical = b.cpm_critical ?? cpmTarget * 1.8;

    // CTR thresholds (as percentages)
    const ctrTarget = b.ctr_min ?? b.ctr_target ?? b.ctr ?? (isGoogle ? 0.8 : 1.0);
    const ctrAlert = b.ctr_alert ?? ctrTarget * 0.7;
    const ctrCritical = b.ctr_critical ?? ctrTarget * 0.4;

    // CVR thresholds (as percentages)
    const cvrTarget = b.cvr_min ?? b.cvr_target ?? b.cvr ?? (isGoogle ? 1.5 : 2.0);
    const cvrAlert = b.cvr_alert ?? cvrTarget * 0.6;
    const cvrCritical = b.cvr_critical ?? cvrTarget * 0.3;

    // Frequency thresholds
    const frequencyWarn = b.frequency_max ?? b.frequency_warn ?? b.freq_warn ?? 1.8;
    const frequencySevere = b.frequency_severe ?? b.freq_severe ?? frequencyWarn * 1.5;

    // Cost-per-visit & quality lead targets
    const cpsvTarget = b.cpsv_low ?? b.cpsv_target_low ?? 0;
    const cpqlTarget = b.cpql_target ?? b.cpql ?? 1500;

    // Budget & lead volume targets
    const budgetTarget = b.budget ?? 0;
    const leadsTarget = b.leads ?? 0;

    return {
      cplTarget,
      cpmTarget,
      ctrTarget,
      cvrTarget,
      cplAlert,
      cplCritical,
      cpmAlert,
      cpmCritical,
      ctrAlert,
      ctrCritical,
      cvrAlert,
      cvrCritical,
      frequencyWarn,
      frequencySevere,
      cpsvTarget,
      cpqlTarget,
      budgetTarget,
      leadsTarget,
      raw: b,
      isLoading: isLoadingBenchmarks,
    };
  }, [benchmarks, isLoadingBenchmarks, activePlatform]);
}

/**
 * Get dynamic thresholds in the format expected by getCplColor
 */
export function useDynamicThresholds() {
  const benchmarks = useMetaBenchmarks();
  
  return useMemo(() => ({
    cpl_target: benchmarks.cplTarget,
    cpl_alert: benchmarks.cplAlert,
    cpl_critical: benchmarks.cplCritical,
  }), [benchmarks.cplTarget, benchmarks.cplAlert, benchmarks.cplCritical]);
}

/**
 * Canonical target map for the active platform.
 * Benchmarks are the single source of truth for target values.
 */
export function useBenchmarkTargets(): PlatformBenchmarkTargets {
  const benchmarks = useMetaBenchmarks();

  return useMemo(() => {
    const raw = benchmarks.raw || {};

    return {
      raw,
      budget: raw.budget ?? benchmarks.budgetTarget ?? 0,
      leads: raw.leads ?? benchmarks.leadsTarget ?? 0,
      cpl: raw.cpl_target ?? raw.cpl ?? benchmarks.cplTarget ?? 0,
      cplMax: raw.cpl_max ?? raw.cpl_critical ?? benchmarks.cplCritical ?? 0,
      cpql: raw.cpql_target ?? raw.cpql ?? benchmarks.cpqlTarget ?? 0,
      positiveLeadTarget: raw.positive_lead_target ?? 0,
      positivePctTarget: raw.positive_pct_target ?? 0,
      svPctTarget: raw.sv_pct_target ?? 0,
      ctrMin: raw.ctr_min ?? raw.ctr_target ?? benchmarks.ctrTarget ?? 0,
      cvrMin: raw.cvr_min ?? raw.cvr_target ?? benchmarks.cvrTarget ?? 0,
      cpmMin: raw.cpm_min ?? 0,
      cpmMax: raw.cpm_max ?? raw.cpm_target ?? benchmarks.cpmTarget ?? 0,
      cpcMax: raw.cpc_max ?? 0,
      tsrMin: raw.tsr_min ?? 0,
      vhrMin: raw.vhr_min ?? 0,
      ffrMin: raw.ffr_min ?? 0,
      frequencyMax: raw.frequency_max ?? benchmarks.frequencyWarn ?? 0,
      svs: {
        low: raw.svs_low ?? 0,
        high: raw.svs_high ?? raw.svs_low ?? 0,
      },
      cpsv: {
        low: raw.cpsv_low ?? benchmarks.cpsvTarget ?? 0,
        high: raw.cpsv_high ?? raw.cpsv_low ?? benchmarks.cpsvTarget ?? 0,
      },
      targetLocations: Array.isArray(raw.target_locations) ? raw.target_locations : [],
      googleSearchCtrTarget: raw.google_search_ctr_target ?? raw.ctr_min ?? benchmarks.ctrTarget ?? 0,
      googleSearchCvrTarget: raw.google_search_cvr_target ?? raw.cvr_min ?? benchmarks.cvrTarget ?? 0,
      googleSearchCpcMax: raw.google_search_cpc_max ?? raw.cpc_max ?? 0,
      googleDgCtrTarget: raw.google_dg_ctr_target ?? raw.ctr_min ?? benchmarks.ctrTarget ?? 0,
      googleDgCpmTarget: raw.google_dg_cpm_target ?? raw.cpm_max ?? benchmarks.cpmTarget ?? 0,
      googleDgFrequencyMax: raw.google_dg_frequency_max ?? raw.frequency_max ?? benchmarks.frequencyWarn ?? 0,
    };
  }, [benchmarks]);
}
