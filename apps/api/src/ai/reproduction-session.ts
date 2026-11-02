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
            action: text,
            expectedBehavior: text,
            actualBehavior: text,
            sourceEventIds: eventIds,
          })
          .strict(),
      )
      .max(100),
    expectedBehavior: text,
    actualBehavior: text,
    sourceEventIds: eventIds,
  })
  .strict();

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

export class ReproductionSession {
  private readonly browserTools: BrowserTools;
  private readonly evidence = new Set<string>();
  private readonly maxObservation = positiveInteger(
    'AI_MAX_OBSERVATION_CHARACTERS',
    12000,
  );

  constructor(
    private input: ReproductionInput,
    browser: PlaywrightInterface,
    private emit: AgentEvent,
  ) {
    this.browserTools = new BrowserTools(browser, allowedOrigins());
  }

  context() {
    return {
      issue: {
        ...this.input.issue,
        title: this.input.issue.title.slice(0, 500),
        body: this.input.issue.body.slice(0, 16000),
        bodyTruncated: this.input.issue.body.length > 16000,
      },
      environment: this.input.environment,
      expectedBehavior: this.input.expectedBehavior,
      reportedBehavior: this.input.reportedBehavior,
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
      return this.observation(value.observation, name);
    }

    return value;
  }

  parseTextVerdict(content: string | null): AgentConclusion | undefined {
    if (!content) return undefined;

    try {
      return this.conclusion(
        JSON.parse(
          content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'),
        ),
      );
    } catch {
      return undefined;
    }
  }

  private conclusion(raw: unknown): AgentConclusion {
    const result = reproductionFinishSchema.parse(raw);
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

    return {
      verdict: result.verdict,
      summary: result.summary,
      confidence:
        result.verdict === REPRODUCTION_VERDICT.Inconclusive
          ? 0
          : result.confidence,
      steps: result.steps.map(step => step.action),
      observations: [result.actualBehavior],
      reproduction: {
        preconditions: result.preconditions,
        steps: result.steps.map((step, index) => ({
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
          this.input.expectedBehavior ?? 'Not established from the issue',
        actualBehavior: 'Insufficient evidence to conclude',
        sourceEventIds: [],
      },
    };
  }
}
