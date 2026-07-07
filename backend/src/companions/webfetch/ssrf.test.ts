import { describe, it, expect } from "vitest";
import { isBlockedIp, assertUrlAllowed, type LookupFn } from "./ssrf.js";

describe("webfetch SSRF guard", () => {
  it("classifies private/reserved IPs as blocked", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback, dotted form
      "::ffff:7f00:1", // IPv4-mapped loopback, hex form (what `new URL()` produces)
      "::ffff:a9fe:a9fe", // IPv4-mapped 169.254.169.254 (cloud metadata), hex form
      "::ffff:a00:5", // IPv4-mapped 10.0.0.5, hex form
      "64:ff9b::7f00:1", // NAT64-embedded loopback
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("classifies public IPs as allowed", () => {
    for (const ip of [
      "8.8.8.8",
      "93.184.216.34",
      "1.1.1.1",
      "2606:4700::1111",
      "::ffff:808:808", // IPv4-mapped 8.8.8.8 — public, allowed
    ]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("blocks bracketed IPv4-mapped literals as the URL parser normalizes them", async () => {
    // `new URL()` rewrites [::ffff:127.0.0.1] to the hex form [::ffff:7f00:1];
    // the guard must block the form it actually receives.
    for (const url of [
      "http://[::ffff:127.0.0.1]/x",
      "http://[::ffff:169.254.169.254]/x",
      "http://[::ffff:10.0.0.5]/x",
      "http://[64:ff9b::a9fe:a9fe]/x",
    ]) {
      await expect(assertUrlAllowed(url), url).rejects.toThrow(/private\/reserved/);
    }
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertUrlAllowed("file:///etc/passwd")).rejects.toThrow(
      /Only http/,
    );
    await expect(assertUrlAllowed("ftp://example.com")).rejects.toThrow(/Only http/);
  });

  it("rejects internal hostnames without a DNS lookup", async () => {
    const never: LookupFn = () => {
      throw new Error("should not resolve");
    };
    await expect(assertUrlAllowed("http://localhost/x", never)).rejects.toThrow(
      /internal host/,
    );
    await expect(
      assertUrlAllowed("http://db.internal/x", never),
    ).rejects.toThrow(/internal host/);
  });

  it("rejects IP-literal private targets", async () => {
    await expect(assertUrlAllowed("http://127.0.0.1:8080/x")).rejects.toThrow(
      /private\/reserved/,
    );
    await expect(assertUrlAllowed("http://[::1]/x")).rejects.toThrow(
      /private\/reserved/,
    );
  });

  it("blocks a hostname that resolves to a private address (rebinding)", async () => {
    const evil: LookupFn = async () => [{ address: "10.1.2.3" }];
    await expect(assertUrlAllowed("http://evil.example/x", evil)).rejects.toThrow(
      /private\/reserved address/,
    );
  });

  it("allows a hostname that resolves to a public address", async () => {
    const good: LookupFn = async () => [{ address: "93.184.216.34" }];
    await expect(
      assertUrlAllowed("https://example.com/x", good),
    ).resolves.toBeUndefined();
  });
});
