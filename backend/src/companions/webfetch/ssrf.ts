// SSRF guard for the webfetch companion. Before any outbound request we assert
// the target is a public http(s) URL: no internal hostnames, and neither the
// literal address nor any DNS-resolved address falls in a private/reserved range.
// Ranges are matched conservatively — when unsure we block.

import { lookup as dnsLookup } from "node:dns/promises";
import { CompanionError } from "../shared/http.js";

/** Resolver seam so tests can classify without real DNS. Returns candidate IPs. */
export type LookupFn = (host: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true });

/** True if an IPv4 dotted-quad is private, loopback, link-local, or reserved. */
function ipv4Blocked(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed — refuse
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 documentation
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * Expand an IPv6 literal into its 8 16-bit groups, or null if malformed. A
 * dotted-quad tail (`::ffff:127.0.0.1`) is folded into the last two groups, so
 * both the dotted and the hex-normalized form (`::ffff:7f00:1` — what the
 * WHATWG URL parser produces) expand identically.
 */
function expandIpv6(ip: string): [number, number, number, number, number, number, number, number] | null {
  let s = ip;
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const parts = dotted[2].split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    const [a, b, c, d] = parts as [number, number, number, number];
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : head.length !== 8) return null;
  const groupStrs = halves.length === 2 ? [...head, ...Array<string>(missing).fill("0"), ...tail] : head;
  const groups: number[] = [];
  for (const g of groupStrs) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  return groups as [number, number, number, number, number, number, number, number];
}

/** True if an IPv6 address is loopback, unspecified, ULA, link-local, or embeds a blocked v4. */
function ipv6Blocked(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0] ?? ""; // drop any zone id
  const groups = expandIpv6(s);
  if (!groups) return true; // malformed — refuse
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0) {
    return true; // :: (unspecified) and ::1 (loopback)
  }
  // v4-embedded prefixes — IPv4-mapped ::ffff:0:0/96 and NAT64 64:ff9b::/96 —
  // classify by the embedded IPv4 address.
  const isMapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff;
  const isNat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (isMapped || isNat64) {
    return ipv4Blocked(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** Classify a bare IP literal (v4 or v6) as blocked or allowed. */
export function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? ipv6Blocked(ip) : ipv4Blocked(ip);
}

/** If `host` is an IP literal, return it (brackets stripped); otherwise null. */
function asIpLiteral(host: string): string | null {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  if (h.includes(":")) return h; // IPv6 literal
  return null;
}

/**
 * Throw {@link CompanionError} unless `rawUrl` is a public http(s) URL. Validates
 * the scheme, rejects internal hostnames, and blocks private/reserved addresses —
 * for a hostname, every resolved IP must be public. This is a best-effort defense
 * against DNS rebinding: the fetch that follows re-resolves the hostname
 * independently (nothing pins the connection to the checked IPs), so a
 * time-of-use DNS flip is not fully prevented; static private records are.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CompanionError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CompanionError(
      `Only http(s) URLs are allowed (got '${url.protocol}').`,
    );
  }
  const host = url.hostname;
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    throw new CompanionError(`Refusing to fetch internal host '${host}'.`);
  }

  const literal = asIpLiteral(host);
  if (literal) {
    if (isBlockedIp(literal)) {
      throw new CompanionError(
        `Refusing to fetch private/reserved address '${host}'.`,
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host);
  } catch {
    throw new CompanionError(`Could not resolve host '${host}'.`);
  }
  if (addresses.length === 0) {
    throw new CompanionError(`Could not resolve host '${host}'.`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new CompanionError(
        `Host '${host}' resolves to a private/reserved address; refusing.`,
      );
    }
  }
}
