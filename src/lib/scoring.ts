import { SCORING } from "./brand-dna";
import type { TargetType } from "./db";

export type ScoreDimension = (typeof SCORING.dimensions)[number];

export interface ScoreBand {
  min: number;
  label: string;
  action: string;
}

export interface ScoreResult {
  score: number;
  band: string;
  action: string;
}

export function getScoreBand(score: number): ScoreBand {
  for (const band of SCORING.bands) {
    if (score >= band.min) {
      return { min: band.min, label: band.label, action: band.action };
    }
  }
  const last = SCORING.bands[SCORING.bands.length - 1];
  return { min: last.min, label: last.label, action: last.action };
}

export function calculateScore(
  targetType: TargetType,
  dimensions: Record<string, number>
): ScoreResult {
  const weights = SCORING.weights[targetType];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const dim of SCORING.dimensions) {
    const value = dimensions[dim];
    if (value === undefined || value === null) continue;

    const clamped = Math.max(0, Math.min(100, value));
    const weight = weights[dim];
    weightedSum += clamped * weight;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const band = getScoreBand(score);

  return {
    score,
    band: band.label,
    action: band.action,
  };
}
