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

test("discovery metadata routes explicit Codex CLI worker execution", () => {
  const manifest = JSON.parse(read(".codex-plugin/plugin.json"));
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

  assert.match(manifest.description, /Launch scoped Codex CLI workers with codex exec/i);
  assert.match(manifest.description, /Primary route: explicit run\/orchestrate --runner codex-cli/i);
  assert.match(
    manifest.description,
    /Non-use: generic coding and ordinary official-subagent work/i,
  );
  assert.deepEqual(manifest.keywords, [
    "cli-agent-runner",
    ".cli-agent-runner",
    "codex-cli",
    "codex-exec",
    "cli-subagent",
    "process-runner-result",
    "stdout-stderr",
    "cli-agent-runner-continuation",
  ]);
  assert.deepEqual(manifest.interface.capabilities, [
    "Codex CLI Worker Launch",
    "stdout/stderr And Final-Message Capture",
    "Normalized Process Runner Results",
    "Machine-Checkable Scope Guard",
  ]);
  assert.match(manifest.interface.shortDescription, /Launch scoped Codex CLI workers/i);
  assert.match(manifest.interface.longDescription, /invokes codex exec/i);
  assert.match(manifest.interface.longDescription, /captures stdout\/stderr plus the final message/i);
  assert.match(manifest.interface.longDescription, /supports only the codex-cli provider/i);
  assert.ok(
    manifest.interface.defaultPrompt.every((prompt) =>
      /CLI Agent Runner|\.cli-agent-runner|process-runner-result/.test(prompt),
    ),
    "every manifest prompt must route to the CLI worker workflow",
  );

  assert.ok(frontmatterDescription.length <= 320, "skill description must stay routing-budget concise");
  assert.match(frontmatterDescription.slice(0, 160), /^Launch scoped Codex CLI workers with codex exec/i);
  assert.match(frontmatterDescription.slice(0, 220), /process-runner-result in \.cli-agent-runner/i);
  assert.match(frontmatterDescription, /Trigger on CLI Agent Runner, cli-agent-runner, CLI subagent execution/i);
  assert.match(frontmatterDescription, /Excludes generic official-subagent work/i);

  const triggerBoundary = skill.match(/## Trigger Boundary\n\n([\s\S]*?)\n## Core Contract/);
  assert.ok(triggerBoundary, "SKILL.md must define Trigger Boundary before Core Contract");
  assert.match(triggerBoundary[1], /asks for a CLI-spawned Codex worker or CLI subagent/i);
  assert.match(triggerBoundary[1], /primary execution route is `run` or `orchestrate` with `--runner codex-cli`/i);
  assert.match(triggerBoundary[1], /launches `codex exec` as an OS child process/i);
  assert.match(triggerBoundary[1], /Do not auto-route this skill for generic coding, ordinary official-subagent work/i);
  assert.match(triggerBoundary[1], /supports only the `codex-cli` runner/i);
  assert.match(triggerBoundary[1], /Do not claim Claude CLI, Grok CLI, or another provider is implemented/i);
});

test("agents metadata advertises the Codex CLI process-runner route", () => {
  const metadata = read("agents/openai.yaml");
  const shortDescription = yamlScalar(metadata, "short_description");
  const defaultPrompt = yamlScalar(metadata, "default_prompt");

  assert.match(shortDescription, /^Launch scoped Codex CLI workers/i);
  assert.ok(defaultPrompt.length <= 240, "default_prompt must stay concise");
  assert.match(defaultPrompt, /Use CLI Agent Runner to launch a scoped Codex CLI worker with codex exec/i);
  assert.match(defaultPrompt, /capture its result/i);
  assert.match(defaultPrompt, /record process-runner-result state/i);
});
