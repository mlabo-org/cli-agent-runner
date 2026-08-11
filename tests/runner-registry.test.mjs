import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRunnerInvocation,
  loadRunnerRegistry,
  resolveConfiguredRunner,
} from "../lib/runner-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "bin", "cli-agent-runner.mjs");

test("bundled registry exposes Codex, Claude, and Grok through one profile schema", () => {
  const fixture = makeRegistryFixture();
  try {
    const registry = loadRunnerRegistry({
      invocationCwd: fixture.root,
      stateDir: fixture.stateDir,
      environment: isolatedEnvironment(fixture.configHome),
    });

    assert.deepEqual(Object.keys(registry.runners).sort(), ["claude-cli", "codex-cli", "grok-cli"]);
    assert.equal(registry.runners["grok-cli"].defaultHierarchyDepth, 1);
    assert.equal(registry.runners["codex-cli"].defaultHierarchyDepth, undefined);
    assert.equal(registry.runners["claude-cli"].defaultHierarchyDepth, undefined);
    for (const profile of Object.values(registry.runners)) {
      assert.equal(typeof profile.command, "string");
      assert.ok(Array.isArray(profile.args));
      assert.ok(["argument", "stdin"].includes(profile.prompt));
      assert.ok(["stdout", "stderr", "output-file"].includes(profile.result));
      assert.ok(["text", "ndjson", "messages-json"].includes(profile.stream));
    }
  } finally {
    fixture.cleanup();
  }
});

test("jobsite and explicit JSON can add and override runners without source edits", () => {
  const fixture = makeRegistryFixture();
  const explicitPath = path.join(fixture.root, "explicit-runners.json");
  try {
    writeJson(path.join(fixture.stateDir, "runners.json"), {
      version: 1,
      runners: {
        "custom-cli": {
          command: "custom-agent",
          args: ["--cwd", "{cwd}", "--prompt", "{prompt}"],
          prompt: "argument",
          result: "stdout",
        },
        "codex-cli": {
          command: "/opt/custom/codex",
        },
      },
    });
    writeJson(explicitPath, {
      version: 1,
      runners: {
        "custom-cli": {
          args: ["--single", "{prompt}"],
          timeoutMs: 9000,
        },
      },
    });

    const resolved = resolveConfiguredRunner({
      runnerId: "custom-cli",
      invocationCwd: fixture.root,
      stateDir: fixture.stateDir,
      explicitConfigPath: explicitPath,
      environment: isolatedEnvironment(fixture.configHome),
    });
    assert.equal(resolved.profile.command, "custom-agent");
    assert.deepEqual(resolved.profile.args, ["--single", "{prompt}"]);
    assert.equal(resolved.profile.timeoutMs, 9000);

    const registry = loadRunnerRegistry({
      invocationCwd: fixture.root,
      stateDir: fixture.stateDir,
      environment: isolatedEnvironment(fixture.configHome),
    });
    assert.equal(registry.runners["codex-cli"].command, "/opt/custom/codex");
    assert.equal(registry.runners["codex-cli"].result, "output-file");
  } finally {
    fixture.cleanup();
  }
});

test("runner invocation expands arguments without shell lowering and supports stdin", () => {
  const prompt = "change src; printf unsafe && $(touch nope)";
  const argumentInvocation = buildRunnerInvocation({
    command: "agent",
    args: ["--cwd", "{cwd}", "--prompt", "{prompt}", "--out", "{output_file}"],
    prompt: "argument",
    result: "output-file",
  }, {
    prompt,
    cwd: "/tmp/job site",
    outputFile: "/tmp/result file",
  });
  assert.equal(argumentInvocation.command, "agent");
  assert.equal(argumentInvocation.args[3], prompt);
  assert.equal(argumentInvocation.input, undefined);

  const stdinInvocation = buildRunnerInvocation({
    command: "stdin-agent",
    args: ["--cwd", "{cwd}"],
    prompt: "stdin",
    result: "stdout",
  }, {
    prompt,
    cwd: "/tmp/job site",
    outputFile: "/tmp/result file",
  });
  assert.equal(stdinInvocation.input, prompt);
  assert.ok(!stdinInvocation.args.some((argument) => argument.includes(prompt)));
});

test("invalid custom config is rejected before runner state append or process launch", () => {
  const repo = makeTempGitRepo();
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
  try {
    intake(repo, "invalid-runner-config");
    writeJson(path.join(repo, ".cli-agent-runner", "runners.json"), {
      version: 1,
      runners: {
        "broken-cli": {
          command: "never-launched",
          args: ["{unknown_placeholder}", "{prompt}"],
          prompt: "argument",
          result: "stdout",
        },
      },
    });

    const result = runWorker(repo, "invalid-runner-config", "broken-cli", {
      ...isolatedEnvironment(configHome),
      PATH: process.env.PATH || "",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown placeholders unknown_placeholder/);
    assert.equal(existsSync(path.join(repo, ".cli-agent-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("invalid runner hierarchy defaults are rejected before runner state append or process launch", () => {
  const repo = makeTempGitRepo();
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
  try {
    intake(repo, "invalid-hierarchy-default");
    writeJson(path.join(repo, ".cli-agent-runner", "runners.json"), {
      version: 1,
      runners: {
        "broken-cli": {
          command: "never-launched",
          args: ["{prompt}"],
          prompt: "argument",
          result: "stdout",
          defaultHierarchyDepth: 9,
        },
      },
    });

    const result = runWorker(repo, "invalid-hierarchy-default", "broken-cli", {
      ...isolatedEnvironment(configHome),
      PATH: process.env.PATH || "",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /defaultHierarchyDepth must be an integer from 0 to 8/);
    assert.equal(existsSync(path.join(repo, ".cli-agent-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("bundled Claude and Grok profiles launch headlessly and normalize stdout", () => {
  for (const [runnerId, executable, expectedFlag] of [
    ["claude-cli", "claude", "--print"],
    ["grok-cli", "grok", "--single"],
  ]) {
    const repo = makeTempGitRepo();
    const fakeBin = mkdtempSync(path.join(os.tmpdir(), `cli-agent-runner-fake-${executable}-`));
    const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
    const capturePath = path.join(fakeBin, "args.json");
    try {
      intake(repo, `builtin-${executable}`);
      installFakeRunner(fakeBin, executable);
      const result = runWorker(repo, `builtin-${executable}`, runnerId, {
        ...isolatedEnvironment(configHome),
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        CLI_AGENT_RUNNER_CAPTURE: capturePath,
      });

      assert.equal(result.status, 0, result.stderr);
      const args = JSON.parse(readFileSync(capturePath, "utf8"));
      assert.ok(args.includes(expectedFlag));
      if (runnerId === "grok-cli") {
        assert.ok(args.includes("streaming-messages-json"));
        assert.ok(args.includes("--include-partial-messages"));
      }
      const prompt = args.find((argument) => argument.includes("You are a CLI Agent Runner child worker"));
      assert.ok(prompt);
      if (runnerId === "grok-cli") {
        assert.match(prompt, /- hierarchy_mode: one_level/);
        assert.match(prompt, /- max_depth: 1/);
        assert.match(prompt, /- depth: 0/);
        assert.match(prompt, /- remaining_depth: 1/);
        assert.match(prompt, /- hierarchy_permission_source: runner_profile_default/);
        assert.match(prompt, /- hierarchy_override_reason: none/);
        assert.match(prompt, /maximum permission ceiling, not an instruction to delegate/);
        assert.match(prompt, /assigned worker decides whether descendants materially help/);
      } else {
        assert.match(prompt, /- hierarchy_mode: none/);
        assert.match(prompt, /- remaining_depth: 0/);
      }
      const runner = readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8");
      assert.match(runner, new RegExp(`runner: ${runnerId}`));
      assert.match(runner, new RegExp(`runner_command: ${executable}`));
      assert.match(runner, /runner_result_source: stdout/);
      assert.match(runner, /summary: fake configured runner completed/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
    }
  }
});

test("unreasoned explicit hierarchy flags cannot replace a runner profile default", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-fake-grok-"));
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
  const capturePath = path.join(fakeBin, "args.json");
  try {
    intake(repo, "grok-explicit-no-descendants");
    installFakeRunner(fakeBin, "grok");
    const result = runWorker(repo, "grok-explicit-no-descendants", "grok-cli", {
      ...isolatedEnvironment(configHome),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      CLI_AGENT_RUNNER_CAPTURE: capturePath,
    }, ["--hierarchy-mode", "none"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runner profile hierarchy override requires --hierarchy-override-reason/);
    assert.equal(existsSync(capturePath), false);
    assert.equal(existsSync(path.join(repo, ".cli-agent-runner", "runner.md")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("reasoned hierarchy override replaces a runner profile permission ceiling", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-fake-grok-"));
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
  const capturePath = path.join(fakeBin, "args.json");
  try {
    intake(repo, "grok-reasoned-no-descendants");
    installFakeRunner(fakeBin, "grok");
    const result = runWorker(repo, "grok-reasoned-no-descendants", "grok-cli", {
      ...isolatedEnvironment(configHome),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      CLI_AGENT_RUNNER_CAPTURE: capturePath,
    }, ["--hierarchy-mode", "none", "--hierarchy-override-reason", "user_request"]);

    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(capturePath, "utf8"));
    const prompt = args.find((argument) => argument.includes("You are a CLI Agent Runner child worker"));
    assert.ok(prompt);
    assert.match(prompt, /- hierarchy_mode: none/);
    assert.match(prompt, /- max_depth: 0/);
    assert.match(prompt, /- remaining_depth: 0/);
    assert.match(prompt, /- hierarchy_permission_source: reasoned_explicit_override/);
    assert.match(prompt, /- hierarchy_override_reason: user_request/);
    const runner = readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.match(runner, /runner: grok-cli/);
    assert.match(runner, /hierarchy_mode: none/);
    assert.match(runner, /hierarchy_permission_source: reasoned_explicit_override/);
    assert.match(runner, /hierarchy_override_reason: user_request/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("custom runner profile hierarchy defaults use the same override guard", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-fake-custom-default-"));
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
  try {
    intake(repo, "custom-profile-default-guard");
    installFakeRunner(fakeBin, "custom-agent");
    writeJson(path.join(repo, ".cli-agent-runner", "runners.json"), {
      version: 1,
      runners: {
        "custom-default": {
          command: "custom-agent",
          args: ["{prompt}"],
          prompt: "argument",
          result: "stdout",
          defaultHierarchyDepth: 2,
        },
      },
    });
    const environment = {
      ...isolatedEnvironment(configHome),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    };

    const defaultRun = runWorker(repo, "custom-profile-default-guard", "custom-default", environment);
    assert.equal(defaultRun.status, 0, defaultRun.stderr);
    const runner = readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.match(runner, /runner: custom-default/);
    assert.match(runner, /hierarchy_mode: n_level/);
    assert.match(runner, /max_depth: 2/);
    assert.match(runner, /hierarchy_permission_source: runner_profile_default/);

    const rejectedOverride = runWorker(
      repo,
      "custom-profile-default-guard",
      "custom-default",
      environment,
      ["--hierarchy-mode", "none"],
    );
    assert.notEqual(rejectedOverride.status, 0);
    assert.match(rejectedOverride.stderr, /runner profile hierarchy override requires --hierarchy-override-reason/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

test("jobsite JSON launches an arbitrary CLI through the shared runner path", () => {
  const repo = makeTempGitRepo();
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-fake-custom-"));
  const configHome = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-config-home-"));
  try {
    intake(repo, "custom-runner-launch");
    installFakeRunner(fakeBin, "my-agent");
    writeJson(path.join(repo, ".cli-agent-runner", "runners.json"), {
      version: 1,
      runners: {
        "my-cli": {
          command: "my-agent",
          args: ["--jobsite", "{cwd}", "--message", "{prompt}"],
          prompt: "argument",
          result: "stdout",
          timeoutMs: 5000,
        },
      },
    });

    const result = runWorker(repo, "custom-runner-launch", "my-cli", {
      ...isolatedEnvironment(configHome),
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      CLI_AGENT_RUNNER_CAPTURE: path.join(fakeBin, "args.json"),
    });
    assert.equal(result.status, 0, result.stderr);
    const runner = readFileSync(path.join(repo, ".cli-agent-runner", "runner.md"), "utf8");
    assert.match(runner, /runner: my-cli/);
    assert.match(runner, /runner_command: my-agent/);
    assert.match(runner, /timeout_ms: 5000/);
    assert.match(runner, /runner_config_sources: .*runners\.default\.json.*\.cli-agent-runner\/runners\.json/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

function makeRegistryFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-registry-"));
  const stateDir = path.join(root, ".cli-agent-runner");
  const configHome = path.join(root, "config-home");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(configHome, { recursive: true });
  return {
    root,
    stateDir,
    configHome,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function isolatedEnvironment(configHome) {
  return { ...process.env, XDG_CONFIG_HOME: configHome, CLI_AGENT_RUNNER_CONFIG: "" };
}

function makeTempGitRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-provider-"));
  const initialized = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  return repo;
}

function intake(repo, taskId) {
  const result = runCli([
    "intake",
    "--target-cwd",
    repo,
    "--work-type",
    "documentation",
    "--task",
    "Exercise one configured runner",
    "--task-id",
    taskId,
    "--epoch",
    "e1",
    "--scope",
    "README.md",
  ]);
  assert.equal(result.status, 0, result.stderr);
}

function runWorker(repo, taskId, runnerId, environment, extraArgs = []) {
  return runCli([
    "run",
    "--target-cwd",
    repo,
    "--work-type",
    "documentation",
    "--role",
    "Implementer",
    "--task-id",
    taskId,
    "--epoch",
    "e1",
    "--scope",
    "README.md",
    "--assignment",
    "Return a concise configured runner result",
    "--expected-output",
    "process runner result",
    "--runner",
    runnerId,
    "--no-live-console",
    ...extraArgs,
  ], { env: environment });
}

function installFakeRunner(directory, executable) {
  const executablePath = path.join(directory, executable);
  writeFileSync(executablePath, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
if (process.env.CLI_AGENT_RUNNER_CAPTURE) {
  writeFileSync(process.env.CLI_AGENT_RUNNER_CAPTURE, JSON.stringify(process.argv.slice(2)), "utf8");
}
process.stdout.write("fake configured runner completed\\n");
`, "utf8");
  chmodSync(executablePath, 0o755);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}
