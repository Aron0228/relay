import {ReproductionDetails, ReproductionVerdict} from '../ai/types';

export interface IssuePipelineState {
  reproductionRunId?: string;
  reproduction?: ReproductionDetails;
  verificationObservation?: string;
  criticRunId?: string;
  provisionalVerdict?: ReproductionVerdict;
  confirmedRunId?: string;
  confirmed?: ReproductionDetails;
  minimizationAttempts?: number;
  verification?: string;
  summary?: string;
  verdict?: ReproductionVerdict;
  preconditions?: string[];
  steps?: ReproductionDetails['steps'];
  expectedBehavior?: string;
  actualBehavior?: string;
  nextStage?: string | null;
}
