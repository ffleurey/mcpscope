# Project structure research for the CLI tool

## Question

What project structure best fits a CLI that depends on a locally running `mcpscope` server, lives in the same repository as the backend and frontend, and is not expected to become its own product or repository?

## Conclusion

For `mcpscope`, the CLI should be treated as **part of the same product distribution as the backend**, not as an independently useful standalone package.

The best fit is:

- **one repository**
- **one product distribution**
- **one versioned backend + frontend + CLI bundle**
- CLI code either:
  - as another entrypoint inside the backend package, or
  - as an internal/private in-repo module under `cli/`

The CLI should **not** be designed as a separately published package or future separate repository unless requirements change materially.

## Why this fits mcpscope

Current mcpscope assumptions:

- the CLI depends on a locally running `mcpscope` backend
- the frontend is already part of the same product
- the UI, backend, and CLI all need to share the same persisted session model
- there is no real use case for installing the CLI without the backend

That makes mcpscope closer to tools like **NX** and **Storybook** than to tools where the CLI is a separately installable ecosystem package.

## Structural recommendation

Recommended direction:

1. Keep the CLI **in this repo**
2. Ship it **with the backend**
3. Keep it **version-locked** to the backend/frontend
4. Treat `mcpscope` as an **in-repo CLI entrypoint**, not a separate product

Practical options:

### Option A — same package, extra entrypoint

- put CLI code under something like `backend/src/cli/`
- build it with the backend
- expose a CLI binary from the same package

This is the simplest structure and best reflects that the CLI is part of the same application.

### Option B — internal/private `cli/` module

- keep source under `cli/` for cleaner boundaries
- do **not** publish it independently
- build and distribute it together with the backend

This gives cleaner source separation without implying product separation.

For mcpscope, **Option B** is a good default if we want a clearer code boundary, but the important decision is not `backend/src/cli` vs `cli/`; it is **shared distribution instead of separate packaging**.

## Comparable project patterns

## 1. NX

- **Repo:** https://github.com/nrwl/nx
- **Pattern:** CLI + local server in the **same main package**

Observed structure:

```text
packages/
  nx/
    src/command-line/graph/
    dist/bin/nx.js
    dist/core/graph/
graph/
  client/
  shared/
```

Key points:

- CLI is built into the main `nx` package
- the graph UI is built and copied into the package output
- the command serves both API responses and embedded static assets

Why it matters:

- strong example of **one tool, one package, one distribution**
- very close to mcpscope if the CLI is just another way into the same local product

Relevant source:

- repo root: https://github.com/nrwl/nx
- graph command area: `packages/nx/src/command-line/graph/graph.ts`

## 2. Storybook

- **Repo:** https://github.com/storybookjs/storybook
- **Pattern:** CLI, server, and UI **all in one package**

Observed structure:

```text
code/
  core/
    src/cli/
    src/core-server/
    src/manager/
    dist/bin/dispatcher.js
```

Key points:

- one published `storybook` package
- CLI commands start and orchestrate the local server
- web UI ships as part of the same package

Why it matters:

- a good fit when users conceptually install and run **one product**
- matches mcpscope's likely UX better than separate internal packages exposed to users

Relevant source:

- repo root: https://github.com/storybookjs/storybook
- core package: `code/core/`

## 3. Playwright

- **Repo:** https://github.com/microsoft/playwright
- **Pattern:** main package plus **private internal UI packages**

Observed structure:

```text
packages/
  playwright-core/
  html-reporter/
  trace-viewer/
```

Key points:

- `playwright-core` is the main package
- `html-reporter` and `trace-viewer` are separate source packages but `private: true`
- UI builds are copied into the main package at build time

Why it matters:

- best example of **clean source separation without separate product distribution**
- this is the strongest reference if mcpscope wants `cli/` or other private internal packages while still shipping one integrated tool

Relevant source:

- repo root: https://github.com/microsoft/playwright
- core package: `packages/playwright-core/`
- private UI packages: `packages/html-reporter/`, `packages/trace-viewer/`

## 4. Verdaccio

- **Repo:** https://github.com/verdaccio/verdaccio
- **Pattern:** separate workspace CLI/server packages, but one top-level install experience

Observed structure:

```text
packages/
  cli/
  node-api/
  server/
  web/
  verdaccio/
```

Key points:

- CLI is its own workspace package
- server logic is separate
- users still effectively install one top-level product

Why it matters:

- shows a more modular route
- probably heavier than mcpscope needs unless we want independently testable internal packages from day one

Relevant source:

- repo root: https://github.com/verdaccio/verdaccio
- CLI package: `packages/cli/`

## 5. Vitest UI

- **Repo:** https://github.com/vitest-dev/vitest
- **Pattern:** CLI package plus separate UI package

Observed structure:

```text
packages/
  vitest/
  ui/
```

Key points:

- main CLI and UI are separate packages
- UI package contains both node-side integration and built client assets
- useful example of dual build outputs in a TypeScript/Vite codebase

Why it matters:

- good technical reference for build layout
- less relevant as a product model if mcpscope CLI will always be installed with the backend

Relevant source:

- repo root: https://github.com/vitest-dev/vitest
- CLI package: `packages/vitest/`
- UI package: `packages/ui/`

## Pattern comparison

| Project | CLI in same repo | Separate package | Best lesson for mcpscope |
|---|---|---:|---|
| NX | Yes | No | Keep CLI and local server in the same package/distribution |
| Storybook | Yes | No | One product can expose CLI, server, and UI from one package |
| Playwright | Yes | Internal private packages | Use private internal packages when source separation is useful |
| Verdaccio | Yes | Yes | Separate packages are possible, but often unnecessary overhead |
| Vitest | Yes | Yes | Good build/layout reference, weaker product match |

## What this means for mcpscope

The earlier wording of the CLI as a **"standalone CLI client"** is misleading if the actual intended usage is:

- backend runs locally
- CLI talks to that local backend
- CLI is installed and versioned with mcpscope itself

More accurate wording:

> `mcpscope` is an in-repo CLI entrypoint for mcpscope, installed and versioned with the backend, and intended to talk to a locally running mcpscope server.

That still allows a distinct executable name and clear command UX, but it avoids implying:

- a separate npm package
- a separate release/distribution story
- a future separate repository

## Packaging recommendation for the current repo

If we want the simplest implementation:

- keep the existing top-level package
- add CLI source under `cli/` or `backend/src/cli/`
- build it as part of the normal repository build
- expose a binary through the same distribution

If we want a little more structure:

- use `cli/` as an internal package/module
- keep it private
- build and ship it with the backend

Either is valid. The important architectural decision is:

- **shared distribution**
- **shared versioning**
- **shared repository**
- **no separate product boundary**

## Secondary technical lessons

Even though product structure is the main question, the comparison also surfaced a few implementation patterns worth remembering:

### Embedded frontend assets

Common pattern:

- build frontend separately
- copy/embed assets into the backend or main package output
- serve them from the local server

Useful references:

- NX embedded graph UI
- Playwright embedded report/trace viewer

### Runtime config injection

Common pattern:

- inject small runtime values into `index.html`, or
- serve an `environment.js` file that sets `window.*`

Useful references:

- Vitest injects config into `index.html`
- NX serves `environment.js`

### Thin CLI layer

Best practice:

- CLI parses args and orchestrates startup
- business logic stays in backend/server modules

Useful reference:

- Verdaccio CLI delegates to server startup rather than owning business logic

## Recommendation summary

For mcpscope:

1. **Do not** plan around a separate CLI repo
2. **Do not** optimize for a separately installable CLI package
3. Treat the CLI as part of the same product as the backend and frontend
4. Prefer either:
   - same-package CLI entrypoint, or
   - private/internal `cli/` package shipped with the backend
5. Update CLI task wording to reflect this explicitly

## Sources

- NX — https://github.com/nrwl/nx
- Storybook — https://github.com/storybookjs/storybook
- Playwright — https://github.com/microsoft/playwright
- Verdaccio — https://github.com/verdaccio/verdaccio
- Vitest — https://github.com/vitest-dev/vitest