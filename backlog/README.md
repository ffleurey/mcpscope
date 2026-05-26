This folder contains a backlog of ideas for the MCP Scope project.

One file per idea. 

This is more of a brainstorming area. 

Not all ideas will be developed.



Updated.** I added the UI and configuration requirements to the task descriptions:

- `backlog/session-types-and-parent-links.md`
  - GUI tree view in the left pane
  - default-on **`primary sessions only`** toggle
  - non-primary sessions shown under their parent
  - future benchmark parents at the top level
  - CLI/MCP list surfaces stay **primary-only for now**

- `backlog/session-analysis-agent.md`
  - analysis can be launched from the base session and/or tree selection
  - analysis sessions are visible live while running
  - follow-up questions are allowed in the analysis session
  - multiple analyses per primary session are allowed
  - individual analysis sessions can be deleted
  - analysis should open in a separate surface so the base session can remain visible
  - dedicated analysis-configuration screen with multiple model/prompt alternatives and a default choice
  - explicit note to refactor/solidify configuration if the current area is not clean enough

## What still needs discussion/specification

I think the main remaining design decisions are:

1. **Exact `parent_ref` shape**
   - how it is persisted
   - what allowed parent kinds exist initially
   - whether `turn` parents are supported in v1 or deferred

2. **Benchmark object model**
   - what a benchmark/experiment parent actually is
   - whether it is one object or split into suite/case/run layers
   - how it appears at the top of the tree

3. **Analysis follow-up semantics**
   - whether follow-up questions stay within the same restricted tool subset
   - whether expectations can be edited after the initial run
   - whether follow-up turns are clearly separated from the initial analysis result

4. **Execution/locking rules**
   - whether analysis sessions use the same single-active-session lock as normal sessions
   - whether a base session can be inspected while its child analysis is running
   - whether multiple analysis sessions can run concurrently or only exist concurrently

5. **Deletion/cascade rules**
   - what happens when deleting a base session with child analyses
   - what happens when deleting a benchmark with child sessions and synthesis sessions
   - delete vs archive semantics

6. **Configuration model details**
   - whether analysis configurations should mirror model configs + defaults exactly
   - how prompts/defaults/profiles are named and selected
   - whether per-analysis-run override is allowed on top of a chosen analysis profile

7. **Tree view interaction details**
   - ordering of child sessions under a parent
   - naming/labels for analysis sessions in the tree
   - whether parents auto-expand when non-primary sessions become visible

These edits are **not committed yet**.


1. What can you propose? We do not need to support turn ref in v1. Lets keep things simple and make it easy to fetch all the sub elements of a session and to fetch the parent. We do have a tree structure which mixes multiple types of objects.
2. We need to discuss that when we will do the task about creating benchmark. For now all we care is thet they will contain a collection of sesisons.
3. Follow up questions will remain in the same "conversation" as the original evaluation. No need for anything special for the separation. Basically the first turn will be the analysis and subsequent turns will be any follow up. This will be a good dev tool I think to tune the agent instructions and system prompt.
4. We keep things fully sequencials among all types of sessions. What we may introduce later is to run in parallel session which are on separate "connections", ie. separate lmstudio instances. But for now all sequencial which is the best trategy with only one instance of lmstudio.
5. We cascade delete, same as a folders with files in it. That is our containement semantics.
6. Lets start simple. We should be able to define analysis models and a default one. This is more to be able to test alternative system prompts and models on the same sessions to evaluate what works the best. When triggering an analysis we can have a button that launches the default one and a little drop down if multiple are available to allow selecting a non default one. Since we already store all the info about the model, system prompt and stuff in the session, there should not be anything more we have to add.
7. In the treeview we should sort by creation time with the newest on top (I think that it is what we have now) but we should probably start showing the date time in a compact way. Primary sessions and analysis sessions should probably have a different icon (if we use icon). But all sessions, regardless of their type should have the 4 letter ID system we have in place and the treeview labels should start with it. The default title for the analysis session could be the name of the session analysis model used. So that if multiple analysis are done with different models it is shown which is which.
