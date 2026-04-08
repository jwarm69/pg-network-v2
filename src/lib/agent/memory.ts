import {
  getTarget,
  getResearch,
  getContactPaths,
  getThreads,
  getMessages,
  getActivity,
} from "../db";
import { getRecentAgentRuns, getAllLearnedPreferences } from "../db-agent";
import type { OperationalMemory, LearnedPreference } from "./types";

export async function buildOperationalMemory(targetId?: string): Promise<OperationalMemory> {
  if (!targetId) {
    return {
      target: null,
      research: [],
      contactPaths: [],
      threads: [],
      messages: [],
      recentActivity: [],
      priorRuns: [],
    };
  }

  const [target, research, contactPaths, threads, activity, priorRuns] = await Promise.all([
    getTarget(targetId),
    getResearch(targetId),
    getContactPaths(targetId),
    getThreads(targetId),
    getActivity(20, targetId),
    getRecentAgentRuns(targetId, 5),
  ]);

  // Load messages for all threads
  const allMessages = await Promise.all(threads.map((t) => getMessages(t.id)));

  return {
    target,
    research,
    contactPaths,
    threads,
    messages: allMessages.flat(),
    recentActivity: activity,
    priorRuns,
  };
}

export function serializeMemoryForPrompt(memory: OperationalMemory): string {
  const sections: string[] = [];

  if (memory.target) {
    const t = memory.target;
    sections.push(`TARGET: ${t.name} (${t.type}, status: ${t.status}, priority: ${t.priority}, score: ${t.score ?? "unscored"})`);
  }

  if (memory.research.length > 0) {
    sections.push("\nRESEARCH DOSSIER:");
    const fieldMap: Record<string, string> = {};
    for (const r of memory.research) fieldMap[r.field] = r.value;
    for (const [field, value] of Object.entries(fieldMap)) {
      sections.push(`  ${field}: ${value.slice(0, 300)}`);
    }
  }

  if (memory.contactPaths.length > 0) {
    sections.push("\nCONTACT PATHS:");
    for (const p of memory.contactPaths) {
      sections.push(`  ${p.type}: ${p.name} (${p.role}) - ${p.email || p.channel} [${p.confidence}]`);
    }
  }

  if (memory.threads.length > 0) {
    sections.push("\nOUTREACH THREADS:");
    for (const t of memory.threads) {
      const msgs = memory.messages.filter((m) => m.thread_id === t.id);
      const sent = msgs.filter((m) => m.sent).length;
      const replied = msgs.filter((m) => m.response_text).length;
      sections.push(`  ${t.lane}/${t.channel} (${t.status}): ${msgs.length} messages, ${sent} sent, ${replied} replied`);
    }
  }

  if (memory.recentActivity.length > 0) {
    sections.push("\nRECENT ACTIVITY:");
    for (const a of memory.recentActivity.slice(0, 10)) {
      sections.push(`  [${a.created_at}] ${a.action}: ${a.details.slice(0, 150)}`);
    }
  }

  if (memory.priorRuns.length > 0) {
    sections.push("\nPRIOR AGENT RUNS:");
    for (const r of memory.priorRuns) {
      sections.push(`  [${r.created_at}] ${r.goal} -> ${r.status}`);
    }
  }

  return sections.join("\n");
}

export async function buildLearningContext(): Promise<string> {
  const prefs = await getAllLearnedPreferences();
  if (prefs.length === 0) return "";

  const sections: string[] = ["\n--- LEARNED PREFERENCES (from past outcomes) ---"];

  const grouped: Record<string, LearnedPreference[]> = {};
  for (const p of prefs) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  for (const [category, items] of Object.entries(grouped)) {
    sections.push(`\n${category.toUpperCase().replace(/_/g, " ")}:`);
    for (const item of items) {
      try {
        const value = JSON.parse(item.value_json);
        if (category === "angle_effectiveness") {
          sections.push(`  ${item.key}: ${value.approvalRate}% approved, ${value.replyRate || 0}% reply rate (n=${item.sample_size}, confidence=${item.confidence})`);
        } else if (category === "edit_patterns") {
          sections.push(`  ${item.key}: ${value.description || item.value_json} (n=${item.sample_size})`);
        } else if (category === "channel_preference") {
          sections.push(`  ${item.key}: ${value.successRate || 0}% success rate (n=${item.sample_size})`);
        } else {
          sections.push(`  ${item.key}: ${JSON.stringify(value)} (n=${item.sample_size})`);
        }
      } catch {
        sections.push(`  ${item.key}: ${item.value_json}`);
      }
    }
  }

  return sections.join("\n");
}
