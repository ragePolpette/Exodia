export class TriageService {
  hasNewConditions(ticket, existingRecord, mapping) {
    const incoming = [
      ...(ticket.recheckConditions ?? []),
      ...(mapping.recheckConditions ?? [])
    ].filter(Boolean);

    if (incoming.length === 0) {
      return false;
    }

    const previous = new Set(existingRecord.recheck_conditions ?? []);
    return incoming.some((condition) => !previous.has(condition));
  }

  evaluate(ticket, context) {
    const existingRecord = context.memoryByTicket.get(ticket.key);
    const { mapping } = context;
    const recheckConditions = [
      ...(ticket.recheckConditions ?? []),
      ...(mapping.recheckConditions ?? [])
    ].filter(Boolean);

    if (!mapping.inScope) {
      return {
        ticket_key: ticket.key,
        project_key: ticket.projectKey,
        repo_target: mapping.repoTarget,
        status_decision: "skipped_out_of_scope",
        confidence: mapping.confidence ?? 0.1,
        short_reason: "ticket not clearly mapped to BpoPilot scope",
        implementation_hint: "",
        branch_name: "",
        pr_url: "",
        last_outcome: "triage_skipped",
        recheck_conditions: recheckConditions,
        execution_eligible: false
      };
    }

    if (existingRecord && !this.hasNewConditions(ticket, existingRecord, mapping)) {
      if (
        existingRecord.status_decision === "not_feasible" ||
        existingRecord.last_outcome === "not_feasible"
      ) {
        return {
          ...existingRecord,
          status_decision: "skipped_already_rejected",
          short_reason: "ticket already rejected and no new recheck conditions found",
          last_outcome: existingRecord.last_outcome || "not_feasible",
          execution_eligible: false
        };
      }

      if (["in_progress", "pr_opened", "implemented"].includes(existingRecord.last_outcome)) {
        return {
          ...existingRecord,
          status_decision: "skipped_already_in_progress",
          short_reason: "ticket already in progress or already implemented",
          execution_eligible: false
        };
      }

      if (existingRecord.status_decision === "blocked") {
        return {
          ...existingRecord,
          short_reason: "ticket remains blocked until recheck conditions change",
          execution_eligible: false
        };
      }
    }

    if (
      (mapping.blockers ?? []).length > 0 ||
      mapping.feasibility === "blocked" ||
      ticket.feasibility === "blocked"
    ) {
      const blockers = [...(mapping.blockers ?? [])];
      return {
        ticket_key: ticket.key,
        project_key: ticket.projectKey,
        repo_target: mapping.repoTarget,
        status_decision: "blocked",
        confidence: mapping.confidence ?? 0.45,
        short_reason:
          blockers.length > 0 ? `blocked by ${blockers.join(", ")}` : "ticket is currently blocked",
        implementation_hint: mapping.implementationHint ?? "",
        branch_name: "",
        pr_url: "",
        last_outcome: "blocked",
        recheck_conditions: recheckConditions,
        execution_eligible: false
      };
    }

    if (mapping.feasibility === "not_feasible" || ticket.feasibility === "not_feasible") {
      return {
        ticket_key: ticket.key,
        project_key: ticket.projectKey,
        repo_target: mapping.repoTarget,
        status_decision: "not_feasible",
        confidence: mapping.confidence ?? 0.31,
        short_reason: "requirements do not look safely automatable in current harness",
        implementation_hint: mapping.implementationHint ?? "",
        branch_name: "",
        pr_url: "",
        last_outcome: "not_feasible",
        recheck_conditions: recheckConditions,
        execution_eligible: false
      };
    }

    if (
      mapping.feasibility === "feasible_low_confidence" ||
      ticket.feasibility === "feasible_low_confidence"
    ) {
      return {
        ticket_key: ticket.key,
        project_key: ticket.projectKey,
        repo_target: mapping.repoTarget,
        status_decision: "feasible_low_confidence",
        confidence: mapping.confidence ?? 0.55,
        short_reason: "ticket looks feasible but mapping confidence is still low",
        implementation_hint: mapping.implementationHint ?? "",
        branch_name: "",
        pr_url: "",
        last_outcome: "triaged",
        recheck_conditions: recheckConditions,
        execution_eligible: false
      };
    }

    return {
      ticket_key: ticket.key,
      project_key: ticket.projectKey,
      repo_target: mapping.repoTarget,
      status_decision: "feasible",
      confidence: mapping.confidence ?? 0.84,
      short_reason: "ticket mapped to BpoPilot and looks actionable",
      implementation_hint: mapping.implementationHint ?? "",
      branch_name: "",
      pr_url: "",
      last_outcome: "triaged",
      recheck_conditions: recheckConditions,
      execution_eligible: true
    };
  }
}
