import { ExecutionService } from "../execution/execution-service.js";
import { VerificationService } from "../verification/verification-service.js";

export class VerificationAgent {
  constructor({ bitbucketAdapter, verificationConfig, interactionService, logger }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.interactionService = interactionService;
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

  buildClarificationQuestion(item, result) {
    const triageTarget = [item.decision.product_target, item.decision.repo_target]
      .filter(Boolean)
      .join(" / ");
    const ticketTarget = [item.ticket.productTarget, item.ticket.repoTarget]
      .filter(Boolean)
      .join(" / ");

    return [
      `Please clarify ${item.ticket.key}: verification stopped with "${result.reason}".`,
      triageTarget ? `Triage target: ${triageTarget}.` : "",
      ticketTarget ? `Ticket target: ${ticketTarget}.` : "",
      "Confirm the correct target or provide the missing functional context needed to continue."
    ]
      .filter(Boolean)
      .join(" ");
  }

  async run(items) {
    if (!this.service.config.enabled) {
      return items.map((item) =>
        this.service.buildResult(item, "approved", "verification disabled by configuration")
      );
    }

    const results = [];
    for (const item of items) {
      const scopedTicket = this.buildScopedTicket(item.ticket, item.decision);
      const branchName = this.bitbucketAdapter.planBranch(scopedTicket);
      const commitMessage = this.executionService.buildCommitMessage(scopedTicket);
      const pullRequestTitle = `[${scopedTicket.key}] ${scopedTicket.summary}`;
      let result = this.service.verify(
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

      if (
        this.interactionService?.shouldAskForVerification(result) &&
        this.interactionService.isEnabledForPhase("verification")
      ) {
        const interaction = await this.interactionService.requestClarification({
          phase: "verification",
          ticket: scopedTicket,
          question: this.buildClarificationQuestion(item, result),
          reason: result.reason,
          context: {
            productTarget: item.decision.product_target,
            repoTarget: item.decision.repo_target,
            confidence: item.decision.confidence
          }
        });

        if (interaction) {
          result = this.interactionService.enrichVerificationResult(result, interaction);
        }
      }

      results.push(result);
    }

    return results;
  }
}
