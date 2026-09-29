import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cli-agent-runner.mjs");

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function setup() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "car-blocker-repo-"));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: repo }).status, 0);
  const configPath = path.join(repo, "..", `${path.basename(repo)}-runners.json`);
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    runners: {
      "report-fixture": {
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.WORKER_REPORT)"],
        prompt: "stdin",
        result: "stdout",
        stream: "text",
      },
    },
  }));
  const intake = cli([
    "intake", "--target-cwd", repo, "--work-type", "documentation", "--task", "Blocker fixture",
    "--task-id", "blockers", "--epoch", "e1", "--scope", "scope:v1 all",
  ]);
  assert.equal(intake.status, 0, intake.stderr);
  return { repo, configPath };
}

function runWithReport(fixture, report) {
  return cli([
    "run", "--target-cwd", fixture.repo, "--role", "Reporter", "--task-id", "blockers", "--epoch", "e1",
    "--scope", "scope:v1 all", "--work-type", "documentation", "--assignment", "Report",
    "--expected-output", "A report", "--runner", "report-fixture", "--runner-config", fixture.configPath,
    "--no-live-console",
  ], { WORKER_REPORT: report });
}

const NO_BLOCKER_REPORTS = [
  "- findings: done\n- blockers: none\n",
  "- findings: done\n- blockers: None found\n",
  "- findings: done\n- blockers: No blockers.\n",
  "- findings: done\n- blockers: (none)\n",
  "- findings: done\n- blockers: なし\n",
  "- findings: done\n- blockers: None. All checks passed.\n",
  "- findings:\n  - item one\n- blockers:\n  - none\n",
  "**blockers:** none\n",
  "{\"status\": \"completed\", \"blockers\": [\"None found\"]}",
];

const BLOCKER_REPORTS = [
  ["- findings:\n  - item\n- blockers: missing API credentials\n", /missing API credentials/],
  ["**blockers:** cannot reach the registry\n", /cannot reach the registry/],
  ["blockers: tests cannot run\n", /tests cannot run/],
  ["- blocker: waiting on a schema decision\n", /waiting on a schema decision/],
  ["- blockers:\n  - database migration is missing\n", /database migration is missing/],
  ["- blockers: none of the tests can run without Docker\n", /none of the tests can run without Docker/],
  ["{\"status\": \"error\"}", /status error/],
];

test("reports that state no blocker in common phrasings complete the run", () => {
  const fixture = setup();
  try {
    for (const report of NO_BLOCKER_REPORTS) {
      const run = runWithReport(fixture, report);
      assert.equal(run.status, 0, `${JSON.stringify(report)} -> ${run.stderr}`);
    }
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
    rmSync(fixture.configPath, { force: true });
  }
});

test("reports that name a blocker fail the run even when the worker exits zero", () => {
  const fixture = setup();
  try {
    for (const [report, pattern] of BLOCKER_REPORTS) {
      const run = runWithReport(fixture, report);
      assert.notEqual(run.status, 0, JSON.stringify(report));
      assert.match(run.stderr, /worker reported blocker/, JSON.stringify(report));
      assert.match(run.stderr, pattern, JSON.stringify(report));
    }
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
    rmSync(fixture.configPath, { force: true });
  }
});
