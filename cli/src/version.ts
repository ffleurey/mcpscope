import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// cli/{src,dist}/version → package root is two levels up in both layouts.
export function getPackageVersion(): string {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
