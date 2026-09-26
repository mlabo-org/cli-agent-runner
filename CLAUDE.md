# Claude Code Plugin Refresh Router

This file is the scoped `CLAUDE.md` SSOT for one decision: an explicit request to install, refresh, or activate this repository as a Claude Code plugin. It is an execution contract, not general development guidance. Higher-priority system, developer, user, and ancestor instructions still apply.

## Narrow scope

- Trigger this contract only when the current user explicitly asks to install, refresh, or activate `cli-agent-runner` from this repository.
- A request to inspect, explain, review, develop, test, document, or use the repository does not trigger installation.
- Outside the explicit trigger, do not run `claude-plugin-refresh`, edit the `suzuki-local-plugins` marketplace, touch `~/.claude/plugins/cache/`, change Claude Code configuration, or add installation-specific process. Follow the current request and other applicable instructions normally.
- This file does not govern the installed plugin's runtime behavior. The bundled skill, runner registry, and executable source own that behavior.

## Refresh route

When the trigger applies:

1. This checkout (`~/.claude/local-plugins/plugins/cli-agent-runner/`) is the source of truth, registered in the `suzuki-local-plugins` marketplace.
2. Run `npm run check` and stop on failure.
3. Refresh through `claude-plugin-refresh`. It stages only Git-visible files, generates `.claude-plugin/plugin.json` itself, runs `.claude-plugin/refresh.json` post-steps if present, and updates the installed plugin. Never edit the installed cache directly.
4. Report the refreshed state and that a new Claude Code session is required to load it.

When materially editing this router, apply `agents-md-clarifier` before final reporting or commit. This maintenance condition does not apply to ordinary repository work or plugin refresh.
