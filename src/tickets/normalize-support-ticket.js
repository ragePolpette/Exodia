import { inferTargetFromTextFragments } from "../targeting/target-rules.js";

function cleanLine(value) {
  return `${value ?? ""}`.trim();
}

function extractFirstMatch(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function inferTargetFromText(summary, description, pageUrl, targeting) {
  return inferTargetFromTextFragments([summary, description, pageUrl], targeting);
}

export function normalizeSupportTicket(ticket, options = {}) {
  const description = `${ticket.description ?? ""}`;
  const lines = description
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const companyOrStudio = lines[0] ?? "";
  const partitaIva = extractFirstMatch(description, /\bpi\s*:\s*([A-Z0-9]+)/i);
  const pageUrl = extractFirstMatch(description, /\burl\s*:\s*(https?:\/\/\S+)/i);
  const phone = extractFirstMatch(description, /\btel\s*:\s*(.+)/i);
  const studio = lines.find((line, index) => index > 0 && /^studio\b/i.test(line)) ?? "";
  const productTargetHint = inferTargetFromText(
    ticket.summary,
    description,
    pageUrl,
    options.targeting
  );

  return {
    ...ticket,
    rawDescription: description,
    companyOrStudio,
    partitaIva,
    pageUrl,
    phone,
    studio,
    productTarget: (ticket.productTarget ?? ticket.product_target ?? productTargetHint) || undefined
  };
}
