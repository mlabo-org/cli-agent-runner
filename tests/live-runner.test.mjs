import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createLiveConsolePublisher, resolveLiveConsoleIngestUrl } from "../lib/live-console-client.mjs";
import { startLiveConsole } from "../lib/live-console.mjs";
import { runStreamingProcess } from "../lib/process-runner.mjs";
import { createRunnerStreamAdapter } from "../lib/runner-stream.mjs";
import {
  cleanupOrchestrationWorkspace,
  collectWorkspaceChanges,
  createOrchestrationWorkspace,
  integrateOrchestrationChanges,
  snapshotPrefixes,
} from "../lib/orchestration-workspace.mjs";

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

// Shape captured from grok 1.0.31 --output-format streaming-messages-json
// --include-partial-messages: deltas wrapped in stream_event, then the whole
// assistant message, then a result line carrying the final answer.
function grokLines(turns, finalResult, isError = false) {
  const lines = [{ type: "system", subtype: "init" }];
  for (const text of turns) {
    lines.push({ type: "stream_event", event: { type: "message_start", message: { content: [] } } });
    lines.push({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } } });
    lines.push({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } } });
    lines.push({ type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text }] } });
  }
  if (finalResult !== undefined) lines.push({ type: "result", subtype: isError ? "error" : "success", is_error: isError, result: finalResult });
  return lines.map((line) => `${JSON.stringify(line)}\n`).join("");
}

test("messages-json adapter reads Grok's wrapped deltas and final result line", () => {
  const events = [];
  const adapter = createRunnerStreamAdapter({ format: "messages-json", onEvent: (event) => events.push(event) });
  adapter.write("stdout", Buffer.from(grokLines(["Let me read the file.", "Final answer"], "Final answer")));
  adapter.end("stdout");
  adapter.end("stderr");
  assert.equal(adapter.resultText(), "Final answer");
  assert.equal(adapter.reportedError(), null);
  assert.ok(events.some((event) => event.text === "Let me read the file."), "wrapped text deltas are visible");
});

test("messages-json adapter uses only the last assistant turn without a result line", () => {
  const adapter = createRunnerStreamAdapter({ format: "messages-json" });
  adapter.write("stdout", Buffer.from(grokLines(["Let me read the file.", "Final answer"])));
  adapter.end("stdout");
  assert.equal(adapter.resultText(), "Final answer");
});

test("messages-json adapter reports a provider error result", () => {
  const adapter = createRunnerStreamAdapter({ format: "messages-json" });
  adapter.write("stdout", Buffer.from(grokLines(["Working"], "API quota exhausted", true)));
  adapter.end("stdout");
  assert.equal(adapter.reportedError(), "API quota exhausted");
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
      "--role", "Grok Stream Observer",
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
    const runnerState = readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.match(runnerState, /^- role: Grok Stream Observer$/m);
    assert.match(runnerState, /summary: visible progress/);
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
          role: "Public Stream Producer",
          ownerScope: "alpha/",
          assignment: "Emit alpha activity",
          expectedOutput: "Alpha Live Console result",
        },
        {
          id: "beta-live",
          role: "Timeline Contract Observer",
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

test("orchestrate rejects a worker write outside its ownerScope", async () => {
  const repo = makeTempGitRepo();
  const controlDir = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-live-scope-"));
  const configPath = path.join(controlDir, "runners.json");
  const jobsPath = path.join(controlDir, "jobs.json");
  try {
    intake(repo);
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      runners: {
        "cross-job-write-fixture": {
          command: process.execPath,
          args: ["-e", crossJobWriteFixtureProgram(), "{prompt}"],
          prompt: "argument",
          result: "stdout",
          stream: "text",
        },
      },
    }, null, 2));
    writeFileSync(jobsPath, JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "alpha-cross-write",
          role: "Alpha Scope Worker",
          ownerScope: "alpha/",
          assignment: "Write only inside alpha",
          expectedOutput: "Scope guard rejects cross-job write",
        },
        {
          id: "beta-cross-write",
          role: "Beta Scope Worker",
          ownerScope: "beta/",
          assignment: "Remain isolated from alpha",
          expectedOutput: "No cross-job write",
        },
      ],
    }, null, 2));

    const completed = await runCli([
      "orchestrate",
      "--target-cwd", repo,
      "--task-id", "live-fixture",
      "--epoch", "e1",
      "--scope", "scope:v1 all",
      "--work-type", "documentation",
      "--runner", "cross-job-write-fixture",
      "--runner-config", configPath,
      "--jobs-file", jobsPath,
      "--no-live-console",
    ]);

    assert.notEqual(completed.status, 0);
    assert.match(completed.stderr, /orchestrated job alpha-cross-write failed/);
    assert.match(completed.stderr, /outside scope alpha\//);
    assert.match(completed.stderr, /beta\/cross-job\.txt/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(controlDir, { recursive: true, force: true });
  }
});

test("orchestration workspace integrates in-scope writes and deletes, then cleans up", () => {
  const repo = makeTempGitRepo();
  mkdirSync(path.join(repo, "a"));
  writeFileSync(path.join(repo, "a", "old.txt"), "old\n", "utf8");
  const targetBaseline = snapshotPrefixes(repo, ["a"]);
  const workspace = createOrchestrationWorkspace({ gitRoot: repo, targetPrefix: "" });
  try {
    const baseline = snapshotPrefixes(workspace.root, ["a"]);
    writeFileSync(path.join(workspace.root, "a", "alpha.txt"), "alpha\n", "utf8");
    rmSync(path.join(workspace.root, "a", "old.txt"));
    writeFileSync(path.join(workspace.root, "outside.txt"), "ignored by scope\n", "utf8");
    const changes = collectWorkspaceChanges(workspace, baseline, ["a"]);
    assert.deepEqual([...changes].sort(), [["a/alpha.txt", "write"], ["a/old.txt", "delete"]]);
    integrateOrchestrationChanges({ gitRoot: repo, workspace, changes, targetBaseline });
    assert.equal(readFileSync(path.join(repo, "a", "alpha.txt"), "utf8"), "alpha\n");
    assert.equal(existsSync(path.join(repo, "a", "old.txt")), false);
    assert.equal(existsSync(path.join(repo, "outside.txt")), false);
  } finally {
    const root = workspace.root;
    cleanupOrchestrationWorkspace(workspace);
    assert.equal(existsSync(root), false);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("orchestration integration refuses a path that changed in the target, ignoring unrelated changes", () => {
  const repo = makeTempGitRepo();
  mkdirSync(path.join(repo, "a"));
  writeFileSync(path.join(repo, "a", "shared.txt"), "before\n", "utf8");
  writeFileSync(path.join(repo, "unrelated.txt"), "before\n", "utf8");
  const targetBaseline = snapshotPrefixes(repo, ["a"]);
  const workspace = createOrchestrationWorkspace({ gitRoot: repo, targetPrefix: "" });
  try {
    const baseline = snapshotPrefixes(workspace.root, ["a"]);
    writeFileSync(path.join(workspace.root, "a", "alpha.txt"), "alpha\n", "utf8");
    writeFileSync(path.join(workspace.root, "a", "shared.txt"), "worker\n", "utf8");
    writeFileSync(path.join(repo, "unrelated.txt"), "external\n", "utf8");
    writeFileSync(path.join(repo, "a", "shared.txt"), "external\n", "utf8");
    const changes = collectWorkspaceChanges(workspace, baseline, ["a"]);
    assert.throws(
      () => integrateOrchestrationChanges({ gitRoot: repo, workspace, changes, targetBaseline }),
      /target changed while orchestrating: a\/shared\.txt/,
    );
    assert.equal(existsSync(path.join(repo, "a", "alpha.txt")), false);
    assert.equal(readFileSync(path.join(repo, "a", "shared.txt"), "utf8"), "external\n");
  } finally {
    cleanupOrchestrationWorkspace(workspace);
    rmSync(repo, { recursive: true, force: true });
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
      "--role", "Delegation Flow Integrator",
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
    "--role", "Bounded Child Evidence Producer",
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

test("Live Console publisher bounds an oversized provider event so the transport keeps working", async () => {
  const liveConsole = await startLiveConsole({ viewerRoot: path.join(REPO_ROOT, "viewer") });
  try {
    const publisher = createLiveConsolePublisher({ url: liveConsole.viewerUrl, runId: "large-run" });
    await publisher.publish({ type: "runner.message", text: "x".repeat(400 * 1024), data: { content: "y".repeat(400 * 1024) } });
    await publisher.publish({ type: "run.completed", text: "done", data: { status: "completed" } });
    await publisher.drain();
    const run = liveConsole.snapshot().runs[0];
    assert.equal(run.status, "completed");
    assert.match(run.events[0].text, /characters truncated for Live Console/);
    assert.equal(run.events[0].data.truncated, true);
  } finally {
    await liveConsole.close();
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

function crossJobWriteFixtureProgram() {
  return [
    'const fs = require("node:fs")',
    'const path = require("node:path")',
    'const prompt = process.argv[1] || ""',
    'if (prompt.includes("job_id: alpha-cross-write")) { fs.mkdirSync(path.join(process.cwd(), "beta"), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), "beta", "cross-job.txt"), "cross-job") }',
    'console.log("findings: fixture completed\\nchanged_files: beta/cross-job.txt\\nverification: fixture completed\\nblockers: none\\nunresolved_assumptions: none\\nfinalization_references: artifact:cross-job\\nnext: stop")',
  ].join(";");
}

function delegationFixtureProgram() {
  const delegateArgs = JSON.stringify([
    CLI,
    "delegate",
    "--delegate-id", "local-child",
    "--role", "Bounded Child Evidence Producer",
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
