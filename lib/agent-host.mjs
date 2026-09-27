/**
 * Resolves which agent host (Codex or Claude Code) is running this process.
 *
 * AGENT_HOST=codex|claude_code wins; otherwise CLAUDECODE=1 (set by Claude Code
 * for MCP servers and Bash tool subprocesses) means Claude Code; anything else
 * keeps the Codex behaviour. Unknown AGENT_HOST values fall through.
 */
export const AGENT_HOSTS = Object.freeze(["codex", "claude_code"]);

export function resolveAgentHost(env = process.env) {
  const explicit = env.AGENT_HOST?.trim();
  if (AGENT_HOSTS.includes(explicit)) return explicit;
  if (env.CLAUDECODE === "1") return "claude_code";
  return "codex";
}
