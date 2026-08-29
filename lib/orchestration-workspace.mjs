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
  chmodSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const EXCLUDED = new Set([".git", ".cli-agent-runner"]);

function walk(root, current = root, out = new Map()) {
  for (const name of readdirSync(current, { withFileTypes: true })) {
    if (current === root && EXCLUDED.has(name.name)) continue;
    const absolute = path.join(current, name.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) walk(root, absolute, out);
    else if (stat.isSymbolicLink()) out.set(relative, { type: "symlink", value: readlinkSync(absolute), mode: stat.mode & 0o7777 });
    else if (stat.isFile()) out.set(relative, { type: "file", value: readFileSync(absolute), mode: stat.mode & 0o7777 });
  }
  return out;
}

function safePath(root, relative) {
  const clean = relative.replaceAll("\\", "/");
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..") || clean === ".git" || clean.startsWith(".git/")) {
    throw new Error(`unsafe workspace path: ${relative}`);
  }
  return path.join(root, ...clean.split("/"));
}

function ensureParent(file) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }

function materialize(root, entries, sourceRoot) {
  for (const [relative, entry] of entries) {
    const target = safePath(root, relative);
    ensureParent(target);
    if (entry.type === "symlink") {
      const source = safePath(sourceRoot, relative);
      const resolved = path.resolve(path.dirname(source), entry.value);
      const relativeTarget = path.relative(sourceRoot, resolved);
      if (!relativeTarget || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        throw new Error(`unsafe external symlink in workspace: ${relative}`);
      }
      symlinkSync(path.relative(path.dirname(target), path.join(root, relativeTarget)), target);
    }
    else { writeFileSync(target, entry.value); chmodSync(target, entry.mode); }
  }
}

export function createOrchestrationWorkspace(target) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-shadow-"), { encoding: "utf8" });
  try {
    const baseline = walk(target);
    materialize(root, baseline, target);
    execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
    return { root, baseline };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function collectWorkspaceChanges(workspace) {
  const after = walk(workspace.root);
  const changes = new Map();
  const all = new Set([...workspace.baseline.keys(), ...after.keys()]);
  for (const relative of all) {
    const before = workspace.baseline.get(relative);
    const current = after.get(relative);
    if (!current) changes.set(relative, { type: "delete" });
    else if (!before || before.type !== current.type || before.mode !== current.mode || (current.type === "file" ? !before.value.equals(current.value) : before.value !== current.value)) changes.set(relative, current);
  }
  return changes;
}

export function integrateOrchestrationChanges(target, baseline, bundles) {
  const current = walk(target);
  for (const [relative, expected] of baseline) {
    const actual = current.get(relative);
    if (!actual || actual.type !== expected.type || actual.mode !== expected.mode || (actual.type === "file" ? !actual.value.equals(expected.value) : actual.value !== expected.value)) {
      throw new Error(`target changed while orchestrating: ${relative}`);
    }
  }
  for (const bundle of bundles) {
    for (const relative of bundle.keys()) if (bundles.some((other) => other !== bundle && other.has(relative))) throw new Error(`orchestration bundle conflict: ${relative}`);
  }
  for (const bundle of bundles) for (const relative of bundle.keys()) {
    const expected = baseline.get(relative);
    const actual = current.get(relative);
    if (expected && actual && expected.type === actual.type && expected.mode === actual.mode && (actual.type === "file" ? expected.value.equals(actual.value) : expected.value === actual.value)) continue;
    if (!expected && !actual) continue;
    throw new Error(`target changed while orchestrating: ${relative}`);
  }
  for (const bundle of bundles) for (const [relative, entry] of bundle) {
    const destination = safePath(target, relative);
    if (entry.type === "delete") { if (existsSync(destination)) rmSync(destination, { recursive: true, force: true }); continue; }
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
    ensureParent(destination);
    if (entry.type === "symlink") symlinkSync(entry.value, destination);
    else { writeFileSync(destination, entry.value); chmodSync(destination, entry.mode); }
  }
}

export function cleanupOrchestrationWorkspace(workspace) { if (workspace?.root) rmSync(workspace.root, { recursive: true, force: true }); }
