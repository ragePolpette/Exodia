import { normalizeImplementationArtifact } from "./agent-runtime-contracts.js";

function createArtifactRecord(ticket, implementation, attemptNumber) {
  const now = new Date().toISOString();
  return normalizeImplementationArtifact({
    ticketKey: ticket.key,
    projectKey: ticket.projectKey,
    provider: implementation.provider,
    model: implementation.model,
    status: implementation.status,
    summary: implementation.summary,
    branchName: implementation.branchName,
    commitMessage: implementation.commitMessage,
    pullRequestTitle: implementation.pullRequestTitle,
    changedFiles: implementation.changedFiles,
    verificationResults: implementation.verificationResults,
    verificationPlan: implementation.verificationPlan,
    questions: implementation.questions,
    followUp: implementation.followUp,
    attemptNumber,
    createdAt: now,
    updatedAt: now
  });
}

export class ImplementationArtifactStore {
  constructor(store) {
    this.store = store;
  }

  async list() {
    const records = await this.store.list();
    return records.map(normalizeImplementationArtifact);
  }

  async upsertArtifacts(entries = []) {
    const current = await this.list();
    const byTicket = new Map(current.map((record) => [record.ticketKey, record]));

    for (const entry of entries) {
      const artifact = entry.implementation
        ? createArtifactRecord(entry.ticket, entry.implementation, entry.attemptNumber)
        : normalizeImplementationArtifact(entry);
      const previous = byTicket.get(artifact.ticketKey);
      byTicket.set(artifact.ticketKey, {
        ...previous,
        ...artifact,
        createdAt: previous?.createdAt ?? artifact.createdAt,
        updatedAt: artifact.updatedAt
      });
    }

    const merged = [...byTicket.values()].sort((left, right) => left.ticketKey.localeCompare(right.ticketKey));
    await this.store.saveAll(merged);
    return merged;
  }
}
