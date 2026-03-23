import { loadPrompt } from "../prompts/load-prompt.js";
import { ExecutionService } from "../execution/execution-service.js";

export class ExecutionAgent {
  constructor({ bitbucketAdapter, memoryAdapter, executionConfig, logger }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.memoryAdapter = memoryAdapter;
    this.executionConfig = executionConfig;
    this.logger = logger;
    this.service = new ExecutionService();
  }

  async run(items) {
    const prompt = await loadPrompt("execution-agent.md");
    await this.bitbucketAdapter.assertNoMergePolicy();
    const executionMode = this.service.resolveMode({
      executionConfig: this.executionConfig,
      bitbucketKind: this.bitbucketAdapter.kind
    });

    this.logger?.info("Execution mode resolved", {
      mode: executionMode,
      adapter: this.bitbucketAdapter.kind
    });

    if (executionMode === "disabled") {
      return [];
    }

    const results = [];

    for (const item of items) {
      const result = await this.executeItem(item, prompt, executionMode);
      results.push(result);

      await this.memoryAdapter.upsertRecords([
        {
          ticket_key: result.ticketKey,
          project_key: result.projectKey,
          repo_target: result.repoTarget,
          status_decision: item.decision.status_decision,
          confidence: item.decision.confidence,
          short_reason: result.reason,
          implementation_hint: item.decision.implementation_hint ?? "",
          branch_name: result.branchName,
          pr_url: result.pullRequestUrl,
          last_outcome: result.status,
          recheck_conditions: item.decision.recheck_conditions ?? []
        }
      ]);

      if (result.status === "blocked" || result.status === "not_feasible") {
        break;
      }
    }

    return results;
  }

  async executeItem(item, prompt, executionMode) {
    const { ticket, decision } = item;

    if (decision.status_decision === "feasible_low_confidence") {
      return this.service.buildPlannedResult(
        ticket,
        "skipped_low_confidence",
        "execution skipped because triage confidence is too low"
      );
    }

    if (decision.status_decision === "blocked") {
      return this.service.buildPlannedResult(
        ticket,
        "blocked",
        "execution stopped because the ticket is blocked"
      );
    }

    if (decision.status_decision === "not_feasible") {
      return this.service.buildPlannedResult(
        ticket,
        "not_feasible",
        "execution stopped because the ticket is not feasible"
      );
    }

    const branchName = this.bitbucketAdapter.planBranch(ticket);

    if (executionMode === "dry-run-mcp") {
      return {
        ...this.service.buildPlannedResult(
          ticket,
          "dry_run_planned",
          "execution dry-run planned with MCP adapter; no real PR opened"
        ),
        branchName,
        commitMessage: this.service.buildCommitMessage(ticket, prompt),
        pullRequestTitle: `[${ticket.key}] ${ticket.summary}`,
        pullRequestUrl: ""
      };
    }

    await this.bitbucketAdapter.createBranch(ticket, branchName);
    await this.bitbucketAdapter.checkoutBranch(ticket, branchName);
    const commitMessage = this.service.buildCommitMessage(ticket, prompt);
    const commitResult = await this.bitbucketAdapter.createCommit(
      ticket,
      branchName,
      commitMessage
    );
    const pullRequest = await this.bitbucketAdapter.openPullRequest(
      ticket,
      branchName,
      commitResult
    );

    return this.service.buildExecutionResult(
      ticket,
      branchName,
      commitMessage,
      pullRequest
    );
  }
}
