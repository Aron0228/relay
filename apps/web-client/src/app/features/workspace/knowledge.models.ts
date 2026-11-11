export interface KnowledgeEvidence {
  id: string;
  payload: { observation: string };
}

export interface KnowledgeVerification {
  id: string;
  patchId: string;
  runId: string;
  result: string;
  reason: string;
  confidence: number;
  observedUrls: string[];
  sourceEventIds: string[];
  createdAt: string;
}

export interface KnowledgeChange {
  operation: string;
  status: string;
  reason: string;
  createdAt: string;
  sourceRunId: string;
  proposal: { content: string };
  previous?: { content: string };
}
