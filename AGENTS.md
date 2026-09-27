# Plugin Installation Router

This file is the scoped `AGENTS.md` SSOT for one decision: an explicit request to install, set up, refresh, or activate this repository as a plugin for the host agent (Codex or Claude Code). `CLAUDE.md` only points here. It is an execution contract, not general development guidance. Higher-priority system, developer, user, and ancestor instructions still apply.

## Narrow scope

- Trigger this contract only when the current user explicitly asks to install, set up, refresh, or activate `cli-agent-runner` from this repository.
- A request to inspect, explain, review, develop, test, document, or use the repository does not trigger installation.
- Outside the explicit installation trigger, do not run the installer or `claude-plugin-refresh`, edit a marketplace, install or refresh a plugin, touch `~/.codex/plugins/cache/` or `~/.claude/plugins/cache/`, change Codex or Claude Code configuration, or add installation-specific process. Follow the current request and other applicable instructions normally.
- This file does not govern the installed plugin's runtime behavior. The plugin manifest, bundled skill, runner registry, and executable source own that behavior.

## Installation route

When the trigger applies, follow the route for the host that asked:

- In Codex:
  1. Read `docs/INSTALL_FOR_CODEX.md` completely. That file is the delegated execution contract for this one installation decision.
  2. Follow its preflight, canonical-source, mutation, verification, and reporting sequence exactly.
  3. Stop on any blocker it defines. Do not replace its official-CLI route with cache editing or maintainer-specific paths.
- In Claude Code:
  1. This checkout is the source of truth registered in the local Claude Code marketplace.
  2. Run `npm run check` and stop on failure.
  3. Refresh through `claude-plugin-refresh`. It stages only Git-visible files, generates `.claude-plugin/plugin.json` itself, runs `.claude-plugin/refresh.json` post-steps if present, and updates the installed plugin. Never edit the installed cache directly.
  4. Report the refreshed state and that a new Claude Code session is required to load it.

When materially editing this router, apply `agents-md-clarifier` before final reporting or commit. This maintenance condition does not apply to ordinary repository work or plugin installation.
