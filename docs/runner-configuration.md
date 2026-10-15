# Runner Configuration

CLI Agent Runner resolves every process runner through the same JSON registry. The bundled defaults live in `config/runners.default.json` and provide `codex-cli`, `claude-cli`, and `grok-cli`.

## Configuration layers

Definitions are merged in this order, with later fields overriding earlier fields for the same runner ID:

1. Bundled `config/runners.default.json`.
2. `$XDG_CONFIG_HOME/cli-agent-runner/runners.json`, or `~/.config/cli-agent-runner/runners.json` when `XDG_CONFIG_HOME` is unset.
3. The path named by `CLI_AGENT_RUNNER_CONFIG`.
4. The path passed with `--runner-config <path>`.

Relative paths supplied by the environment variable or flag resolve from the invocation working directory. Missing optional files are ignored. A missing explicitly named file, invalid JSON, invalid profile, or unknown runner ID fails before `runner.md` is appended and before a child process starts.

The jobsite's `.cli-agent-runner/` directory is workflow state only and is never a runner configuration layer. Runner JSON selects a local executable and is therefore executable configuration: review it before use and keep user, environment-selected, and flag-selected config outside paths that a child worker can write.

## File format

```json
{
  "version": 1,
  "runners": {
    "gemini-cli": {
      "description": "Example custom CLI",
      "command": "gemini",
      "args": ["--approval-mode", "auto_edit", "--prompt", "{prompt}"],
      "prompt": "argument",
      "result": "stdout",
      "stream": "text",
      "timeoutMs": 180000,
      "defaultHierarchyDepth": 1
    }
  }
}
```

Each runner supports these fields:

- `command`: executable name resolved through `PATH`, or an absolute executable path.
- `args`: argument array. CLI Agent Runner never joins this into a shell command.
- `prompt`: `argument` or `stdin`. Argument mode requires exactly one `{prompt}` placeholder; stdin mode forbids it.
- `result`: `stdout`, `stderr`, or `output-file`. Output-file mode requires `{output_file}`.
- `stream`: `text`, `ndjson`, or `messages-json`. It defaults to `text` for new custom profiles. With `messages-json` and `result: "stdout"`, the result is the provider's `result` line when present, otherwise the last assistant message only; a `result` line with `is_error: true` fails the run.
- `timeoutMs`: optional positive process timeout in milliseconds. `--timeout-ms` overrides it; without either, the timeout is 120000 ms (2 minutes). Set a larger value for real agent work. The timeout stops the worker's whole process group. It is independent of the supervision `hard_timeout`, which is workflow guidance for the parent rather than a process limit.
- `defaultHierarchyDepth`: optional integer from `0` through `8`. It defines the parent-owned maximum descendant permission when the invocation omits hierarchy fields; `0` explicitly declares that the model profile may not create descendants, `1` permits direct children only, and larger values produce a bounded `n_level` hierarchy. The assigned worker decides whether to use any permitted depth. Model suitability belongs here rather than in an unrecorded per-run parent decision. Explicit hierarchy fields that replace this profile value require `--hierarchy-override-reason user_request|safety_boundary|scope_boundary|capability_boundary`; the CLI rejects an unreasoned replacement before assignment append or process launch.
- `webDisableArgs`: optional array of non-empty strings without placeholders. It names the arguments that keep the child off the web, and it must appear in `args` as one contiguous run. They stay in place by default; `--allow-web` removes exactly that run for one invocation. An overlay that replaces `args` without that run fails validation, so override both together (`"webDisableArgs": []` declares a profile with no web switch).
- `description`: optional single-line description.

Available argument placeholders are `{prompt}`, `{cwd}`, and `{output_file}`. The child process always runs with the jobsite as its process working directory, inherits the current environment, and runs as its own process group; processes it leaves running are stopped when it exits. Captured stdout and stderr keep their last 8 MiB each, with a truncation marker at the start when earlier output was dropped. The machine-checkable scope guard fails closed when Git inspection is unavailable, but it remains a post-run Git change detector rather than an operating-system write sandbox; ignored paths and paths outside the repository require the selected provider's permission model or a separate sandbox.

## Web access and text-gate

Children do not read the web by default. The bundled profiles declare these `webDisableArgs`:

- `grok-cli`: `--disable-web-search` ("Disable web search and web fetch tools" in `grok --help`).
- `codex-cli`: `-c web_search="disabled"`. Codex turns on a cached web-search tool unless `web_search` says otherwise ("Codex defaults to using a web search cache", and `web_search` defaults to `"cached"`, or `"live"` under a full-access sandbox, in the Codex config reference). Network access needs no override: the `workspace-write` sandbox the profile selects "keeps network access turned off unless you enable it in your configuration".
- `claude-cli`: `--disallowedTools WebFetch WebSearch`. This covers Claude Code's built-in web tools only; web-capable MCP servers configured for the child are not covered by this flag.

`--allow-web` on `run` or `orchestrate` removes those arguments for that invocation only; brokered descendants of the run inherit the same choice, and the next run is back to the default. For Codex this returns to Codex's own default (cached web search, network still off in `workspace-write`); it does not select live search. The run prints `ok web_access: disabled`, `allowed`, or `undeclared` (a profile without `webDisableArgs`).

Every rendered child prompt, including brokered descendants' prompts, is passed through `text-gate scan --mode untrusted` before launch. The binary is `~/.local/bin/text-gate`; `CLI_AGENT_RUNNER_TEXT_GATE` names a different absolute path (the test suite uses this for its stand-in). If the report lists a spoofed domain, the child is not launched and the run fails with the gate's alert (`（偽ドメイン！ / spoofed domain）` plus the punycode). If text-gate is missing, exits nonzero, times out, or returns a malformed report, the run fails closed without launching. Otherwise the child receives the gate's sanitized text.

The child's final answer (the source of `summary`, blockers, finalization references, and metacognitive fields), a provider error result, scope-guard failure text, and every Live Console event (`text` and `data`) go through the same scan. Invisible characters are removed; spoofed domains are kept but annotated inline and in a leading alert line with their punycode. Text that is pure ASCII and contains no `xn--` (case-insensitive) cannot carry either and skips the spawn. If text-gate fails on the result, the output is withheld and the run is marked failed; a Live Console event that cannot be gated is replaced by a withheld notice. Console events are gated one by one, so a domain split across two output chunks is only caught in the final result.

## Running a profile

`--role` is a caller-defined responsibility label, not an enum. Any non-empty single-line value is valid, and CLI Agent Runner preallocates no role roster.

```sh
node bin/cli-agent-runner.mjs run \
  --target-cwd /path/to/jobsite \
  --role "Gemini Integration Owner" \
  --task-id my-task \
  --epoch e1 \
  --scope "scope:v1 paths=src/,tests/" \
  --assignment "Implement the scoped change" \
  --expected-output "Changed files and verification" \
  --runner gemini-cli
```

Use `--runner claude-cli` or `--runner grok-cli` for the bundled Claude and Grok profiles. Authentication remains owned by each installed CLI; keep credentials in the CLI's normal credential store or process environment rather than in runner JSON.

The bundled `grok-cli` profile sets `defaultHierarchyDepth` to `1`. The parent therefore permits one direct-child level by default, Grok decides whether a child is useful for the assignment, and any direct child receives no remaining descendant depth. Bundled Codex and Claude profiles retain the zero-depth workflow default. Parent-owned concurrency, time, budget, operation-scope, and permission-inheritance limits remain boundaries around that decision. A reasoned opt-out is written as `--hierarchy-mode none --hierarchy-override-reason user_request` when the current user requests it, or with the matching concrete safety, scope, or capability reason. The same guard applies to custom profiles that declare `defaultHierarchyDepth`; it is not a Grok-specific execution branch, and CLI Agent Runner does not independently reassess whether delegation should occur.

`--delegation-mode local_orchestrator` activates the runner-owned broker route. When the selected profile has no `defaultHierarchyDepth` and no explicit hierarchy fields were supplied, this explicit mode supplies one direct-child level; bundled Codex and Claude therefore use the same broker implementation as Grok without changing their ordinary leaf default. Profiles with a declared hierarchy default retain that default unless the reasoned override contract is satisfied.

The worker-only `delegate` client always reuses the immediate worker's resolved runner profile. It cannot select another runner or config source. The broker launches descendants through the same validated command-and-argument path, requires unique IDs and non-overlapping focus scopes inside the inherited authority, confines concurrent descendants to their collective declared focus set, decrements depth, and reuses the current Live Console lineage.

Process activity publishes to the built-in Live Console viewer (opened in the host browser: Codex IAB or the Claude Code browser pane) by default. Direct `run --runner <id>` owns server startup, URL injection, completed-state retention, and signal-driven cleanup without requiring `--live-console`. The plugin skill starts and opens `live-console` before project work, then reuses it through `--live-console-url <url>` for later runners. Only `--no-live-console` or `--silent` disables the console, and either OFF selector is incompatible with positive console options. The executable still launches every profile through the same validated command-and-argument path; `stream` selects decoding behavior and does not introduce provider-ID branches.
