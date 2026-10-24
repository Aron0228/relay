/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol uses snake_case fields. */
export const AGENT_VERDICT = {
  Passed: 'passed',
  Failed: 'failed',
  Inconclusive: 'inconclusive',
} as const;

export type AgentVerdict = (typeof AGENT_VERDICT)[keyof typeof AGENT_VERDICT];

export const AGENT_STOP_REASON = {
  Finished: 'finished',
  TurnLimit: 'turn_limit',
  ToolLimit: 'tool_limit',
  ContextLimit: 'context_limit',
  Cancelled: 'cancelled',
  Timeout: 'timeout',
  ProviderError: 'provider_error',
} as const;

export type AgentStopReason =
  (typeof AGENT_STOP_REASON)[keyof typeof AGENT_STOP_REASON];

export interface AgentInput {
  prompt: string;
  targetUrl: string;
}

export interface AgentResult {
  verdict: AgentVerdict;
  summary: string;
  confidence: number;
  steps: string[];
  observations: string[];
  stopReason: AgentStopReason;
  turns: number;
  toolCalls: number;
  failedToolCalls?: number;
  tokenUsage?: TokenUsage;
  model: string;
  promptVersion: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {name: string; arguments: string};
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reportedRequests: number;
  unreportedRequests: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  usage?: {inputTokens: number; outputTokens: number; totalTokens: number};
}

export interface AgentTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiProvider {
  readonly model: string;
  complete(
    messages: ChatMessage[],
    tools: AgentTool[],
    signal: AbortSignal,
    requiredTool?: string,
  ): Promise<ChatMessage>;
}

export type AgentEvent = (
  type: string,
  payload: Record<string, unknown>,
) => void;

export const AGENT_ACTIVITY_KIND = {
  Message: 'message',
  Observation: 'observation',
} as const;

export type AgentActivityKind =
  (typeof AGENT_ACTIVITY_KIND)[keyof typeof AGENT_ACTIVITY_KIND];
