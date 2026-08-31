/**
 * MCP Server Test Agent — picks up `mcp_test` tasks and produces a real
 * test report for the Model Context Protocol server named in the task.
 *
 * Pricing: defaults to $2 / 5min. Tweak via env (MAX_BID_CENTS, ETA_MIN).
 *
 *   pnpm install
 *   cp .env.example .env       # paste DORADO_API_KEY (or BUILDER_TOKEN)
 *   pnpm start
 *
 * To smoke this script standalone (no Dorado loop, just test one server):
 *
 *   MCP_COMMAND="npx -y @modelcontextprotocol/server-everything" pnpm dry-run
 */

import "dotenv/config";
import {
  DoradoAgent,
  DoradoApiError,
  type Task,
} from "@dorado/agent-sdk";
import {
  reportToMarkdown,
  testMcpServer,
  type McpTestInput,
} from "./test-mcp-server.js";

const HOST = process.env.DORADO_HOST ?? "https://doradomarket.com";
const API_KEY = process.env.DORADO_API_KEY;
const BUILDER_TOKEN = process.env.DORADO_BUILDER_TOKEN;
const BUILDER_EMAIL = process.env.DORADO_BUILDER_EMAIL;
const MAX_BID_CENTS = Number.parseInt(process.env.MAX_BID_CENTS ?? "200", 10);
const ETA_MIN = Number.parseInt(process.env.ETA_MIN ?? "5", 10);

async function main() {
  // Standalone dry-run: skip the Dorado loop, just test one server and print.
  // Useful for `pnpm dry-run` to validate your local setup before bidding.
  if (process.argv.includes("--dry-run") || process.env.DRY_RUN === "1") {
    const input = inputFromEnv();
    if (!input) {
      console.error(
        "Set MCP_SERVER_URL or MCP_COMMAND for --dry-run, e.g.\n  MCP_COMMAND=\"npx -y @modelcontextprotocol/server-everything\" pnpm dry-run",
      );
      process.exit(1);
    }
    console.log(`[dry-run] testing ${input.serverUrl ?? input.command}…\n`);
    const report = await testMcpServer(input);
    console.log(reportToMarkdown(report, input));
    return;
  }

  // Live mode: register (or reuse apiKey) and start the bid/deliver loop.
  const client = await getClient();
  console.log(
    `MCP Server Test Agent → ${HOST}\n  watching mcp_test tasks · max bid $${(MAX_BID_CENTS / 100).toFixed(2)} · ETA ${ETA_MIN}min\n`,
  );

  const stop = await client.run({
    categories: ["mcp_test"],
    skills: ["mcp", "testing"],
    intervalMs: 6_000,

    onTaskMatch: async (task) => {
      const input = inputFromTask(task);
      if (!input) {
        console.log(
          `[skip]  ${task.slug}  (no serverUrl or command in inputPayload)`,
        );
        return null;
      }
      const price = Math.min(MAX_BID_CENTS, task.budgetCents);
      console.log(
        `[bid]   ${task.slug.padEnd(50).slice(0, 50)}  $${(price / 100).toFixed(2)} / ${ETA_MIN}min`,
      );
      return {
        priceCents: price,
        etaMinutes: ETA_MIN,
        proposal:
          "I'll connect to the MCP server, enumerate tools / resources / prompts, smoke-call each tool with empty args, and deliver a Markdown report with tools-tested table, issues, and repro steps.",
        confidence: 0.9,
      };
    },

    onAssigned: async (task) => {
      const input = inputFromTask(task);
      if (!input) {
        // We bid only when input was valid, so this shouldn't happen — but
        // be defensive: an empty delivery is rejected by the verifier, which
        // is the right outcome.
        return {
          content:
            "# Failed\n\nThe accepted task has no `serverUrl` or `command` in `inputPayload`.",
          logsSummary: "skipped — invalid input",
        };
      }
      console.log(
        `[run]   ${task.slug.slice(0, 50)} → testing ${input.serverUrl ?? input.command}…`,
      );
      try {
        const report = await testMcpServer(input);
        const md = reportToMarkdown(report, input);
        console.log(
          `[ok]    ${task.slug.slice(0, 50)} → ${report.toolsTested.length} tools, ${report.issues.length} issues, ${(report.totalDurationMs / 1000).toFixed(1)}s`,
        );
        return {
          content: md,
          logsSummary: `Tested ${report.toolsTested.length} tool(s), found ${report.issues.length} issue(s) in ${(report.totalDurationMs / 1000).toFixed(1)}s.`,
          proof: {
            serverIdentity: report.serverIdentity,
            toolNames: report.toolsTested.map((t) => t.name),
            issueCount: report.issues.length,
            durationMs: report.totalDurationMs,
          },
        };
      } catch (err) {
        const e = err as Error;
        console.error(`[err]   ${task.slug.slice(0, 50)} → ${e.message}`);
        return {
          content: `# MCP Server Test — failed to connect\n\n## Summary\nCould not reach the server.\n\n## Tools tested\n_n/a — connection failed before tool enumeration._\n\n## Issues found\n- **MAJOR** · \`(connection)\` — ${e.message}\n\n## Repro steps\n\`\`\`\n${input.serverUrl ? `Connect via SSE to ${input.serverUrl}` : `Launch stdio server: ${input.command}`}\n\`\`\``,
          logsSummary: `connection failed: ${e.message}`,
        };
      }
    },

    onError: (err) => {
      if (err instanceof DoradoApiError) {
        console.error(`[err]   ${err.code} (${err.status}): ${err.message}`);
      } else {
        console.error("[err]  ", err);
      }
    },
  });

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`\nShutting down on ${sig}…`);
      await stop();
      process.exit(0);
    });
  }
}

/**
 * Resolve a Dorado client. Prefers DORADO_API_KEY (you've already registered);
 * otherwise registers a fresh agent via SDK using the builder token.
 */
async function getClient(): Promise<DoradoAgent> {
  if (API_KEY) return new DoradoAgent({ host: HOST, apiKey: API_KEY });
  // No key yet and no operator credentials: register self-serve, which is the
  // normal path. This used to exit here demanding a builder token from a beta
  // that has since ended.
  console.log(
    `[register] no DORADO_API_KEY found — registering a fresh agent…`,
  );
  const r = await DoradoAgent.register({
    host: HOST,
    builderToken: BUILDER_TOKEN,
    builderEmail: BUILDER_EMAIL,
    builderName: "MCP Test Builder",
    agent: {
      name: "MCP Server Test Agent",
      description:
        "Connects to MCP servers, enumerates tools / resources / prompts, smoke-calls each tool, and delivers a Markdown audit report.",
      skills: ["mcp", "testing", "mcp-tools", "mcp-server"],
      pricingModel: "fixed",
      basePriceCents: MAX_BID_CENTS,
    },
  });
  console.log(
    `[register] slug=${r.agent.slug} apiKey=${r.apiKey.slice(0, 12)}…${r.apiKey.slice(-6)}`,
  );
  console.log(
    `[register] ⚠️  Persist this apiKey now: paste it into .env as DORADO_API_KEY.`,
  );
  return r.client;
}

/** Extract MCP test input from the task payload. */
function inputFromTask(task: Task): McpTestInput | null {
  const p = (task.inputPayload ?? {}) as Record<string, unknown>;
  const serverUrl = typeof p.serverUrl === "string" ? p.serverUrl : undefined;
  const command = typeof p.command === "string" ? p.command : undefined;
  if (!serverUrl && !command) return null;
  // Treat a serverUrl that isn't an actual http(s) URL as a stdio command
  // hint — gives buyers more flexibility on how they specify the target.
  if (serverUrl && !/^https?:\/\//i.test(serverUrl)) {
    return { command: serverUrl };
  }
  return { serverUrl, command };
}

/** For dry-run: pull input from environment instead of a Dorado task. */
function inputFromEnv(): McpTestInput | null {
  const serverUrl = process.env.MCP_SERVER_URL;
  const command = process.env.MCP_COMMAND;
  if (!serverUrl && !command) return null;
  return { serverUrl, command };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
