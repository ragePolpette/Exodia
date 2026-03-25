import { createMemoryRecord, normalizeMemoryRecord } from "../contracts/memory-record.js";

export class TicketMemoryAdapter {
  constructor(store) {
    this.store = store;
    this.kind = "file";
  }

  async listRecords() {
    const records = await this.store.list();
    return records.map(normalizeMemoryRecord);
  }

  async upsertRecords(records) {
    const current = await this.listRecords();
    const byTicket = new Map(current.map((record) => [record.ticket_key, record]));

    for (const record of records) {
      const normalized = createMemoryRecord(record);
      byTicket.set(normalized.ticket_key, {
        ...byTicket.get(normalized.ticket_key),
        ...normalized
      });
    }

    const merged = [...byTicket.values()].sort((left, right) =>
      left.ticket_key.localeCompare(right.ticket_key)
    );

    await this.store.saveAll(merged);
    return merged;
  }
}
