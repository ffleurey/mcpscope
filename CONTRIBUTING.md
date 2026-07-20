# Contributing to mcpscope

Thanks for your interest in improving mcpscope! Contributions of all kinds are welcome — bug
reports, docs, and code.

## Getting set up

mcpscope runs from source with Node.js 24+. The full developer guide (run backend + frontend,
build, dev helpers, repo layout) is in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**:

```bash
npm ci
npm run dev        # backend on :3066, frontend on :5173
```

## Before you open a pull request

Run the full check gate — the same one CI runs — and make sure it's green:

```bash
npm run verify     # format check, lint, typecheck (all packages), and tests
```

- **Tests**: how the test strategy works (deterministic replay harness, fixtures, how to add a
  regression) is in **[docs/TESTING.md](docs/TESTING.md)**. Add or update tests for any behavior
  change.
- **Style**: Prettier + ESLint are enforced by `verify`; match the surrounding code.
- **Docs**: user-facing docs live at the repo root (README, TUTORIAL, EXAMPLE, CLI, MCP,
  BENCHMARK, COMPANIONS, CONFIG); internal/contributor docs live under `docs/`. Keep
  them accurate — the CLI/MCP surface is documented in CLI.md and MCP.md and is **parity-tested**,
  so a new operation must be added once to the backend operation catalog (see
  [AGENTS.md](AGENTS.md)) and will surface on both interfaces.

## Architecture & working style

- **[AGENTS.md](AGENTS.md)** — the project shape, the CLI/MCP parity principle, and the working
  conventions (also the guide for AI coding agents).
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**, **[docs/DATA-MODEL.md](docs/DATA-MODEL.md)**,
  **[docs/DATABASE-SCHEMA.md](docs/DATABASE-SCHEMA.md)** — system design, runtime model, schema.

## Branching, commits & pull requests

The workflow, start to finish — **read this before your first commit:**

1. **Always work on a branch off an up-to-date `main`; never commit to `main` directly.** A merged
   branch is deleted, so first sync: `git checkout main && git pull`. Then branch:
   `git checkout -b <type>/<short-topic>` (e.g. `fix/…`, `feat/…`, `docs/…`).
2. **Make small, clean commits** — one logical change each, with a clear message. Keep unrelated
   changes (e.g. a bug fix vs. a doc update) in separate commits.
3. **Push as you go** — push each commit right after you make it; no need to batch or delay.
4. **Run the full gate before opening the PR** (see [Before you open a pull request](#before-you-open-a-pull-request)).
   A formatting or lint failure fails CI, so never open a PR without a green `npm run verify`.
5. **Open one PR to `main`** with a **clear title that reflects the whole PR** and a **compact
   description listing every change**. Reference any related issue. Keep the PR focused.

CI (`.github/workflows/ci.yml`) runs `npm ci` + the same checks as `npm run verify`, plus a
production build (`build:all`); it must pass.

## Reporting bugs & requesting features

Open an issue with steps to reproduce (for bugs: the model/provider, the prompt or benchmark, and
what you inspected). A trace export or the relevant `mcpscope inspect` output helps a lot.

## License

By contributing, you agree that your contributions are licensed under the project's
[Apache License 2.0](LICENSE).
