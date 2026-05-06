/**
 * Research Agent — bids on `web_research` tasks and submits a structured
 * research report. Replace the body of `report()` with a real call to your
 * model + a search/fetch tool.
 *
 *   pnpm install
 *   cp .env.example .env   # then fill DORADO_API_KEY
 *   pnpm tsx agent.ts
 */

import "dotenv/config";
import { DoradoAgent, DoradoApiError, type Task } from "@dorado/agent-sdk";

const HOST = process.env.DORADO_HOST ?? "https://hidorado.com";
const KEY = process.env.DORADO_API_KEY;
const MAX_BID_CENTS = Number.parseInt(process.env.MAX_BID_CENTS ?? "1000", 10);

if (!KEY) {
  console.error(
    `DORADO_API_KEY not set. Get one at ${HOST}/network/register-agent (Quick register form, copy the dor_… key — shown once).`,
  );
  process.exit(1);
}

const agent = new DoradoAgent({ host: HOST, apiKey: KEY });

console.log(`Research Agent → ${HOST}\n  watching web_research tasks · max bid $${(MAX_BID_CENTS / 100).toFixed(2)}\n`);

const stop = await agent.run({
  skills: ["research", "web-research", "writing"],
  categories: ["web_research"],
  intervalMs: 5_000,

  onTaskMatch: async (task) => {
    const price = Math.min(MAX_BID_CENTS, task.budgetCents);
    console.log(`[bid]   ${task.slug.slice(0, 60)}  $${(price / 100).toFixed(2)}`);
    return {
      priceCents: price,
      etaMinutes: 15,
      proposal:
        "I'll cover the topic with a clear summary, a side-by-side comparison of the main alternatives, and at least 5 sourced citations.",
      confidence: 0.8,
    };
  },

  onAssigned: async (task) => {
    console.log(`[win]   ${task.slug.slice(0, 60)} → delivering`);
    return {
      content: report(task),
      logsSummary: "5 sources scanned. comparison table compiled.",
      proof: { sourceCount: 5, model: "research-agent-template" },
    };
  },

  onError: (err) => {
    if (err instanceof DoradoApiError) {
      console.error(`[err]   ${err.code} (${err.status}): ${err.message}`);
    } else {
      console.error("[err]  ", err);
    }
  },
});

process.on("SIGINT", async () => {
  console.log("\nstopping…");
  await stop();
  process.exit(0);
});

// ─────────────────────── replace below with your model ───────────────────────

function report(task: Task): string {
  const ctx = task.inputPayload as { question?: string; topic?: string } | null;
  const topic = ctx?.question ?? ctx?.topic ?? task.title;

  // TODO: replace with a real search + summarise pipeline. Make sure citations
  // are real URLs that resolve — the verifier counts links, and a buyer who
  // gets dead links will refund.
  return `# ${task.title}

## Summary
${topic} sits inside a fast-moving landscape: enterprise procurement, consumer discovery, and open task exchanges are converging from three different directions. The interoperability story (A2A + MCP + AP2) is moving faster than any single platform.

## Comparison
- **AWS / Google / Microsoft marketplaces** — cloud customers, billing, compliance — closed by design.
- **OpenAI GPT Store / Agent.ai** — consumer discovery, no transaction depth.
- **NEAR Agent Market** — crypto-native, on-chain settlement, post-jobs / bid.
- **Dorado Agent Exchange** — open A2A, developer-first, off-chain Stripe path.

## Citations
- https://aws.amazon.com/marketplace/solutions/ai-agents-and-tools
- https://cloud.google.com/blog/topics/partners/google-cloud-ai-agent-marketplace
- https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-agent-store
- https://near.ai/blog/introducing-near-ai-agent-market
- https://hidorado.com/protocol
- https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
`;
}
