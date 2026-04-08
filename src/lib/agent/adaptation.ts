import {
  getRecentSignals,
  upsertLearnedPreference,
  getSignalsByType,
} from "../db-agent";
import type { LearningSignal, PreferenceCategory } from "./types";

export async function runAdaptation(): Promise<void> {
  const signals = await getRecentSignals(500);
  if (signals.length === 0) return;

  await Promise.all([
    computeAngleEffectiveness(signals),
    computeEditPatterns(signals),
    computeScoringBias(signals),
    computeChannelPreferences(signals),
    computeTimingPreferences(signals),
  ]);
}

// ─── Angle Effectiveness ───

async function computeAngleEffectiveness(signals: LearningSignal[]): Promise<void> {
  const angleSelections = signals.filter((s) => s.signal_type === "angle_selected");
  const approvals = signals.filter((s) => s.signal_type === "draft_accepted_clean");
  const edits = signals.filter((s) => s.signal_type === "draft_edited_heavily");
  const rejections = signals.filter((s) => s.signal_type === "draft_rejected");
  const replies = signals.filter((s) => s.signal_type === "reply_received");

  // Group by angle
  const angles: Record<string, { used: number; approved: number; edited: number; rejected: number; replied: number }> = {};

  for (const s of angleSelections) {
    const angle = s.signal_value;
    if (!angles[angle]) angles[angle] = { used: 0, approved: 0, edited: 0, rejected: 0, replied: 0 };
    angles[angle].used++;
  }

  // Match approvals/edits/rejections to angles via run_id
  for (const s of approvals) {
    const matchingAngle = angleSelections.find((a) => a.run_id === s.run_id);
    if (matchingAngle) {
      const angle = matchingAngle.signal_value;
      if (angles[angle]) angles[angle].approved++;
    }
  }
  for (const s of edits) {
    const matchingAngle = angleSelections.find((a) => a.run_id === s.run_id);
    if (matchingAngle) {
      const angle = matchingAngle.signal_value;
      if (angles[angle]) angles[angle].edited++;
    }
  }
  for (const s of rejections) {
    const matchingAngle = angleSelections.find((a) => a.run_id === s.run_id);
    if (matchingAngle) {
      const angle = matchingAngle.signal_value;
      if (angles[angle]) angles[angle].rejected++;
    }
  }
  for (const s of replies) {
    const matchingAngle = angleSelections.find((a) => a.target_id === s.target_id);
    if (matchingAngle) {
      const angle = matchingAngle.signal_value;
      if (angles[angle]) angles[angle].replied++;
    }
  }

  for (const [angle, stats] of Object.entries(angles)) {
    if (stats.used === 0) continue;
    await upsertLearnedPreference({
      category: "angle_effectiveness",
      key: angle,
      valueJson: JSON.stringify({
        approvalRate: Math.round((stats.approved / stats.used) * 100),
        editRate: Math.round((stats.edited / stats.used) * 100),
        rejectionRate: Math.round((stats.rejected / stats.used) * 100),
        replyRate: stats.replied > 0 ? Math.round((stats.replied / stats.used) * 100) : 0,
      }),
      confidence: stats.used >= 10 ? 0.8 : stats.used >= 5 ? 0.6 : 0.4,
      sampleSize: stats.used,
    });
  }
}

// ─── Edit Patterns ───

async function computeEditPatterns(signals: LearningSignal[]): Promise<void> {
  const editSignals = signals.filter((s) => s.signal_type === "draft_edited_heavily");

  if (editSignals.length < 3) return;

  // Analyze what changed
  const patterns: Record<string, number> = {};
  for (const s of editSignals) {
    try {
      const data = JSON.parse(s.signal_value);
      if (data.original && data.edited) {
        const origStr = typeof data.original === "string" ? data.original : JSON.stringify(data.original);
        const editStr = typeof data.edited === "string" ? data.edited : JSON.stringify(data.edited);

        // Simple heuristics for common edit types
        if (editStr.length < origStr.length * 0.7) patterns["shortened"] = (patterns["shortened"] || 0) + 1;
        if (editStr.length > origStr.length * 1.3) patterns["lengthened"] = (patterns["lengthened"] || 0) + 1;

        // Check if opening was changed
        const origFirst = origStr.slice(0, 50);
        const editFirst = editStr.slice(0, 50);
        if (origFirst !== editFirst) patterns["opening_changed"] = (patterns["opening_changed"] || 0) + 1;
      }
    } catch { /* skip */ }
  }

  for (const [pattern, count] of Object.entries(patterns)) {
    await upsertLearnedPreference({
      category: "edit_patterns",
      key: pattern,
      valueJson: JSON.stringify({
        description: `User ${pattern.replace(/_/g, " ")} in ${count} of ${editSignals.length} edits`,
        frequency: count / editSignals.length,
      }),
      confidence: editSignals.length >= 10 ? 0.7 : 0.4,
      sampleSize: editSignals.length,
    });
  }
}

// ─── Scoring Bias ───

async function computeScoringBias(signals: LearningSignal[]): Promise<void> {
  const overrides = signals.filter((s) => s.signal_type === "score_overridden");
  if (overrides.length < 3) return;

  let totalDrift = 0;
  for (const s of overrides) {
    try {
      const data = JSON.parse(s.signal_value);
      if (data.oldValue && data.newValue) {
        totalDrift += Number(data.newValue) - Number(data.oldValue);
      }
    } catch { /* skip */ }
  }

  const avgDrift = totalDrift / overrides.length;

  await upsertLearnedPreference({
    category: "scoring_bias",
    key: "overall_drift",
    valueJson: JSON.stringify({
      dimension: "score",
      adjustment: Math.round(avgDrift),
      description: `User adjusts scores by ${avgDrift > 0 ? "+" : ""}${Math.round(avgDrift)} on average`,
    }),
    confidence: overrides.length >= 10 ? 0.7 : 0.4,
    sampleSize: overrides.length,
  });
}

// ─── Channel Preferences ───

async function computeChannelPreferences(signals: LearningSignal[]): Promise<void> {
  const sent = signals.filter((s) => s.signal_type === "message_sent");
  const replies = signals.filter((s) => s.signal_type === "reply_received");

  const channels: Record<string, { sent: number; replied: number }> = {};

  for (const s of sent) {
    try {
      const data = JSON.parse(s.signal_value);
      const ch = data.channel || "email";
      if (!channels[ch]) channels[ch] = { sent: 0, replied: 0 };
      channels[ch].sent++;
    } catch { /* skip */ }
  }

  for (const s of replies) {
    // Try to match reply to a sent message via threadId
    const matchingSent = sent.find((m) => m.thread_id === s.thread_id);
    if (matchingSent) {
      try {
        const data = JSON.parse(matchingSent.signal_value);
        const ch = data.channel || "email";
        if (channels[ch]) channels[ch].replied++;
      } catch { /* skip */ }
    }
  }

  for (const [channel, stats] of Object.entries(channels)) {
    if (stats.sent === 0) continue;
    await upsertLearnedPreference({
      category: "channel_preference",
      key: channel,
      valueJson: JSON.stringify({
        successRate: Math.round((stats.replied / stats.sent) * 100),
        sent: stats.sent,
        replied: stats.replied,
      }),
      confidence: stats.sent >= 10 ? 0.7 : 0.4,
      sampleSize: stats.sent,
    });
  }
}

// ─── Timing Preferences ───

async function computeTimingPreferences(signals: LearningSignal[]): Promise<void> {
  const sent = signals.filter((s) => s.signal_type === "message_sent");
  const replies = signals.filter((s) => s.signal_type === "reply_received");

  if (sent.length < 3 || replies.length === 0) return;

  // Calculate average time-to-reply
  const responseTimes: number[] = [];
  for (const reply of replies) {
    const matchingSent = sent.find((s) => s.thread_id === reply.thread_id);
    if (matchingSent) {
      const sentTime = new Date(matchingSent.created_at).getTime();
      const replyTime = new Date(reply.created_at).getTime();
      const hours = (replyTime - sentTime) / (1000 * 60 * 60);
      if (hours > 0 && hours < 720) { // Within 30 days
        responseTimes.push(hours);
      }
    }
  }

  if (responseTimes.length > 0) {
    const avgHours = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    await upsertLearnedPreference({
      category: "timing",
      key: "avg_response_time_hours",
      valueJson: JSON.stringify({
        averageHours: Math.round(avgHours),
        medianHours: Math.round(responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)]),
        sampleCount: responseTimes.length,
      }),
      confidence: responseTimes.length >= 10 ? 0.7 : 0.4,
      sampleSize: responseTimes.length,
    });
  }
}
