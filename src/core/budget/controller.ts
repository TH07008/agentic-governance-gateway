/**
 * Budget & cost controller.
 *
 * Tracks per-agent daily/monthly spend, estimates the cost of new actions,
 * and returns whether an action would exceed its budget. The store is
 * pluggable: `MemoryBudgetStore` for tests, `SqlBudgetStore` for production.
 */
import type { AgentAction, BudgetSnapshot } from "../../types/index.js";
import type { Logger } from "../logger.js";

export interface BudgetStore {
  getSnapshot(agentId: string): Promise<BudgetSnapshot>;
  addCost(agentId: string, amountUsd: number, at: Date): Promise<void>;
  resetDaily(): Promise<void>;
}

export interface BudgetControllerOptions {
  store: BudgetStore;
  defaultDailyLimitUsd: number;
  defaultMonthlyLimitUsd: number;
  logger: Logger;
}

export interface CostEstimate {
  estimatedCostUsd: number;
  allowed: boolean;
  reason?: string;
}

/**
 * Rough per-model pricing in USD per 1K tokens. Only used for estimation – the
 * real numbers should come from your provider. Kept intentionally small.
 */
const PRICE_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-3-opus": { input: 0.015, output: 0.075 },
  "claude-3-sonnet": { input: 0.003, output: 0.015 },
  "claude-3.5-sonnet": { input: 0.003, output: 0.015 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "llama3:70b": { input: 0.0, output: 0.0 },
  "test-model": { input: 0.0, output: 0.0 },
};

export class BudgetController {
  constructor(private readonly opts: BudgetControllerOptions) {}

  /** Estimate the USD cost of an action based on prompt size and model. */
  estimateCostUsd(action: AgentAction): number {
    const price = PRICE_PER_1K_TOKENS[action.model] ?? { input: 0.001, output: 0.002 };
    const inputChars = (action.prompt ?? "").length + JSON.stringify(action.params ?? {}).length;
    // ~4 chars per token; very rough, intentional.
    const inputTokens = inputChars / 4;
    const outputTokens = inputTokens * 0.5; // assume output ~50% of input
    return (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
  }

  /** Check whether the action would fit within the agent's budget. */
  async check(action: AgentAction): Promise<CostEstimate> {
    const estimated = this.estimateCostUsd(action);
    const snapshot = await this.opts.store.getSnapshot(action.agentId);
    if (snapshot.dailyCostUsd + estimated > snapshot.dailyLimitUsd) {
      return {
        estimatedCostUsd: estimated,
        allowed: false,
        reason: `Daily budget would be exceeded ($${snapshot.dailyLimitUsd} limit, $${snapshot.dailyCostUsd.toFixed(4)} spent)`,
      };
    }
    if (snapshot.monthlyCostUsd + estimated > snapshot.monthlyLimitUsd) {
      return {
        estimatedCostUsd: estimated,
        allowed: false,
        reason: `Monthly budget would be exceeded ($${snapshot.monthlyLimitUsd} limit, $${snapshot.monthlyCostUsd.toFixed(4)} spent)`,
      };
    }
    return { estimatedCostUsd: estimated, allowed: true };
  }

  /** Record that an action was executed; charges its cost to the budget. */
  async charge(action: AgentAction, actualCostUsd?: number): Promise<BudgetSnapshot> {
    const cost = actualCostUsd ?? this.estimateCostUsd(action);
    await this.opts.store.addCost(action.agentId, cost, new Date(action.timestamp));
    return this.opts.store.getSnapshot(action.agentId);
  }

  /** Return a snapshot for monitoring/UI. */
  async snapshot(agentId: string): Promise<BudgetSnapshot> {
    return this.opts.store.getSnapshot(agentId);
  }
}

/** In-memory budget store, used by tests and ephemeral runs. */
export class MemoryBudgetStore implements BudgetStore {
  private daily = new Map<string, number>();
  private monthly = new Map<string, number>();
  private readonly dailyLimit: number;
  private readonly monthlyLimit: number;

  constructor(defaultDailyLimitUsd: number, defaultMonthlyLimitUsd: number) {
    this.dailyLimit = defaultDailyLimitUsd;
    this.monthlyLimit = defaultMonthlyLimitUsd;
  }

  async getSnapshot(agentId: string): Promise<BudgetSnapshot> {
    const dailyCostUsd = this.daily.get(agentId) ?? 0;
    const monthlyCostUsd = this.monthly.get(agentId) ?? 0;
    return {
      agentId,
      dailyCostUsd,
      monthlyCostUsd,
      dailyLimitUsd: this.dailyLimit,
      monthlyLimitUsd: this.monthlyLimit,
      remainingDailyUsd: Math.max(0, this.dailyLimit - dailyCostUsd),
      remainingMonthlyUsd: Math.max(0, this.monthlyLimit - monthlyCostUsd),
    };
  }

  async addCost(agentId: string, amountUsd: number, _at: Date): Promise<void> {
    this.daily.set(agentId, (this.daily.get(agentId) ?? 0) + amountUsd);
    this.monthly.set(agentId, (this.monthly.get(agentId) ?? 0) + amountUsd);
  }

  async resetDaily(): Promise<void> {
    this.daily.clear();
  }

  /** Test helper: force a specific daily spend. */
  _setDailyForTest(agentId: string, amountUsd: number): void {
    this.daily.set(agentId, amountUsd);
  }
  _setMonthlyForTest(agentId: string, amountUsd: number): void {
    this.monthly.set(agentId, amountUsd);
  }
}