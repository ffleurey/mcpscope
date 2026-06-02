# Related Work: MCP Testing, Evaluation, and Observability

---

## Summary

The MCP testing and evaluation ecosystem expanded quickly in 2025. There are now credible projects for protocol inspection, benchmark-style evaluation, agent observability, and multi-LLM testing. At the same time, the current tools still leave a meaningful gap around **local-first MCP evaluation with LM Studio/Ollama, rich execution traces, deterministic replay, and tool-description diagnostics**.

This document summarizes the most relevant related work and places the project within that landscape.

---

## Directly related projects

### mcp-eval (LastMile AI)

- **URL:** https://github.com/lastmile-ai/mcp-eval
- **What it does:** Python evaluation framework for testing a real agent against a real MCP server. Uses OpenTelemetry for traces and supports assertion APIs, dataset-driven evaluation, and LLM-as-judge grading.
- **Why it matters:** This is the closest open-source match on the evaluation side. It validates the idea that MCP testing must happen end to end.
- **Signals:** Active docs at https://mcp-eval.ai, PyPI package, CI/reporting focus, backed by LastMile AI.
- **Overlap:** High conceptual overlap, but library-first and not local-model-first.

### MCPEval (Salesforce AI Research)

- **Code:** https://github.com/SalesforceAIResearch/MCPEval
- **Paper:** https://arxiv.org/abs/2507.12806
- **What it does:** Academic framework for automated task generation and deep evaluation of LLM agents across multiple domains. Includes multi-turn simulation, replay viewer, SQLite persistence, model comparison, and statistical analysis.
- **Why it matters:** Strong research validation for replayable, persistent, trace-aware evaluation.
- **Signals:** ArXiv paper, release activity, institutional backing.
- **Overlap:** Strong on evaluation methodology, weaker on local interactive debugging.

### MCPBench (ModelScope)

- **Code:** https://github.com/modelscope/MCPBench
- **Paper:** https://arxiv.org/abs/2504.11094
- **What it does:** Benchmark framework for MCP servers, measuring accuracy, latency, and token consumption across web search, database, and GAIA-style tasks.
- **Why it matters:** Important empirical signal that MCP reliability is still weak and that better declarative interfaces improve outcomes.
- **Signals:** Public repo, paper, hackathon usage.
- **Overlap:** Useful benchmark reference, but not a trace-first debugging tool.

### MCP Inspector

- **URL:** https://github.com/modelcontextprotocol/inspector
- **What it does:** Official manual inspection tool for browsing tools/resources/prompts and sending JSON-RPC requests over MCP transports.
- **Why it matters:** Baseline reference point for protocol validation.
- **Signals:** Official project under the modelcontextprotocol organization.
- **Overlap:** Low. It verifies server behavior, not LLM behavior.

### MCPJam Inspector

- **Repo:** https://github.com/MCPJam/inspector
- **App:** https://app.mcpjam.com
- **What it does:** Full MCP development platform with inspection, chat, traces, and evaluation workflows. README and product surface indicate multi-LLM evaluation and regression tracking.
- **Why it matters:** Closest product competitor found.
- **Signals:** Hosted product, desktop apps, SDK/CLI, active README.
- **Overlap:** Highest product overlap, but appears more cloud/frontier-model oriented than local-first.

---

## Adjacent and enabling projects

### OpenLLMetry

- **URL:** https://github.com/traceloop/openllmetry
- **Role:** OpenTelemetry-based instrumentation for LLM applications.
- **Why it matters:** Relevant if MCP trace capture ever needs exportable observability integrations.

### mcp-agent

- **URL:** https://github.com/lastmile-ai/mcp-agent
- **Role:** Agent runtime framework used underneath some MCP evaluation tooling.
- **Why it matters:** Useful reference for agent execution patterns and lifecycle handling.

### AgentOps

- **URL:** https://github.com/AgentOps-AI/agentops
- **Role:** Replay/debugging platform for agents in general.
- **Why it matters:** Adjacent to the observability side of this project, but not MCP-specific.

### Weave

- **URL:** https://github.com/wandb/weave
- **Role:** General LLM tracing and evaluation toolkit.
- **Why it matters:** Reference for evaluation datasets, scoring, and comparison workflows.

### Prompt Flow

- **URL:** https://github.com/microsoft/promptflow
- **Role:** Batch testing and evaluation workflow platform for LLM apps.
- **Why it matters:** Strong reference for prompt-suite execution and evaluation UX.

### LiteLLM

- **URL:** https://github.com/BerriAI/litellm
- **Role:** OpenAI-compatible gateway for many model backends, including local ones.
- **Why it matters:** Important enabling layer for routing eval frameworks to LM Studio or Ollama.

### OpenAI Evals

- **URL:** https://github.com/openai/evals
- **Role:** Foundational eval framework and design reference.
- **Why it matters:** Useful for completion-function abstractions and eval registry patterns.

### AgentBench

- **URL:** https://github.com/THUDM/AgentBench
- **Role:** Function-calling and multi-environment agent benchmark.
- **Why it matters:** Good methodology reference for evaluating tool-using agents.

### OWASP MCP Top 10

- **URL:** https://github.com/OWASP/www-project-mcp-top-10
- **Role:** Security taxonomy for MCP systems.
- **Why it matters:** Especially relevant for **MCP03 Tool Poisoning** and **MCP08 Lack of Audit and Telemetry**, both of which align directly with the project's focus.

---

## Recent experiments and ecosystem signals

### MCPBench benchmark results

- **Source:** https://arxiv.org/abs/2504.11094
- **Finding:** The best MCP setup reported only modest accuracy, and clearer declarative interfaces improved performance.
- **Implication:** Tool descriptions are part of the execution surface, not just documentation.

### MCPEval replay and simulation features

- **Source:** https://github.com/SalesforceAIResearch/MCPEval
- **Finding:** The framework converged on replay, persistence, and multi-turn evaluation as necessary features.
- **Implication:** This validates the importance of storing inspectable sessions rather than only reporting aggregate scores.

### MCPJam evaluation workflow

- **Sources:** https://github.com/MCPJam/inspector, https://app.mcpjam.com
- **Finding:** Product teams are already shipping evaluation surfaces for MCP workflows.
- **Implication:** There is clear demand, but room remains for a local-first alternative.

### ModelScope MCP hackathon

- **Source:** https://modelscope.cn/active/aihackathon-mcp-agent
- **Finding:** MCP evaluation is attracting community and hackathon investment.
- **Implication:** The problem space is active, not speculative.

### MCP roadmap emphasis on observability

- **Source:** https://modelcontextprotocol.io/development/roadmap
- **Finding:** Audit trails and observability are explicitly listed under enterprise readiness.
- **Implication:** The protocol maintainers themselves see this as a top ecosystem need.

---

## Ecosystem gaps and opportunities

The following gaps still appear underserved:

### 1. Local-first LLM-in-the-loop MCP testing

No strong open-source project currently combines:

- LM Studio / Ollama integration
- MCP-aware execution traces
- local persistence
- replay and comparison workflows

### 2. Tool description diagnostics

There is still no strong tool that tells a developer *why* a model misunderstood a tool description or picked the wrong tool.

### 3. Deterministic replay and diffing

Replay viewers exist, but deterministic replay as a regression-testing primitive still looks largely unserved.

### 4. Prompt-suite testing for tool schemas

There is no clear leader for running prompt suites specifically to compare MCP schema versions and tool-description changes.

### 5. Local-model capability benchmarking

There is still little public work comparing how local models perform on MCP tool-use tasks.

---

## Suggested project placement

The clearest positioning is:

> **A local-first MCP runtime debugger and evaluation lab**

That is distinct from:

- **MCP Inspector**: protocol/manual validation
- **MCPJam**: hosted product workflow
- **mcp-eval / MCPEval / MCPBench**: libraries and benchmarks
- **OpenLLMetry / AgentOps / Weave**: general observability infrastructure

The strongest message is:

> **Wireshark + test harness for MCP servers and local LLMs**

Key differentiators:

1. local-first and privacy-preserving
2. MCP-specific traces rather than generic telemetry
3. deterministic replay
4. focus on schema/tool-description quality
5. local models as first-class citizens

---

## Comparative table

| Project | URL | Category | Local LLM support | MCP-specific | Trace / replay | Open source |
|---|---|---|---|---|---|---|
| mcp-eval | https://github.com/lastmile-ai/mcp-eval | Direct eval framework | Partial via adapters, not primary focus | Yes | Traces via OpenTelemetry | Yes |
| MCPEval | https://github.com/SalesforceAIResearch/MCPEval | Academic eval framework | Not a stated primary focus | Yes | Replay viewer + persistence | Yes |
| MCPBench | https://github.com/modelscope/MCPBench | Benchmark framework | No clear local-model focus | Yes | Limited | Yes |
| MCP Inspector | https://github.com/modelcontextprotocol/inspector | Protocol inspector | No | Yes | No | Yes |
| MCPJam Inspector | https://github.com/MCPJam/inspector | Product/dev platform | No clear local-first focus | Yes | Partial | Yes |
| OpenLLMetry | https://github.com/traceloop/openllmetry | Observability infra | Yes | No | Telemetry spans | Yes |
| AgentOps | https://github.com/AgentOps-AI/agentops | Agent observability | No | No | Replay/debugging | Yes |
| Weave | https://github.com/wandb/weave | Eval + trace infra | No clear local-first focus | No | Trace logging | Yes |
| Prompt Flow | https://github.com/microsoft/promptflow | Eval workflow platform | Partial | No | Limited | Yes |
| LiteLLM | https://github.com/BerriAI/litellm | Model gateway | Yes | No | No | Yes |
| OpenAI Evals | https://github.com/openai/evals | Foundational eval framework | Via compatible backends | No | No | Yes |
| AgentBench | https://github.com/THUDM/AgentBench | Agent benchmark | No | No | Limited | Yes |
| OWASP MCP Top 10 | https://github.com/OWASP/www-project-mcp-top-10 | Security taxonomy | N/A | Yes | N/A | Yes |

---

## Reference list

1. https://github.com/lastmile-ai/mcp-eval
2. https://github.com/SalesforceAIResearch/MCPEval
3. https://arxiv.org/abs/2507.12806
4. https://github.com/modelscope/MCPBench
5. https://arxiv.org/abs/2504.11094
6. https://github.com/modelcontextprotocol/inspector
7. https://github.com/MCPJam/inspector
8. https://app.mcpjam.com
9. https://github.com/traceloop/openllmetry
10. https://github.com/lastmile-ai/mcp-agent
11. https://github.com/AgentOps-AI/agentops
12. https://github.com/wandb/weave
13. https://github.com/microsoft/promptflow
14. https://github.com/BerriAI/litellm
15. https://github.com/openai/evals
16. https://github.com/THUDM/AgentBench
17. https://github.com/OWASP/www-project-mcp-top-10
18. https://modelcontextprotocol.io/development/roadmap
19. https://modelscope.cn/active/aihackathon-mcp-agent
