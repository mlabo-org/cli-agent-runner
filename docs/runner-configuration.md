# Runner Configuration

CLI Agent Runner resolves every process runner through the same JSON registry. The bundled defaults live in `config/runners.default.json` and provide `codex-cli`, `claude-cli`, and `grok-cli`.

## Configuration layers

Definitions are merged in this order, with later fields overriding earlier fields for the same runner ID:

1. Bundled `config/runners.default.json`.
2. `$XDG_CONFIG_HOME/cli-agent-runner/runners.json`, or `~/.config/cli-agent-runner/runners.json` when `XDG_CONFIG_HOME` is unset.
3. The jobsite's `<git-root>/.cli-agent-runner/runners.json`.
4. The path named by `CLI_AGENT_RUNNER_CONFIG`.
5. The path passed with `--runner-config <path>`.

Relative paths supplied by the environment variable or flag resolve from the invocation working directory. Missing optional files are ignored. A missing explicitly named file, invalid JSON, invalid profile, or unknown runner ID fails before `runner.md` is appended and before a child process starts.

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
- `stream`: `text`, `ndjson`, or `messages-json`. It defaults to `text` for new custom profiles. `messages-json` reconstructs assistant text from Anthropic Messages text deltas for the existing stdout result contract.
- `timeoutMs`: optional positive default timeout. `--timeout-ms` overrides it.
- `defaultHierarchyDepth`: optional integer from `0` through `8`. It applies only when the invocation omits every hierarchy flag; `0` means no descendants, `1` means direct children only, and larger values produce a bounded `n_level` hierarchy. Any explicit `--hierarchy-mode`, `--max-depth`, `--depth`, or `--remaining-depth` value overrides this profile default.
- `description`: optional single-line description.

Available argument placeholders are `{prompt}`, `{cwd}`, and `{output_file}`. The child process always runs with the jobsite as its process working directory, inherits the current environment, and remains subject to the existing machine-checkable scope guard.

## Running a profile

```sh
node bin/cli-agent-runner.mjs run \
  --target-cwd /path/to/jobsite \
  --role Implementer \
  --task-id my-task \
  --epoch e1 \
  --scope "scope:v1 paths=src/,tests/" \
  --assignment "Implement the scoped change" \
  --expected-output "Changed files and verification" \
  --runner gemini-cli
```

Use `--runner claude-cli` or `--runner grok-cli` for the bundled Claude and Grok profiles. Authentication remains owned by each installed CLI; keep credentials in the CLI's normal credential store or process environment rather than in runner JSON.

The bundled `grok-cli` profile sets `defaultHierarchyDepth` to `1`, so Grok may create direct child agents when the parent decides delegation is useful. Those children receive no remaining descendant depth. Bundled Codex and Claude profiles retain the zero-depth default. Pass `--hierarchy-mode none` to opt a Grok run out, or provide another explicit finite hierarchy selection to override the profile default.

Process activity publishes to the built-in IAB viewer by default. Direct `run --runner <id>` owns server startup, URL injection, completed-state retention, and signal-driven cleanup without requiring `--live-console`. The plugin skill starts and opens `live-console` before project work, then reuses it through `--live-console-url <url>` for later runners. Only `--no-live-console` or `--silent` disables the console, and either OFF selector is incompatible with positive console options. The executable still launches every profile through the same validated command-and-argument path; `stream` selects decoding behavior and does not introduce provider-ID branches.
