import type {
  Target,
  Research,
  OutreachThread,
  Message,
  ContactPath,
  ActivityEntry,
} from "../db";

// ─── Agent Run ───

export type AgentRunStatus =
  | "pending"
  | "planning"
  | "executing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentTrigger = "manual" | "cron" | "event" | "continuation";

export interface AgentRun {
  id: string;
  goal: string;
  target_id: string | null;
  status: AgentRunStatus;
  trigger: AgentTrigger;
  parent_run_id: string | null;
  plan_json: string | null;
  context_json: string | null;
  result_json: string | null;
  error: string | null;
  tokens_used: number;
  cost_cents: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Agent Step ───

export type StepType =
  | "plan"
  | "think"
  | "tool_call"
  | "observe"
  | "decide"
  | "gate_check"
  | "error";

export interface AgentStep {
  id: string;
  run_id: string;
  step_index: number;
  type: StepType;
  input_json: string | null;
  output_json: string | null;
  reasoning: string | null;
  duration_ms: number | null;
  tokens_used: number;
  created_at: string;
}

// ─── Tool Calls ───

export type ToolCallStatus = "pending" | "success" | "error" | "timeout";

export interface ToolCall {
  id: string;
  step_id: string | null;
  run_id: string;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  status: ToolCallStatus;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

// ─── Approval Gates ───

export type GateType = "send_email" | "send_dm" | "high_value_action" | "first_contact";
export type GateStatus = "pending" | "approved" | "rejected" | "edited" | "expired";

export interface ApprovalGate {
  id: string;
  run_id: string;
  step_id: string | null;
  gate_type: string;
  payload_json: string;
  status: GateStatus;
  user_edits_json: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
}

// ─── Learning Signals ───

export type SignalType =
  | "draft_accepted_clean"
  | "draft_edited_heavily"
  | "draft_rejected"
  | "message_sent"
  | "reply_received"
  | "reply_sentiment"
  | "meeting_booked"
  | "target_archived"
  | "user_override"
  | "angle_selected"
  | "angle_changed"
  | "score_overridden";

export interface LearningSignal {
  id: string;
  target_id: string | null;
  run_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  signal_type: SignalType;
  signal_value: string;
  context_json: string | null;
  created_at: string;
}

// ─── Experiments ───

export type ExperimentVariable =
  | "angle"
  | "message_length"
  | "follow_up_days"
  | "channel"
  | "subject_style";

export type ExperimentMetric =
  | "reply_rate"
  | "approval_rate"
  | "meeting_rate"
  | "sentiment_score";

export interface ExperimentVariant {
  id: string;
  label: string;
  value: unknown;
  weight: number;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  variable: ExperimentVariable;
  variants_json: string;
  status: "active" | "paused" | "concluded";
  metric: ExperimentMetric;
  results_json: string | null;
  min_samples: number;
  created_at: string;
  concluded_at: string | null;
}

export interface ExperimentAssignment {
  id: string;
  experiment_id: string;
  variant_id: string;
  run_id: string | null;
  thread_id: string | null;
  target_id: string | null;
  outcome_json: string | null;
  created_at: string;
}

// ─── Learned Preferences ───

export type PreferenceCategory =
  | "angle_effectiveness"
  | "edit_patterns"
  | "timing"
  | "scoring_bias"
  | "channel_preference";

export interface LearnedPreference {
  id: string;
  category: PreferenceCategory;
  key: string;
  value_json: string;
  confidence: number;
  sample_size: number;
  updated_at: string;
}

// ─── Tool System ───

export type ToolPermission = "read" | "write" | "send" | "delete";
export type GateRequirement = "none" | "approval_required";

export interface ToolContext {
  runId: string;
  stepId: string;
  targetId?: string;
  operationalMemory: OperationalMemory;
  learnedPreferences: LearnedPreference[];
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
    provider?: string;
  };
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: "discovery" | "research" | "scoring" | "outreach" | "gmail" | "status" | "learning";
  permissions: ToolPermission[];
  gate: GateRequirement;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput, context: ToolContext) => Promise<ToolResult<TOutput>>;
  timeout?: number;
}

// ─── Operational Memory ───

export interface AgentRunSummary {
  id: string;
  goal: string;
  status: AgentRunStatus;
  result_json: string | null;
  created_at: string;
}

export interface OperationalMemory {
  target: Target | null;
  research: Research[];
  contactPaths: ContactPath[];
  threads: OutreachThread[];
  messages: Message[];
  recentActivity: ActivityEntry[];
  priorRuns: AgentRunSummary[];
}

// ─── Agent Plan ───

export interface PlannedStep {
  description: string;
  toolName: string;
  estimatedInput: Record<string, unknown>;
  gateExpected: boolean;
}

export interface AgentPlan {
  goal: string;
  reasoning: string;
  steps: PlannedStep[];
  maxSteps: number;
}

// ─── Agent Decision (from think step) ───

export interface AgentDecision {
  action: "tool_call" | "complete";
  toolName?: string;
  input?: Record<string, unknown>;
  reasoning: string;
  outcome?: string;
}
