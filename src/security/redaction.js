const defaultRedactionConfig = {
  enabled: true,
  redactUrls: true,
  redactPaths: true,
  redactPhones: true,
  redactTaxIds: true,
  urlToken: "[redacted:url]",
  pathToken: "[redacted:path]",
  phoneToken: "[redacted:phone]",
  taxIdToken: "[redacted:tax-id]"
};

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
