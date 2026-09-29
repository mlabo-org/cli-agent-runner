import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStreamingProcess } from "../lib/process-runner.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cli-agent-runner.mjs");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

test("timeout stops the worker's whole process group, including a grandchild holding the pipe", async () => {
  const started = Date.now();
  const result = await runStreamingProcess({
    command: "/bin/bash",
    args: ["-c", "sleep 30 & echo $!; wait"],
    cwd: REPO_ROOT,
    timeoutMs: 300,
  });
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.ok(Date.now() - started < 5000, `returned after ${Date.now() - started}ms`);
  const grandchild = Number(result.stdout.trim());
  assert.ok(grandchild > 0);
  assert.equal(await waitUntil(() => !isAlive(grandchild)), true, "grandchild survived the timeout");
});

test("a background process left after a clean worker exit is stopped instead of blocking the run", async () => {
  const started = Date.now();
  const result = await runStreamingProcess({
    command: "/bin/bash",
    args: ["-c", "sleep 30 & echo $!; exit 0"],
    cwd: REPO_ROOT,
    timeoutMs: 20000,
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 0);
  assert.ok(Date.now() - started < 8000, `returned after ${Date.now() - started}ms`);
  const leftover = Number(result.stdout.trim());
  assert.equal(await waitUntil(() => !isAlive(leftover)), true, "leftover background process survived");
});

test("output beyond the cap keeps the tail, marks the truncation, and does not fail the run", async () => {
  const result = await runStreamingProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(5000) + 'FINAL REPORT')"],
    cwd: REPO_ROOT,
    timeoutMs: 10000,
    maxOutputBytes: 1024,
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\[cli-agent-runner: \d+ earlier bytes of stdout truncated\]\n/);
  assert.ok(result.stdout.endsWith("FINAL REPORT"));
});

test("an abort signal stops the worker's process group and reports the interruption", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort("SIGTERM"), 200);
  const result = await runStreamingProcess({
    command: "/bin/bash",
    args: ["-c", "sleep 30 & echo $!; wait"],
    cwd: REPO_ROOT,
    timeoutMs: 20000,
    abortSignal: controller.signal,
  });
  assert.equal(result.error?.code, "EINTERRUPTED");
  const grandchild = Number(result.stdout.trim());
  assert.equal(await waitUntil(() => !isAlive(grandchild)), true);
});

function git(repo, ...args) {
  const result = spawnSync("git", [
    "-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false",
    "-C", repo, ...args,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function makeRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "car-runtime-repo-"));
  git(repo, "init", "-q");
  for (const dir of ["a", "b"]) {
    mkdirSync(path.join(repo, dir));
    writeFileSync(path.join(repo, dir, "keep.txt"), `${dir}\n`);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function intake(repo, taskId, scope) {
  const result = cli([
    "intake", "--target-cwd", repo, "--work-type", "documentation", "--task", "Runtime fixture",
    "--task-id", taskId, "--epoch", "e1", "--scope", scope,
  ]);
  assert.equal(result.status, 0, result.stderr);
}

// A local orchestrator that launches two helpers at once (focus a/ and b/)
// and waits for both; each helper writes one file inside its focus.
const DELEGATING_WORKER = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const prompt = process.argv[1] || "";
const focus = /^focus_scope: scope:v1 paths=(.+)$/m.exec(prompt)?.[1];
if (focus) {
  setTimeout(() => {
    fs.writeFileSync(focus.replace(/\\/$/, "") + "/helper.txt", "helper\\n");
    process.stdout.write("- findings: helper done\\n- blockers: none\\n");
  }, 400);
} else {
  const launch = (id, dir) => new Promise((resolve) => {
    const child = spawn(process.execPath, [process.env.CLI_PATH, "delegate", "--delegate-id", id, "--role", "Helper",
      "--focus-scope", "scope:v1 paths=" + dir + "/", "--assignment", "Write one file", "--expected-output", "done"],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (status) => resolve({ status, out }));
  });
  Promise.all([launch("helper-a", "a"), launch("helper-b", "b")]).then((results) => {
    for (const r of results) if (r.status !== 0) { process.stderr.write(r.out); process.exit(1); }
    process.stdout.write("- findings: integrated two helpers\\n- blockers: none\\n");
  });
}
`;

function delegatingConfig(dir) {
  const configPath = path.join(dir, "runners.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    runners: {
      "delegating-fixture": {
        command: process.execPath,
        args: ["-e", DELEGATING_WORKER, "{prompt}"],
        prompt: "argument",
        result: "stdout",
        stream: "text",
      },
    },
  }));
  return configPath;
}

test("concurrent brokered helpers are guarded by their collective focus set and keep lineage without a console", () => {
  const repo = makeRepo();
  const control = mkdtempSync(path.join(os.tmpdir(), "car-runtime-control-"));
  try {
    const scope = "scope:v1 paths=a/,b/";
    intake(repo, "siblings", scope);
    const run = cli([
      "run", "--target-cwd", repo, "--role", "Integrator", "--task-id", "siblings", "--epoch", "e1",
      "--scope", scope, "--work-type", "documentation", "--delegation-mode", "local_orchestrator",
      "--assignment", "Delegate two helpers", "--expected-output", "done",
      "--runner", "delegating-fixture", "--runner-config", delegatingConfig(control), "--no-live-console",
    ], { CLI_PATH: CLI });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.equal(readFileSync(path.join(repo, "a/helper.txt"), "utf8"), "helper\n");
    assert.equal(readFileSync(path.join(repo, "b/helper.txt"), "utf8"), "helper\n");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    const lineage = [...runner.matchAll(/^- parent_run_id: (.+)$/gm)].map((match) => match[1]);
    assert.ok(lineage.length >= 2, "delegated results record their parent");
    assert.ok(lineage.every((value) => value !== "none"), `parent_run_id: ${lineage.join(", ")}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(control, { recursive: true, force: true });
  }
});

test("orchestrated local orchestrators record their helpers in the real workflow state", () => {
  const repo = makeRepo();
  const control = mkdtempSync(path.join(os.tmpdir(), "car-runtime-control-"));
  try {
    const scope = "scope:v1 paths=a/,b/";
    intake(repo, "orchestrated-helpers", scope);
    const jobsPath = path.join(control, "jobs.json");
    writeFileSync(jobsPath, JSON.stringify({
      version: 1,
      jobs: [{ id: "owner", role: "Owner", ownerScope: scope, assignment: "Delegate", expectedOutput: "done" }],
    }));
    const run = cli([
      "orchestrate", "--target-cwd", repo, "--task-id", "orchestrated-helpers", "--epoch", "e1",
      "--scope", scope, "--work-type", "documentation", "--delegation-mode", "local_orchestrator",
      "--runner", "delegating-fixture", "--runner-config", delegatingConfig(control),
      "--jobs-file", jobsPath, "--no-live-console",
    ], { CLI_PATH: CLI });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.equal(readFileSync(path.join(repo, "b/helper.txt"), "utf8"), "helper\n");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    assert.match(runner, /## Delegated Assignments/);
    assert.match(runner, /## Delegated Runner Results/);
    assert.doesNotMatch(runner, /cli-agent-runner-shadow-/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(control, { recursive: true, force: true });
  }
});

test("SIGTERM during a run stops the worker, records the interruption, and cleans up", async () => {
  const repo = makeRepo();
  const control = mkdtempSync(path.join(os.tmpdir(), "car-runtime-control-"));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "car-runtime-tmp-"));
  const pidFile = path.join(control, "worker.pid");
  try {
    const configPath = path.join(control, "runners.json");
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      runners: {
        "sleepy-fixture": {
          command: "/bin/bash",
          args: ["-c", `echo $$ > ${pidFile}; sleep 30`],
          prompt: "stdin",
          result: "stdout",
          stream: "text",
        },
      },
    }));
    intake(repo, "interrupt", "scope:v1 paths=a/");
    const child = spawn(process.execPath, [CLI,
      "run", "--target-cwd", repo, "--role", "Sleeper", "--task-id", "interrupt", "--epoch", "e1",
      "--scope", "scope:v1 paths=a/", "--work-type", "documentation", "--assignment", "Sleep",
      "--expected-output", "none", "--runner", "sleepy-fixture", "--runner-config", configPath, "--no-live-console",
    ], { env: { ...process.env, TMPDIR: tmp } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = new Promise((resolve) => child.on("close", (status, signal) => resolve({ status, signal })));
    assert.equal(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== ""), true);
    const workerPid = Number(readFileSync(pidFile, "utf8").trim());
    child.kill("SIGTERM");
    const outcome = await closed;
    assert.notEqual(outcome.status, 0, stderr);
    assert.match(stderr, /interrupted by SIGTERM/);
    assert.equal(await waitUntil(() => !isAlive(workerPid)), true, "worker survived SIGTERM");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    assert.match(runner, /- type: process-runner-result/);
    assert.match(runner, /- failure: interrupted by SIGTERM/);
    assert.deepEqual(readdirSync(tmp).filter((name) => name.startsWith("cli-agent-runner-")), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(control, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Parent: launch one helper through `delegate`, then either wait for it
// (PARENT_MODE=wait) or exit as soon as the helper is running (PARENT_MODE=leave).
// Helper: record its pid, then sleep far longer than the test allows.
const HELPER_WORKER = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const prompt = process.argv[1] || "";
if (/^focus_scope: /m.test(prompt)) {
  fs.writeFileSync(process.env.HELPER_PID_FILE, String(process.pid));
  setTimeout(() => process.stdout.write("- blockers: none\\n"), 30000);
} else {
  const child = spawn(process.execPath, [process.env.CLI_PATH, "delegate", "--delegate-id", "slow-helper", "--role", "Helper",
    "--focus-scope", "scope:v1 paths=a/", "--assignment", "Sleep", "--expected-output", "done"],
    { env: process.env, stdio: "ignore" });
  if (process.env.PARENT_MODE === "leave") {
    const poll = setInterval(() => {
      if (fs.existsSync(process.env.HELPER_PID_FILE)) {
        clearInterval(poll);
        process.stdout.write("- blockers: none\\n");
        process.exit(0);
      }
    }, 50);
  } else {
    child.on("close", () => process.stdout.write("- blockers: none\\n"));
  }
}
`;

function helperFixture(control) {
  const configPath = path.join(control, "runners.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    runners: {
      "helper-fixture": {
        command: process.execPath,
        args: ["-e", HELPER_WORKER, "{prompt}"],
        prompt: "argument",
        result: "stdout",
        stream: "text",
      },
    },
  }));
  return configPath;
}

function helperRunArgs(repo, taskId, configPath) {
  return [CLI,
    "run", "--target-cwd", repo, "--role", "Integrator", "--task-id", taskId, "--epoch", "e1",
    "--scope", "scope:v1 paths=a/", "--work-type", "documentation", "--delegation-mode", "local_orchestrator",
    "--assignment", "Delegate one helper", "--expected-output", "done",
    "--runner", "helper-fixture", "--runner-config", configPath, "--timeout-ms", "60000", "--no-live-console",
  ];
}

test("a signal to the runner also stops a running brokered helper and records both results", async () => {
  const repo = makeRepo();
  const control = mkdtempSync(path.join(os.tmpdir(), "car-runtime-control-"));
  const pidFile = path.join(control, "helper.pid");
  try {
    intake(repo, "helper-signal", "scope:v1 paths=a/");
    const child = spawn(process.execPath, helperRunArgs(repo, "helper-signal", helperFixture(control)), {
      env: { ...process.env, CLI_PATH: CLI, HELPER_PID_FILE: pidFile, PARENT_MODE: "wait" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = new Promise((resolve) => child.on("close", (status) => resolve(status)));
    assert.equal(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== ""), true);
    const helperPid = Number(readFileSync(pidFile, "utf8"));
    const signalledAt = Date.now();
    child.kill("SIGTERM");
    assert.notEqual(await closed, 0, stderr);
    assert.ok(Date.now() - signalledAt < 10000, `runner took ${Date.now() - signalledAt}ms to stop`);
    assert.equal(await waitUntil(() => !isAlive(helperPid)), true, "helper survived the signal");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    assert.match(runner, /## Delegated Runner Results/);
    assert.equal([...runner.matchAll(/- failure: interrupted by SIGTERM/g)].length, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(control, { recursive: true, force: true });
  }
});

test("a helper still running when its local orchestrator exits is stopped", () => {
  const repo = makeRepo();
  const control = mkdtempSync(path.join(os.tmpdir(), "car-runtime-control-"));
  const pidFile = path.join(control, "helper.pid");
  try {
    intake(repo, "helper-orphan", "scope:v1 paths=a/");
    const started = Date.now();
    const run = spawnSync(process.execPath, helperRunArgs(repo, "helper-orphan", helperFixture(control)), {
      env: { ...process.env, CLI_PATH: CLI, HELPER_PID_FILE: pidFile, PARENT_MODE: "leave" },
      encoding: "utf8",
    });
    assert.ok(Date.now() - started < 15000, `run took ${Date.now() - started}ms`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(isAlive(Number(readFileSync(pidFile, "utf8"))), false, "helper outlived its parent run");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    assert.match(runner, /- failure: interrupted by parent run ended/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(control, { recursive: true, force: true });
  }
});

test("unknown options are rejected and --option=value passes values that start with --", () => {
  const typo = cli(["run", "--runer", "codex-cli"]);
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /unknown option: --runer/);

  const repo = makeRepo();
  try {
    intake(repo, "equals-value", "scope:v1 paths=a/");
    const assign = cli([
      "assign", "--target-cwd", repo, "--role", "Owner", "--task-id", "equals-value", "--epoch", "e1",
      "--scope", "scope:v1 paths=a/", "--assignment=--fix the flag parser", "--expected-output", "done",
    ]);
    assert.equal(assign.status, 0, assign.stderr);
    assert.match(readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8"), /- assignment: --fix the flag parser/);
    const missing = cli(["assign", "--target-cwd", repo, "--assignment", "--fix"]);
    assert.match(missing.stderr, /missing value for --assignment; use --assignment=<value>/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
