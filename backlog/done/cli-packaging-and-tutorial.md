# CLI packaging and tutorial

This task packaged the shipped CLI lifecycle MVP so it can be used without cloning the repository or installing Node.js on the host.

## Delivered

### Docker packaging

- the production Docker image now builds the CLI
- the production image now includes `cli/dist`
- the image exposes an in-container `mcpscope` executable
- the packaged CLI defaults to `http://127.0.0.1:3030` for the common `docker exec` workflow

### Packaged workflow

- the primary packaged setup is now:
  - `docker build`
  - `docker run`
  - `docker exec ... mcpscope`
- the one-container workflow is now the documented default for the developer + coding-agent loop
- quick evaluation without a Docker volume is documented
- persistent local use with `-v mcpscope-data:/data` is also documented

### Documentation

- added [TUTORIAL.md](../../TUTORIAL.md) as the main developer + coding-agent walkthrough
- updated [README.md](../../README.md) to present Docker as the main packaged path
- updated [CLI.md](../../CLI.md) to document the in-container CLI usage
- updated [RELEASING.md](../../RELEASING.md) so released-image usage includes the packaged CLI path
- updated [PLAN.md](../../PLAN.md) to reflect the completed Docker CLI packaging work

## Important decisions

- the CLI ships in the **same application container** as the backend and Web UI
- no separate CLI container was introduced
- plain `docker run` is the primary quick-start path
- data persistence is optional for a first testing round
- `docker compose` remains available only as a convenience path

## Validation

- built the Docker image successfully
- started a container from the packaged image
- verified the backend came up inside the container
- verified the in-container `mcpscope` command worked for:
  - `mcpscope --help`
  - `mcpscope list`

## Follow-up

The next CLI task remains:

- [../cli-next-iteration.md](../cli-next-iteration.md)

That follow-up should focus on:

- better follow/help UX
- richer lifecycle control
- later streaming / cancellation / discovery work as separate increments
