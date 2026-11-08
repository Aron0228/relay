import {ReproductionStep, VerificationInput} from './types';

export function verificationStepError(
  verification: VerificationInput,
  steps: Pick<ReproductionStep, 'sourceStepNumber'>[],
  requireComplete: boolean,
): string | undefined {
  const originals = verification.steps.map(step => step.number);
  const seen = new Set<number>();
  let previousIndex = -1;

  for (const [index, step] of steps.entries()) {
    const number = step.sourceStepNumber;

    if (number === undefined)
      return `Verification report step ${index + 1} is missing sourceStepNumber. Identify the corresponding original step by its number; its wording may differ.`;

    const position = originals.indexOf(number);

    if (position < 0)
      return `Verification report references unknown sourceStepNumber ${number}. Use only original step numbers: ${originals.join(', ')}.`;
    if (seen.has(number))
      return `Verification report repeats sourceStepNumber ${number}. Report each original step once.`;
    if (position <= previousIndex)
      return `Verification report step references are out of order. Preserve the original order: ${originals.join(', ')}.`;

    seen.add(number);
    previousIndex = position;
  }

  const missing = originals.filter(number => !seen.has(number));

  if (requireComplete && missing.length)
    return `Verification report is missing original step references: ${missing.join(', ')}. Map every original step using sourceStepNumber and this session's recorded observations. If a step could not be checked, report inconclusive and explain what blocked it.`;

  return undefined;
}
