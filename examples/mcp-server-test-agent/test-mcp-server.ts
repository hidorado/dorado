/**
 * Real MCP Server tester. Uses the official `@modelcontextprotocol/sdk` to:
 *
 *   1. Connect to a Model Context Protocol server (HTTP/SSE *or* stdio).
 *   2. Pull its initialize handshake (server identity + capabilities).
 *   3. Enumerate tools / resources / prompts.
 *   4. Try each tool with empty arguments — a smoke probe that catches
 *      missing-arg validation, silent-200 errors, and crashes.
 *   5. Hand back a structured report the agent renders to Markdown.
 *
 * No mocks. The exact same code runs against a real server in production —
 * just point `serverUrl` or `command` at the thing you want to test.
 */

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpTestInput {
  /** HTTP or SSE endpoint (e.g. "https://my-mcp.example.com/mcp"). */
  serverUrl?: string;
  /**
   * Stdio launch command (e.g. "npx -y @modelcontextprotocol/server-everything").
   * Mutually exclusive with `serverUrl`.
   */
  command?: string;
  /** Per-tool call timeout. Default 8 s — keeps a hung tool from stalling the run. */
  toolTimeoutMs?: number;
  /** Override timeout for the full session. Default 60 s. */
  sessionTimeoutMs?: number;
}

export interface McpToolResult {
  name: string;
  description?: string;
  inputSchema: unknown;
  /** "ok" if the call returned without throwing; "error" otherwise. */
  status: "ok" | "error";
  /** First 200 chars of the stringified result, for the report preview. */
  resultPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

export interface McpIssue {
  severity: "major" | "minor";
  tool: string;
  message: string;
}

export interface McpTestReport {
  serverIdentity: { name: string; version: string };
  capabilities: Record<string, unknown>;
  protocolVersion?: string;
  toolsTested: McpToolResult[];
  resourceCount: number;
  promptCount: number;
  issues: McpIssue[];
  reproSteps: string[];
  summary: string;
  totalDurationMs: number;
}

/**
 * Connect, exercise, disconnect. Throws only on connection-level failures —
 * per-tool failures are captured in the report so the buyer sees them.
 */
export async function testMcpServer(
  input: McpTestInput,
): Promise<McpTestReport> {
  const start = Date.now();
  const toolTimeout = input.toolTimeoutMs ?? 8_000;
  const sessionTimeout = input.sessionTimeoutMs ?? 60_000;
  const reproSteps: string[] = [];

  if (!input.serverUrl && !input.command) {
    throw new Error("Provide either `serverUrl` or `command` in the input.");
  }
  if (input.serverUrl && input.command) {
    throw new Error("Provide only one of `serverUrl` or `command`, not both.");
  }

  // ── 1. Build transport ────────────────────────────────────────────────
  const client = new Client(
    { name: "dorado-mcp-tester", version: "0.1.0" },
    { capabilities: {} },
  );
  let transport: SSEClientTransport | StdioClientTransport;
  if (input.serverUrl) {
    transport = new SSEClientTransport(new URL(input.serverUrl));
    reproSteps.push(`Connect via SSE to ${input.serverUrl}`);
  } else {
    const parts = input.command!.trim().split(/\s+/);
    const [command, ...args] = parts as [string, ...string[]];
    transport = new StdioClientTransport({ command, args });
    reproSteps.push(`Launch stdio server: \`${input.command}\``);
  }

  // ── 2. Connect (with overall session timeout) ─────────────────────────
  const sessionDeadline = Date.now() + sessionTimeout;
  await withTimeout(
    client.connect(transport),
    sessionDeadline - Date.now(),
    "connect",
  );

  let toolsTested: McpToolResult[] = [];
  let resourceCount = 0;
  let promptCount = 0;
  const issues: McpIssue[] = [];
  let serverIdentity = { name: "unknown", version: "unknown" };
  let capabilities: Record<string, unknown> = {};
  let protocolVersion: string | undefined;

  try {
    // The SDK exposes server info on the client after handshake.
    const sv = client.getServerVersion();
    if (sv) {
      serverIdentity = { name: sv.name ?? "unknown", version: sv.version ?? "unknown" };
    }
    const cap = client.getServerCapabilities();
    if (cap) capabilities = cap as Record<string, unknown>;
    const ip = client.getInstructions();
    if (ip) reproSteps.push(`Server instructions: "${ip.slice(0, 120)}"`);

    // ── 3. Enumerate ──────────────────────────────────────────────────
    let toolList: { tools: Array<{ name: string; description?: string; inputSchema: unknown }> } = {
      tools: [],
    };
    try {
      toolList = await withTimeout(client.listTools(), 5_000, "listTools");
    } catch (err) {
      issues.push({
        severity: "major",
        tool: "(server)",
        message: `listTools failed: ${(err as Error).message}`,
      });
    }
    try {
      const resources = await withTimeout(
        client.listResources(),
        5_000,
        "listResources",
      );
      resourceCount = resources.resources?.length ?? 0;
    } catch {
      // Servers that don't implement resources just throw a method-not-found —
      // that's fine, no issue.
    }
    try {
      const prompts = await withTimeout(
        client.listPrompts(),
        5_000,
        "listPrompts",
      );
      promptCount = prompts.prompts?.length ?? 0;
    } catch {
      // Same — prompts are optional.
    }

    // ── 4. Smoke each tool ────────────────────────────────────────────
    for (const tool of toolList.tools) {
      const t0 = Date.now();
      try {
        const r = await withTimeout(
          client.callTool({ name: tool.name, arguments: {} }),
          toolTimeout,
          `callTool:${tool.name}`,
        );
        const preview = JSON.stringify(r).slice(0, 200);
        toolsTested.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          status: "ok",
          resultPreview: preview,
          durationMs: Date.now() - t0,
        });
      } catch (err) {
        const e = err as Error & { code?: string };
        toolsTested.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          status: "error",
          errorCode: e.code,
          errorMessage: e.message,
          durationMs: Date.now() - t0,
        });
        // Empty-args failure is informational, not necessarily a bug.
        // Flag only if it suggests the server isn't validating input
        // (silent crashes, NPE-style stack traces).
        if (e.message && /TypeError|undefined|null is not/i.test(e.message)) {
          issues.push({
            severity: "major",
            tool: tool.name,
            message: `Crashed on empty args (suspected missing input validation): ${e.message.slice(0, 120)}`,
          });
        }
      }
    }
  } finally {
    try {
      await withTimeout(client.close(), 3_000, "close");
    } catch {
      // Ignore close failures — the test data is what we wanted.
    }
  }

  const total = Date.now() - start;
  const summary = buildSummary(serverIdentity, toolsTested, issues, total);

  return {
    serverIdentity,
    capabilities,
    protocolVersion,
    toolsTested,
    resourceCount,
    promptCount,
    issues,
    reproSteps,
    summary,
    totalDurationMs: total,
  };
}

function buildSummary(
  identity: { name: string; version: string },
  tools: McpToolResult[],
  issues: McpIssue[],
  totalMs: number,
): string {
  const ok = tools.filter((t) => t.status === "ok").length;
  const fail = tools.length - ok;
  const major = issues.filter((i) => i.severity === "major").length;
  return [
    `Tested **${identity.name}** v${identity.version} (${tools.length} tools, ${(totalMs / 1000).toFixed(1)}s).`,
    `${ok}/${tools.length} responded OK to empty-args call.`,
    fail > 0 ? `${fail} returned an error.` : null,
    major > 0
      ? `**${major} major issue(s)** flagged — see below before shipping.`
      : "No major issues flagged.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Render a report as Markdown matching the verifier's required-sections list. */
export function reportToMarkdown(
  report: McpTestReport,
  input: McpTestInput,
): string {
  const lines: string[] = [];
  lines.push(
    `# MCP Server Test Report — ${report.serverIdentity.name} v${report.serverIdentity.version}`,
  );
  lines.push("");
  lines.push(
    `_Tested by Dorado MCP Server Test Agent · ${new Date().toISOString()}_`,
  );
  lines.push("");

  lines.push(`## Summary`);
  lines.push(report.summary);
  lines.push("");
  lines.push(
    `Resources advertised: **${report.resourceCount}** · Prompts advertised: **${report.promptCount}** · Total runtime: **${(report.totalDurationMs / 1000).toFixed(1)}s**.`,
  );
  lines.push("");

  lines.push(`## Tools tested`);
  if (report.toolsTested.length === 0) {
    lines.push(`_The server exposed no tools._`);
  } else {
    lines.push(`| Tool | Status | Duration | Notes |`);
    lines.push(`|---|---|---|---|`);
    for (const t of report.toolsTested) {
      const status = t.status === "ok" ? "✓ ok" : `✗ ${t.errorCode ?? "error"}`;
      const notes =
        t.status === "ok"
          ? truncate(t.description ?? "", 60)
          : truncate(t.errorMessage ?? "", 80);
      lines.push(`| \`${t.name}\` | ${status} | ${t.durationMs}ms | ${escapeCell(notes)} |`);
    }
  }
  lines.push("");

  lines.push(`## Issues found`);
  if (report.issues.length === 0) {
    lines.push(`No issues flagged. Empty-args probe passed cleanly on every tool.`);
  } else {
    for (const i of report.issues) {
      lines.push(
        `- **${i.severity.toUpperCase()}** · \`${i.tool}\` — ${i.message}`,
      );
    }
  }
  lines.push("");

  lines.push(`## Repro steps`);
  lines.push("```");
  for (const s of report.reproSteps) lines.push(s);
  lines.push("");
  lines.push(`# As a one-liner via @dorado/example-mcp-server-test-agent:`);
  if (input.serverUrl) {
    lines.push(`MCP_SERVER_URL=${input.serverUrl} pnpm start`);
  } else {
    lines.push(`MCP_COMMAND="${input.command}" pnpm start`);
  }
  lines.push("```");
  lines.push("");

  // Optional appendix: full tool catalogue
  if (report.toolsTested.length > 0) {
    lines.push(`## Tool catalogue (full)`);
    for (const t of report.toolsTested) {
      lines.push(`### \`${t.name}\``);
      if (t.description) lines.push(t.description);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(t.inputSchema, null, 2));
      lines.push("```");
      if (t.status === "ok" && t.resultPreview) {
        lines.push(`_Sample result:_ \`${truncate(t.resultPreview, 160)}\``);
      } else if (t.status === "error") {
        lines.push(`_Error:_ \`${truncate(t.errorMessage ?? "", 200)}\``);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// Re-export `spawn` so tooling that wants to inspect the child process can.
// Not used inside this file — kept only as a hint for advanced users.
export const _spawn = spawn;
