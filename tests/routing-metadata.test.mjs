import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function yamlScalar(document, key) {
  const match = document.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  assert.ok(match, `${key} must be a single-line YAML scalar`);
  return match[1].trim();
}

test("discovery metadata routes built-in and configured CLI worker execution", () => {
  const manifest = JSON.parse(read(".codex-plugin/plugin.json"));
  const defaultRunners = JSON.parse(read("config/runners.default.json"));
  const skill = read("skills/cli-agent-runner/SKILL.md");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "SKILL.md must have YAML frontmatter");
  const frontmatterLines = frontmatter[1].split("\n");
  const descriptionStart = frontmatterLines.indexOf("description: >-");
  assert.notEqual(descriptionStart, -1, "SKILL.md must use a folded description");
  const frontmatterDescription = frontmatterLines
    .slice(descriptionStart + 1)
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim())
    .join(" ");

  assert.match(manifest.description, /Launch scoped Codex, Claude, Grok, or user-configured CLI workers/i);
  assert.match(manifest.description, /Primary route: explicit run\/orchestrate --runner <id>/i);
  assert.match(
    manifest.description,
    /Non-use: generic coding and ordinary official-subagent work/i,
  );
  assert.deepEqual(manifest.keywords, [
    "cli-agent-runner",
    ".cli-agent-runner",
    "codex-cli",
    "claude-cli",
    "grok-cli",
    "custom-cli-runner",
    "runner-config-json",
    "cli-subagent",
    "process-runner-result",
    "stdout-stderr",
    "cli-agent-runner-continuation",
  ]);
  assert.deepEqual(manifest.interface.capabilities, [
    "Codex, Claude, And Grok CLI Worker Launch",
    "User-Configured CLI Runner Registry",
    "stdout/stderr And Final-Message Capture",
    "Normalized Process Runner Results",
    "Machine-Checkable Scope Guard",
  ]);
  assert.match(manifest.interface.shortDescription, /Codex, Claude, Grok, or configured CLI workers/i);
  assert.match(manifest.interface.longDescription, /accepts additional or overridden profiles from runner JSON/i);
  assert.match(manifest.interface.longDescription, /one validated command-and-arguments path/i);
  assert.match(manifest.interface.longDescription, /captures the configured result source plus stdout\/stderr/i);
  assert.ok(
    manifest.interface.defaultPrompt.every((prompt) =>
      /CLI Agent Runner|\.cli-agent-runner|process-runner-result/.test(prompt),
    ),
    "every manifest prompt must route to the CLI worker workflow",
  );

  assert.ok(frontmatterDescription.length <= 320, "skill description must stay routing-budget concise");
  assert.match(frontmatterDescription.slice(0, 160), /^Launch scoped Codex, Claude, Grok, or configured CLI workers/i);
  assert.match(frontmatterDescription.slice(0, 220), /process-runner-result state in \.cli-agent-runner/i);
  assert.match(frontmatterDescription, /Trigger on CLI Agent Runner, cli-agent-runner, Claude\/Grok CLI workers/i);
  assert.match(frontmatterDescription, /Excludes ordinary official-subagent work/i);

  const triggerBoundary = skill.match(/## Trigger Boundary\n\n([\s\S]*?)\n## Core Contract/);
  assert.ok(triggerBoundary, "SKILL.md must define Trigger Boundary before Core Contract");
  assert.match(triggerBoundary[1], /asks for a CLI-spawned Codex, Claude, Grok, or configured worker/i);
  assert.match(triggerBoundary[1], /primary execution route is `run` or `orchestrate` with `--runner <id>`/i);
  assert.match(triggerBoundary[1], /Bundled IDs are `codex-cli`, `claude-cli`, and `grok-cli`/i);
  assert.match(triggerBoundary[1], /Do not auto-route this skill for generic coding, ordinary official-subagent work/i);

  assert.equal(defaultRunners.version, 1);
  assert.deepEqual(Object.keys(defaultRunners.runners).sort(), ["claude-cli", "codex-cli", "grok-cli"]);
});

test("agents metadata advertises the multi-CLI process-runner route", () => {
  const metadata = read("agents/openai.yaml");
  const shortDescription = yamlScalar(metadata, "short_description");
  const defaultPrompt = yamlScalar(metadata, "default_prompt");

  assert.match(shortDescription, /^Launch scoped Codex, Claude, Grok, or configured CLI workers/i);
  assert.ok(defaultPrompt.length <= 240, "default_prompt must stay concise");
  assert.match(defaultPrompt, /Use CLI Agent Runner to launch a scoped built-in or JSON-configured CLI worker/i);
  assert.match(defaultPrompt, /capture its result/i);
  assert.match(defaultPrompt, /record process-runner-result state/i);
});
