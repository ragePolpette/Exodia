import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const promptsDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function loadPrompt(fileName) {
  return readFile(path.join(promptsDirectory, fileName), "utf8");
}
