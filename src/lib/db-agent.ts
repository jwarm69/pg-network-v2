import type { InValue } from "@libsql/client";
import { getClient, ensureSchema } from "./db";
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  StepType,
  ToolCall,
  ToolCallStatus,
  ApprovalGate,
  GateStatus,
  LearningSignal,
  SignalType,
  Experiment,
  ExperimentAssignment,
  LearnedPreference,
  PreferenceCategory,
  AgentRunSummary,
} from "./agent/types";

async function db() {
  await ensureSchema();
  return getClient();
}

// ─── Agent Runs ───

export async function createAgentRun(params: {
  goal: string;
  targetId?: string;
  trigger?: string;
  parentRunId?: string;
}): Promise<AgentRun> {
  const client = await db();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO agent_runs (id, goal, target_id, status, trigger, parent_run_id, started_at, created_at)
          VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
    args: [id, params.goal, params.targetId || null, params.trigger || "manual", params.parentRunId || null, now, now],
  });
  return (await getAgentRun(id))!;
}

export async function getAgentRun(id: string): Promise<AgentRun | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM agent_runs WHERE id = ?", args: [id] });
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as AgentRun;
}

export async function updateAgentRun(id: string, updates: Partial<AgentRun>): Promise<void> {
  const client = await db();
  const fields: string[] = [];
  const values: InValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(value as InValue);
  }
  values.push(id);
  await client.execute({
    sql: `UPDATE agent_runs SET ${fields.join(", ")} WHERE id = ?`,
    args: values,
  });
}

/**
 * Atomically claim a run for execution. Returns true if this caller won the lock.
 * Uses an atomic UPDATE ... WHERE to prevent concurrent execution of the same run.
 */
export async function tryClaimRun(runId: string, expectedStatus: AgentRunStatus = "executing"): Promise<boolean> {
  const client = await db();
  const lockToken = crypto.randomUUID();
  const result = await client.execute({
    sql: `UPDATE agent_runs
          SET context_json = json_set(COALESCE(context_json, '{}'), '$.lockToken', ?, '$.lockClaimedAt', ?)
          WHERE id = ? AND status = ?
            AND (
              json_extract(context_json, '$.lockClaimedAt') IS NULL
              OR datetime(json_extract(context_json, '$.lockClaimedAt'), '+60 seconds') < datetime('now')
            )`,
    args: [lockToken, new Date().toISOString(), runId, expectedStatus],
  });
  return result.rowsAffected > 0;
}

/**
 * Release the execution lock on a run (clear the lock fields).
 */
export async function releaseLock(runId: string): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE agent_runs
          SET context_json = json_remove(json_remove(COALESCE(context_json, '{}'), '$.lockToken'), '$.lockClaimedAt')
          WHERE id = ?`,
    args: [runId],
  });
}

/**
 * Get the count of signals created after a given timestamp.
 */
export async function getSignalCountSince(since: string): Promise<number> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT COUNT(*) as count FROM learning_signals WHERE created_at > ?",
    args: [since],
  });
  return (result.rows[0] as unknown as { count: number }).count;
}

export async function getAgentRunsByStatus(status: AgentRunStatus): Promise<AgentRun[]> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM agent_runs WHERE status = ? ORDER BY created_at DESC", args: [status] });
  return result.rows as unknown as AgentRun[];
}

export async function getRecentAgentRuns(targetId: string, limit = 5): Promise<AgentRunSummary[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT id, goal, status, result_json, created_at FROM agent_runs WHERE target_id = ? ORDER BY created_at DESC LIMIT ?",
    args: [targetId, limit],
  });
  return result.rows as unknown as AgentRunSummary[];
}

export async function getAllAgentRuns(limit = 50): Promise<AgentRun[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });
  return result.rows as unknown as AgentRun[];
}

// ─── Agent Steps ───

export async function createAgentStep(params: {
  runId: string;
  stepIndex: number;
  type: StepType;
  inputJson?: string;
  outputJson?: string;
  reasoning?: string;
  durationMs?: number;
  tokensUsed?: number;
}): Promise<AgentStep> {
  const client = await db();
  const id = crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO agent_steps (id, run_id, step_index, type, input_json, output_json, reasoning, duration_ms, tokens_used)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, params.runId, params.stepIndex, params.type, params.inputJson || null, params.outputJson || null, params.reasoning || null, params.durationMs || null, params.tokensUsed || 0],
  });
  const result = await client.execute({ sql: "SELECT * FROM agent_steps WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as AgentStep;
}

export async function getStepsForRun(runId: string): Promise<AgentStep[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index ASC",
    args: [runId],
  });
  return result.rows as unknown as AgentStep[];
}

export async function getMaxStepIndex(runId: string): Promise<number> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT MAX(step_index) as max_idx FROM agent_steps WHERE run_id = ?",
    args: [runId],
  });
  const row = result.rows[0] as unknown as { max_idx: number | null };
  return row.max_idx ?? -1;
}

// ─── Tool Calls ───

export async function createToolCall(params: {
  stepId?: string;
  runId: string;
  toolName: string;
  inputJson: string;
}): Promise<ToolCall> {
  const client = await db();
  const id = crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO tool_calls (id, step_id, run_id, tool_name, input_json, status)
          VALUES (?, ?, ?, ?, ?, 'pending')`,
    args: [id, params.stepId || null, params.runId, params.toolName, params.inputJson],
  });
  const result = await client.execute({ sql: "SELECT * FROM tool_calls WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as ToolCall;
}

export async function updateToolCall(id: string, updates: {
  outputJson?: string;
  status?: ToolCallStatus;
  error?: string;
  durationMs?: number;
}): Promise<void> {
  const client = await db();
  const fields: string[] = [];
  const values: InValue[] = [];
  if (updates.outputJson !== undefined) { fields.push("output_json = ?"); values.push(updates.outputJson); }
  if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
  if (updates.error !== undefined) { fields.push("error = ?"); values.push(updates.error); }
  if (updates.durationMs !== undefined) { fields.push("duration_ms = ?"); values.push(updates.durationMs); }
  values.push(id);
  await client.execute({
    sql: `UPDATE tool_calls SET ${fields.join(", ")} WHERE id = ?`,
    args: values,
  });
}

export async function getToolCallsForRun(runId: string): Promise<ToolCall[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM tool_calls WHERE run_id = ? ORDER BY created_at ASC",
    args: [runId],
  });
  return result.rows as unknown as ToolCall[];
}

// ─── Approval Gates ───

export async function createApprovalGate(params: {
  runId: string;
  stepId?: string;
  gateType: string;
  payloadJson: string;
  expiresAt?: string;
}): Promise<ApprovalGate> {
  const client = await db();
  const id = crypto.randomUUID();
  const expiresAt = params.expiresAt || new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  await client.execute({
    sql: `INSERT INTO approval_gates (id, run_id, step_id, gate_type, payload_json, status, expires_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    args: [id, params.runId, params.stepId || null, params.gateType, params.payloadJson, expiresAt],
  });
  const result = await client.execute({ sql: "SELECT * FROM approval_gates WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as ApprovalGate;
}

export async function getApprovalGate(id: string): Promise<ApprovalGate | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM approval_gates WHERE id = ?", args: [id] });
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as ApprovalGate;
}

export async function updateApprovalGate(id: string, updates: {
  status: GateStatus;
  userEditsJson?: string;
}): Promise<void> {
  const client = await db();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE approval_gates SET status = ?, user_edits_json = ?, decided_at = ? WHERE id = ?`,
    args: [updates.status, updates.userEditsJson || null, now, id],
  });
}

export async function getPendingGates(): Promise<ApprovalGate[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM approval_gates WHERE status = 'pending' ORDER BY created_at ASC",
    args: [],
  });
  return result.rows as unknown as ApprovalGate[];
}

export async function getExpiredGates(): Promise<ApprovalGate[]> {
  const client = await db();
  const now = new Date().toISOString();
  const result = await client.execute({
    sql: "SELECT * FROM approval_gates WHERE status = 'pending' AND expires_at < ? ORDER BY created_at ASC",
    args: [now],
  });
  return result.rows as unknown as ApprovalGate[];
}

export async function getGatesForRun(runId: string): Promise<ApprovalGate[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM approval_gates WHERE run_id = ? ORDER BY created_at ASC",
    args: [runId],
  });
  return result.rows as unknown as ApprovalGate[];
}

// ─── Learning Signals ───

export async function emitLearningSignal(params: {
  targetId?: string;
  runId?: string;
  threadId?: string;
  messageId?: string;
  signalType: SignalType;
  signalValue: string;
  contextJson?: string;
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO learning_signals (id, target_id, run_id, thread_id, message_id, signal_type, signal_value, context_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      params.targetId || null,
      params.runId || null,
      params.threadId || null,
      params.messageId || null,
      params.signalType,
      params.signalValue,
      params.contextJson || null,
    ],
  });
}

export async function getRecentSignals(limit = 500): Promise<LearningSignal[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM learning_signals ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });
  return result.rows as unknown as LearningSignal[];
}

export async function getSignalCount(): Promise<number> {
  const client = await db();
  const result = await client.execute("SELECT COUNT(*) as count FROM learning_signals");
  return (result.rows[0] as unknown as { count: number }).count;
}

export async function getSignalsByType(signalType: SignalType, limit = 100): Promise<LearningSignal[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM learning_signals WHERE signal_type = ? ORDER BY created_at DESC LIMIT ?",
    args: [signalType, limit],
  });
  return result.rows as unknown as LearningSignal[];
}

// ─── Experiments ───

export async function createExperiment(params: {
  name: string;
  hypothesis: string;
  variable: string;
  variantsJson: string;
  metric: string;
  minSamples?: number;
}): Promise<Experiment> {
  const client = await db();
  const id = crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO experiments (id, name, hypothesis, variable, variants_json, metric, min_samples)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, params.name, params.hypothesis, params.variable, params.variantsJson, params.metric, params.minSamples || 10],
  });
  const result = await client.execute({ sql: "SELECT * FROM experiments WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as Experiment;
}

export async function getActiveExperiment(variable: string): Promise<Experiment | null> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM experiments WHERE variable = ? AND status = 'active' LIMIT 1",
    args: [variable],
  });
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as Experiment;
}

export async function getAllExperiments(): Promise<Experiment[]> {
  const client = await db();
  const result = await client.execute("SELECT * FROM experiments ORDER BY created_at DESC");
  return result.rows as unknown as Experiment[];
}

export async function updateExperiment(id: string, updates: Partial<Experiment>): Promise<void> {
  const client = await db();
  const fields: string[] = [];
  const values: InValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(value as InValue);
  }
  values.push(id);
  await client.execute({
    sql: `UPDATE experiments SET ${fields.join(", ")} WHERE id = ?`,
    args: values,
  });
}

export async function createExperimentAssignment(params: {
  experimentId: string;
  variantId: string;
  runId?: string;
  threadId?: string;
  targetId?: string;
}): Promise<ExperimentAssignment> {
  const client = await db();
  const id = crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO experiment_assignments (id, experiment_id, variant_id, run_id, thread_id, target_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, params.experimentId, params.variantId, params.runId || null, params.threadId || null, params.targetId || null],
  });
  const result = await client.execute({ sql: "SELECT * FROM experiment_assignments WHERE id = ?", args: [id] });
  return result.rows[0] as unknown as ExperimentAssignment;
}

export async function getExperimentAssignments(experimentId: string): Promise<ExperimentAssignment[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM experiment_assignments WHERE experiment_id = ? ORDER BY created_at ASC",
    args: [experimentId],
  });
  return result.rows as unknown as ExperimentAssignment[];
}

export async function updateExperimentAssignment(id: string, outcomeJson: string): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "UPDATE experiment_assignments SET outcome_json = ? WHERE id = ?",
    args: [outcomeJson, id],
  });
}

// ─── Learned Preferences ───

export async function upsertLearnedPreference(params: {
  category: PreferenceCategory;
  key: string;
  valueJson: string;
  confidence: number;
  sampleSize: number;
}): Promise<void> {
  const client = await db();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO learned_preferences (id, category, key, value_json, confidence, sample_size, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(category, key) DO UPDATE SET value_json = ?, confidence = ?, sample_size = ?, updated_at = ?`,
    args: [
      crypto.randomUUID(), params.category, params.key, params.valueJson, params.confidence, params.sampleSize, now,
      params.valueJson, params.confidence, params.sampleSize, now,
    ],
  });
}

export async function getLearnedPreferences(category?: PreferenceCategory): Promise<LearnedPreference[]> {
  const client = await db();
  if (category) {
    const result = await client.execute({
      sql: "SELECT * FROM learned_preferences WHERE category = ? ORDER BY confidence DESC",
      args: [category],
    });
    return result.rows as unknown as LearnedPreference[];
  }
  const result = await client.execute("SELECT * FROM learned_preferences ORDER BY category, confidence DESC");
  return result.rows as unknown as LearnedPreference[];
}

export async function getAllLearnedPreferences(): Promise<LearnedPreference[]> {
  const client = await db();
  const result = await client.execute("SELECT * FROM learned_preferences ORDER BY category, confidence DESC");
  return result.rows as unknown as LearnedPreference[];
}
