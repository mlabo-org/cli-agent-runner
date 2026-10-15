#!/usr/bin/env node
// Test stand-in for the shared `text-gate` CLI, following its
// `scan --mode untrusted` contract closely enough for the runner tests:
// invisible characters are removed and counted, tag characters are decoded
// into hidden_text, and a dotted name mixing Cyrillic and Latin letters, or
// carrying an xn-- label, is reported as spoofed.
import { readFileSync } from "node:fs";
import { domainToASCII } from "node:url";

const ALERT_PREFIX = "（偽ドメイン！ / spoofed domain）";
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿︀-️\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

if (process.argv[2] !== "scan" || process.argv[3] !== "--mode" || process.argv[4] !== "untrusted") {
  process.stderr.write("usage: text-gate scan --mode untrusted\n");
  process.exit(2);
}
const input = readFileSync(0, "utf8");
const counts = new Map();
let hidden = "";
for (const match of input.matchAll(INVISIBLE)) {
  const codePoint = match[0].codePointAt(0);
  const key = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  counts.set(key, (counts.get(key) || 0) + 1);
  if (codePoint >= 0xE0020 && codePoint <= 0xE007E) hidden += String.fromCharCode(codePoint - 0xE0000);
}
const text = input.replace(INVISIBLE, "");
const spoofed = [];
for (const [candidate] of text.matchAll(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu)) {
  const cyrillic = /\p{Script=Cyrillic}/u.test(candidate);
  const latin = /\p{Script=Latin}/u.test(candidate);
  if ((cyrillic && latin) || /xn--/i.test(candidate)) {
    spoofed.push({
      input: candidate,
      punycode: domainToASCII(candidate) || candidate,
      skeleton: candidate.replace(/а/g, "a"),
      scripts: cyrillic ? ["Cyrillic", "Latin"] : ["Latin"],
      reason: cyrillic ? "mixed-script" : "punycode",
    });
  }
}
const invisible = [...counts].map(([codepoint, count]) => ({ codepoint, name: "INVISIBLE", count }));
process.stdout.write(JSON.stringify({
  ok: !invisible.length && !spoofed.length,
  text,
  changed: text !== input,
  invisible,
  hidden_text: hidden || null,
  spoofed,
  alert: spoofed.length ? `${ALERT_PREFIX} ${spoofed.map((entry) => entry.input).join(", ")}` : null,
}));
