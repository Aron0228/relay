export const RUN_STATUS = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export interface Run {
  id: string;
  title: string;
  targetUrl?: string;
  status: RunStatus;
  cancelRequested: boolean;
  workerPid?: number;
  videoFile?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface RunEvent {
  id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RunResult {
  result: {
    verdict: 'passed' | 'failed' | 'inconclusive';
    summary: string;
    steps: string[];
    observations: string[];
  };
}

export interface RunPage {
  items: Run[];
  nextCursor: string | null;
}
export const isActive = (run: Run) => run.status === 'running' || run.status === 'queued';
