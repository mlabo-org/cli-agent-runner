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
    "parallel-leaf-orchestration",
    "jobs-file",
    "cli-agent-runner-continuation",
  ]);
  assert.deepEqual(manifest.interface.capabilities, [
    "Codex, Claude, And Grok CLI Worker Launch",
    "User-Configured CLI Runner Registry",
    "stdout/stderr And Final-Message Capture",
    "Default-On Prestarted Token-Protected IAB Live Console",
    "Live Console Continuity Across User-Input Pauses",
    "Provider-Neutral Text And JSON Event Streaming",
    "Protected Runner-Profile Delegation Ceilings",
    "Parallel Independent Leaf-Job Orchestration",
    "Terminal Minimal Result For Successful Runs",
    "Machine-Checkable Scope Guard",
  ]);
  assert.match(manifest.interface.shortDescription, /IAB Live Console/i);
  assert.match(manifest.interface.longDescription, /accepts additional or overridden profiles from runner JSON/i);
  assert.match(manifest.interface.longDescription, /one validated command-and-arguments path/i);
  assert.match(manifest.interface.longDescription, /`run --runner <id>` launches exactly one worker/i);
  assert.match(manifest.interface.longDescription, /`orchestrate --runner <id> --jobs-file <json>` concurrently launches parent-declared independent leaf jobs/i);
  assert.match(manifest.interface.longDescription, /version-1 jobs file/i);
  assert.match(manifest.interface.longDescription, /human responsibility owners and their dependency graph/i);
  assert.match(manifest.interface.longDescription, /non-overlapping writable scopes/i);
  assert.match(manifest.interface.longDescription, /materially reduces elapsed time/i);
  assert.match(manifest.interface.longDescription, /never substitutes for sibling-job dispatch/i);
  assert.match(manifest.interface.longDescription, /starts and opens one token-protected Codex IAB Live Console at skill selection before worker preparation/i);
  assert.match(manifest.interface.longDescription, /keeps it alive across user-confirmation pauses/i);
  assert.match(manifest.interface.longDescription, /restores or reopens it before resuming/i);
  assert.match(manifest.interface.longDescription, /shares it across all jobs with per-job run IDs/i);
  assert.match(manifest.interface.longDescription, /Direct runner commands also own a console by default/i);
  assert.match(manifest.interface.longDescription, /only explicit silent or no-console selection disables it/i);
  assert.match(manifest.interface.longDescription, /streams emitted stdout\/stderr or structured messages/i);
  assert.match(manifest.interface.longDescription, /successful run or orchestration records its minimal completed result and stops/i);
  assert.match(manifest.interface.longDescription, /reviewer, or validator chain/i);
  assert.ok(
    manifest.interface.defaultPrompt.every((prompt) =>
      /CLI Agent Runner|\.cli-agent-runner|process-runner-result/.test(prompt),
    ),
    "every manifest prompt must route to the CLI worker workflow",
  );
  assert.ok(
    manifest.interface.defaultPrompt.every((prompt) => prompt.length <= 128),
    "every manifest prompt must satisfy the plugin manifest limit",
  );

  assert.ok(frontmatterDescription.length <= 320, "skill description must stay routing-budget concise");
  assert.match(frontmatterDescription.slice(0, 160), /^Run one CLI worker or parallel independent leaf jobs/i);
  assert.match(frontmatterDescription.slice(0, 160), /default-on IAB Live Console/i);
  assert.match(frontmatterDescription, /Triggers: CLI Agent Runner, Live Console, Grok\/Claude CLI, runner JSON/i);
  assert.match(frontmatterDescription, /Only explicit silent\/no-console requests disable it/i);
  assert.match(frontmatterDescription, /excludes official subagents/i);

  const triggerBoundary = skill.match(/## Trigger Boundary\n\n([\s\S]*?)\n## Core Contract/);
  assert.ok(triggerBoundary, "SKILL.md must define Trigger Boundary before Core Contract");
  assert.match(triggerBoundary[1], /asks for its Live Console or IAB viewer/i);
  assert.match(triggerBoundary[1], /asks for a CLI-spawned Codex, Claude, Grok, or configured worker/i);
  assert.match(triggerBoundary[1], /`run --runner <id>` for exactly one worker/i);
  assert.match(triggerBoundary[1], /`orchestrate --runner <id> --jobs-file <json>` for parent-declared independent leaf jobs/i);
  assert.match(triggerBoundary[1], /Bundled IDs are `codex-cli`, `claude-cli`, and `grok-cli`/i);
  assert.match(triggerBoundary[1], /Do not auto-route this skill for generic coding, ordinary official-subagent work/i);
  assert.match(skill, /first action after trigger is to launch `live-console --port 0`/i);
  assert.match(skill, /before target resolution, project intake, assignment construction/i);
  assert.match(skill, /Only a current explicit silent\/no-console\/OFF instruction selects console-free execution/i);
  assert.match(skill, /Direct CLI `run\|orchestrate --runner <id>` without a URL starts an owned console by default/i);
  assert.match(skill, /If the default console cannot start or its viewer cannot be opened, stop before target intake or worker launch/i);
  assert.match(skill, /Before yielding a user-input question, keep the standalone console process running/i);
  assert.match(skill, /finalize its IAB tab with `status: handoff`/i);
  assert.match(skill, /On the resumed turn, restore the Live Console before continuing project work/i);
  assert.match(skill, /Never resume headless merely because a console was opened in an earlier turn/i);
  assert.match(skill, /Task identity remains top-level/i);
  assert.match(skill, /Each job must contain `id`, `role`, `ownerScope`, `assignment`, and `expectedOutput`/i);
  assert.match(skill, /stable handoffs and non-overlapping writable scopes materially reduce elapsed time/i);
  assert.match(skill, /use `run` when the split and merge overhead erases the saving/i);
  assert.match(skill, /hierarchy permission ceiling as a substitute for the parent's explicit sibling-job dispatch/i);
  assert.match(skill, /all orchestration jobs share it and emit distinct per-job run IDs/i);
  assert.match(skill, /reviewer, or another validator after success/i);

  assert.equal(defaultRunners.version, 1);
  assert.deepEqual(Object.keys(defaultRunners.runners).sort(), ["claude-cli", "codex-cli", "grok-cli"]);
  assert.equal(defaultRunners.runners["grok-cli"].defaultHierarchyDepth, 1);
  assert.equal(defaultRunners.runners["codex-cli"].defaultHierarchyDepth, undefined);
  assert.equal(defaultRunners.runners["claude-cli"].defaultHierarchyDepth, undefined);
});

test("agents metadata advertises the run-or-orchestrate Live Console route", () => {
  const metadata = read("agents/openai.yaml");
  const shortDescription = yamlScalar(metadata, "short_description");
  const defaultPrompt = yamlScalar(metadata, "default_prompt");

  assert.match(shortDescription, /IAB Live Console/i);
  assert.match(shortDescription, /one CLI worker or parallel independent leaf jobs/i);
  assert.ok(defaultPrompt.length <= 240, "default_prompt must stay concise");
  assert.match(defaultPrompt, /open its IAB Live Console first/i);
  assert.match(defaultPrompt, /keep it across user-confirmation pauses/i);
  assert.match(defaultPrompt, /restore it before resuming/i);
  assert.match(defaultPrompt, /use run for one worker or orchestrate --jobs-file for independent leaf jobs/i);
  assert.match(defaultPrompt, /sharing the console and stopping after success/i);
});
