import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNNER_CONFIG_ENV = "CLI_AGENT_RUNNER_CONFIG";
export const PROJECT_RUNNER_CONFIG_FILE = "runners.json";
export const DEFAULT_RUNNER_CONFIG_PATH = fileURLToPath(
  new URL("../config/runners.default.json", import.meta.url),
);

const CONFIG_VERSION = 1;
const RUNNER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PROFILE_KEYS = new Set([
  "description",
  "command",
  "args",
  "prompt",
  "result",
  "stream",
  "timeoutMs",
  "defaultHierarchyDepth",
]);
const MAX_DEFAULT_HIERARCHY_DEPTH = 8;
const PROMPT_TRANSPORTS = new Set(["argument", "stdin"]);
const RESULT_SOURCES = new Set(["stdout", "stderr", "output-file"]);
const STREAM_FORMATS = new Set(["text", "ndjson", "messages-json"]);
const PLACEHOLDERS = new Set(["prompt", "cwd", "output_file"]);

export function resolveConfiguredRunner(options) {
  const runnerId = requireRunnerId(options.runnerId, "--runner");
  const registry = loadRunnerRegistry(options);
  const profile = registry.runners[runnerId];
  if (!profile) {
    throw new Error(
      `unknown runner: ${runnerId}; configured runners: ${Object.keys(registry.runners).sort().join(", ")}`,
    );
  }
  return {
    runnerId,
    profile,
    sourcePaths: registry.sourcePaths,
    profileSource: registry.profileSources[runnerId],
  };
}

export function loadRunnerRegistry(options = {}) {
  const invocationCwd = path.resolve(options.invocationCwd || process.cwd());
  const stateDir = options.stateDir ? path.resolve(options.stateDir) : null;
  const environment = options.environment || process.env;
  const candidates = runnerConfigCandidates({
    invocationCwd,
    stateDir,
    environment,
    explicitConfigPath: options.explicitConfigPath,
  });
  const runners = {};
  const profileSources = {};
  const sourcePaths = [];
  const loaded = new Set();

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      if (candidate.required) {
        throw new Error(`runner config does not exist (${candidate.label}): ${candidate.path}`);
      }
      continue;
    }
    if (loaded.has(candidate.path)) continue;
    loaded.add(candidate.path);

    const document = readRunnerConfig(candidate.path);
    sourcePaths.push(candidate.path);
    for (const [runnerId, overlay] of Object.entries(document.runners)) {
      const current = runners[runnerId] || { prompt: "argument", result: "stdout", stream: "text" };
      runners[runnerId] = { ...current, ...overlay };
      profileSources[runnerId] = candidate.path;
    }
  }

  for (const [runnerId, profile] of Object.entries(runners)) {
    validateCompleteProfile(runnerId, profile, profileSources[runnerId]);
  }

  return { version: CONFIG_VERSION, runners, profileSources, sourcePaths };
}

export function buildRunnerInvocation(profile, values) {
  const replacements = {
    prompt: String(values.prompt),
    cwd: path.resolve(values.cwd),
    output_file: path.resolve(values.outputFile),
  };
  const args = profile.args.map((argument) => replacePlaceholders(argument, replacements));
  return {
    command: profile.command,
    args,
    input: profile.prompt === "stdin" ? replacements.prompt : undefined,
    resultSource: profile.result,
  };
}

function runnerConfigCandidates({ invocationCwd, stateDir, environment, explicitConfigPath }) {
  const candidates = [{
    label: "built-in defaults",
    path: path.resolve(DEFAULT_RUNNER_CONFIG_PATH),
    required: true,
  }];
  const configHome = environment.XDG_CONFIG_HOME
    ? path.resolve(environment.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  candidates.push({
    label: "user config",
    path: path.join(configHome, "cli-agent-runner", PROJECT_RUNNER_CONFIG_FILE),
    required: false,
  });
  if (stateDir) {
    candidates.push({
      label: "jobsite config",
      path: path.join(stateDir, PROJECT_RUNNER_CONFIG_FILE),
      required: false,
    });
  }
  if (environment[RUNNER_CONFIG_ENV]?.trim()) {
    candidates.push({
      label: RUNNER_CONFIG_ENV,
      path: resolveConfigPath(environment[RUNNER_CONFIG_ENV], invocationCwd),
      required: true,
    });
  }
  if (explicitConfigPath?.trim()) {
    candidates.push({
      label: "--runner-config",
      path: resolveConfigPath(explicitConfigPath, invocationCwd),
      required: true,
    });
  }
  return candidates;
}

function resolveConfigPath(value, invocationCwd) {
  const configPath = String(value).trim();
  return path.isAbsolute(configPath) ? path.resolve(configPath) : path.resolve(invocationCwd, configPath);
}

function readRunnerConfig(filePath) {
  let document;
  try {
    document = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid runner config JSON ${filePath}: ${error.message}`);
  }
  if (!isPlainObject(document)) {
    throw new Error(`invalid runner config ${filePath}: top level must be an object`);
  }
  if (document.version !== CONFIG_VERSION) {
    throw new Error(`invalid runner config ${filePath}: version must be ${CONFIG_VERSION}`);
  }
  if (!isPlainObject(document.runners)) {
    throw new Error(`invalid runner config ${filePath}: runners must be an object`);
  }
  for (const [runnerId, profile] of Object.entries(document.runners)) {
    requireRunnerId(runnerId, `runner id in ${filePath}`);
    validateProfileOverlay(runnerId, profile, filePath);
  }
  return document;
}

function validateProfileOverlay(runnerId, profile, sourcePath) {
  if (!isPlainObject(profile)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: profile must be an object`);
  }
  const unknownKeys = Object.keys(profile).filter((key) => !PROFILE_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: unknown fields ${unknownKeys.join(", ")}`);
  }
  if (profile.description !== undefined) requireSingleLineString(profile.description, `${runnerId}.description`, sourcePath);
  if (profile.command !== undefined) requireSingleLineString(profile.command, `${runnerId}.command`, sourcePath);
  if (profile.args !== undefined) {
    if (!Array.isArray(profile.args) || profile.args.some((value) => typeof value !== "string" || value.includes("\0"))) {
      throw new Error(`invalid runner ${runnerId} in ${sourcePath}: args must be an array of strings without NUL bytes`);
    }
  }
  if (profile.prompt !== undefined && !PROMPT_TRANSPORTS.has(profile.prompt)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: prompt must be argument or stdin`);
  }
  if (profile.result !== undefined && !RESULT_SOURCES.has(profile.result)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: result must be stdout, stderr, or output-file`);
  }
  if (profile.stream !== undefined && !STREAM_FORMATS.has(profile.stream)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: stream must be text, ndjson, or messages-json`);
  }
  if (profile.timeoutMs !== undefined && !isPositiveSafeInteger(profile.timeoutMs)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: timeoutMs must be a positive integer`);
  }
  if (
    profile.defaultHierarchyDepth !== undefined
    && (!Number.isSafeInteger(profile.defaultHierarchyDepth)
      || profile.defaultHierarchyDepth < 0
      || profile.defaultHierarchyDepth > MAX_DEFAULT_HIERARCHY_DEPTH)
  ) {
    throw new Error(
      `invalid runner ${runnerId} in ${sourcePath}: defaultHierarchyDepth must be an integer from 0 to ${MAX_DEFAULT_HIERARCHY_DEPTH}`,
    );
  }
}

function validateCompleteProfile(runnerId, profile, sourcePath) {
  requireSingleLineString(profile.command, `${runnerId}.command`, sourcePath);
  if (!Array.isArray(profile.args)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: args are required`);
  }
  if (!PROMPT_TRANSPORTS.has(profile.prompt)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: prompt must be argument or stdin`);
  }
  if (!RESULT_SOURCES.has(profile.result)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: result must be stdout, stderr, or output-file`);
  }
  if (!STREAM_FORMATS.has(profile.stream)) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: stream must be text, ndjson, or messages-json`);
  }

  const placeholderNames = profile.args.flatMap((argument) =>
    [...argument.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1])
  );
  const unknown = [...new Set(placeholderNames.filter((name) => !PLACEHOLDERS.has(name)))];
  if (unknown.length) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: unknown placeholders ${unknown.join(", ")}`);
  }
  const promptCount = placeholderNames.filter((name) => name === "prompt").length;
  if (profile.prompt === "argument" && promptCount !== 1) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: argument prompt transport requires exactly one {prompt}`);
  }
  if (profile.prompt === "stdin" && promptCount !== 0) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: stdin prompt transport cannot include {prompt}`);
  }
  if (profile.result === "output-file" && !placeholderNames.includes("output_file")) {
    throw new Error(`invalid runner ${runnerId} in ${sourcePath}: output-file result requires {output_file}`);
  }
}

function requireRunnerId(value, label) {
  const runnerId = String(value || "").trim();
  if (!RUNNER_ID_PATTERN.test(runnerId)) {
    throw new Error(`invalid ${label}: expected lowercase letters, numbers, dot, underscore, or hyphen`);
  }
  return runnerId;
}

function requireSingleLineString(value, field, sourcePath) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error(`invalid runner config ${sourcePath}: ${field} must be a non-empty single-line string`);
  }
}

function replacePlaceholders(argument, replacements) {
  return argument.replace(/\{(prompt|cwd|output_file)\}/g, (_, name) => replacements[name]);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
