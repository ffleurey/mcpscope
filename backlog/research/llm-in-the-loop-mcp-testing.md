# LLM-in-the-Loop MCP Testing: Core Idea

This project starts from a simple observation: **an MCP server can be technically correct and still fail in practice because the model does not understand how to use it**.

Traditional testing checks protocol compliance, transport behavior, and tool execution. That is necessary, but it misses the most important failure mode in agentic systems: whether the LLM chooses the right tool, interprets its description correctly, produces valid arguments, and recovers when something goes wrong.

That is why MCP testing needs to be **LLM-in-the-loop**.

## The problem

Current workflows are still too weak for this job:

- manual inspection proves that a server responds, but not that a model will use it correctly
- local inference tools such as LM Studio and Ollama provide the model runtime, but not the testing workflow
- general observability tools capture telemetry, but usually not the MCP-specific reasoning needed to debug tool selection and argument formation

The result is a gap between "the server works" and "the agent works."

## The core thesis

Tool descriptions and schemas are part of the execution surface, not just documentation.

If a tool description is vague, overloaded, misleading, or incomplete, the model may:

- choose the wrong tool
- invent or omit parameters
- loop unnecessarily
- fail to recover after a bad call

These are not conventional API bugs, so conventional API testing does not catch them well.

## The idea

The project should act as a **local-first MCP runtime debugger and evaluation lab**.

In practice, that means a developer should be able to:

1. connect a local or remote MCP server
2. run prompts against a local model such as LM Studio or Ollama
3. inspect the full interaction trace
4. see exactly which tool was selected, which arguments were generated, and what happened next
5. replay failures after changing prompts, schemas, or tool descriptions

The key value is not only pass/fail evaluation. It is giving developers a way to understand **why** the model behaved the way it did.

## Why local-first matters

The local-first approach is important for three reasons:

1. **Iteration speed**: tool descriptions and prompts can be adjusted and re-run quickly
2. **Privacy**: schemas, prompts, and traces do not need to leave the machine
3. **Model realism**: many developers are already building with local models, but the evaluation tooling around them is still immature

## Project placement

The best way to position the project is:

> **Wireshark + test harness for MCP servers and local LLMs**

It is:

- **not** just a protocol inspector
- **not** just a benchmark suite
- **not** just a cloud eval product
- **yes** a debugging and evaluation environment for real MCP + model interactions

The strongest differentiators are:

- local-first operation
- MCP-specific traces
- deterministic replay
- schema and tool-description diagnostics
- support for local models as first-class evaluation targets

## Why now

This matters now because the MCP ecosystem has reached the point where reliability and observability are becoming the real bottlenecks. The harder problem is no longer only exposing tools over the protocol. It is making sure models can use those tools reliably in real workflows.

Detailed references, related tools, and the comparative landscape are captured in [related-work.md](./related-work.md).
