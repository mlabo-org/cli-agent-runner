import "./support/text-gate-env.mjs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startLiveConsole } from "../lib/live-console.mjs";
import { buildRunnerInvocation, loadRunnerRegistry } from "../lib/runner-registry.mjs";
import {
  SPOOFED_DOMAIN_ALERT_PREFIX,
  TEXT_GATE_ENV,
  requiresTextGate,
  resolveTextGatePath,
  sanitizeChildOutput,
} from "../lib/text-gate.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cli-agent-runner.mjs");
const MISSING_GATE = path.join(os.tmpdir(), "cli-agent-runner-no-such-dir", "text-gate");
// Reserved, non-resolvable names only: a Cyrillic "а" look-alike and its punycode.
const SPOOFED_NAME = "аmazon.test";
const SPOOFED_PUNYCODE = "xn--mazon-3ve.test";

test("bundled profiles keep children off the web unless --allow-web is given", () => {
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-web-config-"));
  try {
    const { runners } = loadRunnerRegistry({
      invocationCwd: configHome,
      environment: { ...process.env, XDG_CONFIG_HOME: configHome, CLI_AGENT_RUNNER_CONFIG: "" },
    });
    const values = { prompt: "p", cwd: "/tmp/job", outputFile: "/tmp/out" };
    const expected = {
      "grok-cli": ["--disable-web-search"],
      "codex-cli": ["-c", 'web_search="disabled"'],
      "claude-cli": ["--disallowedTools", "WebFetch", "WebSearch"],
    };
    for (const [runnerId, disableArgs] of Object.entries(expected)) {
      const off = buildRunnerInvocation(runners[runnerId], values);
      assert.equal(off.webAccess, "disabled", runnerId);
      assert.ok(containsRun(off.args, disableArgs), `${runnerId} default args: ${off.args.join(" ")}`);
      const on = buildRunnerInvocation(runners[runnerId], { ...values, allowWeb: true });
      assert.equal(on.webAccess, "allowed", runnerId);
      assert.ok(!containsRun(on.args, disableArgs), `${runnerId} --allow-web args: ${on.args.join(" ")}`);
      assert.equal(on.args.length, off.args.length - disableArgs.length);
    }
    // grok takes the prompt as the value of --single, so the flag must not land between them.
    const grokArgs = buildRunnerInvocation(runners["grok-cli"], values).args;
    assert.equal(grokArgs[grokArgs.indexOf("--single") + 1], "p");
  } finally {
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("a profile whose args lost its webDisableArgs run is rejected", () => {
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-web-config-"));
  try {
    writeFileSync(path.join(configHome, "runners.json"), JSON.stringify({
      version: 1,
      runners: { "grok-cli": { args: ["--single", "{prompt}"] } },
    }));
    assert.throws(() => loadRunnerRegistry({
      invocationCwd: configHome,
      environment: { ...process.env, XDG_CONFIG_HOME: configHome, CLI_AGENT_RUNNER_CONFIG: "runners.json" },
    }), /webDisableArgs must appear in args as one contiguous run/);
  } finally {
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("grok-cli launches with --disable-web-search by default and without it under --allow-web", () => {
  for (const [extraArgs, expectFlag, webAccess] of [[[], true, "disabled"], [["--allow-web"], false, "allowed"]]) {
    const repo = makeTempGitRepo();
    const fakeBin = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-web-grok-"));
    const capturePath = path.join(fakeBin, "args.json");
    try {
      intake(repo);
      const grok = path.join(fakeBin, "grok");
      writeFileSync(grok, `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "result", result: "grok fixture done" }) + "\\n");
`);
      chmodSync(grok, 0o755);
      const result = runCliSync([...runArgs(repo, "grok-cli"), ...extraArgs], {
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        XDG_CONFIG_HOME: fakeBin,
        CLI_AGENT_RUNNER_CONFIG: "",
      });
      assert.equal(result.status, 0, result.stderr);
      const args = JSON.parse(readFileSync(capturePath, "utf8"));
      assert.equal(args.includes("--disable-web-search"), expectFlag);
      assert.match(result.stdout, new RegExp(`ok web_access: ${webAccess}`));
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  }
});

test("--allow-web is rejected without a runner", () => {
  const repo = makeTempGitRepo();
  try {
    intake(repo);
    const withoutRunner = runArgs(repo, "unused").slice(0, -3);
    assert.deepEqual(withoutRunner.slice(-2), ["--expected-output", "fixture result"]);
    const result = runCliSync([...withoutRunner, "--allow-web"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--allow-web requires --runner/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a prompt naming a spoofed domain is not launched and fails with the alert", () => {
  const fixture = makeFixtureRunner('process.stdout.write("should not run")');
  try {
    const result = runCliSync(runArgs(fixture.repo, "fixture", {
      configPath: fixture.configPath,
      assignment: `Summarize the login page at https://${SPOOFED_NAME}/signin`,
    }));
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(SPOOFED_DOMAIN_ALERT_PREFIX), result.stderr);
    assert.ok(result.stderr.includes(SPOOFED_PUNYCODE), result.stderr);
    assert.match(result.stderr, /the child was not launched/);
    assert.match(result.stdout, /ok spawned: false/);
    assert.equal(existsSync(fixture.markerPath), false);
    const runner = readFileSync(path.join(fixture.repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.ok(runner.includes(SPOOFED_PUNYCODE));
  } finally {
    fixture.cleanup();
  }
});

test("a missing text-gate fails closed before launch and names the binary path", () => {
  const fixture = makeFixtureRunner('process.stdout.write("should not run")');
  try {
    const result = runCliSync(runArgs(fixture.repo, "fixture", { configPath: fixture.configPath }), {
      [TEXT_GATE_ENV]: MISSING_GATE,
    });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(MISSING_GATE), result.stderr);
    assert.match(result.stderr, /the child was not launched/);
    assert.equal(existsSync(fixture.markerPath), false);
  } finally {
    fixture.cleanup();
  }
  assert.equal(resolveTextGatePath({}), path.join(os.homedir(), ".local", "bin", "text-gate"));
  assert.throws(() => resolveTextGatePath({ [TEXT_GATE_ENV]: "bin/text-gate" }), /must be an absolute path/);
});

test("invisible characters are stripped from the result and spoofed domains annotated", () => {
  const output = "findings: clean​ up\u{E0049}\u{E0047}\u{E004E} done; see " + SPOOFED_NAME + "\nblockers: none\n";
  const fixture = makeFixtureRunner(`process.stdout.write(${JSON.stringify(output)})`);
  try {
    const result = runCliSync(runArgs(fixture.repo, "fixture", { configPath: fixture.configPath }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(fixture.markerPath), true);
    const summary = /^ok summary: (.*)$/m.exec(result.stdout)?.[1] ?? "";
    assert.ok(summary.includes("clean up done"), summary);
    assert.ok(!/[​\u{E0000}-\u{E007F}]/u.test(summary), "invisible characters removed");
    assert.ok(summary.startsWith(SPOOFED_DOMAIN_ALERT_PREFIX), summary);
    assert.ok(summary.includes(SPOOFED_PUNYCODE), summary);
    const runner = readFileSync(path.join(fixture.repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.ok(!/[​\u{E0000}-\u{E007F}]/u.test(runner));
  } finally {
    fixture.cleanup();
  }
});

test("Live Console events are gated before they reach the viewer", async () => {
  const output = `step one​​ done, see ${SPOOFED_NAME}\n`;
  const fixture = makeFixtureRunner(`process.stdout.write(${JSON.stringify(output)})`);
  const liveConsole = await startLiveConsole({ viewerRoot: path.join(REPO_ROOT, "viewer") });
  try {
    const result = await runCliAsync(runArgs(fixture.repo, "fixture", {
      configPath: fixture.configPath,
      liveConsoleUrl: liveConsole.viewerUrl,
    }));
    assert.equal(result.status, 0, result.stderr);
    const events = liveConsole.snapshot().runs[0].events;
    const output = events.filter((event) => event.type === "runner.output");
    assert.ok(output.length > 0);
    const shown = output.map((event) => event.text).join("");
    assert.ok(!shown.includes("​"), shown);
    assert.ok(shown.includes("step one done"), shown);
    assert.ok(shown.includes(SPOOFED_DOMAIN_ALERT_PREFIX) && shown.includes(SPOOFED_PUNYCODE), shown);
  } finally {
    await liveConsole.close();
    fixture.cleanup();
  }
});

test("only pure ASCII without an xn-- label skips the text-gate spawn", async () => {
  const unavailable = { gatePath: MISSING_GATE };
  assert.equal(requiresTextGate("plain ascii report"), false);
  assert.equal(await sanitizeChildOutput("plain ascii report", unavailable), "plain ascii report");
  for (const text of ["see xn--mazon-3ve.test", "see XN--MAZON-3VE.TEST", "café", "zero​width", "\u{E0041}"]) {
    assert.equal(requiresTextGate(text), true, JSON.stringify(text));
    await assert.rejects(sanitizeChildOutput(text, unavailable), /text-gate failed at .*executable not found/);
  }
});

function containsRun(values, run) {
  return values.some((_, start) => run.every((value, offset) => values[start + offset] === value));
}

function makeFixtureRunner(program) {
  const repo = makeTempGitRepo();
  const controlDir = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-gate-fixture-"));
  const markerPath = path.join(controlDir, "launched");
  const configPath = path.join(controlDir, "runners.json");
  intake(repo);
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    runners: {
      fixture: {
        command: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "1");${program}`, "{prompt}"],
        prompt: "argument",
        result: "stdout",
        stream: "text",
      },
    },
  }));
  return {
    repo,
    markerPath,
    configPath,
    cleanup: () => {
      rmSync(repo, { recursive: true, force: true });
      rmSync(controlDir, { recursive: true, force: true });
    },
  };
}

function runArgs(repo, runnerId, options = {}) {
  return [
    "run",
    "--target-cwd", repo,
    "--work-type", "documentation",
    "--role", "Gate Probe",
    "--task-id", "text-gate",
    "--epoch", "e1",
    "--scope", "README.md",
    "--assignment", options.assignment ?? "Return one fixture result",
    "--expected-output", "fixture result",
    "--runner", runnerId,
    ...(options.configPath ? ["--runner-config", options.configPath] : []),
    ...(options.liveConsoleUrl ? ["--live-console-url", options.liveConsoleUrl] : ["--no-live-console"]),
  ];
}

function makeTempGitRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-gate-"));
  const initialized = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  return repo;
}

function intake(repo) {
  const result = runCliSync([
    "intake",
    "--target-cwd", repo,
    "--work-type", "documentation",
    "--task", "Exercise the text gate",
    "--task-id", "text-gate",
    "--epoch", "e1",
    "--scope", "README.md",
  ]);
  assert.equal(result.status, 0, result.stderr);
}

function runCliSync(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function runCliAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
