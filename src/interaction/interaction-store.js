import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mergeInteractionRecord,
  normalizeInteractionRecord
} from "./interaction-contracts.js";

export class InteractionStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async list() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeInteractionRecord) : [];
    } catch (error) {
      if (error?.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async saveAll(records) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(records.map(normalizeInteractionRecord), null, 2)
    );
  }

  async upsert(records) {
    const current = await this.list();
    const byId = new Map(current.map((record) => [record.id, record]));

    for (const record of records) {
      const normalized = normalizeInteractionRecord(record);
      const existing = byId.get(normalized.id);
      byId.set(
        normalized.id,
        existing ? mergeInteractionRecord(existing, normalized) : normalized
      );
    }

    const merged = [...byId.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
    await this.saveAll(merged);
    return merged;
  }
}
