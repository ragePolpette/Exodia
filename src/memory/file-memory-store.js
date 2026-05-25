import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(records, null, 2));
  }
}
