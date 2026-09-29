import {
  chmodSync,
  constants as fsConstants,
  copyFileSync,
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
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

// Each orchestrated job runs in a private copy of the target's Git worktree.
// The copy is committed as its own baseline so the ordinary Git scope guard
// sees exactly the job's changes.  Only changes inside the job's owner scope
// are written back to the real worktree; everything else stays in the copy.

const STATE_DIR_NAME = ".cli-agent-runner";
const BASELINE_GIT_CONFIG = [
  "-c", "user.name=CLI Agent Runner",
  "-c", "user.email=cli-agent-runner@localhost",
  "-c", "commit.gpgsign=false",
  "-c", "core.hooksPath=/dev/null",
];

function toPosix(relative) {
  return relative.split(path.sep).join("/");
}

function isSkipped(name, relativeDir) {
  return name === ".git" || (relativeDir === "" && name === STATE_DIR_NAME);
}

function copyTree(sourceRoot, destinationRoot, relativeDir = "") {
  const sourceDir = path.join(sourceRoot, relativeDir);
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (isSkipped(entry.name, relativeDir)) continue;
    const relative = path.join(relativeDir, entry.name);
    const source = path.join(sourceRoot, relative);
    const destination = path.join(destinationRoot, relative);
    const stat = lstatSync(source);
    if (stat.isDirectory()) {
      mkdirSync(destination, { recursive: true, mode: 0o700 });
      copyTree(sourceRoot, destinationRoot, relative);
    } else if (stat.isSymbolicLink()) {
      symlinkSync(copiedLinkValue(sourceRoot, destinationRoot, source, destination), destination);
    } else if (stat.isFile()) {
      copyFileSync(source, destination, fsConstants.COPYFILE_FICLONE);
      chmodSync(destination, stat.mode & 0o7777);
    }
  }
}

// A link that resolves inside the worktree must keep pointing inside the
// copy; an absolute value would let the worker write into the real target.
// Links that leave the worktree are copied verbatim, as a worker could follow
// them in the real worktree too.
function copiedLinkValue(sourceRoot, destinationRoot, source, destination) {
  const value = readlinkSync(source);
  const resolved = path.resolve(path.dirname(source), value);
  const inside = path.relative(sourceRoot, resolved);
  if (!path.isAbsolute(value) || inside.startsWith("..") || path.isAbsolute(inside)) return value;
  return path.relative(path.dirname(destination), path.join(destinationRoot, inside)) || ".";
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function realInfoExclude(gitRoot) {
  try {
    const file = git(gitRoot, ["rev-parse", "--git-path", "info/exclude"]).trim();
    const absolute = path.resolve(gitRoot, file);
    return existsSync(absolute) ? readFileSync(absolute) : null;
  } catch {
    return null;
  }
}

/**
 * Creates one job copy of `gitRoot`.  `targetPrefix` is the target cwd
 * relative to the Git root ("" when the target is the root); the job runs in
 * `cwd`, the same relative location inside the copy.
 */
export function createOrchestrationWorkspace({ gitRoot, targetPrefix }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cli-agent-runner-shadow-"));
  try {
    copyTree(gitRoot, root);
    git(root, ["init", "-q"]);
    const exclude = realInfoExclude(gitRoot);
    if (exclude) {
      mkdirSync(path.join(root, ".git", "info"), { recursive: true });
      writeFileSync(path.join(root, ".git", "info", "exclude"), exclude);
    }
    git(root, ["add", "-A"]);
    git(root, [...BASELINE_GIT_CONFIG, "commit", "-q", "--no-verify", "--allow-empty", "-m", "cli-agent-runner baseline"]);
    const cwd = targetPrefix ? path.join(root, targetPrefix) : root;
    mkdirSync(cwd, { recursive: true });
    return { root, cwd, targetPrefix };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function fingerprint(absolute) {
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return `symlink:${readlinkSync(absolute)}`;
  if (stat.isFile()) {
    const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    return `file:${(stat.mode & 0o7777).toString(8)}:${digest}`;
  }
  return `other:${stat.mode.toString(8)}`;
}

function collectFiles(root, relative, out) {
  const absolute = path.join(root, relative);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw error;
  }
  if (!stat.isDirectory()) {
    out.set(toPosix(relative), fingerprint(absolute));
    return;
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (isSkipped(entry.name, relative === "." ? "" : relative)) continue;
    collectFiles(root, relative === "." ? entry.name : path.join(relative, entry.name), out);
  }
}

/**
 * Fingerprints every file and symlink under the given Git-root-relative
 * prefixes ("." for the whole tree), including Git-ignored files.
 */
export function snapshotPrefixes(root, rootPrefixes) {
  const out = new Map();
  for (const prefix of rootPrefixes) collectFiles(root, prefix, out);
  return out;
}

/**
 * Returns the job's in-scope changes as a Map of Git-root-relative path to
 * "write" or "delete", comparing the copy now against `baseline`.
 */
export function collectWorkspaceChanges(workspace, baseline, rootPrefixes) {
  const after = snapshotPrefixes(workspace.root, rootPrefixes);
  const changes = new Map();
  for (const [relative, before] of baseline) {
    if (!after.has(relative)) changes.set(relative, "delete");
    else if (after.get(relative) !== before) changes.set(relative, "write");
  }
  for (const relative of after.keys()) {
    if (!baseline.has(relative)) changes.set(relative, "write");
  }
  return changes;
}

function assertNoSymlinkAncestor(gitRoot, relative) {
  const parts = relative.split("/").slice(0, -1);
  let current = gitRoot;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`orchestration refuses to write through a symlinked directory: ${relative}`);
    if (!stat.isDirectory()) throw new Error(`orchestration path parent is not a directory: ${relative}`);
  }
}

/**
 * Writes one job's changes into the real worktree.  Every path is checked
 * first against the real worktree's state when the job started, so a
 * concurrent edit is never overwritten and a job is applied entirely or not
 * at all.
 */
export function integrateOrchestrationChanges({ gitRoot, workspace, changes, targetBaseline }) {
  for (const relative of changes.keys()) {
    if (!relative || relative.startsWith("/") || relative.split("/").includes("..") || relative.split("/").includes(".git")) {
      throw new Error(`unsafe orchestration path: ${relative}`);
    }
    const expected = targetBaseline.has(relative) ? targetBaseline.get(relative) : null;
    if (fingerprint(path.join(gitRoot, relative)) !== expected) {
      throw new Error(`target changed while orchestrating: ${relative}`);
    }
    assertNoSymlinkAncestor(gitRoot, relative);
  }
  for (const [relative, action] of changes) {
    const destination = path.join(gitRoot, relative);
    rmSync(destination, { force: true });
    if (action === "delete") continue;
    const source = path.join(workspace.root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      symlinkSync(integratedLinkValue(workspace.root, gitRoot, source), destination);
    } else {
      copyFileSync(source, destination);
      chmodSync(destination, stat.mode & 0o7777);
    }
  }
}

function integratedLinkValue(workspaceRoot, gitRoot, source) {
  const value = readlinkSync(source);
  if (!path.isAbsolute(value)) return value;
  const inside = path.relative(workspaceRoot, value);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return value;
  return path.join(gitRoot, inside);
}

export function cleanupOrchestrationWorkspace(workspace) {
  if (workspace?.root) rmSync(workspace.root, { recursive: true, force: true });
}
