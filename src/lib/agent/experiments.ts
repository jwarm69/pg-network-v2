import {
  getActiveExperiment,
  createExperimentAssignment,
  getExperimentAssignments,
  updateExperiment,
} from "../db-agent";
import type { ExperimentVariant } from "./types";

export async function assignExperiment(
  targetId: string,
  variable: string,
  runId?: string,
  threadId?: string
): Promise<{ experimentId: string; variantId: string; variantValue: unknown } | null> {
  const experiment = await getActiveExperiment(variable);
  if (!experiment) return null;

  let variants: ExperimentVariant[];
  try {
    variants = JSON.parse(experiment.variants_json);
  } catch {
    return null;
  }

  if (variants.length === 0) return null;

  // Weighted random assignment
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let random = Math.random() * totalWeight;
  let selected = variants[0];

  for (const v of variants) {
    random -= v.weight;
    if (random <= 0) {
      selected = v;
      break;
    }
  }

  await createExperimentAssignment({
    experimentId: experiment.id,
    variantId: selected.id,
    runId,
    threadId,
    targetId,
  });

  return {
    experimentId: experiment.id,
    variantId: selected.id,
    variantValue: selected.value,
  };
}

export async function analyzeExperiment(experimentId: string): Promise<{
  experimentId: string;
  variantResults: Record<string, { n: number; withOutcome: number; metric: number | null }>;
  totalAssignments: number;
  significant: boolean;
}> {
  const assignments = await getExperimentAssignments(experimentId);

  // Group by variant
  const grouped: Record<string, typeof assignments> = {};
  for (const a of assignments) {
    if (!grouped[a.variant_id]) grouped[a.variant_id] = [];
    grouped[a.variant_id].push(a);
  }

  const variantResults: Record<string, { n: number; withOutcome: number; metric: number | null }> = {};

  for (const [variantId, group] of Object.entries(grouped)) {
    const withOutcome = group.filter((a) => a.outcome_json);
    let metricSum = 0;

    for (const a of withOutcome) {
      try {
        const outcome = JSON.parse(a.outcome_json!);
        // Assume outcome has a "value" field that's numeric
        if (typeof outcome.value === "number") {
          metricSum += outcome.value;
        } else if (typeof outcome.success === "boolean") {
          metricSum += outcome.success ? 1 : 0;
        }
      } catch { /* skip */ }
    }

    variantResults[variantId] = {
      n: group.length,
      withOutcome: withOutcome.length,
      metric: withOutcome.length > 0 ? metricSum / withOutcome.length : null,
    };
  }

  // Simple significance check: both variants need 10+ samples with outcomes
  const variants = Object.values(variantResults);
  const significant = variants.length >= 2 && variants.every((v) => v.withOutcome >= 10);

  return {
    experimentId,
    variantResults,
    totalAssignments: assignments.length,
    significant,
  };
}

export async function concludeExperiment(experimentId: string): Promise<void> {
  const analysis = await analyzeExperiment(experimentId);
  await updateExperiment(experimentId, {
    status: "concluded",
    results_json: JSON.stringify(analysis),
    concluded_at: new Date().toISOString(),
  });
}
