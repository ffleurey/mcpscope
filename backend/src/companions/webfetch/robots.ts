// Minimal robots.txt evaluation for the webfetch companion. Parses the standard
// User-agent / Disallow / Allow grammar, selects the group for our product token
// (falling back to `*`), and applies longest-match precedence between Allow and
// Disallow. Missing/unfetchable robots.txt is treated as "allowed" by the caller.

/** The product token webfetch matches against robots.txt User-agent lines. */
export const WEBFETCH_UA_TOKEN = "mcpscope-companion";

interface RobotsGroup {
  allow: string[];
  disallow: string[];
}

function parseRobots(txt: string): Record<string, RobotsGroup> {
  const groups: Record<string, RobotsGroup> = {};
  let pendingAgents: string[] = [];
  let lastWasRule = false;

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after a rule starts a fresh group of agents.
      if (lastWasRule) {
        pendingAgents = [];
        lastWasRule = false;
      }
      const ua = value.toLowerCase();
      groups[ua] ??= { allow: [], disallow: [] };
      pendingAgents.push(ua);
    } else if (field === "disallow" || field === "allow") {
      lastWasRule = true;
      for (const ua of pendingAgents) {
        (field === "allow" ? groups[ua]!.allow : groups[ua]!.disallow).push(value);
      }
    }
  }
  return groups;
}

/**
 * Return whether `path` may be fetched under `robotsTxt` for our user-agent.
 * Empty/malformed robots or no applicable group ⇒ allowed. Longest matching
 * rule wins; an equal-length Allow beats Disallow.
 */
export function isPathAllowed(
  robotsTxt: string,
  path: string,
  uaToken: string = WEBFETCH_UA_TOKEN,
): boolean {
  const groups = parseRobots(robotsTxt);
  const rules = groups[uaToken] ?? groups["*"];
  if (!rules) return true;

  let allowed = true;
  let decisionLen = -1;
  for (const rule of rules.disallow) {
    if (rule && path.startsWith(rule) && rule.length > decisionLen) {
      decisionLen = rule.length;
      allowed = false;
    }
  }
  for (const rule of rules.allow) {
    if (rule && path.startsWith(rule) && rule.length >= decisionLen) {
      decisionLen = rule.length;
      allowed = true;
    }
  }
  return allowed;
}
