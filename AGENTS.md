# Plugin Installation Router

This file is the scoped `AGENTS.md` SSOT for one decision: an explicit request to install, set up, refresh, or activate this repository as a plugin for the host agent (Codex or Claude Code). `CLAUDE.md` only points here. It is an execution contract, not general development guidance. Higher-priority system, developer, user, and ancestor instructions still apply.

## Narrow scope

- Trigger this contract only when the current user explicitly asks to install, set up, refresh, or activate `cli-agent-runner` from this repository.
- A request to inspect, explain, review, develop, test, document, or use the repository does not trigger installation.
- Outside the explicit installation trigger, do not run the installer or a `claude plugin` install or marketplace command, edit a marketplace, install or refresh a plugin, touch `~/.codex/plugins/cache/` or `~/.claude/plugins/cache/`, change Codex or Claude Code configuration, or add installation-specific process. Follow the current request and other applicable instructions normally.
- This file does not govern the installed plugin's runtime behavior. The plugin manifest, bundled skill, runner registry, and executable source own that behavior.

## Installation route

When the trigger applies, follow the route for the host that asked:

1. Read the delegated execution contract for that host completely:
   - Codex: `docs/INSTALL_FOR_CODEX.md`.
   - Claude Code: `docs/INSTALL_FOR_CLAUDE_CODE.md`.
2. Follow its preflight, canonical-source handling (where the contract defines it), mutation, verification, and reporting sequence exactly.
3. Stop on any blocker it defines. Do not replace its official-CLI route with cache editing or maintainer-specific paths.

When materially editing this router, apply `agents-md-clarifier` before final reporting or commit. This maintenance condition does not apply to ordinary repository work or plugin installation.
