import {verificationStepError} from './verification-steps';
import {describeBrowserAction, isBareBrowserAction} from './browser-action';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {PlaywrightInterface} from '../workers/playwright.interface';
import {BROWSER_TOOLS, BrowserToolOutput, BrowserTools} from './browser-tools';
import {allowedOrigins, positiveInteger} from './config';
import {
  AgentConclusion,
  AgentEvent,
  AgentTool,
  ReproductionInput,
  REPRODUCTION_VERDICT,
  VerificationInput,
  FixVerificationInput,
  FIX_VERDICT,
} from './types';

const text = z.string().min(1).max(4000);
const eventIds = z.array(z.uuid()).max(100);
export const reproductionFinishSchema = z
  .object({
    verdict: z.enum(Object.values(REPRODUCTION_VERDICT)),
    summary: text,
    confidence: z.number().min(0).max(1),
    preconditions: z.array(text).max(30),
    steps: z
      .array(
        z
          .object({
            action: text.describe(
              'A human-readable instruction identifying the target and test value, for example: Enter "Finn" into the First Name textbox. Never just fill or click.',
            ),
            sourceStepNumber: z.number().int().min(1).max(100).optional(),
            expectedBehavior: text.describe(
              'The intended correct behavior supported by the requirements. Do not describe the reported bug as the expected behavior.',
            ),
            actualBehavior: text.describe(
              'What this browser session actually observed, including any reported bug.',
            ),
            sourceEventIds: eventIds,
          })
          .strict(),
      )
      .max(100),
    expectedBehavior: text.describe(
      'The intended correct behavior supported by the requirements, separate from the observed bug.',
    ),
    actualBehavior: text.describe(
      'What this browser session actually observed.',
    ),
    sourceEventIds: eventIds,
  })
  .strict();

export const verificationFinishSchema = reproductionFinishSchema.extend({
  steps: z
    .array(
      reproductionFinishSchema.shape.steps.element.extend({
        sourceStepNumber: z
          .number()
          .int()
          .min(1)
          .max(100)
          .describe(
            'Required: the number of the original verification.steps entry checked by this step. Preserve the original order; wording may differ.',
          ),
      }),
    )
    .max(100),
});

export const fixFinishSchema = reproductionFinishSchema.extend({
  verdict: z.enum(Object.values(FIX_VERDICT)),
});

export const REPRODUCTION_TOOLS: AgentTool[] = BROWSER_TOOLS.map(tool =>
  tool.function.name === 'finish'
    ? {
        type: 'function',
        function: {
          name: 'finish',
          description:
            'Report whether the issue was reproduced, using observed evidence and ordered reproduction steps. Findings are provisional until independently verified.',
          parameters: z.toJSONSchema(reproductionFinishSchema),
        },
      }
    : tool,
);

export const VERIFICATION_TOOLS: AgentTool[] = REPRODUCTION_TOOLS.map(tool =>
  tool.function.name === 'finish'
    ? {
        type: 'function',
        function: {
          name: 'finish',
          description:
            'Report the independent verification result. Map each reported step to its original sourceStepNumber and cite observations from this browser session. Invalid reports can be corrected without repeating browser actions.',
          parameters: z.toJSONSchema(verificationFinishSchema),
        },
      }
    : tool,
);

export const FIX_VERIFICATION_TOOLS = REPRODUCTION_TOOLS.map(tool =>
  tool.function.name === 'finish'
    ? {
        type: 'function' as const,
        function: {
          name: 'finish',
          description:
            'Report fixed, not_fixed or inconclusive using only observations from this session.',
          parameters: z.toJSONSchema(fixFinishSchema),
        },
      }
    : tool,
);

export class ReproductionSession {
  private readonly browserTools: BrowserTools;
  private readonly evidence = new Set<string>();
  private readonly actions: {
    description: string;
    sourceEventId: string;
    kind: string;
  }[] = [];
  private readonly maxObservation = positiveInteger(
    'AI_MAX_OBSERVATION_CHARACTERS',
    12000,
  );

  constructor(
    private input: ReproductionInput | undefined,
    browser: PlaywrightInterface,
    private emit: AgentEvent,
    private verification?: VerificationInput,
    private fixVerification?: FixVerificationInput,
  ) {
    this.browserTools = new BrowserTools(browser, allowedOrigins());
  }

  context() {
    if (this.fixVerification) return {fixVerification: this.fixVerification};

    return {
      issue: {
        ...this.input!.issue,
        title: this.input!.issue.title.slice(0, 500),
        body: this.input!.issue.body.slice(0, 16000),
        bodyTruncated: this.input!.issue.body.length > 16000,
      },
      environment: this.input!.environment,
      verification: this.verification,
      expectedBehavior: this.input?.expectedBehavior,
      reportedBehavior: this.input?.reportedBehavior,
    };
  }

  observation(
    value: string,
    tool = 'initialObservation',
  ): {sourceEventId: string; observation: string} {
    const sourceEventId = randomUUID();
    const observation = value.slice(0, this.maxObservation);
    this.evidence.add(sourceEventId);
    this.emit('agent.evidence', {sourceEventId, tool, observation});

    return {sourceEventId, observation};
  }

  async execute(name: string, args: string): Promise<BrowserToolOutput> {
    if (name === 'finish') {
      return {result: this.conclusion(JSON.parse(args))};
    }

    const value = await this.browserTools.execute(name, args);

    if (value.observation !== undefined) {
      const observed = this.observation(value.observation, name);
      const description = describeBrowserAction(name, JSON.parse(args));
      if (description)
        this.actions.push({
          description,
          sourceEventId: observed.sourceEventId,
          kind: name.replace(/^browser/, '').toLowerCase(),
        });
      return observed;
    }

    return value;
  }

  parseTextVerdict(content: string | null): AgentConclusion | undefined {
    if (!content) return undefined;

    let raw: unknown;

    try {
      raw = JSON.parse(
        content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'),
      );
    } catch {
      return undefined;
    }

    try {
      return this.conclusion(raw);
    } catch (error) {
      if (this.verification) throw error;

      return undefined;
    }
  }

  private conclusion(raw: unknown): AgentConclusion {
    const schema = this.fixVerification
      ? fixFinishSchema
      : this.verification
        ? verificationFinishSchema
        : reproductionFinishSchema;
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `Invalid finish report: ${issues}. Correct the report using the observations already collected; do not repeat successful browser actions.`,
      );
    }

    const result = parsed.data;

    if (this.verification) {
      const error = verificationStepError(
        this.verification,
        result.steps,
        result.verdict !== REPRODUCTION_VERDICT.Inconclusive,
      );

      if (error) throw new Error(error);
    }
    const references = [
      ...result.sourceEventIds,
      ...result.steps.flatMap(step => step.sourceEventIds),
    ];

    if (references.some(id => !this.evidence.has(id))) {
      throw new Error(
        'Use only sourceEventIds from successful browser observations in this run',
      );
    }

    if (
      result.verdict !== REPRODUCTION_VERDICT.Inconclusive &&
      (!result.sourceEventIds.length ||
        !result.steps.length ||
        result.steps.some(step => !step.sourceEventIds.length))
    ) {
      throw new Error(
        'A conclusive reproduction verdict requires observed steps and source events',
      );
    }

    const steps = result.steps.map((step, index) => {
      const kind = step.action
        .toLowerCase()
        .replace(/^browser/, '')
        .replace(/[.!]$/, '');
      const matching = this.actions.filter(
        item =>
          item.kind === kind &&
          step.sourceEventIds.includes(item.sourceEventId),
      );
      const positional =
        this.actions.length === result.steps.length
          ? this.actions[index]
          : undefined;
      const action =
        positional?.kind === kind
          ? positional
          : matching.length === 1
            ? matching[0]
            : undefined;
      if (!action || !isBareBrowserAction(step.action)) return step;

      return {
        ...step,
        action: action.description,
        sourceEventIds: [
          ...new Set([...step.sourceEventIds, action.sourceEventId]),
        ],
      };
    });

    return {
      verdict: result.verdict,
      summary: result.summary,
      confidence:
        result.verdict === REPRODUCTION_VERDICT.Inconclusive
          ? 0
          : result.confidence,
      steps: steps.map(step => step.action),
      observations: [result.actualBehavior],
      reproduction: {
        preconditions: result.preconditions,
        steps: steps.map((step, index) => ({
          number: index + 1,
          ...step,
        })),
        expectedBehavior: result.expectedBehavior,
        actualBehavior: result.actualBehavior,
        sourceEventIds: result.sourceEventIds,
      },
    };
  }

  inconclusive(): Pick<AgentConclusion, 'reproduction'> {
    return {
      reproduction: {
        preconditions: [],
        steps: [],
        expectedBehavior:
          this.fixVerification?.expectedBehavior ??
          this.input?.expectedBehavior ??
          'Not established from the issue',
        actualBehavior: 'Insufficient evidence to conclude',
        sourceEventIds: [],
      },
    };
  }
}
