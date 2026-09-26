# Contributing / コントリビューション

Thank you for improving CLI Agent Runner. Keep each change focused on one purpose and preserve the provider-neutral runner path.

CLI Agent Runnerへの改善を歓迎します。一つの変更は一つの目的に絞り、provider非依存のrunner経路を保ってください。

## Before changing source / ソース変更前

- Use Node.js 22 or later.
- Read the repository-root `CLAUDE.md`. Its refresh route activates only for an explicit install or refresh request; ordinary development must not mutate a marketplace or installed cache.
- Check `git status` and preserve unrelated work.
- Treat this repository as source of truth. Never edit `~/.claude/plugins/cache/` as source.

## Implementation boundaries / 実装境界

- Add runner behavior through the shared registry, process runner, stream adapter, or broker contract rather than a provider-ID branch.
- Keep a worker's descendant authority inside its inherited scope and finite hierarchy ceiling.
- Do not commit `.cli-agent-runner/` workflow state, Live Console tokens, local runner secrets, caches, or logs.
- Update both English and Japanese README sections when public behavior or installation changes.

## Required check / 必須確認

Run the repository acceptance command once:

```sh
npm run check
```

Do not run `claude-plugin-refresh`, refresh a plugin cache, or restart Claude Code as part of development unless the current user explicitly authorized that operation.

## Pull requests / Pull Request

Describe the user-visible outcome, changed responsibility boundary, acceptance evidence, and any remaining limitation. Keep unrelated formatting or cleanup out of the same pull request.

Security vulnerabilities should follow [`SECURITY.md`](SECURITY.md), not a public issue.
