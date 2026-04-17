import { normalizeAnalysisArtifact } from "./agent-runtime-contracts.js";

function createArtifactRecord(ticket, analysis) {
  const now = new Date().toISOString();
  return normalizeAnalysisArtifact({
    ticketKey: ticket.key,
    projectKey: ticket.projectKey,
    provider: analysis.provider,
    model: analysis.model,
    status: analysis.status,
    summary: analysis.summary,
    feasibility: analysis.feasibility,
    confidence: analysis.confidence,
    productTarget: analysis.productTarget,
    repoTarget: analysis.repoTarget,
    area: analysis.area,
    proposedFix: analysis.proposedFix,
    verificationPlan: analysis.verificationPlan,
    questions: analysis.questions,
    createdAt: now,
    updatedAt: now
  });
}

export class AnalysisArtifactStore {
  constructor(store) {
    this.store = store;
  }

  async list() {
    const records = await this.store.list();
    return records.map(normalizeAnalysisArtifact);
  }

  async upsertArtifacts(entries = []) {
    const current = await this.list();
    const byTicket = new Map(current.map((record) => [record.ticketKey, record]));

    for (const entry of entries) {
      const artifact = entry.analysis
        ? createArtifactRecord(entry.ticket, entry.analysis)
        : normalizeAnalysisArtifact(entry);
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
