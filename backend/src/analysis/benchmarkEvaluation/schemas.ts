/**
 * Schemas for the benchmark_evaluation analysis type — the rubric judge.
 *
 * The judge scores a finished session against a per-case rubric (criteria +
 * points). Output is deliberately tiny: per-criterion awarded points + a short
 * ID-citing note, and an optional overall comment. Totals/normalization are
 * computed at the benchmark layer, not here.
 */

import { z } from 'zod'
import type { RubricCriterion } from '../../domain/model.js'

export const SCHEMA_KEY = {
  /** The rubric verdict produced by the judge step. */
  VERDICT: 'analysis.benchmark_evaluation_verdict.v1',
  /** A trivial index artifact so BootstrapStep has something to write. */
  WORK_INDEX: 'analysis.benchmark_evaluation_index.v1',
} as const

/** One per-criterion award from the judge. `id` aligns to a rubric criterion. */
export const verdictCriterionSchema = z.object({
  id: z.number().int(),
  points: z.number().int(),
  note: z.string(),
})

export const benchmarkVerdictSchema = z.object({
  criteria: z.array(verdictCriterionSchema),
  comment: z.string().optional(),
})
export type BenchmarkVerdict = z.infer<typeof benchmarkVerdictSchema>

/**
 * Reconcile a raw judge verdict against the rubric: one entry per rubric
 * criterion (in rubric order), points clamped to [0, criterion.points], the
 * judge's note carried through (empty if it skipped the criterion). Pure — unit
 * tested. Keeps the stored verdict trustworthy regardless of what the judge
 * returned (extra/missing/over-cap entries).
 */
export function clampVerdictToRubric(
  rubric: RubricCriterion[],
  verdict: BenchmarkVerdict,
): BenchmarkVerdict {
  const byId = new Map(verdict.criteria.map((c) => [c.id, c]))
  const criteria = rubric.map((criterion) => {
    const raw = byId.get(criterion.id)
    const points = Math.max(0, Math.min(raw?.points ?? 0, criterion.points))
    return { id: criterion.id, points, note: raw?.note ?? '' }
  })
  return verdict.comment !== undefined ? { criteria, comment: verdict.comment } : { criteria }
}
