import { loadPrompt } from "../prompts/load-prompt.js";
import { ExecutionService } from "../execution/execution-service.js";
import { buildExecutionInsight } from "../memory/semantic-insights.js";
import { VerificationService } from "../verification/verification-service.js";

export class ExecutionAgent {
  constructor({
    bitbucketAdapter,
    ticketMemoryAdapter,
    semanticMemoryAdapter,
    sqlDbAdapter,
    executionConfig,
    verificationConfig,
    logger
  }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.ticketMemoryAdapter = ticketMemoryAdapter;
    this.semanticMemoryAdapter = semanticMemoryAdapter;
    this.sqlDbAdapter = sqlDbAdapter;
    this.executionConfig = executionConfig;
    this.logger = logger;
    this.service = new ExecutionService();
    this.verificationService = new VerificationService(verificationConfig);
  }

  resolveWorkspaceRoot() {
    return (
      this.executionConfig.workspaceRoot ||
      this.bitbucketAdapter.workspaceRoot ||
      process.cwd()
    );
  }

  async runPreflightChecks(item, scopedTicket, payload) {
    return this.verificationService.runPreflight({
      item: {
        ...item,
        ticket: scopedTicket
      },
      workspaceRoot: this.resolveWorkspaceRoot(),
      payload
    });
  }

  async maybeRunDiagnostics(ticket) {
    const request = ticket.diagnostics?.execution;
    if (!request?.query && !request?.statement) {
      return null;
    }

    return this.sqlDbAdapter.runDiagnosticQuery({
      phase: "execution",
      ticketKey: ticket.key,
      ...request
    });
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

      await this.ticketMemoryAdapter.upsertRecords([
        {
          ticket_key: result.ticketKey,
          project_key: result.projectKey,
          product_target: result.productTarget,
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

      try {
        const insight = buildExecutionInsight(item.ticket, item.decision, result);
        if (insight) {
          await this.semanticMemoryAdapter?.captureExecutionInsight?.(insight);
        }
      } catch (error) {
        this.logger?.debug("Semantic memory execution capture skipped", {
          ticketKey: item.ticket?.key ?? result.ticketKey,
          error: error.message
        });
      }

      if (result.status === "blocked" || result.status === "not_feasible") {
        break;
      }
    }

    return results;
  }

  async executeItem(item, prompt, executionMode) {
    const { ticket, decision } = item;
    const scopedTicket = {
      ...ticket,
      productTarget: decision.product_target ?? ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: decision.repo_target ?? ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN"
    };

    if (decision.status_decision === "feasible_low_confidence") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "skipped_low_confidence",
        "execution skipped because triage confidence is too low"
      );
    }

    if (decision.status_decision === "blocked") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "blocked",
        "execution stopped because the ticket is blocked"
      );
    }

    if (decision.status_decision === "not_feasible") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "not_feasible",
        "execution stopped because the ticket is not feasible"
      );
    }

    const branchName = this.bitbucketAdapter.planBranch(scopedTicket);
    const diagnostics = await this.maybeRunDiagnostics(scopedTicket);
    const commitMessage = this.service.buildCommitMessage(scopedTicket, prompt);
    const pullRequestTitle = `[${scopedTicket.key}] ${scopedTicket.summary}`;

    if (diagnostics?.used && (diagnostics.shouldBlock || (diagnostics.blockers ?? []).length > 0)) {
      return this.service.buildPlannedResult(
        scopedTicket,
        "blocked",
        diagnostics.summary || "execution blocked by SQL diagnostics"
      );
    }

    if (executionMode === "dry-run-mcp") {
      const existingPullRequest = await this.bitbucketAdapter.findOpenPullRequest?.(
        scopedTicket,
        branchName
      );

      if (existingPullRequest) {
        return this.service.buildExistingPullRequestResult(
          scopedTicket,
          branchName,
          existingPullRequest
        );
      }

      const preflightResult = await this.runPreflightChecks(item, scopedTicket, {
        branchName,
        commitMessage,
        pullRequestTitle
      });

      if (preflightResult.status !== "approved") {
        return this.service.buildPlannedResult(scopedTicket, "blocked", preflightResult.reason);
      }

      return {
        ...this.service.buildPlannedResult(
          scopedTicket,
          "dry_run_planned",
          diagnostics?.summary
            ? `execution dry-run planned with diagnostics: ${diagnostics.summary}`
            : "execution dry-run planned with MCP adapter; no real PR opened"
        ),
        branchName,
        commitMessage,
        pullRequestTitle,
        pullRequestUrl: ""
      };
    }

    const existingPullRequest = await this.bitbucketAdapter.findOpenPullRequest?.(
      scopedTicket,
      branchName
    );

    if (existingPullRequest) {
      return this.service.buildExistingPullRequestResult(
        scopedTicket,
        branchName,
        existingPullRequest
      );
    }

    await this.bitbucketAdapter.createBranch(scopedTicket, branchName);
    await this.bitbucketAdapter.checkoutBranch(scopedTicket, branchName);
    const preflightResult = await this.runPreflightChecks(item, scopedTicket, {
      branchName,
      commitMessage,
      pullRequestTitle
    });

    if (preflightResult.status !== "approved") {
      return this.service.buildPlannedResult(scopedTicket, "blocked", preflightResult.reason);
    }

    const commitResult = await this.bitbucketAdapter.createCommit(
      scopedTicket,
      branchName,
      commitMessage
    );
    const pullRequest = await this.bitbucketAdapter.openPullRequest(
      scopedTicket,
      branchName,
      commitResult
    );

    return this.service.buildExecutionResult(
      scopedTicket,
      branchName,
      commitMessage,
      pullRequest
    );
  }
}
