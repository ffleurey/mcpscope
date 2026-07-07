import { describe, it, expect } from "vitest";
import { isPathAllowed } from "./robots.js";

const ROBOTS = `
User-agent: *
Disallow: /private
Allow: /private/public

User-agent: mcpscope-companion
Disallow: /no-bots
`;

describe("webfetch robots.txt evaluation", () => {
  it("allows paths not covered by any rule", () => {
    expect(isPathAllowed(ROBOTS, "/articles/1")).toBe(true);
  });

  it("blocks a disallowed prefix for the wildcard group (via fallback)", () => {
    // Our UA has its own group, so the wildcard /private rule does NOT apply.
    expect(isPathAllowed(ROBOTS, "/private/thing", "someotherbot")).toBe(false);
  });

  it("honors a longer Allow over a shorter Disallow", () => {
    expect(isPathAllowed(ROBOTS, "/private/public/x", "someotherbot")).toBe(true);
  });

  it("applies the group matching our user-agent token", () => {
    expect(isPathAllowed(ROBOTS, "/no-bots/x")).toBe(false);
    // The wildcard-only /private rule is not in our group, so it is allowed for us.
    expect(isPathAllowed(ROBOTS, "/private/x")).toBe(true);
  });

  it("treats empty robots as fully allowed", () => {
    expect(isPathAllowed("", "/anything")).toBe(true);
  });

  it("blocks everything under Disallow: /", () => {
    expect(isPathAllowed("User-agent: *\nDisallow: /", "/x")).toBe(false);
  });
});
