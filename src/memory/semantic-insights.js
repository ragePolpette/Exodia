import { redactText } from "../security/redaction.js";
import { collectInteractionTags } from "../interaction/interaction-contracts.js";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractPathHints(mapping) {
  return unique(
    (mapping?.hints ?? []).filter(
      (hint) =>
        typeof hint === "string" &&
        /(?:api|pubblico|librerie)[\\/]|\.asp$|\.cs$|\.js$/i.test(hint)
    )
  ).slice(0, 5);
}

export function buildTriageInsight(ticket, mapping, decision, redaction) {
  if (!decision || decision.status_decision === "skipped_out_of_scope") {
    return null;
  }

  const pathHints = extractPathHints(mapping);
  const shouldStore =
    decision.status_decision !== "feasible" ||
    (decision.confidence ?? 0) >= 0.78 ||
    pathHints.length > 0 ||
    (mapping?.blockers ?? []).length > 0;

  if (!shouldStore) {
    return null;
  }

  return {
    phase: "triage",
    ticketKey: ticket.key,
    productTarget: decision.product_target,
    repoTarget: decision.repo_target,
    confidence: decision.confidence ?? 0.5,
    tags: unique([
      "triage",
      decision.status_decision,
      decision.product_target,
      decision.repo_target
    ]),
    content: redactText([
      `${ticket.key} triage => ${decision.product_target}/${decision.repo_target} [${decision.status_decision}]`,
      decision.short_reason,
      decision.implementation_hint ? `hint: ${decision.implementation_hint}` : "",
      pathHints.length > 0 ? `paths: ${pathHints.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join(" | "), redaction),
    metadata: {
      summary: redactText(ticket.summary, redaction),
      statusDecision: decision.status_decision,
      blockers: mapping?.blockers ?? [],
      recheckConditions: decision.recheck_conditions ?? [],
      pathHints: pathHints.map((hint) => redactText(hint, redaction))
    }
  };
}

export function buildExecutionInsight(ticket, decision, result, redaction) {
  if (!result) {
    return null;
  }

  const interestingStatuses = new Set([
    "pr_opened",
    "blocked",
    "not_feasible",
    "skipped_low_confidence"
  ]);

  if (!interestingStatuses.has(result.status)) {
    return null;
  }

  return {
    phase: "execution",
    ticketKey: ticket.key,
    productTarget: result.productTarget ?? decision?.product_target ?? ticket.productTarget ?? "unknown",
    repoTarget: result.repoTarget ?? decision?.repo_target ?? ticket.repoTarget ?? "UNKNOWN",
    confidence: decision?.confidence ?? 0.5,
    tags: unique([
      "execution",
      result.status,
      result.productTarget ?? decision?.product_target,
      result.repoTarget ?? decision?.repo_target
    ]),
    content: redactText([
      `${ticket.key} execution => ${result.status}`,
      result.reason,
      result.branchName ? `branch: ${result.branchName}` : "",
      result.pullRequestUrl ? `pr: ${result.pullRequestUrl}` : ""
    ]
      .filter(Boolean)
      .join(" | "), redaction),
    metadata: {
      summary: redactText(ticket.summary, redaction),
      status: result.status,
      branchName: result.branchName ?? "",
      pullRequestUrl: redactText(result.pullRequestUrl ?? "", redaction)
    }
  };
}

export function buildClarificationInsight(ticket, interaction, summary, redaction) {
  if (!interaction?.response?.text || !summary) {
    return null;
  }

  const source = interaction.response.source ?? "human";
  const productTarget =
    interaction.context?.productTarget ??
    ticket.productTarget ??
    ticket.product_target ??
    "unknown";
  const repoTarget =
    interaction.context?.repoTarget ??
    ticket.repoTarget ??
    ticket.repo_target ??
    "UNKNOWN";

  return {
    phase: "interaction",
    ticketKey: ticket.key,
    productTarget,
    repoTarget,
    confidence: 0.82,
    tags: collectInteractionTags(
      interaction.phase,
      source,
      productTarget,
      repoTarget
    ),
    content: redactText(
      `${ticket.key} clarification via ${source}: ${summary}`,
      redaction
    ),
    metadata: {
      summary: redactText(ticket.summary, redaction),
      question: redactText(interaction.question ?? "", redaction),
      response: redactText(interaction.response.text, redaction),
      interactionId: interaction.id,
      source,
      phase: interaction.phase
    }
  };
}
