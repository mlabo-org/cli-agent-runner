import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveLiveConsoleIngestUrl } from "../lib/live-console-client.mjs";
import { startLiveConsole } from "../lib/live-console.mjs";
import { runStreamingProcess } from "../lib/process-runner.mjs";
import { createRunnerStreamAdapter } from "../lib/runner-stream.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cli-agent-runner.mjs");

test("messages-json adapter exposes structured activity and reconstructs the assistant result", () => {
  const events = [];
  const adapter = createRunnerStreamAdapter({
    format: "messages-json",
    onEvent: (event) => events.push(event),
  });
  adapter.write("stdout", Buffer.from('{"type":"message_start","message":{"content":[]}}\n'));
  adapter.write("stdout", Buffer.from('{"type":"content_block_delta","delta":{"type":"text_delta","text":"visible "}}\n'));
  adapter.write("stdout", Buffer.from('{"type":"content_block_delta","delta":{"type":"text_delta","text":"progress"}}\n'));
  adapter.end("stdout");
  adapter.end("stderr");

  assert.equal(adapter.resultText(), "visible progress");
  assert.deepEqual(events.map((event) => event.type), ["runner.message", "runner.message", "runner.message"]);
  assert.equal(events.at(-1).text, "progress");
});

test("streaming process delivers chunks before close and preserves timeout failure", async () => {
  const observed = [];
  let closed = false;
  const running = runStreamingProcess({
    command: process.execPath,
    args: ["-e", 'process.stdout.write("first"); setTimeout(() => process.stdout.write("second"), 80)'],
    cwd: REPO_ROOT,
    timeoutMs: 1000,
    onChunk: (_stream, chunk) => observed.push(chunk.toString("utf8")),
  }).then((result) => {
    closed = true;
    return result;
  });
  await waitFor(() => observed.includes("first"));
  assert.equal(closed, false);
  const completed = await running;
  assert.equal(completed.status, 0);
  assert.equal(completed.stdout, "firstsecond");

  const timedOut = await runStreamingProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 5000)"],
    cwd: REPO_ROOT,
    timeoutMs: 25,
  });
  assert.equal(timedOut.error.code, "ETIMEDOUT");
});

test("CLI streams a Grok-shaped messages fixture into the built-in Live Console before process exit", async () => {
  const repo = makeTempGitRepo();
  const configPath = path.join(repo, "runners.json");
  const liveConsole = await startLiveConsole({ viewerRoot: path.join(REPO_ROOT, "viewer") });
  try {
    intake(repo);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      runners: {
        "grok-fixture": {
          command: process.execPath,
          args: ["-e", fixtureProgram(), "{prompt}"],
          prompt: "argument",
          result: "stdout",
          stream: "messages-json",
        },
      },
    }, null, 2));

    const execution = runCli([
      "run",
      "--target-cwd", repo,
      "--role", "Implementer",
      "--task-id", "live-fixture",
      "--epoch", "e1",
      "--scope", "scope:v1 all",
      "--work-type", "documentation",
      "--assignment", "Emit a deterministic Grok-shaped stream",
      "--expected-output", "Visible progress and a completed result",
      "--runner", "grok-fixture",
      "--runner-config", configPath,
      "--live-console-url", liveConsole.viewerUrl,
    ]);

    await waitFor(() => {
      const run = liveConsole.snapshot().runs[0];
      return run?.status === "running" && run.events.some((event) => event.type === "runner.message");
    });
    const inFlight = liveConsole.snapshot().runs[0];
    assert.equal(inFlight.status, "running");
    assert.equal(inFlight.events[0].type, "run.started");

    const completed = await execution;
    assert.equal(completed.status, 0, completed.stderr);
    const run = liveConsole.snapshot().runs[0];
    assert.equal(run.status, "completed");
    assert.equal(run.events.at(-1).type, "run.completed");
    assert.deepEqual(run.events.map((event) => event.sequence), run.events.map((_, index) => index + 1));
    assert.ok(run.events.some((event) => event.text === "visible "));
    assert.match(readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8"), /summary: visible progress/);
    assert.match(completed.stdout, /live_console_status: connected/);
  } finally {
    await liveConsole.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test("orchestrate gives parallel jobs distinct Live Console run IDs and event streams", async () => {
  const repo = makeTempGitRepo();
  const controlDir = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-live-orchestrate-"));
  const configPath = path.join(controlDir, "runners.json");
  const jobsPath = path.join(controlDir, "jobs.json");
  const liveConsole = await startLiveConsole({ viewerRoot: path.join(REPO_ROOT, "viewer") });
  try {
    intake(repo);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      runners: {
        "parallel-live-fixture": {
          command: process.execPath,
          args: ["-e", fixtureProgram(), "{prompt}"],
          prompt: "argument",
          result: "stdout",
          stream: "messages-json",
        },
      },
    }, null, 2));
    writeFileSync(jobsPath, JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "alpha-live",
          role: "Implementer",
          ownerScope: "alpha/",
          assignment: "Emit alpha activity",
          expectedOutput: "Alpha Live Console result",
        },
        {
          id: "beta-live",
          role: "Test Runner",
          ownerScope: "beta/",
          assignment: "Emit beta activity",
          expectedOutput: "Beta Live Console result",
        },
      ],
    }, null, 2));

    const execution = runCli([
      "orchestrate",
      "--target-cwd", repo,
      "--task-id", "live-fixture",
      "--epoch", "e1",
      "--scope", "scope:v1 all",
      "--work-type", "documentation",
      "--runner", "parallel-live-fixture",
      "--runner-config", configPath,
      "--jobs-file", jobsPath,
      "--live-console-url", liveConsole.viewerUrl,
    ]);

    await waitFor(() => {
      const runs = liveConsole.snapshot().runs;
      return runs.length === 2 && runs.every((run) => run.events.some((event) => event.type === "runner.message"));
    });
    const inFlightRuns = liveConsole.snapshot().runs;
    assert.equal(new Set(inFlightRuns.map((run) => run.runId)).size, 2);
    assert.ok(inFlightRuns.some((run) => run.runId.includes(":alpha-live:")));
    assert.ok(inFlightRuns.some((run) => run.runId.includes(":beta-live:")));

    const completed = await execution;
    assert.equal(completed.status, 0, completed.stderr);
    const completedRuns = liveConsole.snapshot().runs;
    assert.equal(completedRuns.length, 2);
    for (const run of completedRuns) {
      assert.equal(run.status, "completed");
      assert.equal(run.events[0].type, "run.started");
      assert.equal(run.events.at(-1).type, "run.completed");
    }
  } finally {
    await liveConsole.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(controlDir, { recursive: true, force: true });
  }
});

test("local_orchestrator delegates through the runner broker and exposes child lineage", async () => {
  const repo = makeTempGitRepo();
  const configPath = path.join(repo, "runners.json");
  const liveConsole = await startLiveConsole({ viewerRoot: path.join(REPO_ROOT, "viewer") });
  try {
    intake(repo);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      runners: {
        "delegation-fixture": {
          command: process.execPath,
          args: ["-e", delegationFixtureProgram(), "{prompt}"],
          prompt: "argument",
          result: "stdout",
          stream: "text",
        },
      },
    }, null, 2));

    const completed = await runCli([
      "run",
      "--target-cwd", repo,
      "--role", "Implementer",
      "--task-id", "live-fixture",
      "--epoch", "e1",
      "--scope", "scope:v1 all",
      "--work-type", "documentation",
      "--delegation-mode", "local_orchestrator",
      "--assignment", "Delegate one bounded internal helper and integrate its result",
      "--expected-output", "One parent result with one delegated child",
      "--runner", "delegation-fixture",
      "--runner-config", configPath,
      "--live-console-url", liveConsole.viewerUrl,
    ]);

    assert.equal(completed.status, 0, completed.stderr);
    const runs = liveConsole.snapshot().runs;
    assert.equal(runs.length, 2);
    const parent = runs.find((run) => run.parentRunId === null);
    const child = runs.find((run) => run.parentRunId !== null);
    assert.ok(parent);
    assert.ok(child);
    assert.equal(child.parentRunId, parent.runId);
    assert.equal(child.depth, 1);
    assert.equal(child.delegationMode, "leaf");
    assert.equal(child.focusScope, "scope:v1 paths=README.md");
    assert.equal(child.events[0].type, "delegation.started");
    assert.equal(child.events.at(-1).type, "delegation.completed");

    const runner = readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.equal([...runner.matchAll(/- type: assignment/g)].length, 2);
    assert.equal([...runner.matchAll(/- type: process-runner-result/g)].length, 2);
    assert.match(runner, /- delegation_mode: local_orchestrator/);
    assert.match(runner, /- delegation_mode: leaf/);
    assert.match(runner, /- task_scope: scope:v1 all/);
    assert.match(runner, /- scope: scope:v1 paths=README\.md/);
    assert.match(runner, /- focus_scope: scope:v1 paths=README\.md/);
    assert.match(runner, new RegExp(`- parent_run_id: ${escapeRegExp(parent.runId)}`));
    assert.match(completed.stdout, /live_console_status: connected/);
  } finally {
    await liveConsole.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test("delegate fails closed outside a runner-owned local orchestrator", async () => {
  const result = await runCli([
    "delegate",
    "--delegate-id", "unowned-child",
    "--role", "Test Runner",
    "--focus-scope", "scope:v1 all",
    "--assignment", "Must not launch",
    "--expected-output", "No result",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /available only inside a runner-owned local_orchestrator process/);
});

test("run owns Live Console by default and only explicit OFF flags disable it", async () => {
  const repo = makeTempGitRepo();
  const configPath = path.join(repo, "runners.json");
  let execution;
  try {
    intake(repo);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      runners: {
        "grok-fixture": {
          command: process.execPath,
          args: ["-e", fixtureProgram(), "{prompt}"],
          prompt: "argument",
          result: "stdout",
          stream: "messages-json",
        },
      },
    }, null, 2));

    const commonArgs = [
      "run",
      "--target-cwd", repo,
      "--role", "Implementer",
      "--task-id", "live-fixture",
      "--epoch", "e1",
      "--scope", "scope:v1 all",
      "--work-type", "documentation",
      "--assignment", "Emit a deterministic Grok-shaped stream",
      "--expected-output", "Visible progress and a completed result",
      "--runner", "grok-fixture",
      "--runner-config", configPath,
    ];

    const ownershipConflict = spawnSync(process.execPath, [
      CLI,
      ...commonArgs,
      "--live-console",
      "--live-console-url", "http://127.0.0.1:1/?token=test",
    ], { encoding: "utf8" });
    assert.equal(ownershipConflict.status, 1);
    assert.match(ownershipConflict.stderr, /mutually exclusive/);

    const explicitOffConflict = spawnSync(process.execPath, [
      CLI,
      ...commonArgs,
      "--no-live-console",
      "--live-console",
    ], { encoding: "utf8" });
    assert.equal(explicitOffConflict.status, 1);
    assert.match(explicitOffConflict.stderr, /cannot be combined/);

    const silentExternalConflict = spawnSync(process.execPath, [
      CLI,
      ...commonArgs,
      "--silent",
      "--live-console-url", "http://127.0.0.1:1/?token=test",
    ], { encoding: "utf8" });
    assert.equal(silentExternalConflict.status, 1);
    assert.match(silentExternalConflict.stderr, /cannot be combined/);

    execution = spawnCli(commonArgs);
    await waitFor(() => /live_console_viewer_url: \S+/.test(execution.stdout()));
    const viewerUrl = /live_console_viewer_url: (\S+)/.exec(execution.stdout())[1];

    await waitFor(async () => {
      const snapshot = await fetchLiveSnapshot(viewerUrl);
      const run = snapshot.runs[0];
      return run?.status === "running" && run.events.some((event) => event.type === "runner.message");
    });
    assert.doesNotMatch(execution.stdout(), /live_console_run_finished: true/);

    await waitFor(() => /live_console_run_finished: true/.test(execution.stdout()));
    const retained = await fetchLiveSnapshot(viewerUrl);
    assert.equal(retained.runs[0].status, "completed");
    assert.equal(retained.runs[0].events.at(-1).type, "run.completed");
    assert.match(execution.stdout(), /live_console_owned: true/);
    assert.match(execution.stdout(), /summary: visible progress/);
    assert.equal(execution.child.exitCode, null);

    execution.child.kill("SIGINT");
    const completed = await execution.completed;
    assert.equal(completed.status, 0, completed.stderr);
    assert.match(completed.stdout, /live_console_stop_signal: SIGINT/);
    await assert.rejects(fetchLiveSnapshot(viewerUrl));
    assert.match(readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8"), /summary: visible progress/);

    for (const offFlag of ["--no-live-console", "--silent"]) {
      const disabled = spawnSync(process.execPath, [CLI, ...commonArgs, offFlag], { encoding: "utf8" });
      assert.equal(disabled.status, 0, disabled.stderr);
      assert.match(disabled.stdout, /live_console_status: disabled/);
      assert.doesNotMatch(disabled.stdout, /live_console_viewer_url:/);
    }
  } finally {
    if (execution?.child.exitCode === null) execution.child.kill("SIGINT");
    rmSync(repo, { recursive: true, force: true });
  }
});

test("Live Console client refuses non-loopback or tokenless URLs", () => {
  assert.throws(() => resolveLiveConsoleIngestUrl("https://example.com/?token=x"), /http on loopback/);
  assert.throws(() => resolveLiveConsoleIngestUrl("http://127.0.0.1:3000/"), /generated token/);
});

function makeTempGitRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-live-"));
  const initialized = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  return repo;
}

function intake(repo) {
  const result = spawnSync(process.execPath, [
    CLI,
    "intake",
    "--target-cwd", repo,
    "--work-type", "documentation",
    "--task", "Exercise deterministic Live Console streaming",
    "--task-id", "live-fixture",
    "--epoch", "e1",
    "--scope", "scope:v1 all",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function spawnCli(args) {
  const child = spawn(process.execPath, [CLI, ...args]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const completed = new Promise((resolve) => {
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, completed, stdout: () => stdout, stderr: () => stderr };
}

async function fetchLiveSnapshot(viewerUrl) {
  const snapshotUrl = new URL(viewerUrl);
  snapshotUrl.pathname = "/api/snapshot";
  const response = await fetch(snapshotUrl);
  if (!response.ok) throw new Error(`snapshot request failed with HTTP ${response.status}`);
  return response.json();
}

function fixtureProgram() {
  return [
    'console.log(JSON.stringify({type:"message_start",message:{content:[]}}))',
    'setTimeout(() => console.log(JSON.stringify({type:"content_block_delta",delta:{type:"text_delta",text:"visible "}})), 40)',
    'setTimeout(() => console.log(JSON.stringify({type:"content_block_delta",delta:{type:"text_delta",text:"progress"}})), 140)',
    'setTimeout(() => console.log(JSON.stringify({type:"message_stop"})), 280)',
  ].join(";");
}

function delegationFixtureProgram() {
  const delegateArgs = JSON.stringify([
    CLI,
    "delegate",
    "--delegate-id", "local-child",
    "--role", "Test Runner",
    "--focus-scope", "scope:v1 paths=README.md",
    "--assignment", "Produce one bounded delegated result",
    "--expected-output", "Delegated fixture result",
  ]);
  return [
    'const { spawnSync } = require("node:child_process")',
    'const prompt = process.argv[1] || ""',
    'if (prompt.includes("\\ndelegation_mode: local_orchestrator\\n")) {',
    `  const delegated = spawnSync(process.execPath, ${delegateArgs}, { encoding: "utf8", env: process.env })`,
    '  process.stdout.write(delegated.stdout || "")',
    '  process.stderr.write(delegated.stderr || "")',
    '  if (delegated.status !== 0) process.exit(delegated.status || 1)',
    '  console.log("findings: parent integrated delegated result\\nchanged_files: none\\nverification: delegated child completed\\nblockers: none\\nunresolved_assumptions: none\\nfinalization_references: artifact:local-child\\nnext: stop")',
    '} else {',
    '  console.log("findings: delegated child completed\\nchanged_files: none\\nverification: fixture child ran\\nblockers: none\\nunresolved_assumptions: none\\nfinalization_references: artifact:local-child\\nnext: return to local orchestrator")',
    '}',
  ].join(";");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitFor(predicate, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
}
