# Fixme: dead `analysis_v2_cursor` step-key lookup

Small dead-branch finding from the 2026-06-17 foundation review. Left untouched because it
lives in the analysis subsystem being reshaped by `candidates/v1-analysis-and-benchmark-plan.md`
— fold this into that work rather than touching analysis code in isolation.

## Finding

`backend/src/analysis/analysisSessionPresentation.ts:31` looks up a step whose
`stepTypeKey === 'analysis_v2_cursor'`:

```
const cursorStep = steps.find(step => step.stepTypeKey === 'analysis_v2_cursor')
if (cursorStep) return getAnalysisWorkflowKindFromStep(cursorStep)
```

But `STEP_TYPE` (`backend/src/domain/executionModel.ts`) defines no such key — the analysis
cursor stopped being a pseudo-step in PR #25 (`refactor-step-containement`) and moved to a
session state column. So this `find` never matches and the branch is dead. It is also the
last `v2`-flavored name left in the backend after the schema-history cleanup (it is a value
string, not a table name, so the rename pass correctly skipped it).

## Action

Remove the dead lookup/branch (and confirm the function's remaining path is correct) as part
of the analysis consolidation. Verify no test relies on the `analysis_v2_cursor` string
before removing (a couple of analysis tests still reference it).
