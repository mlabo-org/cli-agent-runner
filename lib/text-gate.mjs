import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

// Every prompt sent to a child and every piece of child output shown to the
// caller or the Live Console passes through the shared `text-gate` CLI.  It
// removes invisible characters (tag characters, bidi controls, zero-width
// characters, variation-selector payloads) and reports spoofed domains.
// Without a working gate nothing is launched or shown: the gate fails closed.
export const TEXT_GATE_ENV = "CLI_AGENT_RUNNER_TEXT_GATE";
export const SPOOFED_DOMAIN_ALERT_PREFIX = "（偽ドメイン！ / spoofed domain）";

const DEFAULT_GATE_TIMEOUT_MS = 30000;
const MAX_GATE_OUTPUT_BYTES = 64 * 1024 * 1024;
const NON_ASCII = /[^\x00-\x7F]/;
const PUNYCODE_LABEL = /xn--/i;

export class TextGateError extends Error {
  constructor(message) {
    super(message);
    this.code = "ETEXTGATE";
  }
}

export function resolveTextGatePath(environment = process.env) {
  const override = environment[TEXT_GATE_ENV]?.trim();
  if (!override) return path.join(os.homedir(), ".local", "bin", "text-gate");
  if (!path.isAbsolute(override)) throw new TextGateError(`${TEXT_GATE_ENV} must be an absolute path: ${override}`);
  return override;
}

// Pure ASCII without a punycode label can hold neither an invisible
// character nor a spoofed domain, so it skips the process spawn.
export function requiresTextGate(text) {
  const value = String(text ?? "");
  return NON_ASCII.test(value) || PUNYCODE_LABEL.test(value);
}

/**
 * Runs `text-gate scan --mode untrusted` on `text` and returns the validated
 * report.  Any spawn failure, nonzero exit, timeout, or malformed report
 * throws TextGateError naming the binary path.
 */
export function scanUntrustedText(text, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let gatePath;
    try {
      gatePath = options.gatePath ?? resolveTextGatePath(options.environment);
    } catch (error) {
      reject(error);
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let settled = false;
    let timer = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new TextGateError(`text-gate failed at ${gatePath}: ${error}`));
      else resolve(value);
    };
    let child;
    try {
      child = spawn(gatePath, ["scan", "--mode", "untrusted"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      finish(error.code === "ENOENT" ? "executable not found" : error.message);
      return;
    }
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(`timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    timer.unref();
    child.on("error", (error) => finish(error.code === "ENOENT" ? "executable not found" : error.message));
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GATE_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(`report exceeded ${MAX_GATE_OUTPUT_BYTES} bytes`);
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (status, signal) => {
      if (settled) return;
      if (status !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 300);
        finish(`exit ${status ?? signal}${detail ? ` (${detail})` : ""}`);
        return;
      }
      try {
        finish(null, parseReport(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        finish(error.message);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(String(text ?? ""), "utf8");
  });
}

/**
 * Sanitizes child output for display.  Pure ASCII without `xn--` is
 * returned unchanged without spawning.  Invisible characters are removed;
 * spoofed domains are kept but annotated with the alert and punycode.
 */
export async function sanitizeChildOutput(text, options = {}) {
  const value = String(text ?? "");
  if (!requiresTextGate(value)) return value;
  const report = await scanUntrustedText(value, options);
  return annotateReport(report);
}

export function annotateReport(report) {
  let text = report.text;
  const notes = [];
  if (report.spoofed.length) {
    for (const entry of report.spoofed) {
      if (entry.input) text = text.split(entry.input).join(`${entry.input} [${SPOOFED_DOMAIN_ALERT_PREFIX} ${entry.punycode}]`);
    }
    notes.push(spoofedAlertLine(report));
  }
  if (report.invisible.length) {
    const removed = report.invisible.map((item) => `${item.codepoint}x${item.count}`).join(", ");
    notes.push(`[text-gate: removed invisible characters ${removed}]`);
  }
  return notes.length ? `${notes.join("\n")}\n${text}` : text;
}

export function spoofedAlertLine(report) {
  const alert = typeof report.alert === "string" && report.alert.trim()
    ? report.alert.trim()
    : SPOOFED_DOMAIN_ALERT_PREFIX;
  // text-gate's alert normally names each punycode already; add only the missing ones.
  const missing = report.spoofed
    .filter((entry) => !alert.includes(entry.punycode))
    .map((entry) => `${entry.input} = ${entry.punycode}`);
  return missing.length ? `${alert} [${missing.join(", ")}]` : alert;
}

function parseReport(output) {
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    throw new Error("report is not valid JSON");
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("report is not an object");
  if (typeof report.ok !== "boolean") throw new Error("report.ok is not a boolean");
  if (typeof report.text !== "string") throw new Error("report.text is not a string");
  if (!Array.isArray(report.invisible)) throw new Error("report.invisible is not an array");
  if (!Array.isArray(report.spoofed)) throw new Error("report.spoofed is not an array");
  for (const entry of report.spoofed) {
    if (!entry || typeof entry.input !== "string" || typeof entry.punycode !== "string") {
      throw new Error("report.spoofed entries need string input and punycode");
    }
  }
  for (const entry of report.invisible) {
    if (!entry || typeof entry.codepoint !== "string") throw new Error("report.invisible entries need a codepoint");
  }
  if (report.alert !== null && report.alert !== undefined && typeof report.alert !== "string") {
    throw new Error("report.alert is not a string or null");
  }
  // A report claiming ok while listing findings is inconsistent; refuse it.
  if (report.ok && (report.spoofed.length || report.invisible.length)) throw new Error("report.ok contradicts its findings");
  return report;
}
