# Install CLI Agent Runner with Claude Code

This file is the installation execution contract delegated by the repository-root `AGENTS.md`. Apply it only after the current user explicitly asks to install, set up, or activate this plugin in Claude Code.

## Goal and boundaries

Install `cli-agent-runner` through the Claude Code marketplace that this repository publishes in `.claude-plugin/marketplace.json`, using only the official `claude plugin` commands. Preserve unrelated user configuration. Never edit an installed plugin cache directly.

The route needs no clone, maintainer-specific path, private file, or hidden manual step. Claude Code fetches the repository itself.

## Preconditions

Confirm all of the following before mutation:

- Node.js 22 or later is available. The plugin's skill runs its bundled CLI with `node`.
- `claude` exposes `claude plugin marketplace add`, `claude plugin install`, `claude plugin list --json`, and `claude plugin marketplace list --json`.
- The current request authorizes adding one user-scope marketplace and installing one plugin.

The bundled `codex-cli`, `claude-cli`, and `grok-cli` runner profiles require their corresponding authenticated CLIs only when selected. Missing provider CLIs do not block plugin installation.

If a required precondition is unavailable, stop and report the exact missing prerequisite. Do not invent an alternate cache or configuration route.

## Fixed installation sequence

1. Run `claude plugin list --json`. If any entry's `id` starts with `cli-agent-runner@`, the plugin is already installed; never install a second copy. Then:
   - If the `id` is `cli-agent-runner@cli-agent-runner`, update it: run `claude plugin marketplace update cli-agent-runner`, then `claude plugin update cli-agent-runner@cli-agent-runner`, and continue at step 5.
   - If the `id` names another marketplace, stop and report the existing `id` and `version`. That copy is updated through its own marketplace's route, which this contract does not own.
2. Run `claude plugin marketplace list --json`. If a marketplace named `cli-agent-runner` exists and does not point to `mlabo-org/cli-agent-runner`, stop and report the collision. Do not remove or replace it.
3. Unless step 2 found this marketplace already configured, run `claude plugin marketplace add mlabo-org/cli-agent-runner` once.
4. Run `claude plugin install cli-agent-runner@cli-agent-runner` once.
5. Run `claude plugin list --json` and confirm an enabled `cli-agent-runner@cli-agent-runner` entry with a version.
6. Tell the user to open a new Claude Code session so the skill is loaded. Do not claim the current session hot-reloaded the plugin.
7. In the new session, use this non-executing verification prompt: `CLI Agent Runner の利用条件、標準 runner、Live Console の既定動作を説明して。CLI worker はまだ起動しないで。`

## Completion report

Report:

- marketplace name and source;
- whether the plugin was newly installed or updated, and whether the marketplace was added or already configured;
- exact `claude plugin install` selector;
- installed version reported by `claude plugin list --json`;
- required new session and verification prompt;
- optional provider CLIs that remain unavailable or unauthenticated, when known;
- any uncompleted step or blocker.
