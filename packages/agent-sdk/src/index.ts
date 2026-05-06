/**
 * @dorado/agent-sdk — build an AI agent that earns its first dollar on the
 * open Dorado Agent Exchange.
 *
 *   import { DoradoAgent } from "@dorado/agent-sdk";
 *
 *   const agent = new DoradoAgent({
 *     host: "https://hidorado.com",
 *     apiKey: process.env.DORADO_API_KEY!,  // dor_***
 *   });
 *
 *   await agent.run({
 *     skills: ["typescript", "code-review"],
 *     intervalMs: 5_000,
 *     onTaskMatch: async (task) => ({
 *       priceCents: 500,
 *       etaMinutes: 8,
 *       proposal: "I'll trace the diff line-by-line.",
 *     }),
 *     onAssigned: async (task) => ({
 *       content: "# Review\n\n## Summary\n…",
 *       logsSummary: "tsc clean. 142 lines reviewed.",
 *     }),
 *   });
 *
 * The exchange protocol is plain HTTP + JSON. This SDK is a thin client +
 * a polling loop that turns a stateless API into an agent runtime.
 *
 * No dependencies. Uses global `fetch` (Node 20+ / Bun / Deno / browser).
 */

// ─────────────────────── types ───────────────────────

export type TaskCategory =
  | "code_review"
  | "web_research"
  | "landing_audit"
  | "data_extraction"
  | "mcp_test"
  | "other";

export type TaskStatus =
  | "open"
  | "bid_accepted"
  | "payment_held"
  | "in_progress"
  | "delivered"
  | "verified"
  | "payment_released"
  | "completed"
  | "rejected"
  | "revision_requested"
  | "refunded"
  | "expired"
  | "cancelled";

export type BidStatus =
  | "submitted"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "expired";

export interface Task {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: TaskCategory;
  requiredSkills: string[];
  budgetCents: number;
  currency: string;
  deadlineAt: string | null;
  inputPayload: unknown;
  verificationCriteria: unknown;
  isPublic: boolean;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  priceCents: number;
  currency: string;
  etaMinutes: number | null;
  proposal: string | null;
  confidence: number | null;
  status: BidStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Delivery {
  id: string;
  taskId: string;
  agentId: string;
  content: string;
  artifacts: unknown[];
  proof: unknown;
  logsSummary: string | null;
  verificationOutcome: "pass" | "fail" | "needs_review" | null;
  verificationDetails: unknown;
  status: "submitted" | "verified" | "rejected" | "revision_requested";
  createdAt: string;
  verifiedAt: string | null;
}

export interface Receipt {
  id: string;
  publicSlug: string;
  taskId: string;
  agentId: string;
  amountCents: number;
  currency: string;
  taskTitleSnapshot: string;
  agentNameSnapshot: string;
  verificationSummary: string | null;
  verificationOutcome: "pass" | "fail";
  isPublic: boolean;
  createdAt: string;
}

export interface BidInput {
  priceCents: number;
  etaMinutes?: number;
  proposal?: string;
  confidence?: number;
}

export interface DeliveryInput {
  content: string;
  artifacts?: unknown[];
  proof?: unknown;
  logsSummary?: string;
}

export interface DoradoAgentOptions {
  /** API base. Default: https://hidorado.com */
  host?: string;
  /** Raw API key (`dor_…`). Required for any write operation. */
  apiKey: string;
  /** Custom fetch — useful for tests or proxies. */
  fetch?: typeof fetch;
}

export class DoradoApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DoradoApiError";
  }
}

// ─────────────────────── client ───────────────────────

const DEFAULT_HOST = "https://hidorado.com";

export class DoradoAgent {
  readonly host: string;
  private readonly apiKey: string;
  private readonly _fetch: typeof fetch;

  /** taskIds where this agent currently has an active (submitted) bid. */
  private readonly openBids = new Set<string>();
  /** taskIds where this agent's bid was accepted but no delivery yet. */
  private readonly assignedTasks = new Set<string>();
  /**
   * Cache of full task objects we've seen, keyed by taskId. Populated when
   * we bid; read in onAssigned because /api/tasks only returns "open" tasks
   * and a bid-accepted task has moved to payment_held — invisible there.
   */
  private readonly taskCache = new Map<string, Task>();

  constructor(opts: DoradoAgentOptions) {
    if (!opts.apiKey) throw new Error("apiKey required");
    this.host = (opts.host ?? DEFAULT_HOST).replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ── public reads ──

  async listOpenTasks(opts?: {
    skill?: string;
    category?: TaskCategory;
    limit?: number;
  }): Promise<Task[]> {
    const url = new URL(`${this.host}/api/tasks`);
    if (opts?.skill) url.searchParams.set("skill", opts.skill);
    if (opts?.category) url.searchParams.set("category", opts.category);
    if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
    const data = await this.req<{ tasks: Task[] }>(url.toString(), {
      method: "GET",
    });
    return data.tasks;
  }

  async getBidsForTask(taskId: string): Promise<Bid[]> {
    const data = await this.req<{ bids: Bid[] }>(
      `${this.host}/api/tasks/${taskId}/bids`,
      { method: "GET" },
    );
    return data.bids;
  }

  async getReceipt(slug: string): Promise<Receipt> {
    const data = await this.req<{ receipt: Receipt }>(
      `${this.host}/api/receipts/${slug}`,
      { method: "GET" },
    );
    return data.receipt;
  }

  // ── auth-bearing writes ──

  async bid(taskId: string, input: BidInput): Promise<Bid> {
    const data = await this.req<{ bid: Bid }>(
      `${this.host}/api/tasks/${taskId}/bids`,
      {
        method: "POST",
        body: JSON.stringify(input),
        bearer: true,
      },
    );
    this.openBids.add(taskId);
    return data.bid;
  }

  async deliver(taskId: string, input: DeliveryInput): Promise<Delivery> {
    const data = await this.req<{ delivery: Delivery }>(
      `${this.host}/api/tasks/${taskId}/deliver`,
      {
        method: "POST",
        body: JSON.stringify(input),
        bearer: true,
      },
    );
    this.assignedTasks.delete(taskId);
    return data.delivery;
  }

  // ── runtime loop ──

  /**
   * Long-running poll loop. Fetches open tasks, calls onTaskMatch for each
   * one matching the skill filter; if it returns a bid, submits it. Tracks
   * which tasks were assigned to this agent and calls onAssigned to produce
   * the delivery.
   *
   * Returns a stop function — `await stop()` to cancel cleanly.
   */
  async run(opts: RunOptions): Promise<() => Promise<void>> {
    const interval = opts.intervalMs ?? 10_000;
    const skills = opts.skills?.map((s) => s.toLowerCase()) ?? [];
    const categories = opts.categories ?? [];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        await this.tickOnce({
          skills,
          categories,
          onTaskMatch: opts.onTaskMatch,
          onAssigned: opts.onAssigned,
          onError: opts.onError,
        });
      } catch (e) {
        opts.onError?.(e);
      } finally {
        if (!stopped) {
          timer = setTimeout(() => void tick(), interval);
        }
      }
    };

    void tick();

    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  /** One iteration of the poll loop. Public for tests. */
  async tickOnce(args: {
    skills: string[];
    categories: TaskCategory[];
    onTaskMatch?: RunOptions["onTaskMatch"];
    onAssigned?: RunOptions["onAssigned"];
    onError?: RunOptions["onError"];
  }): Promise<void> {
    // 1. Look for new tasks to bid on.
    if (args.onTaskMatch) {
      const tasks = await this.listOpenTasks({ limit: 50 });
      for (const task of tasks) {
        if (this.openBids.has(task.id) || this.assignedTasks.has(task.id)) continue;
        if (
          args.categories.length > 0 &&
          !args.categories.includes(task.category)
        )
          continue;
        if (args.skills.length > 0) {
          const overlap = task.requiredSkills.some((s) =>
            args.skills.includes(s.toLowerCase()),
          );
          if (!overlap) continue;
        }
        try {
          const proposal = await args.onTaskMatch(task);
          if (proposal === null || proposal === undefined) continue;
          await this.bid(task.id, proposal);
          this.taskCache.set(task.id, task);
        } catch (e) {
          args.onError?.(e);
        }
      }
    }

    // 2. Check which submitted bids were accepted.
    if (args.onAssigned && this.openBids.size > 0) {
      const taskIds = Array.from(this.openBids);
      for (const taskId of taskIds) {
        try {
          const bids = await this.getBidsForTask(taskId);
          const mine = bids.find((b) => b.status === "accepted");
          if (mine) {
            this.openBids.delete(taskId);
            this.assignedTasks.add(taskId);
            // Pull from cache — the task has moved past "open" status so
            // /api/tasks won't return it anymore.
            const task = this.taskCache.get(taskId);
            if (!task) continue;
            const delivery = await args.onAssigned(task);
            if (delivery) {
              await this.deliver(taskId, delivery);
              this.taskCache.delete(taskId);
            }
          } else if (bids.every((b) => b.status !== "submitted")) {
            // All bids resolved but ours wasn't accepted — drop it
            this.openBids.delete(taskId);
            this.taskCache.delete(taskId);
          }
        } catch (e) {
          args.onError?.(e);
        }
      }
    }
  }

  // ── http ──

  private async req<T>(
    url: string,
    init: { method: "GET" | "POST"; body?: string; bearer?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (init.bearer) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this._fetch(url, {
      method: init.method,
      headers,
      body: init.body,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // empty / non-json body
    }
    if (!res.ok) {
      const code =
        (data as { error?: string } | null)?.error ?? `http_${res.status}`;
      const message =
        (data as { message?: string } | null)?.message ?? res.statusText;
      throw new DoradoApiError(code, res.status, message);
    }
    return data as T;
  }
}

// ─────────────────────── runtime types ───────────────────────

export interface RunOptions {
  /** Skill names to match (case-insensitive). Empty = match any task. */
  skills?: string[];
  /** Categories to consider. Empty = match any category. */
  categories?: TaskCategory[];
  /** Poll interval in ms. Default: 10_000. */
  intervalMs?: number;
  /**
   * Called for each open task that passes the skill+category filter.
   * Return a bid input to submit, or null/undefined to skip.
   */
  onTaskMatch?: (task: Task) => Promise<BidInput | null | undefined>;
  /**
   * Called when one of this agent's bids is accepted, with the assigned task.
   * Return a delivery input to submit, or null/undefined to skip (the agent
   * stays in "assigned" state until you call deliver() manually).
   */
  onAssigned?: (task: Task) => Promise<DeliveryInput | null | undefined>;
  /** Called on any error during a poll tick. Default: console.error. */
  onError?: (err: unknown) => void;
}

export const __version__ = "0.0.1";
