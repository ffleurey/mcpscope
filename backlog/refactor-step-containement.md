# Task to refactor the Steps to be a proper containement structure

## Goal

Make `Step` a first-class part of the canonical session containment tree, not a side-car concept. The session tree and the ID tree should match, so every node can be reached through its full hierarchical ID and the node type can be inferred from the ID alone.

This is a breaking change by design. We are not preserving legacy data or compatibility; the database may be wiped as part of the refactor.

Desired outcome:

- one canonical composite model for session containment
- step nodes visible in inspect, trace, and UI traversal like any other node
- IDs that encode the full path and the node type at each level
- less special-casing for analysis workflow steps, inspect, and UI rendering

## Acceptance criteria

- `Step` is modeled as a first-class container node in the runtime/data model.
- Step IDs are hierarchical and reflect containment, not just workflow ordinals.
- A node ID alone is enough to infer the node type at each segment.
- Inspect resolves sessions, steps, turns, rounds, and parts through the same containment model.
- UI rendering no longer needs a parallel step side-channel for analysis sessions.
- The refactor is implemented as one coordinated breaking change, not as a two-stage compatibility migration.
- The change stays focused on step containment, IDs, inspect, and analysis-session UI traversal; no broader execution-logic factoring is introduced in this task.
- Documentation updates at the end are limited to the sections in the runtime model and architecture notes that describe the changed containment tree, canonical IDs, and lookup/UI behavior.

Success should be visible in the backend model, inspect output, trace/export shape, and the frontend traversal/rendering path.

## Target structure

Implementation names today:

- `AnalysisSession`
- `FastSessionAnalysisSession`
- `FastToolAnalysisSession`
- `AnalysisWorkflowRuntime`

The concrete workflow nodes in the diagram are shown using the actual persisted `stepTypeKey` names used by the current implementation.

```mermaid
classDiagram
	class Session {
		<<abstract>>
	}

	class Step {
		<<abstract>>
	}

	class WorkflowStep {
		<<abstract>>
		+turns: Turn[]
	}

	class analysis_bootstrap
	class analysis_tool_call_assessment
	class analysis_tool_group_assessment
	class analysis_turn_summary
	class analysis_final_aggregation

	class Turn {
		+rounds: Round[]
	}

	class Round {
	}

	class Part {
		<<abstract>>
	}

	class PromptPart
	class AnswerPart
	class ToolCallPart

	Session "1" o-- "*" Step
	Step <|-- WorkflowStep
	Step <|-- Turn
	WorkflowStep <|-- analysis_bootstrap
	WorkflowStep <|-- analysis_tool_call_assessment
	WorkflowStep <|-- analysis_tool_group_assessment
	WorkflowStep <|-- analysis_turn_summary
	WorkflowStep <|-- analysis_final_aggregation
	WorkflowStep "1" o-- "*" Turn
	Turn "1" o-- "*" Round
	Round "1" o-- "*" Part
	Part <|-- PromptPart
	Part <|-- AnswerPart
	Part <|-- ToolCallPart
```

## Design decisions

- `Step` is abstract.
- `WorkflowStep` is abstract and sits under `Step`; it can own zero or more `Turn`s.
- `Turn` is a concrete `Step` subtype and can be a direct child of `Session` or a child of a concrete `WorkflowStep`.
- `Turn` owns `Round`s; below `Turn` the hierarchy does not change.
- `WorkflowStep` only contains `Turn` children at this stage.
- The ID grammar should mirror the type hierarchy using concrete-type suffix letters, similar to parts.
- Step IDs should use the sequence position plus a type suffix, e.g. `ABCD.3T` for a turn and `ABCD.4W` for a workflow step.
- `W` is the default suffix for `WorkflowStep`; subclasses may optionally override it with a different suffix if needed.
- All concrete analysis-session `WorkflowStep` subclasses use the default `W` suffix.
- Numbering is shared across all step subtypes within a session, like parts: the number is the step's position in the session's ordered step list.
- A nested path should preserve the full containment chain, e.g. `ABCD.4W.1T.3.3R`.
- We are accepting a breaking change and can reset the DB rather than maintaining backward compatibility.
- The refactor should be done in one pass so the data model, ID grammar, resolver, and UI all agree on the same tree shape.
- Keep the design compact and compositional: avoid separate side-car traversal paths where the tree itself can express the relationship.
- Keep the refactor minimal: focus on containment and IDs first, and do not try to factor or redesign the step execution logic in this step.

The concrete analysis-session `WorkflowStep` subclasses are:

- `analysis_bootstrap`
- `analysis_tool_call_assessment`
- `analysis_tool_group_assessment`
- `analysis_turn_summary`
- `analysis_final_aggregation`

Open items already settled:

- The inspect contract for `Turn` stays unchanged.
- `WorkflowStep` inspect returns the full subtree under that workflow step.
- Primary session UI remains unchanged.
- Analysis-session UI is updated to follow the composite containment structure, but the refactor effort stays minimal.

## Pre-implementation gates

- Freeze the target tree before coding: `Session -> Step -> WorkflowStep/Turn`, with workflow steps owning turns only.
- Freeze the ID grammar before coding: type-inferable suffixes, shared numbering within the session step list, and `W` for all concrete analysis workflow steps.
- Freeze the implementation boundary before coding: no execution-logic factoring, no primary-session UI redesign, no broader benchmark/session-parent work.
- Freeze the doc boundary before coding: only the affected runtime-tree, canonical-ID, lookup-rule, and analysis-session UI sections get updated at the end.


## Implemntation Steps

1. [done] Finalize the concrete `Step` / `WorkflowStep` / `Turn` split and confirm the typed suffix rule, with `W` as the default for workflow steps.
2. [done] Update the domain model and persistence contracts to represent `WorkflowStep` as abstract and owning turns, without changing step execution behavior.
3. [done] Refactor hierarchical ID parsing/formatting so IDs encode the full path and concrete node type.
4. [done] Update inspect / lookup resolution so `Turn` inspect stays the same and `WorkflowStep` inspect returns the full subtree.
5. [done] Rework trace serialization so workflow steps and their descendant turns/rounds/parts are emitted as part of the same hierarchy.
6. [done] Update analysis-session scheduling and step ownership only as needed to fit the new containment shape.
7. [done] Remove or reduce analysis-session UI side paths that only exist because steps are modeled separately; keep primary-session UI unchanged.
8. [done] Add or update tests for ID parsing, inspect traversal, trace shape, and analysis-session rendering.
9. [done] Update [DATA-MODEL.md](../DATA-MODEL.md) and any directly affected architecture notes to match the new step containment and ID model, changing only the sections that describe the runtime tree, canonical IDs, lookup rules, and analysis-session inspect/UI behavior.
10. [done] Validate the end-to-end flow with the new tree, then clean up any remaining compatibility code.

### Step gates and checks

- Step 1 gate: the class diagram, subclass list, and naming are final; there are no remaining shape questions.
- Step 2 gate: the domain model compiles with the new abstract/concrete split and no logic paths were refactored.
- Step 3 gate: ID parse/format rules cover the settled tree and all concrete analysis workflow steps use the shared `W` suffix.
- Step 4 gate: `Turn` lookup behavior is unchanged, while `WorkflowStep` lookup returns its full subtree.
- Step 5 gate: trace output reflects the composite step subtree without changing unrelated session or part semantics.
- Step 6 gate: scheduling still behaves the same from the user's point of view; only ownership/containment wiring changes.
- Step 7 gate: primary-session UI remains effectively unchanged; analysis-session UI follows the composite structure.
- Step 8 gate: the new and existing tests that cover containment, IDs, inspect, trace, and analysis UI pass.
- Step 9 gate: documentation is updated only where the changed model is described, and it matches the implemented tree and IDs.
- Final gate: the end-to-end refactor is coherent, and no compatibility scaffolding is left behind in the touched slice.