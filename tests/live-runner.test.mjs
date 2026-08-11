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

async function waitFor(predicate, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
}
