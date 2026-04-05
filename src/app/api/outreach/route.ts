import { NextResponse } from "next/server";
import {
  isDbConfigured,
  getTarget,
  getResearch,
  createThread,
  insertMessages,
  updateTarget,
  logActivity,
  getAllThreadsWithTargets,
  updateMessage,
  updateThread,
  type Lane,
  type OutreachThread,
  type Message,
} from "@/lib/db";
import { askClaude } from "@/lib/claude";
import { validateMessage, type ValidationResult } from "@/lib/validate";
import {
  ANGLE_ARCHETYPES,
  PROGRESSIVE_CONCISION,
  CHANNEL_CONSTRAINTS,
} from "@/lib/brand-dna";

export const dynamic = "force-dynamic";

interface GeneratedMessage {
  sequence: number;
  subject: string;
  body: string;
  validation: ValidationResult;
}

interface GeneratedLane {
  lane: Lane;
  channel: string;
  angle: string;
  messages: GeneratedMessage[];
}

// ─── Example data for when Claude API is not configured ───

function buildExampleResponse(targetName: string) {
  const lanes: GeneratedLane[] = [
    {
      lane: "direct",
      channel: "email",
      angle: "The Founder Parallel",
      messages: [
        {
          sequence: 1,
          subject: `Quick thought on ${targetName}'s approach`,
          body: `Something ${targetName} said recently caught my attention — the parallel to what we've built at Performance Golf is hard to ignore. 800,000 golfers on the platform, $5M into AI that detects 77 swing flaws at 96% accuracy. Would be worth a 15-minute conversation.\n\nBrixton`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 2,
          subject: `Re: Quick thought`,
          body: `Wanted to share one data point: 2M+ swings analyzed so far. The AI angle alone might be worth a look.\n\nBrixton`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 3,
          subject: `Re: Quick thought`,
          body: `No worries if the timing's off. Door stays open.\n\nBrixton`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 4,
          subject: `One last thing`,
          body: `Forbes #1 Golf Company — figured that alone might earn a reply.\n\nBrixton`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 5,
          subject: ``,
          body: `Closing the loop. If it ever makes sense, you know where to find me.\n\nBrixton`,
          validation: { valid: true, violations: [] },
        },
      ],
    },
    {
      lane: "agent",
      channel: "email",
      angle: "The Mutual Mission",
      messages: [
        {
          sequence: 1,
          subject: `Connecting ${targetName} + Brixton Marr`,
          body: `Reaching out on behalf of Brixton Marr, founder of Performance Golf. He noticed some overlap between ${targetName}'s work and what PG has built — 800K+ golfers, $120M+ revenue, all bootstrapped. Brixton wanted to explore whether there's a fit for a conversation.\n\nBest,\nTeam PG`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 2,
          subject: `Re: Connecting ${targetName} + Brixton Marr`,
          body: `Following up briefly — Brixton's team just crossed 2M swings analyzed with their AI. Thought that context might be relevant.\n\nBest,\nTeam PG`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 3,
          subject: `Re: Connecting ${targetName} + Brixton Marr`,
          body: `Last note from our end. Happy to coordinate if the timing works.\n\nBest,\nTeam PG`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 4,
          subject: `Final follow-up`,
          body: `Closing the loop on this. Door's always open.\n\nBest,\nTeam PG`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 5,
          subject: ``,
          body: `If the timing changes, reach out anytime.\n\nBest,\nTeam PG`,
          validation: { valid: true, violations: [] },
        },
      ],
    },
    {
      lane: "wildcard",
      channel: "dm",
      angle: "The Challenge/Experience",
      messages: [
        {
          sequence: 1,
          subject: ``,
          body: `Random question: ever had your swing analyzed by AI? Built something at Performance Golf that picks up 77 flaws at 96% accuracy. Would love to run yours through it.`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 2,
          subject: ``,
          body: `2M swings analyzed so far. Yours could be 2,000,001.`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 3,
          subject: ``,
          body: `No pitch — genuinely curious what the AI would find.`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 4,
          subject: ``,
          body: `Open invite. Anytime.`,
          validation: { valid: true, violations: [] },
        },
        {
          sequence: 5,
          subject: ``,
          body: `Last one. The offer stands.`,
          validation: { valid: true, violations: [] },
        },
      ],
    },
  ];

  return {
    threads: lanes,
    warnings: [],
    note: "Example messages shown — set ANTHROPIC_API_KEY to generate personalized outreach with Claude.",
  };
}

// ─── Context-aware outreach prompt ───
// The tone, framing, and content change based on WHO we're reaching out to:
// - "direct" → peer-to-peer, casual, reference their work, Brixton signs off
// - "agent" → business-formal, reference Brixton's credentials, team signs off
// - "wildcard" → creative, pattern-interrupt, conversational

function buildOutreachPrompt(
  targetName: string,
  targetType: string,
  researchSummary: string,
  angle: string,
  contactPath?: { type: string; name: string; channel: string; email?: string; role?: string }
): string {
  const pathType = contactPath?.type || "direct";
  const recipientName = contactPath?.name || targetName;
  const recipientRole = contactPath?.role || "";
  const channel = contactPath?.channel || "email";

  // Context-specific instructions
  let contextInstructions = "";
  let laneOverride = "";

  if (pathType === "agent") {
    contextInstructions = `You are writing TO ${recipientName} (${recipientRole}), who is the AGENT/REPRESENTATIVE of ${targetName}.

CRITICAL CONTEXT: This is a BUSINESS email to a gatekeeper, NOT a casual message to the target.
- Open by clearly stating who Brixton is and why you're reaching out about ${targetName}
- Lead with credentials: $120M+ company, Forbes #1 Golf Company, 800K+ golfers
- Make the VALUE PROP for their client clear (what's in it for ${targetName}?)
- Be respectful of their time — they get hundreds of pitches
- Sign off as "Team Performance Golf" or "Brixton Marr, CEO, Performance Golf"
- Include specific ask: "15-minute call to discuss a potential partnership"`;
    laneOverride = `Generate a SINGLE outreach lane for the agent path.
Lane: "agent", Channel: "email", Recipient: ${recipientName}`;
  } else if (pathType === "wildcard") {
    contextInstructions = `You are writing via a WILDCARD/CREATIVE path — this could be through ${recipientName} (${recipientRole}).

CRITICAL CONTEXT: This is an unconventional approach, NOT a standard pitch.
- Be creative and unexpected — pattern interrupt
- If going through a mutual connection, reference the shared context
- If going through a foundation/charity, lead with shared values
- Keep it conversational, not corporate
- Sign off as "Brixton"`;
    laneOverride = `Generate a SINGLE outreach lane for the wildcard path.
Lane: "wildcard", Channel: "${channel}", Via: ${recipientName}`;
  } else {
    contextInstructions = `You are writing DIRECTLY to ${targetName} from Brixton, peer-to-peer.

CRITICAL CONTEXT: This is a personal, casual message from one achiever to another.
- Reference THEIR specific work, achievements, recent activity from the research
- Brixton is NOT asking for a favor — he's offering a genuine opportunity
- Sound like a human texting a peer, not a marketer writing copy
- Never start with "I" — open with something about THEM
- Sign off as "Brixton"`;
    laneOverride = `Generate a SINGLE outreach lane for the direct path.
Lane: "direct", Channel: "${channel}"`;
  }

  return `${contextInstructions}

TARGET: ${targetName} (type: ${targetType})
RECIPIENT: ${recipientName} ${recipientRole ? `(${recipientRole})` : ""}
${contactPath?.email ? `EMAIL: ${contactPath.email}` : ""}

RESEARCH:
${researchSummary}

ANGLE: ${angle}

${laneOverride}

Generate exactly 5 messages following PROGRESSIVE CONCISION:
${channel === "dm" || channel === "instagram" || channel === "twitter" ? `
- M1: ${PROGRESSIVE_CONCISION.dm.M1}
- M2: ${PROGRESSIVE_CONCISION.dm.M2}
- M3: ${PROGRESSIVE_CONCISION.dm.M3}
- M4: ${PROGRESSIVE_CONCISION.dm.M4}
- M5: ${PROGRESSIVE_CONCISION.dm.M5}
DM constraints: M1 max ${CHANNEL_CONSTRAINTS.dm.m1MaxChars} chars` : `
- M1: ${PROGRESSIVE_CONCISION.email.M1}
- M2: ${PROGRESSIVE_CONCISION.email.M2}
- M3: ${PROGRESSIVE_CONCISION.email.M3}
- M4: ${PROGRESSIVE_CONCISION.email.M4}
- M5: ${PROGRESSIVE_CONCISION.email.M5}
Email constraints: subject max ${CHANNEL_CONSTRAINTS.email.subjectMaxChars} chars, M1 max ${CHANNEL_CONSTRAINTS.email.m1MaxWords} words`}

CRITICAL: Personalize EVERY message with research data. Generic messages are unacceptable.

Respond in this EXACT JSON format (no markdown, no code fences):
{
  "lanes": [
    {
      "lane": "${pathType}",
      "channel": "${channel === "instagram" || channel === "twitter" ? "dm" : "email"}",
      "angle": "angle name used",
      "recipient": "${recipientName}",
      "messages": [
        { "sequence": 1, "subject": "subject line (empty for DMs)", "body": "message body" },
        { "sequence": 2, "subject": "subject line", "body": "message body" },
        { "sequence": 3, "subject": "subject line", "body": "message body" },
        { "sequence": 4, "subject": "subject line", "body": "message body" },
        { "sequence": 5, "subject": "", "body": "message body" }
      ]
    }
  ]
}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetId, angle, contactPathType, contactPathName, contactPathChannel, contactPathEmail, contactPathRole } = body as {
      targetId: string;
      angle?: string;
      contactPathType?: string;
      contactPathName?: string;
      contactPathChannel?: string;
      contactPathEmail?: string;
      contactPathRole?: string;
    };

    if (!targetId) {
      return NextResponse.json({ error: "targetId is required" }, { status: 400 });
    }

    // Check if Claude API is available
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    // If DB isn't configured, return example data
    if (!isDbConfigured()) {
      const example = buildExampleResponse("Example Target");
      return NextResponse.json(example);
    }

    // Fetch target
    const target = await getTarget(targetId);
    if (!target) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }

    // Fetch research
    const research = await getResearch(targetId);
    const researchSummary =
      research.length > 0
        ? research.map((r) => `${r.field}: ${r.value}`).join("\n")
        : "No research available yet. Use general knowledge about the target.";

    // Pick angle
    const selectedAngle =
      angle ||
      ANGLE_ARCHETYPES[Math.floor(Math.random() * ANGLE_ARCHETYPES.length)].name;

    // If no API key, return example messages
    if (!hasApiKey) {
      const example = buildExampleResponse(target.name);
      return NextResponse.json(example);
    }

    // Build contact path context if provided
    const contactPath = contactPathType ? {
      type: contactPathType,
      name: contactPathName || target.name,
      channel: contactPathChannel || "email",
      email: contactPathEmail,
      role: contactPathRole,
    } : undefined;

    // Generate with Claude
    const prompt = buildOutreachPrompt(
      target.name,
      target.type,
      researchSummary,
      selectedAngle,
      contactPath
    );

    const raw = await askClaude(prompt, { maxTokens: 4096, temperature: 0.8 });

    // Parse response — strip any code fences if present
    let parsed: { lanes: Array<{ lane: Lane; channel: string; angle: string; messages: Array<{ sequence: number; subject: string; body: string }> }> };
    try {
      const cleaned = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse Claude response", raw },
        { status: 500 }
      );
    }

    // Validate messages and build result
    const allWarnings: Array<{ lane: string; sequence: number; violations: ValidationResult["violations"] }> = [];
    const generatedLanes: GeneratedLane[] = [];

    for (const laneData of parsed.lanes) {
      const channel = laneData.channel === "dm" ? "dm" : "email";
      const validatedMessages: GeneratedMessage[] = [];

      for (const msg of laneData.messages) {
        const validation = validateMessage(msg.body, channel);
        if (!validation.valid) {
          allWarnings.push({
            lane: laneData.lane,
            sequence: msg.sequence,
            violations: validation.violations,
          });
        }
        validatedMessages.push({
          sequence: msg.sequence,
          subject: msg.subject || "",
          body: msg.body,
          validation,
        });
      }

      generatedLanes.push({
        lane: laneData.lane as Lane,
        channel,
        angle: laneData.angle,
        messages: validatedMessages,
      });
    }

    // Save to database
    const savedThreads: Array<OutreachThread & { messages: Message[] }> = [];

    for (const lane of generatedLanes) {
      try {
        const thread = await createThread({
          target_id: targetId,
          lane: lane.lane,
          channel: lane.channel,
          status: "draft",
        });

        const messagesToInsert = lane.messages.map((msg) => ({
          thread_id: thread.id,
          sequence: msg.sequence,
          subject: msg.subject,
          body: msg.body,
          sent: false,
        }));

        const messages = await insertMessages(messagesToInsert);
        savedThreads.push({ ...thread, messages });
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    }

    // Update target status
    await updateTarget(targetId, { status: "drafted" } as Partial<import("@/lib/db").Target>);

    // Log activity
    await logActivity({
      target_id: targetId,
      action: "outreach_generated",
      details: `Generated 3-lane outreach for ${target.name} using "${selectedAngle}" angle`,
    });

    return NextResponse.json({
      threads: generatedLanes,
      savedThreads,
      warnings: allWarnings,
    });
  } catch (err) {
    console.error("Outreach generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate outreach" },
      { status: 500 }
    );
  }
}

// GET: fetch all outreach threads with their target info
export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json([]);
  }

  try {
    const threadsWithMessages = await getAllThreadsWithTargets();
    return NextResponse.json(threadsWithMessages);
  } catch (err) {
    console.error("Error fetching outreach threads:", err);
    return NextResponse.json(
      { error: "Failed to fetch outreach threads" },
      { status: 500 }
    );
  }
}

// PATCH: update a message (edit body, mark sent, approve, etc.)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { messageId, threadId, ...updates } = body;

    if (messageId) {
      const data = await updateMessage(messageId, updates);
      return NextResponse.json(data);
    }

    if (threadId) {
      const data = await updateThread(threadId, updates);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "messageId or threadId required" }, { status: 400 });
  } catch (err) {
    console.error("Error updating outreach:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
