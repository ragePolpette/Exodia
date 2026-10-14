const defaultRedactionConfig = {
  enabled: true,
  redactSecrets: true,
  redactEmails: true,
  redactUrls: true,
  redactPaths: true,
  redactPhones: true,
  redactTaxIds: true,
  secretToken: "[redacted:secret]",
  emailToken: "[redacted:email]",
  urlToken: "[redacted:url]",
  pathToken: "[redacted:path]",
  phoneToken: "[redacted:phone]",
  taxIdToken: "[redacted:tax-id]"
};

export const secretPatterns = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bATATT[A-Za-z0-9_=-]{20,}/g,
  /\bATCTT[A-Za-z0-9_=-]{20,}/g,
  /\bATBB[A-Za-z0-9_=-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g
]);

const bearerPattern = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function resolveRedactionConfig(config = {}) {
  return {
    ...defaultRedactionConfig,
    ...config
  };
}

export function redactText(value, config = {}) {
  const resolved = resolveRedactionConfig(config);
  if (!resolved.enabled || typeof value !== "string" || !value) {
    return value;
  }

  let redacted = value;

  if (resolved.redactSecrets) {
    for (const pattern of secretPatterns) {
      redacted = redacted.replace(pattern, resolved.secretToken);
    }
    redacted = redacted.replace(bearerPattern, (_match, scheme) => `${scheme} ${resolved.secretToken}`);
  }

  if (resolved.redactEmails) {
    redacted = redacted.replace(emailPattern, resolved.emailToken);
  }

  if (resolved.redactUrls) {
    redacted = redacted.replace(/https?:\/\/\S+/gi, resolved.urlToken);
  }

  if (resolved.redactPaths) {
    redacted = redacted.replace(/[A-Za-z]:\\Users\\[^\s\\]+(?:\\[^\s\\]+)*/g, resolved.pathToken);
    redacted = redacted.replace(/[A-Za-z]:\\inetpub\\[^\s\\]+(?:\\[^\s\\]+)*/gi, resolved.pathToken);
  }

  if (resolved.redactPhones) {
    redacted = redacted.replace(/\b(?:\+?\d[\s-]?){8,}\d\b/g, resolved.phoneToken);
  }

  if (resolved.redactTaxIds) {
    redacted = redacted.replace(/\b(?:IT)?\d{11}\b/gi, resolved.taxIdToken);
  }

  return redacted;
}

export function redactValue(value, config = {}) {
  if (typeof value === "string") {
    return redactText(value, config);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, config));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactValue(entry, config)])
  );
}
