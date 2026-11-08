import { Run, RunResult } from '../execution/execution.models';

export interface IssueStep {
  number: number;
  action: string;
  expectedBehavior: string;
  actualBehavior: string;
  sourceEventIds: string[];
}

export interface Investigation {
  id: string;
  status: string;
  outcome: string | null;
  cancelRequested: boolean;
  feedbackStatus: string;
  feedbackError?: string;
  feedbackAttempts: number;
  createdAt: string;
  endedAt?: string;
  result?: {
    summary?: string;
    verification?: string;
    preconditions?: string[];
    steps?: IssueStep[];
    expectedBehavior?: string;
    actualBehavior?: string;
  };
}

export interface IssueItem {
  id: string;
  number: number;
  title: string;
  repository: string;
  status: string;
  outcome: string | null;
  taskId: string;
}

export type IssueRun = Run & { stage: string; attempt: number; result: RunResult['result'] | null };
export interface IssueRunGroup {
  investigation: Investigation;
  runs: IssueRun[];
}

export interface PrContext {
  model?: string;
  promptVersion?: string;
  id: string;
  headSha: string;
  status: string;
  error?: string;
  data?: {
    summary: string;
    affectedSurfaces: string[];
    preconditions: string[];
    steps: string[];
    expectedBehavior: string;
    uncertainties: string[];
    sourceIds: string[];
  };
  sources: { id: string; kind: string; url: string; content: string; truncated: boolean }[];
}

export interface IssueDetail {
  context?: PrContext | null;
  targetUrl?: string;
  headSha?: string;
  id: string;
  number: number;
  title: string;
  description: string;
  url: string;
  repository: string;
  workspaceId: string;
  task: Investigation;
  investigations: Investigation[];
  runs: IssueRun[];
  runGroups: IssueRunGroup[];
}
