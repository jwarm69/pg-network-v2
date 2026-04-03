import { NextResponse } from "next/server";
import {
  supabase,
  isSupabaseConfigured,
  getTarget,
  getResearch,
  type Lane,
  type OutreachThread,
  type Message,
} from "@/lib/supabase";
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

// ─── Claude prompt for generating 3-lane outreach ───

function buildOutreachPrompt(
  targetName: string,
  targetType: string,
  researchSummary: string,
  angle: string
): string {
  return `Generate a 3-lane outreach campaign for the following target. Each lane should have a 5-message sequence.

TARGET: ${targetName}
TYPE: ${targetType}
RESEARCH:
${researchSummary}

PRIMARY ANGLE: ${angle}

Generate 3 lanes:
1. DIRECT — Brixton reaches out personally via email. Use the "${angle}" angle.
2. AGENT — A team member reaches out on Brixton's behalf via email. More formal, references Brixton's credentials.
3. WILDCARD — Brixton reaches out via DM. Creative, unexpected, pattern-interrupt approach. Use a different angle than direct.

For each lane, generate exactly 5 messages following PROGRESSIVE CONCISION:
- Email: M1=${PROGRESSIVE_CONCISION.email.M1}, M2=${PROGRESSIVE_CONCISION.email.M2}, M3=${PROGRESSIVE_CONCISION.email.M3}, M4=${PROGRESSIVE_CONCISION.email.M4}, M5=${PROGRESSIVE_CONCISION.email.M5}
- DM: M1=${PROGRESSIVE_CONCISION.dm.M1}, M2=${PROGRESSIVE_CONCISION.dm.M2}, M3=${PROGRESSIVE_CONCISION.dm.M3}, M4=${PROGRESSIVE_CONCISION.dm.M4}, M5=${PROGRESSIVE_CONCISION.dm.M5}

CHANNEL CONSTRAINTS:
- Email subject lines: max ${CHANNEL_CONSTRAINTS.email.subjectMaxChars} chars
- Email M1: max ${CHANNEL_CONSTRAINTS.email.m1MaxWords} words
- DM M1: max ${CHANNEL_CONSTRAINTS.dm.m1MaxChars} chars

CRITICAL: Use the research data to personalize EVERY message. Reference specific things about ${targetName} — their work, achievements, recent activity. Generic messages are unacceptable.

Respond in this EXACT JSON format (no markdown, no code fences):
{
  "lanes": [
    {
      "lane": "direct",
      "channel": "email",
      "angle": "angle name used",
      "messages": [
        { "sequence": 1, "subject": "subject line", "body": "message body" },
        { "sequence": 2, "subject": "subject line", "body": "message body" },
        { "sequence": 3, "subject": "subject line", "body": "message body" },
        { "sequence": 4, "subject": "subject line", "body": "message body" },
        { "sequence": 5, "subject": "", "body": "message body" }
      ]
    },
    {
      "lane": "agent",
      "channel": "email",
      "angle": "angle name used",
      "messages": [...]
    },
    {
      "lane": "wildcard",
      "channel": "dm",
      "angle": "angle name used",
      "messages": [...]
    }
  ]
}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetId, angle } = body as { targetId: string; angle?: string };

    if (!targetId) {
      return NextResponse.json({ error: "targetId is required" }, { status: 400 });
    }

    // Check if Claude API is available
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    // If Supabase isn't configured, return example data
    if (!isSupabaseConfigured()) {
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

    // Generate with Claude
    const prompt = buildOutreachPrompt(
      target.name,
      target.type,
      researchSummary,
      selectedAngle
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

    // Save to Supabase
    const savedThreads: Array<OutreachThread & { messages: Message[] }> = [];

    for (const lane of generatedLanes) {
      // Create thread
      const { data: thread, error: threadError } = await supabase
        .from("outreach_threads")
        .insert({
          target_id: targetId,
          lane: lane.lane,
          channel: lane.channel,
          status: "draft" as const,
        })
        .select()
        .single();

      if (threadError) {
        console.error("Error creating thread:", threadError);
        continue;
      }

      // Create messages
      const messagesToInsert = lane.messages.map((msg) => ({
        thread_id: thread.id,
        sequence: msg.sequence,
        subject: msg.subject,
        body: msg.body,
        sent: false,
      }));

      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .insert(messagesToInsert)
        .select();

      if (msgError) {
        console.error("Error creating messages:", msgError);
      }

      savedThreads.push({ ...thread, messages: messages || [] });
    }

    // Update target status
    await supabase
      .from("targets")
      .update({ status: "drafted", updated_at: new Date().toISOString() })
      .eq("id", targetId);

    // Log activity
    await supabase.from("activity_log").insert({
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
  if (!isSupabaseConfigured()) {
    return NextResponse.json([]);
  }

  try {
    const { data: threads, error } = await supabase
      .from("outreach_threads")
      .select("*, targets(id, name, type, status, priority, score)")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // For each thread, fetch messages
    const threadsWithMessages = await Promise.all(
      (threads || []).map(async (thread: OutreachThread & { targets: unknown }) => {
        const { data: messages } = await supabase
          .from("messages")
          .select("*")
          .eq("thread_id", thread.id)
          .order("sequence", { ascending: true });

        return { ...thread, messages: messages || [] };
      })
    );

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
      const { data, error } = await supabase
        .from("messages")
        .update(updates)
        .eq("id", messageId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json(data);
    }

    if (threadId) {
      const { data, error } = await supabase
        .from("outreach_threads")
        .update(updates)
        .eq("id", threadId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "messageId or threadId required" }, { status: 400 });
  } catch (err) {
    console.error("Error updating outreach:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
