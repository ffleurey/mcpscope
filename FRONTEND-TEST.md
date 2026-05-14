# Frontend testing with agent-browser

This project can be tested directly in a real browser with [`agent-browser`](https://github.com/vercel-labs/agent-browser), a browser automation CLI from Vercel Labs.

## Recommendation

For this repo, the simplest setup is a **global install** so the tool is available from the terminal without changing this project's dependencies.

## Install

### Recommended: global install

```bash
npm install -g agent-browser
agent-browser install
```

### Linux

If Chrome dependencies are missing on Linux, use:

```bash
agent-browser install --with-deps
```

### Optional: local project install

If you want the version pinned in `package.json` instead:

```bash
npm install agent-browser
agent-browser install
```

## Verify the install

```bash
agent-browser doctor
agent-browser open https://example.com
agent-browser snapshot
agent-browser close
```

Useful maintenance command:

```bash
agent-browser upgrade
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

## Basic workflow

Open the app:

```bash
agent-browser --headed open http://localhost:5173
agent-browser wait --load networkidle
```

Use `--headed` for this project when you want to watch the flow and help during debugging.

Get a navigable accessibility snapshot:

```bash
agent-browser snapshot
```

The snapshot returns refs like `@e1`, `@e2`, etc. Those refs are usually the easiest way to drive the UI:

```bash
agent-browser click @e2
agent-browser fill @e5 "http://localhost:1234/v1"
agent-browser press Enter
```

Take screenshots during debugging:

```bash
agent-browser screenshot
agent-browser screenshot --annotate
```

Close the browser when done:

```bash
agent-browser close --all
```

Do not forget this step after testing. If an old daemon is still running, new launch options such as `--headed` may be ignored until you close existing sessions.

## Commands that are especially useful for this repo

### Inspect visible UI state

```bash
agent-browser snapshot
agent-browser get title
agent-browser get url
agent-browser get text @e1
```

### Wait for async UI changes

```bash
agent-browser wait --load networkidle
agent-browser wait --text "New session"
agent-browser wait "#spinner" --state hidden
agent-browser wait --fn "!document.body.innerText.includes('Loading')"
```

### Check frontend errors

```bash
agent-browser console
agent-browser errors
agent-browser errors --clear
```

### Inspect network activity

```bash
agent-browser network requests
agent-browser network requests --filter /api/
agent-browser network request <requestId>
```

### Save evidence

```bash
agent-browser screenshot ./tmp/frontend-check.png
agent-browser pdf ./tmp/frontend-check.pdf
agent-browser trace start
agent-browser trace stop ./tmp/agent-browser-trace.zip
```

## Good usage pattern for manual bug reproduction

```bash
agent-browser open http://localhost:5173
agent-browser wait --load networkidle
agent-browser snapshot
agent-browser console --clear
agent-browser errors --clear
```

Then reproduce the issue using `click`, `fill`, `press`, `select`, and `snapshot` again as needed.

After reproduction:

```bash
agent-browser console
agent-browser errors
agent-browser network requests --filter /api/
agent-browser screenshot --annotate
```

## Batch mode

For repeatable multi-step checks, `batch` is useful:

```bash
agent-browser batch \
  "open http://localhost:5173" \
  "wait --load networkidle" \
  "snapshot" \
  "screenshot ./tmp/home.png"
```

## Example — full headed session test used in this repo

This is a real example of the sequence used to test `mcpscope` end to end:

1. Open the UI in headed mode.
2. Go to **Model Configs**.
3. Eject the currently loaded model.
4. Load the target model.
5. Go back to **New session**.
6. Select the model and MCP server.
7. Start the session.
8. Ask the question.
9. Close the browser when done.

### Open the app in headed mode

```bash
agent-browser close --all
agent-browser --headed open http://localhost:5173
agent-browser snapshot -i
```

### Eject the currently loaded model and load Gemma

```bash
agent-browser batch --bail \
  "click @e4" \
  "wait 1500" \
  "snapshot -i" \
  "click @e10" \
  "wait 8000" \
  "snapshot -i" \
  "click @e14" \
  "wait 12000" \
  "snapshot -i"
```

In our run:
- `@e4` was **Model Configs**
- `@e10` was **Eject** for Qwen
- `@e14` was **Load** for Gemma

### Create the Gemma + MCP session

```bash
agent-browser batch --bail \
  "click @e1" \
  "wait 1000" \
  "snapshot -i" \
  "focus @e8" \
  "press ArrowDown" \
  "press Enter" \
  "focus @e9" \
  "press ArrowDown" \
  "press Enter" \
  "snapshot -i" \
  "click @e12" \
  "wait 5000" \
  "snapshot -i"
```

In our run:
- `@e1` was **New session**
- `@e8` was the **Model** combobox
- `@e9` was the **MCP server** combobox
- `@e12` was **Start session**

### Ask for the outdoor temperature

```bash
agent-browser batch --bail \
  "fill @e11 What is the outdoor temperature?" \
  "press Control+Enter" \
  "wait 12000" \
  "snapshot" \
  "console" \
  "errors"
```

In our successful run, the response was:

> The outdoor temperature, measured by `sensor.ruuvitag_4730_temperature` in the Jardin area, is currently 8.84°C as of 2026-05-14 22:41.

### Close the browser after the test

```bash
agent-browser close --all
```

## Notes

- `snapshot` is usually better than CSS selectors for agent-driven testing because it exposes stable accessibility refs.
- For interactive debugging in this repo, prefer `--headed`.
- `console`, `errors`, and `network requests` are the most useful commands when debugging regressions in `mcpscope`.
- The tool can also persist browser state with `agent-browser state save` and `agent-browser state load` if we later need authenticated or longer-lived test sessions.

## Upstream documentation

- Repo: <https://github.com/vercel-labs/agent-browser>
- Main README: <https://github.com/vercel-labs/agent-browser/blob/main/README.md>
