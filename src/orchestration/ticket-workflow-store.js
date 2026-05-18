const terminalStates = new Set([
  "candidate_rejected",
  "not_feasible",
  "blocked",
  "failed",
  "pr_opened"
]);

export const workflowStates = [
  "new",
  "candidate_selected",
  "awaiting_human_approval",
  "approved_for_analysis",
  "code_analysis_ready",
  "analysis_approved",
  "implementation_ready",
  "implementation_verified",
  "candidate_rejected",
  "not_feasible",
  "blocked",
  "failed",
  "pr_opened"
];

function normalizeWorkflowState(state) {
  const normalized = `${state ?? "new"}`.trim() || "new";
  return workflowStates.includes(normalized) ? normalized : "new";
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePhaseAttempts(value = {}) {
  return {
    candidateSelection: Number(value.candidateSelection ?? 0) || 0,
    codeAnalysis: Number(value.codeAnalysis ?? 0) || 0,
    analysisAudit: Number(value.analysisAudit ?? 0) || 0,
    implementation: Number(value.implementation ?? 0) || 0,
    implementationCheck: Number(value.implementationCheck ?? 0) || 0
  };
}

export function normalizeTicketWorkflowRecord(record = {}) {
  const createdAt = `${record.createdAt ?? record.created_at ?? nowIso()}`;
  const updatedAt = `${record.updatedAt ?? record.updated_at ?? createdAt}`;

  return {
    ticketKey: `${record.ticketKey ?? record.ticket_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    projectKey: `${record.projectKey ?? record.project_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    state: normalizeWorkflowState(record.state),
    approved: Boolean(record.approved),
    approval: {
      required: Boolean(record.approval?.required),
      status: `${record.approval?.status ?? "not_required"}`.trim() || "not_required",
      interactionId: `${record.approval?.interactionId ?? ""}`.trim(),
      decidedAt: `${record.approval?.decidedAt ?? ""}`.trim(),
      reason: `${record.approval?.reason ?? ""}`.trim()
    },
    candidate: {
      status: `${record.candidate?.status ?? ""}`.trim(),
      confidence: Number(record.candidate?.confidence ?? 0) || 0,
      productTarget: `${record.candidate?.productTarget ?? ""}`.trim(),
      repoTarget: `${record.candidate?.repoTarget ?? ""}`.trim(),
      reason: `${record.candidate?.reason ?? ""}`.trim()
    },
    artifacts: {
      analysis: `${record.artifacts?.analysis ?? ""}`.trim(),
      audit: `${record.artifacts?.audit ?? ""}`.trim(),
      implementation: `${record.artifacts?.implementation ?? ""}`.trim(),
      implementationCheck: `${record.artifacts?.implementationCheck ?? ""}`.trim()
    },
    phaseAttempts: normalizePhaseAttempts(record.phaseAttempts),
    lastOutcome: `${record.lastOutcome ?? record.last_outcome ?? ""}`.trim(),
    createdAt,
    updatedAt
  };
}

function initialRecord(ticket) {
  return normalizeTicketWorkflowRecord({
    ticketKey: ticket.key,
    projectKey: ticket.projectKey,
    state: "new",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function mergeSparse(previous = {}, next = {}) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value === "" || (value === 0 && previous[key] !== undefined)) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export class TicketWorkflowStore {
  constructor(store) {
    this.store = store;
  }

  async list() {
    const records = await this.store.list();
    return records.map(normalizeTicketWorkflowRecord);
  }

  async saveAll(records) {
    const normalized = records
      .map(normalizeTicketWorkflowRecord)
      .sort((left, right) => left.ticketKey.localeCompare(right.ticketKey));
    await this.store.saveAll(normalized);
    return normalized;
  }

  async upsert(records = []) {
    const current = await this.list();
    const byTicket = new Map(current.map((record) => [record.ticketKey, record]));

    for (const record of records) {
      const normalized = normalizeTicketWorkflowRecord(record);
      const previous = byTicket.get(normalized.ticketKey);
      byTicket.set(normalized.ticketKey, {
        ...previous,
        ...normalized,
        approval: {
          ...(previous?.approval ?? {}),
          ...normalized.approval
        },
        candidate: {
          ...mergeSparse(previous?.candidate, normalized.candidate)
        },
        artifacts: {
          ...mergeSparse(previous?.artifacts, normalized.artifacts)
        },
        phaseAttempts: {
          ...mergeSparse(previous?.phaseAttempts, normalized.phaseAttempts)
        },
        createdAt: previous?.createdAt ?? normalized.createdAt,
        updatedAt: nowIso()
      });
    }

    return this.saveAll([...byTicket.values()]);
  }

  async ensureTickets(tickets = []) {
    const current = await this.list();
    const byTicket = new Map(current.map((record) => [record.ticketKey, record]));
    let changed = false;

    for (const ticket of tickets) {
      if (!byTicket.has(ticket.key)) {
        byTicket.set(ticket.key, initialRecord(ticket));
        changed = true;
      }
    }

    return changed ? this.saveAll([...byTicket.values()]) : current;
  }

  async recordCandidate(decision) {
    const state =
      decision.status_decision === "feasible" || decision.status_decision === "feasible_low_confidence"
        ? "candidate_selected"
        : decision.status_decision === "not_feasible"
          ? "not_feasible"
          : decision.status_decision === "blocked"
            ? "blocked"
            : "candidate_rejected";

    await this.upsert([
      {
        ticketKey: decision.ticket_key,
        projectKey: decision.project_key,
        state,
        candidate: {
          status: decision.status_decision,
          confidence: decision.confidence,
          productTarget: decision.product_target,
          repoTarget: decision.repo_target,
          reason: decision.short_reason
        },
        phaseAttempts: {
          candidateSelection: 1
        },
        lastOutcome: decision.status_decision
      }
    ]);
  }

  async markApproval({ ticket, required, status, interaction = null, reason = "" }) {
    const approved = status === "approved" || !required;
    const state = approved
      ? "approved_for_analysis"
      : status === "rejected"
        ? "candidate_rejected"
        : "awaiting_human_approval";

    await this.upsert([
      {
        ticketKey: ticket.key,
        projectKey: ticket.projectKey,
        state,
        approved,
        approval: {
          required,
          status,
          interactionId: interaction?.id ?? "",
          decidedAt: status === "approved" || status === "rejected" ? nowIso() : "",
          reason
        },
        lastOutcome: state
      }
    ]);
  }

  async markPhase(ticketKey, phase, state, artifact = "") {
    const records = await this.list();
    const record = records.find((item) => item.ticketKey === ticketKey);
    if (!record) {
      return;
    }

    const artifacts = { ...record.artifacts };
    const phaseAttempts = { ...record.phaseAttempts };
    if (phase in artifacts && artifact) {
      artifacts[phase] = artifact;
    }
    if (phase in phaseAttempts) {
      phaseAttempts[phase] += 1;
    }

    await this.upsert([
      {
        ...record,
        state: normalizeWorkflowState(state),
        artifacts,
        phaseAttempts,
        lastOutcome: state
      }
    ]);
  }

  async snapshot() {
    const records = await this.list();
    const counts = records.reduce((accumulator, record) => {
      accumulator[record.state] = (accumulator[record.state] ?? 0) + 1;
      return accumulator;
    }, {});
    const active = records.filter((record) => !terminalStates.has(record.state)).length;

    return {
      total: records.length,
      active,
      counts,
      records
    };
  }
}
