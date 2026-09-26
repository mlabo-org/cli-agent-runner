import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("skill metadata routes built-in and configured CLI workers plus Live Console", () => {
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

  assert.ok(frontmatterDescription.length <= 320, "skill description must stay routing-budget concise");
  assert.match(frontmatterDescription.slice(0, 160), /^Run Grok, Claude, Codex, or custom CLI workers singly, with brokered descendants/i);
  assert.match(frontmatterDescription.slice(0, 160), /default-on IAB Live Console/i);
  assert.match(frontmatterDescription, /Triggers: CLI Agent Runner, local orchestrator, Live Console, CLI LLM, runner JSON/i);
  assert.match(frontmatterDescription, /Silent\/no-console is explicit-only/i);
  assert.match(frontmatterDescription, /excludes official subagents/i);

  const triggerBoundary = skill.match(/## Trigger Boundary\n\n([\s\S]*?)\n## Core Contract/);
  assert.ok(triggerBoundary, "SKILL.md must define Trigger Boundary before Core Contract");
  assert.match(triggerBoundary[1], /asks for its Live Console or IAB viewer/i);
  assert.match(triggerBoundary[1], /asks for a CLI-spawned Codex, Claude, Grok, or configured worker/i);
  assert.match(triggerBoundary[1], /`run --runner <id>` for exactly one parent-managed worker/i);
  assert.match(triggerBoundary[1], /`run --runner <id> --delegation-mode local_orchestrator` for one parent-managed worker that may split bounded internal helper work/i);
  assert.match(triggerBoundary[1], /`orchestrate --runner <id> --jobs-file <json>` for parent-declared independent responsibility leaves/i);
  assert.match(triggerBoundary[1], /Bundled IDs are `codex-cli`, `claude-cli`, and `grok-cli`/i);
  assert.match(triggerBoundary[1], /Do not auto-route this skill for generic coding, ordinary official-subagent work/i);
  assert.match(skill, /first action after trigger is to launch `live-console --port 0`/i);
  assert.match(skill, /before target resolution, project intake, assignment construction/i);
  assert.match(skill, /Only a current explicit silent\/no-console\/OFF instruction selects console-free execution/i);
  assert.match(skill, /Direct CLI `run\|orchestrate --runner <id>` without a URL starts an owned console by default/i);
  assert.match(skill, /If the default console cannot start or its viewer cannot be opened, stop before target intake or worker launch/i);
  assert.match(skill, /Before yielding a user-input question, keep the standalone console process running/i);
  assert.match(skill, /leave its IAB tab open as the handoff state/i);
  assert.match(skill, /On the resumed turn, restore the Live Console before continuing project work/i);
  assert.match(skill, /Never resume headless merely because a console was opened in an earlier turn/i);
  assert.match(skill, /Task identity remains top-level/i);
  assert.match(skill, /Each job must contain `id`, caller-defined `role`, `ownerScope`, `assignment`, and `expectedOutput`/i);
  assert.match(skill, /stable handoffs and non-overlapping writable scopes materially reduce elapsed time/i);
  assert.match(skill, /use `run` when the split and merge overhead erases the saving/i);
  assert.match(skill, /hierarchy permission ceiling as a substitute for the parent's explicit sibling-job dispatch/i);
  assert.match(skill, /all orchestration jobs share it and emit distinct per-job run IDs/i);
  assert.match(skill, /reviewer, or another validator after success/i);
  assert.match(skill, /Every assignment resolves exactly one executable `delegation_mode`/i);
  assert.match(skill, /worker-only `delegate` command/i);
  assert.match(skill, /`delegation\.started`, `delegation\.completed`, or `delegation\.failed`/i);
  assert.match(skill, /Codex and Claude the same explicit local-orchestrator route as Grok/i);
  assert.match(skill, /Every `role` is a caller-defined responsibility label/i);
  assert.match(skill, /must not preallocate, recommend, or enforce a built-in role roster/i);
  assert.match(skill, /initialize the role-agnostic assignment packet contract/i);

  assert.equal(defaultRunners.version, 1);
  assert.deepEqual(Object.keys(defaultRunners.runners).sort(), ["claude-cli", "codex-cli", "grok-cli"]);
  assert.equal(defaultRunners.runners["grok-cli"].defaultHierarchyDepth, 1);
  assert.equal(defaultRunners.runners["codex-cli"].defaultHierarchyDepth, undefined);
  assert.equal(defaultRunners.runners["claude-cli"].defaultHierarchyDepth, undefined);
});
