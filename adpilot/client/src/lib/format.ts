/**
 * Format currency in Indian notation: ₹1,23,456
 */
export function formatINR(amount: number, decimals = 0): string {
  if (amount === 0) return "₹0";
  const isNeg = amount < 0;
  const abs = Math.abs(amount);
  const [intPart, decPart] = abs.toFixed(decimals).split(".");
  
  // Indian grouping: last 3 digits, then groups of 2
  let result = "";
  const len = intPart.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 2) {
      result = remaining.slice(-2) + "," + result;
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      result = remaining + "," + result;
    }
  }
  
  const formatted = decPart ? `${result}.${decPart}` : result;
  return `${isNeg ? "-" : ""}₹${formatted}`;
}

/**
 * Format percentage to 2 decimal places
 */
export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

/**
 * Format large numbers with Indian notation (no currency symbol)
 */
export function formatNumber(num: number): string {
  if (num === 0) return "0";
  const abs = Math.abs(num);
  const intPart = Math.floor(abs).toString();
  const len = intPart.length;
  
  let result = "";
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 2) {
      result = remaining.slice(-2) + "," + result;
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      result = remaining + "," + result;
    }
  }
  
  return num < 0 ? `-${result}` : result;
}

/**
 * Compact number format (1.2L, 12.5K)
 */
export function formatCompact(num: number): string {
  const abs = Math.abs(num);
  if (abs >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${(num / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

/**
 * Get health score color
 */
export function getHealthColor(score: number): string {
  if (score <= 40) return "text-red-500";
  if (score <= 60) return "text-amber-500";
  if (score <= 80) return "text-emerald-500";
  return "text-emerald-400";
}

export function getHealthBgColor(score: number): string {
  if (score <= 40) return "bg-red-500";
  if (score <= 60) return "bg-amber-500";
  if (score <= 80) return "bg-emerald-500";
  return "bg-emerald-400";
}

export function getHealthBarBg(score: number): string {
  if (score <= 40) return "bg-red-500/20";
  if (score <= 60) return "bg-amber-500/20";
  if (score <= 80) return "bg-emerald-500/20";
  return "bg-emerald-400/20";
}

/**
 * Layer badge colors
 */
export function getLayerColor(layer: string): { bg: string; text: string } {
  switch (layer?.toUpperCase()) {
    case "TOFU": return { bg: "bg-blue-500/15", text: "text-blue-400" };
    case "MOFU": return { bg: "bg-purple-500/15", text: "text-purple-400" };
    case "BOFU": return { bg: "bg-orange-500/15", text: "text-orange-400" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-400" };
  }
}

/**
 * Status badge colors
 */
export function getStatusColor(status: string): { bg: string; text: string } {
  switch (status?.toUpperCase()) {
    case "ACTIVE": return { bg: "bg-emerald-500/15", text: "text-emerald-400" };
    case "PAUSED": return { bg: "bg-gray-500/15", text: "text-gray-400" };
    case "ERROR": return { bg: "bg-red-500/15", text: "text-red-400" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-400" };
  }
}

/**
 * Trend arrow with color
 */
export function getTrendInfo(trend: string, isInverse = false): { arrow: string; color: string } {
  const up = trend === "UP";
  const isGood = isInverse ? !up : up;
  return {
    arrow: up ? "↑" : "↓",
    color: isGood ? "text-emerald-400" : "text-red-400",
  };
}

/**
 * Get CPL color based on dynamic thresholds
 */
export function getCplColor(cpl: number, thresholds?: { cpl_target: number; cpl_alert: number; cpl_critical: number }): string {
  if (!thresholds) return "text-foreground";
  if (cpl <= thresholds.cpl_target) return "text-emerald-400";
  if (cpl <= thresholds.cpl_alert) return "text-amber-400";
  return "text-red-400";
}

/**
 * Get classification badge colors
 */
export function getClassificationColor(classification: string): { bg: string; text: string } {
  switch (classification?.toUpperCase()) {
    case "WINNER": return { bg: "bg-emerald-500/15", text: "text-emerald-400" };
    case "WATCH": return { bg: "bg-amber-500/15", text: "text-amber-400" };
    case "UNDERPERFORMER": return { bg: "bg-red-500/15", text: "text-red-400" };
    case "NEW": return { bg: "bg-blue-500/15", text: "text-blue-400" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-400" };
  }
}

/**
 * Get learning status badge colors
 */
export function getLearningStatusColor(status: string): { bg: string; text: string } {
  if (status === "LEARNING_LIMITED") return { bg: "bg-red-500/15", text: "text-red-400" };
  return { bg: "bg-emerald-500/15", text: "text-emerald-400" };
}

/**
 * Get video metric color (TSR, VHR, FFR)
 */
export function getVideoMetricColor(metric: "tsr" | "vhr" | "ffr", value: number): string {
  switch (metric) {
    case "tsr": // Thumb Stop Rate
      if (value < 25) return "text-red-400";
      if (value < 35) return "text-amber-400";
      return "text-emerald-400";
    case "vhr": // Video Hold Rate
      if (value < 40) return "text-red-400";
      if (value < 55) return "text-amber-400";
      return "text-emerald-400";
    case "ffr": // First Frame Rate
      if (value < 80) return "text-red-400";
      if (value < 90) return "text-amber-400";
      return "text-emerald-400";
    default:
      return "text-foreground";
  }
}

/**
 * Get CTR color
 */
export function getCtrColor(ctr: number): string {
  if (ctr < 0.4) return "text-red-400";
  if (ctr < 0.7) return "text-amber-400";
  return "text-foreground";
}

/**
 * Get frequency color
 */
export function getFrequencyColor(freq: number): string {
  if (freq > 3) return "text-red-400";
  if (freq > 2.5) return "text-amber-400";
  return "text-foreground";
}

/**
 * Get CPM color against benchmarks
 */
export function getCpmColor(cpm: number, benchmarks?: { cpm_ideal_high?: number; cpm_alert?: number }): string {
  if (!benchmarks) return "text-foreground";
  if (cpm > (benchmarks.cpm_alert || 500)) return "text-red-400";
  if (cpm > (benchmarks.cpm_ideal_high || 300)) return "text-amber-400";
  return "text-foreground";
}

/**
 * Truncate text
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

/**
 * Format relative time
 */
export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}
