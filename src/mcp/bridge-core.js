import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { normalizeMemoryRecord } from "../contracts/memory-record.js";
import { normalizeSupportTicket } from "../tickets/normalize-support-ticket.js";
import {
  defaultRepoTarget as resolveDefaultRepoTarget,
  defaultUnknownTarget,
  inferTargetFromProjectKey,
  inferTargetFromTextFragments,
  resolveMappingDefaults
} from "../targeting/target-rules.js";

const execFileAsync = promisify(execFile);

function stripQuotes(value) {
  const trimmed = `${value ?? ""}`.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseTomlScalar(value) {
  const trimmed = `${value ?? ""}`.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return JSON.parse(trimmed);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return stripQuotes(trimmed);
}

export function parseServerRegistryToml(raw) {
  const registry = {};
  let currentSection = "";

  for (const line of `${raw ?? ""}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      registry[currentSection] = registry[currentSection] ?? {};
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const assignment = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }

    const [, key, value] = assignment;
    registry[currentSection][key] = parseTomlScalar(value);
  }

  return registry;
}

function normalizeServerAlias(serverName) {
  return `${serverName ?? ""}`.trim().replace(/_/g, "-");
}

export function resolveServerDefinition(registry, serverName) {
  const direct = registry?.[serverName];
  if (direct) {
    return direct;
  }

  const normalized = normalizeServerAlias(serverName);
  if (registry?.[normalized]) {
    return registry[normalized];
  }

  const alternative = normalized.replace(/-/g, "_");
  return registry?.[alternative] ?? null;
}

function extractToolTexts(result) {
  return (result?.content ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean);
}

function tryParseJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function unwrapToolResult(result) {
  const texts = extractToolTexts(result);
  const parsed = texts.map((text) => tryParseJson(text)).find(Boolean) ?? null;

  return {
    data: result?.structuredContent ?? parsed ?? null,
    texts,
    raw: result
  };
}

function adfToPlainText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => adfToPlainText(item)).filter(Boolean).join("\n");
  }

  if (value.type === "text") {
    return value.text ?? "";
  }

  if (Array.isArray(value.content)) {
    return value.content.map((item) => adfToPlainText(item)).filter(Boolean).join("\n");
  }

  return "";
}

function toJiraTicket(issue) {
  return {
    key: issue.key,
    projectKey: issue.fields?.project?.key ?? issue.projectKey ?? issue.key?.split("-")?.[0] ?? "UNKNOWN",
    summary: issue.fields?.summary ?? issue.summary ?? "",
    description: adfToPlainText(issue.fields?.description ?? issue.description),
    issueType: issue.fields?.issuetype?.name ?? issue.issueType ?? "",
    priority: issue.fields?.priority?.name ?? issue.priority ?? "",
    status: issue.fields?.status?.name ?? issue.status ?? "",
    created: issue.fields?.created ?? issue.created ?? "",
    labels: issue.fields?.labels ?? issue.labels ?? []
  };
}

function toJiraComment(comment) {
  return {
    id: `${comment.id ?? comment.commentId ?? ""}`.trim(),
    text: adfToPlainText(comment.body ?? comment.text ?? comment.content),
    createdAt: comment.created ?? comment.createdAt ?? "",
    author:
      comment.author?.displayName ??
      comment.author?.name ??
      comment.author?.emailAddress ??
      ""
  };
}

function extractJiraIssues(payload) {
  const candidate = payload?.data ?? payload?.raw ?? payload;
  if (Array.isArray(candidate)) {
    return candidate;
  }

  return (
    candidate?.issues ??
    candidate?.results ??
    candidate?.items ??
    candidate?.pull_requests ??
    []
  );
}

function extractJiraComments(payload) {
  const candidate = payload?.data ?? payload?.raw ?? payload;
  if (Array.isArray(candidate)) {
    return candidate;
  }

  return (
    candidate?.fields?.comment?.comments ??
    candidate?.comment?.comments ??
    candidate?.comments ??
    []
  );
}

function collectNestedStrings(value, results = []) {
  if (typeof value === "string") {
    results.push(value);
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedStrings(item, results);
    }
    return results;
  }

  for (const item of Object.values(value)) {
    collectNestedStrings(item, results);
  }

  return results;
}

function collectContextPaths(value) {
  const matches = [];

  for (const item of collectNestedStrings(value)) {
    const normalized = item.replace(/\\\\/g, "\\");
    const pathMatches = normalized.match(
      /(?:api|pubblico|librerie)[\\/][^\s,:*?"<>|]+(?:\.(?:asp|cs|js))?/gi
    );

    if (pathMatches) {
      matches.push(...pathMatches);
    }
  }

  return [...new Set(matches)];
}

export function inferProductTargetFromEvidence(ticket, paths = [], searchPayload = null, targeting = {}) {
  if (ticket.productTarget) {
    return ticket.productTarget;
  }

  const ticketTarget = inferTargetFromTextFragments(
    [ticket.summary, ticket.rawDescription, ticket.pageUrl, ...paths],
    targeting
  );
  if (ticketTarget) {
    return ticketTarget;
  }

  const searchTarget = inferTargetFromTextFragments(
    collectNestedStrings(searchPayload?.data ?? searchPayload?.raw ?? searchPayload),
    targeting
  );
  if (searchTarget) {
    return searchTarget;
  }

  return (
    inferTargetFromProjectKey(ticket.projectKey ?? ticket.key?.split("-")?.[0], targeting) ||
    defaultUnknownTarget(targeting)
  );
}

export function defaultRepoTarget(productTarget, targeting = {}) {
  return resolveDefaultRepoTarget(productTarget, targeting);
}

function inferConfidence(ticket, productTarget, paths, targeting = {}) {
  if (ticket.productTarget) {
    return 0.92;
  }

  const projectKey = ticket.projectKey ?? ticket.key?.split("-")?.[0] ?? "";
  if (productTarget === "unknown") {
    return 0.18;
  }

  if (inferTargetFromProjectKey(projectKey, targeting) === productTarget) {
    return paths.length > 0 ? 0.8 : 0.66;
  }

  if (paths.length > 0) {
    return 0.78;
  }

  return 0.63;
}

async function connectServer(serverDefinition) {
  const transport = new StdioClientTransport({
    command: serverDefinition.command,
    args: serverDefinition.args ?? [],
    cwd: serverDefinition.cwd,
    env: serverDefinition.env,
    stderr: "pipe"
  });
  const client = new Client({
    name: "malkuth-mcp-bridge",
    version: "0.1.0"
  });
  await client.connect(transport);
  return { client, transport };
}

async function callTool(serverDefinition, toolName, args = {}) {
  const { client, transport } = await connectServer(serverDefinition);
  try {
    return await client.callTool({
      name: toolName,
      arguments: args
    });
  } finally {
    await transport.close();
  }
}

async function loadShadowStore(shadowMemoryFile) {
  try {
    const raw = await readFile(shadowMemoryFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeShadowStore(shadowMemoryFile, store) {
  await mkdir(path.dirname(shadowMemoryFile), { recursive: true });
  await writeFile(shadowMemoryFile, JSON.stringify(store, null, 2));
}

function mergeRecords(existingRecords, incomingRecords) {
  const byTicket = new Map(existingRecords.map((record) => [record.ticket_key, record]));
  for (const record of incomingRecords) {
    byTicket.set(record.ticket_key, normalizeMemoryRecord(record));
  }
  return [...byTicket.values()];
}

async function handleJiraRequest(serverDefinition, action, payload) {
  if (action === "addTicketComment") {
    const rawResult = await callTool(serverDefinition, "addCommentToJiraIssue", {
      cloudId: payload.cloudId ?? "",
      issueIdOrKey: payload.ticketKey,
      commentBody: payload.body,
      contentFormat: "markdown",
      responseContentFormat: "markdown"
    });
    const parsed = unwrapToolResult(rawResult);
    return {
      id: parsed.data?.id ?? parsed.data?.comment?.id ?? "",
      commentId: parsed.data?.id ?? parsed.data?.comment?.id ?? "",
      createdAt: parsed.data?.created ?? parsed.data?.createdAt ?? new Date().toISOString()
    };
  }

  if (action === "listTicketComments") {
    const rawResult = await callTool(serverDefinition, "getJiraIssue", {
      cloudId: payload.cloudId ?? "",
      issueIdOrKey: payload.ticketKey,
      fields: ["comment"],
      responseContentFormat: "markdown"
    });
    const parsed = unwrapToolResult(rawResult);
    return {
      comments: extractJiraComments(parsed).map(toJiraComment)
    };
  }

  if (!["searchTicketsByJql", "searchTicketsByFilter"].includes(action)) {
    throw new Error(`Unsupported Jira MCP action: ${action}`);
  }

  const jql =
    action === "searchTicketsByFilter"
      ? `filter = ${payload.filterId}`
      : payload.jql;
  const cloudId = payload.cloudId ?? "";
  const rawResult = await callTool(serverDefinition, "searchJiraIssuesUsingJql", {
    cloudId,
    jql,
    maxResults: payload.maxResults ?? 50,
    responseContentFormat: payload.responseContentFormat ?? "markdown"
  });
  const parsed = unwrapToolResult(rawResult);
  const tickets = extractJiraIssues(parsed).map(toJiraTicket);
  return {
    tickets,
    nextPageToken: parsed.data?.nextPageToken ?? "",
    isLast: parsed.data?.isLast ?? true
  };
}

async function handleGenericRequest(serverDefinition, action, payload) {
  const rawResult = await callTool(serverDefinition, action, payload);
  const parsed = unwrapToolResult(rawResult);
  if (parsed.data !== null) {
    return parsed.data;
  }

  if (parsed.texts.length === 1) {
    return {
      text: parsed.texts[0]
    };
  }

  if (parsed.texts.length > 1) {
    return {
      texts: parsed.texts
    };
  }

  return {};
}

async function handleContextRequest(serverDefinition, action, payload) {
  if (action !== "mapTicketToCodebase") {
    throw new Error(`Unsupported llm-context MCP action: ${action}`);
  }

  const ticket = normalizeSupportTicket(payload.ticket ?? {}, { targeting: payload.targeting });
  const queryText = [ticket.summary, ticket.rawDescription, ticket.pageUrl, ticket.productTarget]
    .filter(Boolean)
    .join("\n");

  let searchPayload = null;
  try {
    searchPayload = unwrapToolResult(
      await callTool(serverDefinition, "rag_search", {
        query_text: queryText,
        project_id: payload.projectId,
        top_k: payload.topK ?? 6
      })
    );
  } catch {
    searchPayload = null;
  }

  const contextPaths = collectContextPaths(searchPayload?.data ?? searchPayload?.raw ?? {});
  const productTarget = inferProductTargetFromEvidence(
    ticket,
    contextPaths,
    searchPayload,
    payload.targeting
  );
  const defaults = resolveMappingDefaults(productTarget, payload.targeting);
  const confidence = inferConfidence(ticket, productTarget, contextPaths, payload.targeting);
  const inScope = defaults.inScope ?? productTarget !== defaultUnknownTarget(payload.targeting);

  return {
    productTarget,
    repoTarget: defaults.repoTarget,
    area: defaults.area,
    inScope,
    feasibility: inScope
      ? confidence < 0.7
        ? "feasible_low_confidence"
        : defaults.feasibility
      : "not_feasible",
    confidence,
    hints: contextPaths.slice(0, 5),
    implementationHint:
      contextPaths.length > 0
        ? `Inspect ${contextPaths.slice(0, 3).join(", ")}`
        : defaults.implementationHint,
    blockers: [],
    recheckConditions: [],
    source: {
      queryText,
      resultCount: searchPayload?.data?.results?.length ?? 0
    }
  };
}

async function handleMemoryRequest(serverDefinition, action, payload, { shadowMemoryFile }) {
  const namespace = payload.namespace ?? "malkuth";
  const store = await loadShadowStore(shadowMemoryFile);
  const existingRecords = (store[namespace] ?? []).map(normalizeMemoryRecord);

  if (action === "listTicketMemoryRecords") {
    try {
      await callTool(serverDefinition, "memory.about", {});
    } catch {
      // ignore connectivity probe failures and keep shadow memory available
    }

    return {
      records: existingRecords,
      source: "shadow"
    };
  }

  if (action === "captureInferenceMemory") {
    const insight = payload.insight ?? {};
    const ticketKey = insight.ticketKey ?? "unknown-ticket";
    const productTarget = insight.productTarget ?? "unknown";
    const repoTarget = insight.repoTarget ?? "UNKNOWN";
    const content =
      insight.content ??
      [
        `${payload.phase ?? "triage"} insight for ${ticketKey}`,
        `product_target=${productTarget}`,
        `repo_target=${repoTarget}`
      ].join(" | ");
    const tags = [...new Set([
      "malkuth",
      "ticket-harness",
      payload.phase ?? "triage",
      productTarget,
      ...(insight.tags ?? [])
    ].filter(Boolean))];

    try {
      const rawResult = await callTool(serverDefinition, "memory.add", {
        agent_id: namespace,
        content,
        context: JSON.stringify(insight.metadata ?? {}),
        type: "decision",
        visibility: "shared",
        scope: {
          scope_level: "workspace",
          agent_id: namespace
        },
        tags,
        confidence: insight.confidence ?? 0.5
      });
      const parsed = unwrapToolResult(rawResult);
      return {
        stored: true,
        source: "mcp",
        memoryId: parsed.data?.id ?? parsed.data?.memory_id ?? ""
      };
    } catch (error) {
      return {
        stored: false,
        source: "mcp",
        reason: error.message
      };
    }
  }

  if (action !== "upsertTicketMemoryRecords") {
    throw new Error(`Unsupported llm-memory MCP action: ${action}`);
  }

  const incomingRecords = (payload.records ?? []).map(normalizeMemoryRecord);
  const merged = mergeRecords(existingRecords, incomingRecords);
  store[namespace] = merged;
  await writeShadowStore(shadowMemoryFile, store);

  return {
    records: merged,
    source: "shadow"
  };
}

async function runGit(workspaceRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspaceRoot,
    windowsHide: true
  });
  return stdout.trim();
}

async function handleBitbucketRequest(serverDefinition, action, payload) {
  if (action === "findOpenPullRequest") {
    const rawResult = await callTool(serverDefinition, "list_pull_requests", {
      state: "OPEN",
      source_branch: payload.sourceBranch,
      page: 1,
      pagelen: 25
    });
    const parsed = unwrapToolResult(rawResult);
    const pullRequest = parsed.data?.pull_requests?.[0] ?? null;

    return pullRequest
      ? {
          pullRequest: {
            id: pullRequest.id,
            title: pullRequest.title,
            link:
              pullRequest.links?.html?.href ??
              pullRequest.link ??
              "",
            sourceBranch: pullRequest.source?.branch?.name ?? payload.sourceBranch
          }
        }
      : null;
  }

  if (action === "openPullRequest") {
    const rawResult = await callTool(serverDefinition, "create_pull_request", {
      title: payload.title,
      source_branch: payload.sourceBranch,
      destination_branch: payload.targetBranch,
      description:
        payload.description ??
        `Automated harness pull request for ${payload.ticket?.key ?? payload.title}`
    });
    const parsed = unwrapToolResult(rawResult);
    return {
      title: parsed.data?.title ?? payload.title,
      link:
        parsed.data?.links?.html?.href ??
        parsed.data?.link ??
        ""
    };
  }

  if (action === "createBranch") {
    await runGit(payload.workspaceRoot ?? payload.ticket?.workspaceRoot ?? process.cwd(), [
      "branch",
      payload.branchName,
      payload.baseBranch
    ]);
    return {
      branchName: payload.branchName,
      baseBranch: payload.baseBranch
    };
  }

  if (action === "checkoutBranch") {
    const workspaceRoot = payload.workspaceRoot ?? process.cwd();
    await runGit(workspaceRoot, ["checkout", payload.branchName]);
    return {
      branchName: payload.branchName,
      workspaceRoot
    };
  }

  if (action === "createCommit") {
    const workspaceRoot = payload.workspaceRoot ?? process.cwd();
    await runGit(workspaceRoot, ["add", "-A"]);
    const status = await runGit(workspaceRoot, ["status", "--porcelain"]);
    if (!status.trim()) {
      const head = await runGit(workspaceRoot, ["rev-parse", "HEAD"]);
      return {
        commitSha: head,
        skipped: true
      };
    }

    await runGit(workspaceRoot, ["commit", "-m", payload.commitMessage]);
    const commitSha = await runGit(workspaceRoot, ["rev-parse", "HEAD"]);
    return {
      commitSha
    };
  }

  throw new Error(`Unsupported Bitbucket MCP action: ${action}`);
}

function normalizeSqlRows(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.rows)) {
    return data.rows;
  }

  if (Array.isArray(data?.result)) {
    return data.result;
  }

  return [];
}

function summarizeSqlResult(rows, database) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `query on ${database} returned no rows`;
  }

  if (rows.length === 1) {
    return `query on ${database} returned 1 row`;
  }

  return `query on ${database} returned ${rows.length} rows`;
}

export function resolveSqlBridgeInvocation(serverName, action, payload = {}) {
  if (action === "recordHarnessRun") {
    if (serverName !== "llm-db-dev-mcp") {
      return {
        executable: false,
        response: {
          runId: payload.runId ?? `mcp-run-${Date.now()}`,
          mode: payload.mode,
          stored: false,
          note: "record run persistence requires a writable llm-db-dev-mcp target"
        }
      };
    }

    if (!payload.sql?.trim()) {
      return {
        executable: false,
        response: {
          runId: payload.runId ?? `mcp-run-${Date.now()}`,
          mode: payload.mode,
          stored: false,
          note: "record run persistence is disabled because no SQL statement is configured"
        }
      };
    }

    return {
      executable: true,
      toolName: "db_dev_write",
      toolArgs: {
        sql: payload.sql,
        parameters: payload.parameters ?? {},
        reason: payload.reason ?? `malkuth run log (${payload.mode ?? "unknown"})`
      }
    };
  }

  if (action === "runDiagnosticQuery") {
    const query = payload.query?.trim();
    if (!query) {
      return {
        executable: false,
        response: {
          used: false,
          source: "mcp-bridge",
          database: payload.database ?? "prod",
          rows: [],
          summary: ""
        }
      };
    }

    return {
      executable: true,
      toolName: serverName === "llm-db-dev-mcp" ? "db_dev_read" : "db_prod_read_anonymized",
      toolArgs: {
        sql: query,
        parameters: payload.parameters ?? {},
        maxRows: payload.maxRows
      }
    };
  }

  throw new Error(`Unsupported llm-sql-db MCP action: ${action}`);
}

async function handleSqlDbRequest(serverName, serverDefinition, action, payload) {
  const invocation = resolveSqlBridgeInvocation(serverName, action, payload);
  if (!invocation.executable) {
    return invocation.response;
  }

  if (action === "recordHarnessRun") {
    await callTool(serverDefinition, invocation.toolName, invocation.toolArgs);
    return {
      runId: payload.runId ?? `mcp-run-${Date.now()}`,
      mode: payload.mode,
      stored: true,
      note: "run recorded through llm-db-dev-mcp"
    };
  }

  if (action === "runDiagnosticQuery") {
    const rawResult = await callTool(serverDefinition, invocation.toolName, invocation.toolArgs);
    const parsed = unwrapToolResult(rawResult);
    const rows = normalizeSqlRows(parsed.data);

    return {
      used: true,
      source: "mcp-bridge",
      database: payload.database ?? "prod",
      rows,
      summary: parsed.data?.summary ?? summarizeSqlResult(rows, payload.database ?? "prod")
    };
  }

  throw new Error(`Unsupported llm-sql-db MCP action: ${action}`);
}

export async function handleBridgeRequest({
  registryFile,
  request,
  shadowMemoryFile = path.resolve(process.cwd(), "data", "mcp-memory-shadow.json")
}) {
  const registryRaw = await readFile(registryFile, "utf8");
  const registry = parseServerRegistryToml(registryRaw);
  const serverDefinition = resolveServerDefinition(registry, request.server);
  if (!serverDefinition) {
    throw new Error(`Unknown MCP server in bridge registry: ${request.server}`);
  }

  const serverName = normalizeServerAlias(request.server);
  if (serverName === "atlassian-rovo-mcp") {
    return handleJiraRequest(serverDefinition, request.action, request.payload ?? {});
  }

  if (serverName === "llm-context") {
    return handleContextRequest(serverDefinition, request.action, request.payload ?? {});
  }

  if (serverName === "llm-memory") {
    return handleMemoryRequest(serverDefinition, request.action, request.payload ?? {}, {
      shadowMemoryFile
    });
  }

  if (serverName === "llm-bitbucket-mcp") {
    return handleBitbucketRequest(serverDefinition, request.action, request.payload ?? {});
  }

  if (serverName === "llm-db-prod-mcp" || serverName === "llm-db-dev-mcp") {
    return handleSqlDbRequest(serverName, serverDefinition, request.action, request.payload ?? {});
  }

  return handleGenericRequest(serverDefinition, request.action, request.payload ?? {});
}
