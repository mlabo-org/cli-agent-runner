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

test("discovery metadata routes built-in and configured CLI workers plus Live Console", () => {
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

  assert.match(manifest.description, /Run scoped Grok, Claude, Codex, or custom CLI workers/i);
  assert.match(manifest.description, /Codex IAB Live Console/i);
  assert.match(manifest.description, /Trigger on CLI Agent Runner, Live Console, Grok\/Claude CLI/i);
  assert.match(
    manifest.description,
    /excludes generic coding and ordinary official subagents/i,
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
    "iab-live-console",
    "runner-streaming",
    "cli-agent-runner-continuation",
  ]);
  assert.deepEqual(manifest.interface.capabilities, [
    "Codex, Claude, And Grok CLI Worker Launch",
    "User-Configured CLI Runner Registry",
    "stdout/stderr And Final-Message Capture",
    "Automatically Owned Token-Protected IAB Live Console",
    "Provider-Neutral Text And JSON Event Streaming",
    "Separated Execution, Artifact-Acceptance, And Result-Contract Outcomes",
    "Machine-Checkable Scope Guard",
  ]);
  assert.match(manifest.interface.shortDescription, /IAB Live Console/i);
  assert.match(manifest.interface.longDescription, /accepts additional or overridden profiles from runner JSON/i);
  assert.match(manifest.interface.longDescription, /one validated command-and-arguments path/i);
  assert.match(manifest.interface.longDescription, /automatically owns server startup and URL handoff/i);
  assert.match(manifest.interface.longDescription, /streams emitted stdout\/stderr or structured messages/i);
  assert.match(manifest.interface.longDescription, /records execution, parent artifact-acceptance, and result-contract outcomes independently/i);
  assert.ok(
    manifest.interface.defaultPrompt.every((prompt) =>
      /CLI Agent Runner|\.cli-agent-runner|process-runner-result/.test(prompt),
    ),
    "every manifest prompt must route to the CLI worker workflow",
  );

  assert.ok(frontmatterDescription.length <= 320, "skill description must stay routing-budget concise");
  assert.match(frontmatterDescription.slice(0, 160), /^Run scoped Grok, Claude, Codex, or custom CLI workers/i);
  assert.match(frontmatterDescription.slice(0, 160), /Codex IAB Live Console/i);
  assert.match(frontmatterDescription, /Trigger on cli-agent-runner, Live Console, Grok\/Claude CLI, custom runner JSON/i);
  assert.match(frontmatterDescription, /excludes ordinary official subagents/i);

  const triggerBoundary = skill.match(/## Trigger Boundary\n\n([\s\S]*?)\n## Core Contract/);
  assert.ok(triggerBoundary, "SKILL.md must define Trigger Boundary before Core Contract");
  assert.match(triggerBoundary[1], /asks for its Live Console or IAB viewer/i);
  assert.match(triggerBoundary[1], /asks for a CLI-spawned Codex, Claude, Grok, or configured worker/i);
  assert.match(triggerBoundary[1], /primary execution route is `run` or `orchestrate` with `--runner <id>`/i);
  assert.match(triggerBoundary[1], /Bundled IDs are `codex-cli`, `claude-cli`, and `grok-cli`/i);
  assert.match(triggerBoundary[1], /Do not auto-route this skill for generic coding, ordinary official-subagent work/i);

  assert.equal(defaultRunners.version, 1);
  assert.deepEqual(Object.keys(defaultRunners.runners).sort(), ["claude-cli", "codex-cli", "grok-cli"]);
});

test("agents metadata advertises the multi-CLI Live Console route", () => {
  const metadata = read("agents/openai.yaml");
  const shortDescription = yamlScalar(metadata, "short_description");
  const defaultPrompt = yamlScalar(metadata, "default_prompt");

  assert.match(shortDescription, /IAB Live Console/i);
  assert.ok(defaultPrompt.length <= 240, "default_prompt must stay concise");
  assert.match(defaultPrompt, /automatically start and open its Codex IAB Live Console/i);
  assert.match(defaultPrompt, /launch a scoped Grok or custom CLI worker/i);
  assert.match(defaultPrompt, /stream activity/i);
  assert.match(defaultPrompt, /record process, artifact-acceptance, and result-contract state/i);
});
