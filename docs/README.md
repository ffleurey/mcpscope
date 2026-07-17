# Internal documentation

Contributor- and maintainer-facing docs for mcpscope. User-facing guides
([README](../README.md), [TUTORIAL](../TUTORIAL.md), [CLI](../CLI.md),
[MCP](../MCP.md), [BENCHMARK](../BENCHMARK.md), [EMBEDDING](../EMBEDDING.md)) stay
at the repository root; [AGENTS.md](../AGENTS.md) (the coding-agent guide) also stays at the root by
convention.

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, persistence, streaming, replay, and API surface
- [PROVIDERS.md](PROVIDERS.md) — provider internals (LM Studio, Ollama, OpenRouter): reasoning tokens, token counting, context windows, model loading/unloading
- [DATA-MODEL.md](DATA-MODEL.md) — canonical runtime tree, part taxonomy, and the hierarchical ID scheme
- [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) — SQLite tables, foreign keys, and ER diagram
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — frontend design system: the tokens, primitives, and patterns that keep the GUI consistent
- [DEVELOPMENT.md](DEVELOPMENT.md) — run from source, build, and dev helpers
- [TESTING.md](TESTING.md) — test strategy, the replay harness, and how to add regressions
- [FRONTEND-TEST.md](FRONTEND-TEST.md) — manual frontend smoke checklist
- [RELEASING.md](RELEASING.md) — release workflow and artifact publishing
