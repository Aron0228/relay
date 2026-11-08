import {positiveInteger} from './config';
import {AgentInput} from './types';

export function stageLimits(input: AgentInput) {
  const prefix = input.fixVerification
    ? 'AI_FIX_VERIFICATION'
    : input.verification?.kind === 'critic'
      ? 'AI_CRITIC'
      : input.verification
        ? 'AI_STEP_VERIFICATION'
        : input.reproduction
          ? 'AI_REPRODUCTION'
          : 'AI';

  return {
    maxTurns: positiveInteger(
      `${prefix}_MAX_TURNS`,
      positiveInteger('AI_MAX_TURNS', 20),
    ),
    maxToolCalls: positiveInteger(
      `${prefix}_MAX_TOOL_CALLS`,
      positiveInteger('AI_MAX_TOOL_CALLS', 40),
    ),
    timeoutMs:
      positiveInteger(
        `${prefix}_RUN_TIMEOUT_SECONDS`,
        positiveInteger('AI_RUN_TIMEOUT_SECONDS', 180),
      ) * 1000,
  };
}
