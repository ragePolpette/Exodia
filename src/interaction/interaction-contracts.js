import { randomUUID } from "node:crypto";
import {
  defaultRepoTarget,
  inferTargetFromTextFragments
} from "../targeting/target-rules.js";

const validInteractionStatuses = ["awaiting_response", "resolved"];
const validDestinations = ["slack", "ticket"];

function normalizeTimestamp(value, fallback) {
  const candidate = `${value ?? ""}`.trim();
  if (!candidate) {
    return fallback;
  }

  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => `${entry ?? ""}`.trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

export function normalizeInteractionDestinations(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => `${entry ?? ""}`.trim()).filter(Boolean))]
      .filter((entry) => validDestinations.includes(entry));
  }

  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (normalized === "both") {
    return ["slack", "ticket"];
  }

  return validDestinations.includes(normalized) ? [normalized] : [];
}

export function normalizeInteractionResponse(response = {}, source = "") {
  const fallbackTimestamp = new Date().toISOString();
  const author =
    response.author?.displayName ??
    response.author?.name ??
    response.author ??
    response.user?.displayName ??
    response.user?.name ??
    response.user ??
    "";
  const text =
    response.text ??
    response.body ??
    response.message ??
    response.content ??
    "";

  return {
    source: `${response.source ?? source ?? ""}`.trim() || "unknown",
    text: `${text ?? ""}`.trim(),
    author: `${author ?? ""}`.trim(),
    respondedAt: normalizeTimestamp(
      response.respondedAt ??
        response.createdAt ??
        response.created ??
        response.timestamp ??
        response.ts ??
        response.date,
      fallbackTimestamp
    ),
    externalId: `${response.externalId ?? response.id ?? response.commentId ?? response.ts ?? ""}`.trim()
  };
}

export function sortInteractionResponses(responses = []) {
  return [...responses].sort((left, right) => {
    const leftTimestamp = Date.parse(left.respondedAt ?? "");
    const rightTimestamp = Date.parse(right.respondedAt ?? "");

    if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    if (left.source !== right.source) {
      if (left.source === "slack") {
        return -1;
      }

      if (right.source === "slack") {
        return 1;
      }
    }

    return `${left.externalId ?? ""}`.localeCompare(`${right.externalId ?? ""}`);
  });
}

export function isFunctionalInteractionResponse(text) {
  const normalized = `${text ?? ""}`.trim();
  if (normalized.length < 8) {
    return false;
  }

  return !/^(ok|okay|yes|no|vai|procedi|confermo|va bene|ricevuto)$/i.test(normalized);
}

export function summarizeFunctionalInteractionResponse(text) {
  if (!isFunctionalInteractionResponse(text)) {
    return "";
  }

  return `${text ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 220);
}

function normalizeInteractionStatus(status) {
  const normalized = `${status ?? ""}`.trim() || "awaiting_response";
  if (!validInteractionStatuses.includes(normalized)) {
    throw new Error(`Unsupported interaction status: ${status}`);
  }
  return normalized;
}

export function createInteractionRecord({
  ticket,
  phase,
  question,
  reason,
  destinations,
  context = {}
}) {
  const now = new Date().toISOString();
  return normalizeInteractionRecord({
    id: randomUUID(),
    ticketKey: ticket.key,
    projectKey: ticket.projectKey ?? "UNKNOWN",
    phase,
    status: "awaiting_response",
    question,
    reason,
    destinations,
    createdAt: now,
    updatedAt: now,
    response: null,
    transportState: {},
    context
  });
}

export function normalizeInteractionRecord(record = {}) {
  const fallbackTimestamp = new Date().toISOString();
  const normalized = {
    id: `${record.id ?? randomUUID()}`.trim(),
    ticketKey: `${record.ticketKey ?? record.ticket_key ?? ""}`.trim(),
    projectKey: `${record.projectKey ?? record.project_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    phase: `${record.phase ?? "triage"}`.trim() || "triage",
    status: normalizeInteractionStatus(record.status),
    question: `${record.question ?? ""}`.trim(),
    reason: `${record.reason ?? ""}`.trim(),
    destinations: normalizeInteractionDestinations(record.destinations),
    createdAt: normalizeTimestamp(record.createdAt, fallbackTimestamp),
    updatedAt: normalizeTimestamp(record.updatedAt, fallbackTimestamp),
    resolvedAt: record.resolvedAt ? normalizeTimestamp(record.resolvedAt, fallbackTimestamp) : "",
    response: record.response
      ? normalizeInteractionResponse(record.response, record.response.source)
      : null,
    transportState: record.transportState && typeof record.transportState === "object"
      ? record.transportState
      : {},
    context: record.context && typeof record.context === "object" ? record.context : {},
    answerSummary: `${record.answerSummary ?? record.answer_summary ?? ""}`.trim()
  };

  if (!normalized.ticketKey) {
    throw new Error("Interaction record requires ticketKey");
  }

  return normalized;
}

export function mergeInteractionRecord(previous, next) {
  return normalizeInteractionRecord({
    ...previous,
    ...next,
    transportState: {
      ...(previous?.transportState ?? {}),
      ...(next?.transportState ?? {})
    },
    context: {
      ...(previous?.context ?? {}),
      ...(next?.context ?? {})
    }
  });
}

export function buildInteractionMarkers(interactionId) {
  return {
    pending: `interaction:${interactionId}:pending`,
    answered: `interaction:${interactionId}:answered`
  };
}

export function deriveInteractionOverrides(text, targeting) {
  const normalizedText = `${text ?? ""}`.trim();
  if (!normalizedText) {
    return {};
  }

  const productTarget = inferTargetFromTextFragments([normalizedText], targeting);
  const repoMatch = normalizedText.match(
    /\b(?:repo|repository)\s*[:=]?\s*([A-Za-z0-9._+/-]+)/i
  );
  const repoTarget = repoMatch?.[1]?.trim() ?? "";

  if (!productTarget && !repoTarget) {
    return {};
  }

  return {
    productTarget,
    repoTarget: repoTarget || (productTarget ? defaultRepoTarget(productTarget, targeting) : "")
  };
}

export function mergeInteractionOverrides(base = {}, incoming = {}) {
  return {
    productTarget: incoming.productTarget || base.productTarget || "",
    repoTarget: incoming.repoTarget || base.repoTarget || ""
  };
}

export function appendInteractionContext(description, phase, response) {
  const normalizedDescription = `${description ?? ""}`.trim();
  const normalizedResponse = `${response?.text ?? ""}`.trim();
  if (!normalizedResponse) {
    return normalizedDescription;
  }

  const source = `${response?.source ?? "human"}`.trim();
  const clarificationBlock = `Human clarification (${phase}/${source}): ${normalizedResponse}`;
  return [normalizedDescription, clarificationBlock].filter(Boolean).join("\n\n");
}

export function collectInteractionTags(phase, source, productTarget, repoTarget) {
  return normalizeStringArray([
    "interaction",
    "human-input",
    phase,
    source,
    productTarget,
    repoTarget
  ]);
}
