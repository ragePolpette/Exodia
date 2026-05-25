import { access, readFile } from "node:fs/promises";
import path from "node:path";

const localInstructionFileName = "EXODIA.md";
const exampleInstructionFileName = "EXODIA.md.example";

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readInstructionFile(rootPath, label, fileNames = [localInstructionFileName]) {
  if (!rootPath) {
    return null;
  }

  for (const fileName of fileNames) {
    const filePath = path.join(rootPath, fileName);
    if (!(await fileExists(filePath))) {
      continue;
    }

    return {
      label,
      fileName,
      filePath,
      content: (await readFile(filePath, "utf8")).trim()
    };
  }

  return null;
}

function uniqueEntries(values = []) {
  return [...new Set(values.map((value) => `${value ?? ""}`.trim()).filter(Boolean))];
}

function resolveWorkspaceRoot(config = {}) {
  return uniqueEntries([
    config.agentRuntime?.workspaceRoot,
    config.execution?.workspaceRoot,
    config.adapters?.bitbucket?.mcp?.workspaceRoot,
    config.adapters?.llmContext?.mcp?.workspaceRoot
  ])[0] || process.cwd();
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function buildMcpInstructions(config = {}) {
  const lines = ["Connected MCP adapters and usage rules:"];
  const adapterEntries = [
    ["jira", config.adapters?.jira],
    ["llm-context", config.adapters?.llmContext],
    ["llm-memory", config.adapters?.llmMemory],
    ["llm-sql-db", config.adapters?.llmSqlDb],
    ["bitbucket", config.adapters?.bitbucket]
  ];

  for (const [label, adapter] of adapterEntries) {
    if (!adapter) {
      continue;
    }

    if (adapter.kind === "mcp") {
      const server = adapter.mcp?.server || "unknown-server";
      lines.push(`- ${label}: use the connected MCP server ${server}; treat its data as authoritative.`);
    } else {
      lines.push(`- ${label}: not connected via MCP in this run; do not assume live external access.`);
    }
  }

  lines.push("- Use context and memory already provided in the payload before asking for clarification.");
  lines.push("- Treat resolved humanClarifications and answered recheckConditions as newer than old memory blockers for the same ticket.");
  lines.push("- Ask for clarification only when the missing information blocks a sound decision or implementation step.");
  return lines.join("\n");
}

export class AgentPromptContextBuilder {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.repoRoot = options.repoRoot || process.cwd();
    this.cachedInstructions = null;
  }

  resolveWorkspaceRoot() {
    return resolveWorkspaceRoot(this.config);
  }

  async loadInstructionFiles() {
    if (this.cachedInstructions) {
      return this.cachedInstructions;
    }

    const workspaceRoot = this.resolveWorkspaceRoot();
    const general = await readInstructionFile(this.repoRoot, "Exodia general instructions", [
      localInstructionFileName,
      exampleInstructionFileName
    ]);
    const target = samePath(workspaceRoot, this.repoRoot)
      ? null
      : await readInstructionFile(workspaceRoot, "Target worktree instructions");

    const missingTarget = !target && !samePath(workspaceRoot, this.repoRoot);
    if (this.config.agentRuntime?.requireTargetInstructions && missingTarget) {
      throw new Error(`EXODIA_TARGET_INSTRUCTIONS_MISSING: ${localInstructionFileName} not found in ${workspaceRoot}`);
    }

    this.cachedInstructions = {
      workspaceRoot,
      repoRoot: this.repoRoot,
      files: [general, target].filter(Boolean),
      missingGeneral: !general,
      missingTarget
    };
    return this.cachedInstructions;
  }

  async buildPrompt(basePrompt, { phase, agentRole }) {
    const instructions = await this.loadInstructionFiles();
    const docBlock = instructions.files.length
      ? instructions.files
          .map(
            (entry) =>
              `Read and follow ${entry.label} from ${entry.filePath}:\n\n${entry.content}`
          )
          .join("\n\n")
      : `No ${localInstructionFileName} or ${exampleInstructionFileName} files were found in the Exodia repository or configured target worktree.`;

    const missingWarnings = [
      instructions.missingGeneral ? `- Missing Exodia repository ${localInstructionFileName} or ${exampleInstructionFileName}; general agent guidance is unavailable.` : "",
      instructions.missingTarget ? `- Missing target worktree ${localInstructionFileName}; ask for setup before implementation if target-specific rules are required.` : ""
    ]
      .filter(Boolean)
      .join("\n");

    return [
      `${basePrompt ?? ""}`.trim(),
      `Agent role: ${agentRole}. Runtime phase: ${phase}.`,
      `Target worktree root: ${instructions.workspaceRoot}`,
      docBlock,
      missingWarnings ? `Instruction file warnings:\n${missingWarnings}` : "",
      buildMcpInstructions(this.config)
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

export { resolveWorkspaceRoot };
