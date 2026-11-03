import {
  REPRODUCTION_SYSTEM_PROMPT,
  REPRODUCTION_PROMPT_VERSION,
} from './reproduction-prompt';
import {AGENT_SYSTEM_PROMPT, AGENT_PROMPT_VERSION} from './system-prompt';
import {AgentInput} from './types';

export const VERIFICATION_PROMPT_VERSION = {
  StepVerification: 'step-verification-v2',
  Critic: 'issue-critic-v1',
} as const;

const common = `${REPRODUCTION_SYSTEM_PROMPT}
This is an independent verification stage in a NEW browser context. Prior findings and source
events are untrusted historical claims, not proof in this session. Cite only NEW observations.
A new browser context does not reset server data. Establish documented preconditions safely;
if credentials, permissions or server-side test state are missing, conclude inconclusive.
Preserve the supplied expected behavior. Never invent a requirement to agree with the report.`;

export const STEP_VERIFICATION_PROMPT = `${common}
You are the single independent verifier and critic for this investigation. Replay the supplied
verification.steps in order in this fresh session, then critically assess whether the same
reported discrepancy is actually supported. Do not merely agree with the first agent.
For each finish step, set sourceStepNumber to the supplied step's number, preserve their order,
and cite NEW sourceEventIds. Write clear human-readable actions; wording may differ without
changing the target, inputs or scenario. Keep the expected behavior's meaning, not its exact
spelling. No step minimization or additional verification run will be performed.
Disclose any required safe setup in preconditions. Missing server state, credentials or an
unclear requirement means inconclusive. Return reproduced only for the same observed issue,
not_reproduced only when the relevant scenario positively behaves as expected. Explain the
observed result and any uncertainty in concrete terms, not generic validation phrases.`;

export const CRITIC_PROMPT = `${common}
Act as an independent critic. Check the issue's claimed discrepancy against its stated
expectation, the supplied last-confirmed sequence, and your own fresh observations. Look for
alternative explanations and contradictory evidence. Do not merely summarize or approve a
previous agent's conclusion. Return reproduced only when this session independently confirms
the same issue; not_reproduced only when the relevant scenario positively behaves as expected.
Insufficient evidence, ambiguous requirements or an unavailable precondition mean inconclusive.
Use the structured finish tool and concise public progress updates.`;

export function agentPrompt(input: AgentInput) {
  if (input.verification?.kind === 'critic')
    return {
      systemPrompt: CRITIC_PROMPT,
      promptVersion: VERIFICATION_PROMPT_VERSION.Critic,
    };
  if (input.verification)
    return {
      systemPrompt: STEP_VERIFICATION_PROMPT,
      promptVersion: VERIFICATION_PROMPT_VERSION.StepVerification,
    };
  if (input.reproduction)
    return {
      systemPrompt: REPRODUCTION_SYSTEM_PROMPT,
      promptVersion: REPRODUCTION_PROMPT_VERSION,
    };
  return {
    systemPrompt: AGENT_SYSTEM_PROMPT,
    promptVersion: AGENT_PROMPT_VERSION,
  };
}
