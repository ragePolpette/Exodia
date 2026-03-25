import { ExecutionService } from "../execution/execution-service.js";
import { VerificationService } from "../verification/verification-service.js";

export class VerificationAgent {
  constructor({ bitbucketAdapter, verificationConfig, logger }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.logger = logger;
    this.executionService = new ExecutionService();
    this.service = new VerificationService(verificationConfig);
  }

  buildScopedTicket(ticket, decision) {
    return {
      ...ticket,
      productTarget: decision.product_target ?? ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: decision.repo_target ?? ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN"
    };
  }

  async run(items) {
    if (!this.service.config.enabled) {
      return items.map((item) =>
        this.service.buildResult(item, "approved", "verification disabled by configuration")
      );
    }

    return items.map((item) => {
      const scopedTicket = this.buildScopedTicket(item.ticket, item.decision);
      const branchName = this.bitbucketAdapter.planBranch(scopedTicket);
      const commitMessage = this.executionService.buildCommitMessage(scopedTicket);
      const pullRequestTitle = `[${scopedTicket.key}] ${scopedTicket.summary}`;
      const result = this.service.verify(
        {
          ...item,
          ticket: item.ticket
        },
        {
          branchName,
          commitMessage,
          pullRequestTitle
        }
      );

      this.logger?.debug("Verification evaluated ticket", {
        ticketKey: result.ticketKey,
        status: result.status
      });

      return result;
    });
  }
}
