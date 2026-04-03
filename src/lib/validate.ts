import { VOICE_RULES, CHANNEL_CONSTRAINTS } from "./brand-dna";

export interface Violation {
  rule: string;
  detail: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

export function validateMessage(
  body: string,
  channel: keyof typeof CHANNEL_CONSTRAINTS = "email"
): ValidationResult {
  const violations: Violation[] = [];
  const trimmed = body.trim();

  // Rule: never start with "I"
  if (/^I\s/.test(trimmed)) {
    violations.push({
      rule: "STARTS_WITH_I",
      detail: "Message starts with 'I' \u2014 signals self-centeredness",
    });
  }

  // Rule: banned phrases
  for (const phrase of VOICE_RULES.bannedPhrases) {
    if (trimmed.toLowerCase().includes(phrase.toLowerCase())) {
      violations.push({
        rule: "BANNED_PHRASE",
        detail: `Contains banned phrase: \"${phrase}\"`,
      });
    }
  }

  // Rule: channel length constraints
  const constraints = CHANNEL_CONSTRAINTS[channel];
  if ("m1MaxWords" in constraints) {
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount > constraints.m1MaxWords) {
      violations.push({
        rule: "TOO_LONG",
        detail: `${wordCount} words exceeds ${constraints.m1MaxWords} word limit for ${channel}`,
      });
    }
  }
  if ("m1MaxChars" in constraints) {
    if (trimmed.length > constraints.m1MaxChars) {
      violations.push({
        rule: "TOO_LONG",
        detail: `${trimmed.length} chars exceeds ${constraints.m1MaxChars} char limit for ${channel}`,
      });
    }
  }
  if ("maxChars" in constraints) {
    if (trimmed.length > constraints.maxChars) {
      violations.push({
        rule: "TOO_LONG",
        detail: `${trimmed.length} chars exceeds ${constraints.maxChars} char limit for ${channel}`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
