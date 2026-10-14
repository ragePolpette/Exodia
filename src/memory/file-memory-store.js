import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic-write.js";

export class FileMemoryStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async list() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async saveAll(records) {
    await writeFileAtomic(this.filePath, JSON.stringify(records, null, 2));
  }
}
