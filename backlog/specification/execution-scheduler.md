So far we do not really have an execution engine in the backend. Each session has an execution semantics and we have defined a stricly sequencial execution policy.

To prepare for more advanced scenarios and allow for easily controling and following the execution of sessions, analysis sessions and later benchmarks we would benefit from a more proper centralized execution queue and engine.

This can be quite simple and the idea is with it is actually to simplify what we have today by having a central queue which can be managed to to which "jobs" can be added. The granularity we want to have is the session, step or turn, we want to remian with one queue and sequencial execution. No parallel and concurency for now.

This meand that multiple sessions could be queues to run, including analysis sessions. We will always try to run full session and not jump between turns of different sessions but that can be the responsability of the component enqueing the jobs.

In the API and UI, we need to be able to monitor the state of the queue, monitor the state of the execution, what is being executed and what is the progress and we need to be able to start, pause, resume and edit the jobs in the queue. Remove a specific turn or remove a session, etc. 

It should not be possible to have multiple jobs for the same session because either what is enqueued is the whole session or it is a step or turn. There can be only one step at the time ready for execution in our session execution model so it is not possible to enqueue more than one step. The schedulaer should check and reject enquing anthing which is not ready to run (ie has all its inputs).

In the UI, I believe that the execution bar could be in the top bar, with the live status, the control button and some sort of drop down that can show the queue and allow removing jobs.

If stoping the queue or pausing teh queue, the granularity is the turn/step. Not sure we are able to easily interrup a turn which is already running in lmstudio for example but we should check. If a step/turn is completed then it should be possible to resume later the session from the next turn. If a turn is not completed, the it shoudl be possible to "re-run" that turn to get back on track.

One goal for the task is also to restore a robust ability to stream the execution with live streaming of all the llm outputs to the frontend even when toggling between different sessions in the frontend. Probably that the streaming could be centralised as part of the execution monitoring instead of being per session or chat.

