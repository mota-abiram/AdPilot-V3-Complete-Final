/**
 * Test suite for Mojo AdCortex v2.0 quadratic formulas
 * Validates that the new formulas match the PDF specification
 */

import {
  scoreStagedCostDynamic,
  scoreStagedBudgetDynamic,
  computeMinRatio,
  computeDualGateStatus,
} from "./scoring-config";

// Test cases from the PDF specification
console.log("=== Testing Cost Metric Formula ===");

// Test case 1: CPL at target
let result = scoreStagedCostDynamic(700, 700);
console.log(`CPL 700 vs target 700: ${result} (expected: 100)`);

// Test case 2: CPL 4.1% over target
result = scoreStagedCostDynamic(729, 700);
console.log(`CPL 729 vs target 700 (4.1% over): ${result} (expected: ~93)`);

// Test case 3: CPQL 51.9% over target (in RED zone)
result = scoreStagedCostDynamic(4481, 2950);
console.log(`CPQL 4481 vs target 2950 (51.9% over): ${result} (expected: ~37)`);

// Test case 4: Cost 100% over target (at red_multiplier)
result = scoreStagedCostDynamic(1400, 700);
console.log(`Cost 1400 vs target 700 (100% over): ${result} (expected: ~50)`);

// Test case 5: Cost 34%+ over target (at zero point)
result = scoreStagedCostDynamic(936, 700);
console.log(`Cost 936 vs target 700 (34% over): ${result} (expected: ~0)`);

console.log("\n=== Testing Budget Pacing Formula ===");

// Test case 1: Perfect pacing
result = scoreStagedBudgetDynamic(100);
console.log(`Pacing 100%: ${result} (expected: 100)`);

// Test case 2: 8.6% overspend (from your case)
result = scoreStagedBudgetDynamic(108.6);
console.log(`Pacing 108.6% (8.6% deviation): ${result} (expected: ~84)`);

// Test case 3: 10% deviation
result = scoreStagedBudgetDynamic(110);
console.log(`Pacing 110% (10% deviation): ${result} (expected: ~80)`);

// Test case 4: 20% deviation
result = scoreStagedBudgetDynamic(120);
console.log(`Pacing 120% (20% deviation): ${result} (expected: ~40)`);

console.log("\n=== Testing Min Ratio Calculation ===");

const breakdown = {
  cpsv: 25,
  budget: 20,
  cpql: 10,  // Weakest metric
  cpl: 20,
  creative: 8,
};

const weights = {
  cpsv: 25,
  budget: 25,
  cpql: 20,
  cpl: 20,
  creative: 10,
};

const minRatio = computeMinRatio(breakdown, weights);
console.log(`Min ratio for breakdown: ${minRatio.toFixed(3)}`);
console.log(`  - CPSV: 25/25 = 1.0`);
console.log(`  - Budget: 20/25 = 0.8`);
console.log(`  - CPQL: 10/20 = 0.5 (weakest)`);
console.log(`  - CPL: 20/20 = 1.0`);
console.log(`  - Creative: 8/10 = 0.8`);
console.log(`Expected min: 0.5, Got: ${minRatio.toFixed(3)}`);

console.log("\n=== Testing Dual-Gate Status ===");

// Test case: composite=80, min_ratio=0.35
let status = computeDualGateStatus(80, 0.35);
console.log(`Composite 80, minRatio 0.35: ${status} (expected: YELLOW)`);

// Test case: composite=76, min_ratio=0.45
status = computeDualGateStatus(76, 0.45);
console.log(`Composite 76, minRatio 0.45: ${status} (expected: GREEN)`);

// Test case: composite=70, min_ratio=0.15
status = computeDualGateStatus(70, 0.15);
console.log(`Composite 70, minRatio 0.15: ${status} (expected: YELLOW)`);

// Test case: composite=30, min_ratio=0.02
status = computeDualGateStatus(30, 0.02);
console.log(`Composite 30, minRatio 0.02: ${status} (expected: RED)`);

console.log("\n=== All Tests Completed ===");
