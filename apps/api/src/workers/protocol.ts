import {AgentInput, AgentResult} from '../ai/types';

export const WORKER_SCRIPT = {
  ExampleTodo: 'example-todo',
  Agent: 'agent',
} as const;
export type WorkerScriptName =
  (typeof WORKER_SCRIPT)[keyof typeof WORKER_SCRIPT];

export interface WorkerInput {
  runId: string;
  scriptName: WorkerScriptName;
  videoDirectory: string;
  exampleUrl: string;
  actionDelayMs: number;
  agentInput?: AgentInput;
  leaseDeadline?: number;
}

export type WorkerCommand =
  | {type: 'start'; input: WorkerInput}
  | {type: 'heartbeat'; deadline: number}
  | {type: 'cancel'};

export interface WorkerResult {
  status: 'completed' | 'failed' | 'cancelled';
  videoFile?: string;
  error?: string;
  agentResult?: AgentResult;
}

export type WorkerMessage =
  | {type: 'event'; event: string; payload: Record<string, unknown>}
  | {type: 'frame'; data: string}
  | {type: 'result'; result: WorkerResult};
