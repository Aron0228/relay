import {z} from 'zod';
import {PlaywrightInterface} from '../workers/playwright.interface';
import {approvedUrl} from './config';
import {AgentConclusion, AgentTool, AGENT_ACTIVITY_KIND} from './types';

const locatorSchema = z
  .object({
    selector: z
      .string()
      .max(1000)
      .optional()
      .describe('CSS selector. Omit or leave empty when using role and name.'),
    role: z
      .string()
      .max(100)
      .optional()
      .describe(
        'Accessible role, for example textbox or button. Omit or leave empty when using selector.',
      ),
    name: z.string().max(500).optional(),
  })
  .refine(
    value => Boolean(value.selector) !== Boolean(value.role),
    'Provide either selector or role',
  );
const finishSchema = z
  .object({
    verdict: z.enum(['passed', 'failed', 'inconclusive']),
    summary: z.string().min(1).max(4000),
    confidence: z.number().min(0).max(1),
    steps: z.array(z.string().max(2000)).max(100),
    observations: z.array(z.string().max(2000)).max(100),
  })
  .strict();

const textVerdictSchema = finishSchema.extend({
  verdict: z.string().toLowerCase().pipe(finishSchema.shape.verdict),
});

export function parseTextVerdict(content: string | null) {
  if (!content) {
    return undefined;
  }

  const json = content
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');

  try {
    const result = textVerdictSchema.safeParse(JSON.parse(json));

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

const tools = {
  reportProgress: {
    description:
      'Keep the user informed: report the initial test plan after inspecting the page, then meaningful progress, findings, or a change of approach. Use message for a short plan/update and observation for an observed fact. Write 1-2 natural sentences about the test goal, not tool mechanics or private reasoning. Group related actions rather than narrating every click. Then continue testing.',
    schema: z
      .object({
        kind: z.enum([
          AGENT_ACTIVITY_KIND.Message,
          AGENT_ACTIVITY_KIND.Observation,
        ]),
        text: z.string().min(1).max(2000),
      })
      .strict(),
  },
  browserSnapshot: {
    description: 'Inspect the current URL and accessibility tree.',
    schema: z.object({}).strict(),
  },
  browserNavigate: {
    description: 'Navigate to a URL within the approved target origins.',
    schema: z.object({url: z.string().url().max(2000)}).strict(),
  },
  browserClick: {
    description: 'Click by CSS selector or accessible role and exact name.',
    schema: locatorSchema,
  },
  browserFill: {
    description:
      'Fill an input with test data using a CSS selector or role/name.',
    schema: locatorSchema.safeExtend({value: z.string().max(4000)}),
  },
  browserPress: {
    description: 'Press a keyboard key on an element (for example Enter).',
    schema: locatorSchema.safeExtend({key: z.string().min(1).max(100)}),
  },
  browserText: {
    description: 'Read visible text from a CSS selector or role/name.',
    schema: locatorSchema,
  },
  finish: {
    description: 'Conclude testing with an evidence-based structured verdict.',
    schema: finishSchema,
  },
} as const;

export const BROWSER_TOOLS: AgentTool[] = Object.entries(tools).map(
  ([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema, {unrepresentable: 'any'}),
    },
  }),
);

export interface BrowserToolOutput {
  observation?: string;
  sourceEventId?: string;
  activity?: {kind: 'message' | 'observation'; text: string};
  result?: AgentConclusion;
}

export class BrowserTools {
  constructor(
    private browser: PlaywrightInterface,
    private origins: string[],
  ) {}

  async execute(
    name: string,
    rawArguments: string,
  ): Promise<BrowserToolOutput> {
    if (!Object.prototype.hasOwnProperty.call(tools, name)) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const parsed = JSON.parse(rawArguments) as unknown;

    switch (name) {
      case 'reportProgress':
        return {activity: tools.reportProgress.schema.parse(parsed)};

      case 'browserSnapshot':
        tools.browserSnapshot.schema.parse(parsed);

        return {observation: await this.browser.observe()};
      case 'browserNavigate':
        await this.browser.navigate(
          approvedUrl(
            tools.browserNavigate.schema.parse(parsed).url,
            this.origins,
          ),
        );
        break;
      case 'browserClick':
        await this.browser.click(locatorSchema.parse(parsed));
        break;
      case 'browserFill': {
        const args = tools.browserFill.schema.parse(parsed);

        await this.browser.fill(args, args.value);
        break;
      }
      case 'browserPress': {
        const args = tools.browserPress.schema.parse(parsed);

        await this.browser.press(args, args.key);
        break;
      }
      case 'browserText':
        return {
          observation: await this.browser.text(locatorSchema.parse(parsed)),
        };
      case 'finish':
        return {result: finishSchema.parse(parsed)};
    }

    return {observation: await this.browser.observe()};
  }
}
