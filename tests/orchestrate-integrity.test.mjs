import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cli-agent-runner.mjs");

// The fixture worker reads a per-job action list from ACTIONS_FILE keyed by
// job_id (or "single-run") and applies it inside its process cwd.  Actions:
// ["write", rel, text], ["delete", rel], ["write-real", rel, text] (writes into
// the real target named by REAL_TARGET), ["report", text].
const WORKER = `
const fs = require("node:fs");
const path = require("node:path");
const prompt = process.argv[1] || "";
const jobId = /^job_id: (.+)$/m.exec(prompt)?.[1] || "single-run";
const actions = JSON.parse(fs.readFileSync(process.env.ACTIONS_FILE, "utf8"))[jobId] || [];
let report = jobId + " completed\\n";
for (const [kind, rel, text] of actions) {
  if (kind === "write" || kind === "write-real") {
    const base = kind === "write" ? process.cwd() : process.env.REAL_TARGET;
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), text);
  } else if (kind === "delete") {
    fs.rmSync(path.join(process.cwd(), rel), { force: true });
  } else if (kind === "report") {
    report = rel;
  }
}
process.stdout.write(report);
`;

function git(repo, ...args) {
  const result = spawnSync("git", [
    "-c", "user.email=test@example.com",
    "-c", "user.name=Test",
    "-c", "commit.gpgsign=false",
    "-C", repo,
    ...args,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function makeRepo(files = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "car-integrity-repo-"));
  git(repo, "init", "-q");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), text);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", "base");
  return repo;
}

function fixture(actions) {
  const controlDir = mkdtempSync(path.join(os.tmpdir(), "car-integrity-control-"));
  const actionsFile = path.join(controlDir, "actions.json");
  writeFileSync(actionsFile, JSON.stringify(actions));
  const configPath = path.join(controlDir, "runners.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    runners: {
      "script-fixture": {
        command: process.execPath,
        args: ["-e", WORKER, "{prompt}"],
        prompt: "argument",
        result: "stdout",
        stream: "text",
      },
    },
  }));
  return { controlDir, actionsFile, configPath };
}

function jobsFile(controlDir, jobs) {
  const file = path.join(controlDir, "jobs.json");
  writeFileSync(file, JSON.stringify({ version: 1, jobs }));
  return file;
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function intake(target, taskId, scope) {
  const result = cli([
    "intake", "--target-cwd", target, "--work-type", "documentation",
    "--task", "Integrity fixture", "--task-id", taskId, "--epoch", "e1", "--scope", scope,
  ]);
  assert.equal(result.status, 0, result.stderr);
}

function orchestrate(target, taskId, scope, fx, jobs, env = {}) {
  return cli([
    "orchestrate", "--target-cwd", target, "--task-id", taskId, "--epoch", "e1",
    "--scope", scope, "--work-type", "documentation", "--runner", "script-fixture",
    "--runner-config", fx.configPath, "--jobs-file", jobsFile(fx.controlDir, jobs),
    "--no-live-console",
  ], { ACTIONS_FILE: fx.actionsFile, REAL_TARGET: target, ...env });
}

function job(id, ownerScope) {
  return { id, role: `${id} owner`, ownerScope, assignment: `Do ${id}`, expectedOutput: `${id} result` };
}

function resultBlock(runnerText, jobId) {
  const blocks = runnerText.split(/\n(?=### )/).filter((block) => block.includes("- type: process-runner-result"));
  const block = blocks.find((candidate) => candidate.includes(`- job_id: ${jobId}\n`));
  assert.ok(block, `missing result for ${jobId}`);
  return block;
}

function cleanup(...dirs) {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

test("orchestrate fails a job that modifies or deletes existing files outside its owner scope", () => {
  const repo = makeRepo({ "a/keep.txt": "a\n", "b/x.txt": "original\n", "c.txt": "c\n" });
  const fx = fixture({
    j1: [["write", "a/new.txt", "from j1\n"], ["write", "b/x.txt", "HIJACKED\n"], ["delete", "c.txt"]],
    j2: [["write", "b/y.txt", "from j2\n"]],
  });
  try {
    const scope = "scope:v1 paths=a/,b/";
    intake(repo, "outside", scope);
    const run = orchestrate(repo, "outside", scope, fx, [job("j1", "scope:v1 paths=a/"), job("j2", "scope:v1 paths=b/")]);
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(run.stderr, /orchestrated job j1 failed: .*outside scope/);
    assert.equal(readFileSync(path.join(repo, "b/x.txt"), "utf8"), "original\n");
    assert.equal(existsSync(path.join(repo, "c.txt")), true);
    assert.equal(existsSync(path.join(repo, "a/new.txt")), false, "a failed job integrates nothing");
    assert.equal(readFileSync(path.join(repo, "b/y.txt"), "utf8"), "from j2\n", "an independent successful job is integrated");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    assert.match(resultBlock(runner, "j1"), /- status: failed/);
    assert.match(resultBlock(runner, "j2"), /- status: completed/);
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("orchestrate integrates in-scope ignored files and drops ignored files outside the owner scope", () => {
  const repo = makeRepo({ ".gitignore": "build/\n*.local\n", "a/keep.txt": "a\n" });
  const fx = fixture({
    j1: [["write", "a/result.txt", "ok\n"], ["write", "a/settings.local", "in scope\n"], ["write", "build/out.bin", "artifact\n"]],
  });
  try {
    const scope = "scope:v1 paths=a/";
    intake(repo, "ignored", scope);
    const run = orchestrate(repo, "ignored", scope, fx, [job("j1", "scope:v1 paths=a/")]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(repo, "a/result.txt"), "utf8"), "ok\n");
    assert.equal(readFileSync(path.join(repo, "a/settings.local"), "utf8"), "in scope\n");
    assert.equal(existsSync(path.join(repo, "build")), false);
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("orchestrate leaves untouched symlinks unchanged", () => {
  const repo = makeRepo({ "a/keep.txt": "a\n", "shared/data.txt": "d\n" });
  symlinkSync(path.join(repo, "shared/data.txt"), path.join(repo, "a/abs-link"));
  symlinkSync("../shared/../shared/data.txt", path.join(repo, "a/odd-link"));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "links");
  const fx = fixture({ j1: [["write", "a/result.txt", "ok\n"]] });
  try {
    const scope = "scope:v1 paths=a/";
    intake(repo, "links", scope);
    const run = orchestrate(repo, "links", scope, fx, [job("j1", "scope:v1 paths=a/")]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readlinkSync(path.join(repo, "a/abs-link")), path.join(repo, "shared/data.txt"));
    assert.equal(readlinkSync(path.join(repo, "a/odd-link")), "../shared/../shared/data.txt");
    assert.equal(lstatSync(path.join(repo, "a/abs-link")).isSymbolicLink(), true);
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("orchestrate records a job as failed when the target changed under it", () => {
  const repo = makeRepo({ "a/x.txt": "base\n" });
  const fx = fixture({ j1: [["write", "a/x.txt", "worker\n"], ["write-real", "a/x.txt", "concurrent edit\n"]] });
  try {
    const scope = "scope:v1 paths=a/";
    intake(repo, "concurrent", scope);
    const run = orchestrate(repo, "concurrent", scope, fx, [job("j1", "scope:v1 paths=a/")]);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /target changed while orchestrating: a\/x\.txt/);
    assert.equal(readFileSync(path.join(repo, "a/x.txt"), "utf8"), "concurrent edit\n");
    const runner = readFileSync(path.join(repo, ".cli-agent-runner/runner.md"), "utf8");
    assert.match(resultBlock(runner, "j1"), /- status: failed/);
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("orchestrate accepts an absolute ownerScope inside the target", () => {
  const repo = makeRepo({ "a/keep.txt": "a\n" });
  const fx = fixture({ j1: [["write", "a/result.txt", "ok\n"]] });
  try {
    const scope = "scope:v1 paths=a/";
    intake(repo, "absolute", scope);
    const run = orchestrate(repo, "absolute", scope, fx, [job("j1", `scope:v1 paths=${path.join(repo, "a")}`)]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(repo, "a/result.txt"), "utf8"), "ok\n");
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("orchestrate removes its job workspaces when setup fails", () => {
  const repo = makeRepo({ "a/keep.txt": "a\n" });
  writeFileSync(path.join(repo, "dirty-outside.txt"), "dirty\n");
  const fx = fixture({ j1: [] });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "car-integrity-tmp-"));
  try {
    const scope = "scope:v1 paths=a/";
    intake(repo, "leak", scope);
    const run = orchestrate(repo, "leak", scope, fx, [job("j1", "scope:v1 paths=a/")], { TMPDIR: tmp });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /refuses to launch with dirty files outside scope/);
    assert.deepEqual(readdirSync(tmp).filter((name) => name.startsWith("cli-agent-runner-")), []);
  } finally {
    cleanup(repo, fx.controlDir, tmp);
  }
});

test("orchestrate works when the target is a subdirectory of its Git repository", () => {
  const repo = makeRepo({ ".gitignore": "*.log\n", "pkg/a/keep.txt": "a\n", "other/o.txt": "o\n" });
  const target = path.join(repo, "pkg");
  const fx = fixture({ j1: [["write", "a/result.txt", "ok\n"], ["write", "a/debug.log", "log\n"]] });
  try {
    const scope = "scope:v1 paths=a/";
    intake(target, "subdir", scope);
    const run = orchestrate(target, "subdir", scope, fx, [job("j1", "scope:v1 paths=a/")]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(target, "a/result.txt"), "utf8"), "ok\n");
    assert.equal(readFileSync(path.join(target, "a/debug.log"), "utf8"), "log\n");
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("run scope guard uses target-relative paths when the target is a subdirectory", () => {
  const repo = makeRepo({ "pkg/src/s.txt": "s\n", "other/o.txt": "o\n" });
  const target = path.join(repo, "pkg");
  const fx = fixture({ "single-run": [["write", "src/s.txt", "changed\n"]] });
  try {
    const scope = "scope:v1 paths=src/";
    intake(target, "subdir-run", scope);
    const args = [
      "run", "--target-cwd", target, "--role", "Owner", "--task-id", "subdir-run", "--epoch", "e1",
      "--scope", scope, "--work-type", "documentation", "--assignment", "Edit src", "--expected-output", "done",
      "--runner", "script-fixture", "--runner-config", fx.configPath, "--no-live-console",
    ];
    const first = cli(args, { ACTIONS_FILE: fx.actionsFile });
    assert.equal(first.status, 0, first.stderr);
    const second = cli(args, { ACTIONS_FILE: fx.actionsFile });
    assert.equal(second.status, 0, second.stderr);
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("run scope all on a subdirectory target rejects changes outside the target", () => {
  const repo = makeRepo({ "pkg/src/s.txt": "s\n", "other/o.txt": "o\n" });
  const target = path.join(repo, "pkg");
  const fx = fixture({ "single-run": [["write-real", "../other/o.txt", "escaped\n"]] });
  try {
    const scope = "scope:v1 all";
    intake(target, "subdir-all", scope);
    const run = cli([
      "run", "--target-cwd", target, "--role", "Owner", "--task-id", "subdir-all", "--epoch", "e1",
      "--scope", scope, "--work-type", "documentation", "--assignment", "Edit", "--expected-output", "done",
      "--runner", "script-fixture", "--runner-config", fx.configPath, "--no-live-console",
    ], { ACTIONS_FILE: fx.actionsFile, REAL_TARGET: target });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /outside scope .*\.\.\/other\/o\.txt/);
  } finally {
    cleanup(repo, fx.controlDir);
  }
});

test("scope:v1 paths accept directory names that look like exclusion words", () => {
  const repo = makeRepo({ "src/exclude/keep.txt": "k\n" });
  const fx = fixture({ "single-run": [["write", "src/exclude/result.txt", "ok\n"]] });
  try {
    const scope = "scope:v1 paths=src/exclude/";
    intake(repo, "exclude-dir", scope);
    const run = cli([
      "run", "--target-cwd", repo, "--role", "Owner", "--task-id", "exclude-dir", "--epoch", "e1",
      "--scope", scope, "--work-type", "documentation", "--assignment", "Edit", "--expected-output", "done",
      "--runner", "script-fixture", "--runner-config", fx.configPath, "--no-live-console",
    ], { ACTIONS_FILE: fx.actionsFile });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(repo, "src/exclude/result.txt"), "utf8"), "ok\n");
  } finally {
    cleanup(repo, fx.controlDir);
  }
});
