# Frontend testing with agent-browser

This project can be tested directly in a real browser with [`agent-browser`](https://github.com/vercel-labs/agent-browser), a browser automation CLI from Vercel Labs.

This is a lightweight helper for manual UI checks. It is **not** part of the main regression strategy in [TESTING.md](TESTING.md).

## Install

```bash
npm install -g agent-browser
agent-browser install
```

If Chrome dependencies are missing on Linux, use:

```bash
agent-browser install --with-deps
```

## Quick sanity check

```bash
agent-browser doctor
agent-browser open https://example.com
agent-browser snapshot
agent-browser close
```

## Running mcpscope for browser testing

Start the app:

```bash
npm run dev
```

This starts the frontend and backend together. The frontend is normally available at:

```text
http://localhost:5173
```

## Recommended workflow

Open the app:

```bash
agent-browser --headed open http://localhost:5173
agent-browser wait --load networkidle
```

Use `--headed` for this project when you want to watch the flow and help during debugging.

Get an accessibility snapshot and drive the UI through snapshot refs:

```bash
agent-browser snapshot
agent-browser click @e2
agent-browser fill @e5 "http://localhost:1234/v1"
agent-browser press Enter
```

Do not treat `@e*` refs as stable across runs. Refresh the snapshot after meaningful UI changes.

Useful diagnostics:

```bash
agent-browser get title
agent-browser get url
agent-browser console
agent-browser errors
agent-browser network requests --filter /api/
agent-browser screenshot
agent-browser screenshot --annotate
```

Close the browser when done:

```bash
agent-browser close --all
```

Do not forget this step after testing. If an old daemon is still running, new launch options such as `--headed` may be ignored until you close existing sessions.

## Common waits

```bash
agent-browser wait --load networkidle
agent-browser wait --text "New session"
agent-browser wait "#spinner" --state hidden
agent-browser wait --fn "!document.body.innerText.includes('Loading')"
```

## Saving evidence

```bash
agent-browser screenshot ./tmp/frontend-check.png
agent-browser pdf ./tmp/frontend-check.pdf
agent-browser trace start
agent-browser trace stop ./tmp/agent-browser-trace.zip
```

## Good usage pattern for a manual repro

```bash
agent-browser open http://localhost:5173
agent-browser wait --load networkidle
agent-browser snapshot
agent-browser console --clear
agent-browser errors --clear
```

Then reproduce the issue using `click`, `fill`, `press`, `select`, and `snapshot` as needed.

After reproduction:

```bash
agent-browser console
agent-browser errors
agent-browser network requests --filter /api/
agent-browser screenshot --annotate
```

## Batch mode

For repeatable multi-step checks:

```bash
agent-browser batch \
  "open http://localhost:5173" \
  "wait --load networkidle" \
  "snapshot" \
  "screenshot ./tmp/home.png"
```

## Scope of this document

Use this file for:

- quick local UI smoke checks
- manual bug reproduction
- collecting browser evidence during debugging

Do not use it as an implementation spec for the product UI. The authoritative product and runtime docs are [DATA-MODEL.md](DATA-MODEL.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [TESTING.md](TESTING.md).

## Notes

- `snapshot` is usually better than CSS selectors for agent-driven testing because it exposes stable accessibility refs.
- For interactive debugging in this repo, prefer `--headed`.
- `console`, `errors`, and `network requests` are the most useful commands when debugging regressions in `mcpscope`.
- The tool can also persist browser state with `agent-browser state save` and `agent-browser state load` if authenticated or longer-lived test sessions are needed later.

## Upstream documentation

- Repo: <https://github.com/vercel-labs/agent-browser>
- Main README: <https://github.com/vercel-labs/agent-browser/blob/main/README.md>
