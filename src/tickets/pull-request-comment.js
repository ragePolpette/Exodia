export function extractPullRequestNumber(pullRequest = {}) {
  const explicitId = `${pullRequest.id ?? pullRequest.number ?? pullRequest.prNumber ?? ""}`.trim();
  if (explicitId) {
    return explicitId;
  }

  const url = `${pullRequest.link ?? pullRequest.url ?? ""}`;
  const match = url.match(/\/pull-requests\/(\d+)(?:\b|\/|$)/i) ?? url.match(/[?&]pullRequest=(\d+)(?:&|$)/i);
  return match?.[1] ?? "";
}

export function buildPullRequestTicketComment(ticket, pullRequest, { branchName = "", commitSha = "" } = {}) {
  const url = `${pullRequest?.link ?? pullRequest?.url ?? ""}`.trim();
  const number = extractPullRequestNumber(pullRequest);
  const label = number ? `PR #${number}` : "PR";
  const lines = [
    `[Exodia] Pull request aperta: ${url ? `[${label}](${url})` : label}.`,
    branchName ? `Branch: \`${branchName}\`` : null,
    commitSha ? `Commit: \`${commitSha}\`` : null,
    ticket?.key ? `Ticket: \`${ticket.key}\`` : null
  ];

  return lines.filter(Boolean).join("\n");
}
