# Security policy

## Scope

mcpscope is a **local-first** tool: it runs on your machine, stores data locally (by default
`~/.mcpscope` for `mcpscope serve`; running from source defaults to `backend-data/` in the
checkout), and talks only to the LLM backends and MCP servers you configure. It has no telemetry
and makes no outbound calls except to those configured endpoints.

By default `mcpscope serve` binds to `127.0.0.1`. If you expose it on a network (`--host`), note
that the API and MCP interface are unauthenticated — treat the bound interface as trusted and do
not expose it to untrusted networks. CORS allows only local origins
(`localhost` / `127.0.0.1`, any port) by default, so pages you visit in a browser cannot read or
drive the local API cross-origin; set the `BACKEND_CORS_ORIGIN` environment variable if you need
a different origin.

The bundled companion servers (`webfetch`, `websearch`, etc.) make outbound requests to public
APIs on your behalf; `webfetch` refuses private/loopback addresses (SSRF guard) and honors
robots.txt. See [COMPANIONS.md](COMPANIONS.md).

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** using GitHub's
[private security advisory](https://github.com/ffleurey/mcpscope/security/advisories/new) for this
repository. Do not open a public issue for a security report.

Include: affected version/commit, a description, reproduction steps, and impact. We'll acknowledge
the report and work with you on a fix and coordinated disclosure.

## Supported versions

mcpscope is pre-1.0 and moves fast; security fixes land on the latest release. Please test against
`main` or the newest published version before reporting.
