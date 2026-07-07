// node:sqlite is still marked experimental in Node 24, so it emits a one-time
// ExperimentalWarning ("SQLite is an experimental feature…") the first time the
// module is used. That warning is noise for our users and prints across every
// run mode (dev/tsx, `node backend/dist/server.js`, `mcpscope serve`, Electron).
//
// We can't suppress it via a launcher flag (--disable-warning) because the npm
// `bin` shebang can't portably carry node flags, so we intercept it in-process.
// Importing this module BEFORE node:sqlite (see connection.ts) installs the
// filter ahead of the first DatabaseSync construction that triggers the warning.
//
// Only the SQLite ExperimentalWarning is swallowed — every other warning (including
// other ExperimentalWarnings) passes through untouched.

type EmitWarning = typeof process.emitWarning;

const original: EmitWarning = process.emitWarning.bind(process);

function isSqliteExperimentalWarning(
  warning: string | Error,
  typeOrOptions: unknown,
): boolean {
  const message = typeof warning === "string" ? warning : warning.message;
  if (!/sqlite/i.test(message)) return false;
  const type =
    typeof typeOrOptions === "string"
      ? typeOrOptions
      : typeof typeOrOptions === "object" && typeOrOptions !== null
        ? (typeOrOptions as { type?: string }).type
        : undefined;
  return type === "ExperimentalWarning";
}

process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
  if (isSqliteExperimentalWarning(warning, rest[0])) return;
  (original as (...args: unknown[]) => void)(warning, ...rest);
}) as EmitWarning;
