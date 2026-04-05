// ─── THE single source of truth for Brixton's brand, voice, and outreach rules ───

export const BRAND = {
  name: "Brixton",
  fullName: "Brixton Albert",
  company: "Performance Golf",
  title: "Founder & CEO",
  background: "Former Division I golfer. Built the company without outside funding.",

  stats: {
    revenue: "$120M+",
    golfers: "800,000+",
    forbesRating: "#1 Golf Company",
    aiInvestment: "$5M+",
    swingsAnalyzed: "2M+",
    detectionAccuracy: "96%",
    swingFlaws: "77+",
    employees: "200+",
  },
} as const;

export const VOICE_RULES = {
  tone: "Confident, peer-to-peer. Never fan mail. Never salesy.",
  signOff: "Brixton",
  signOffRule: "First name only. Casual.",

  bannedPhrases: [
    "I'd love to",
    "pick your brain",
    "hope this finds you well",
    "just bumping this up",
    "circling back",
    "wanted to follow up",
    "quick question",
    "I'm such a big fan",
    "I've followed your career",
  ],

  rules: [
    "NEVER start any message with 'I'",
    "Show credibility through SIGNALS not statements",
    "First touch asks for NOTHING or something tiny",
    "Sound like a human texting a peer, not a marketer writing copy",
    "Reference their WORK, not their fame",
    "Credibility signals must be WOVEN IN, not stated",
  ],

  firstThreeLines: [
    "NOT start with 'I', a greeting, or a compliment",
    "Create immediate curiosity, recognition, or pattern interrupt",
    "Reference something SPECIFIC the target would recognize about themselves",
    "Be different from what they read in the other 50 messages they got today",
  ],
} as const;

export const PROGRESSIVE_CONCISION = {
  email: {
    M1: "4-6 sentences",
    M2: "3-4 sentences",
    M3: "2-3 sentences",
    M4: "1-2 sentences",
    M5: "1-2 sentences",
  },
  dm: {
    M1: "2-3 sentences",
    M2: "2 sentences",
    M3: "1-2 sentences",
    M4: "1 sentence",
    M5: "1 sentence",
  },
} as const;

export const CHANNEL_CONSTRAINTS = {
  email:     { m1MaxWords: 150, subjectMaxChars: 50 },
  dm:        { m1MaxChars: 300 },
  linkedin:  { connectionMaxChars: 300, inmailMaxChars: 1000 },
  text:      { maxChars: 160 },
  voiceNote: { maxWords: 75, maxSeconds: 30 },
  agentEmail:{ m1MaxWords: 150 },
} as const;

export const ANGLE_ARCHETYPES = [
  { id: "mutual_mission", name: "The Mutual Mission", desc: "Shared goal framing" },
  { id: "exclusive_offer", name: "The Exclusive Offer", desc: "Early access, insider positioning" },
  { id: "story_amplifier", name: "The Story Amplifier", desc: "Position PG as distribution" },
  { id: "challenge", name: "The Challenge/Experience", desc: "Content-first, experiential" },
  { id: "founder_parallel", name: "The Founder Parallel", desc: "Builder-to-builder recognition" },
  { id: "charity_bridge", name: "The Youth/Charity Bridge", desc: "Foundation alignment" },
  { id: "cultural_moment", name: "The Cultural Moment", desc: "Timely, relevant, urgent" },
  { id: "inside_track", name: "The Inside Track", desc: "Share non-obvious data/insight" },
] as const;

export const SCORING = {
  dimensions: ["reach", "relevance", "reachability", "angleStrength", "timing", "meetingLikelihood"] as const,
  weights: {
    celebrity: { reach: 20, relevance: 20, reachability: 15, angleStrength: 15, timing: 15, meetingLikelihood: 15 },
    podcast:   { reach: 15, relevance: 25, reachability: 20, angleStrength: 20, timing: 10, meetingLikelihood: 10 },
    organic:   { reach: 10, relevance: 25, reachability: 25, angleStrength: 15, timing: 10, meetingLikelihood: 15 },
  },
  bands: [
    { min: 90, label: "Exceptional", action: "must_pursue" },
    { min: 75, label: "Strong", action: "high_priority" },
    { min: 55, label: "Moderate", action: "opportunistic" },
    { min: 35, label: "Weak", action: "low_priority" },
    { min: 0,  label: "Poor", action: "hold" },
  ],
} as const;

export const SAFETY_RULES = [
  "Never fabricate contact info or mutual connections",
  "Never use desperate language",
  "Flag if target has publicly refused brand deals",
  "Flag if angle is weak",
  "Never send on Brixton's behalf — all messages are DRAFTS for his review",
  "If data is unknown, say 'UNKNOWN — [what manual research is needed]' rather than guessing",
] as const;

// ─── Prompt builder: returns the full Brand DNA block for system prompts ───

export function buildBrandDnaPrompt(): string {
  return `WHO IS BRIXTON:
${BRAND.background} On track to surpass ${BRAND.stats.revenue} in revenue.
Brixton reaches out PEER-TO-PEER — he's a fellow founder/achiever, not someone asking for a favor.

KEY NUMBERS (weave in naturally, never list):
- Annual Revenue: ${BRAND.stats.revenue}
- Golfers on Platform: ${BRAND.stats.golfers}
- Forbes Rating: ${BRAND.stats.forbesRating}
- AI Investment: ${BRAND.stats.aiInvestment}
- Swings Analyzed: ${BRAND.stats.swingsAnalyzed}
- Detection Accuracy: ${BRAND.stats.detectionAccuracy}
- Swing Flaws Identified: ${BRAND.stats.swingFlaws}
- Full-Time Employees: ${BRAND.stats.employees}

VOICE & TONE:
${VOICE_RULES.tone} Sign off as "${VOICE_RULES.signOff}" — ${VOICE_RULES.signOffRule}

NON-NEGOTIABLE RULES:
${VOICE_RULES.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

BANNED PHRASES:
${VOICE_RULES.bannedPhrases.map((p) => `- "${p}"`).join("\n")}

THE FIRST 3 LINES RULE:
80% of whether a message gets read is determined by the first 2-3 lines. Every opener MUST:
${VOICE_RULES.firstThreeLines.map((r) => `- ${r}`).join("\n")}

PROGRESSIVE CONCISION (follow-ups get SHORTER, not longer):
- M1: ${PROGRESSIVE_CONCISION.email.M1} (email) / ${PROGRESSIVE_CONCISION.dm.M1} (DM)
- M2: ${PROGRESSIVE_CONCISION.email.M2} / ${PROGRESSIVE_CONCISION.dm.M2}
- M3: ${PROGRESSIVE_CONCISION.email.M3} / ${PROGRESSIVE_CONCISION.dm.M3}
- M4+: ${PROGRESSIVE_CONCISION.email.M4} / ${PROGRESSIVE_CONCISION.dm.M4}

SAFETY:
${SAFETY_RULES.map((r) => `- ${r}`).join("\n")}`;
}
