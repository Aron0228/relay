/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol uses snake_case fields. */
import {z} from 'zod';
import {setTimeout as delay} from 'node:timers/promises';
import {positiveInteger} from './config';
import {AgentTool, AiProvider, ChatMessage} from './types';

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.literal('assistant'),
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                type: z.literal('function'),
                function: z.object({name: z.string(), arguments: z.string()}),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
});

export class OpenAiCompatibleProvider implements AiProvider {
  readonly model = process.env.AI_MODEL ?? 'qwen3:8b';
  private readonly baseUrl = (
    process.env.AI_BASE_URL ?? 'http://127.0.0.1:11434/v1'
  ).replace(/\/$/, '');
  private readonly apiKey = process.env.AI_API_KEY;
  private readonly timeoutMs =
    positiveInteger('AI_REQUEST_TIMEOUT_SECONDS', 60) * 1000;
  private readonly maxTokens = positiveInteger('AI_MAX_OUTPUT_TOKENS', 2048);

  async complete(
    messages: ChatMessage[],
    tools: AgentTool[],
    signal: AbortSignal,
    requiredTool?: string,
  ): Promise<ChatMessage> {
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    const retries = positiveInteger('AI_REQUEST_MAX_ATTEMPTS', 3);
    let response: globalThis.Response;

    for (let attempt = 1; ; attempt++) {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? {Authorization: `Bearer ${this.apiKey}`} : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools,
          tool_choice: requiredTool
            ? {type: 'function', function: {name: requiredTool}}
            : 'auto',
          max_tokens: this.maxTokens,
          stream: false,
        }),
        signal: requestSignal,
      });

      if (response.ok) {
        break;
      }

      const detail = await this.errorDetail(response);
      const retryable = [429, 500, 502, 503, 504].includes(response.status);

      if (!retryable || attempt >= retries) {
        throw new Error(
          `AI provider request failed (HTTP ${response.status}, attempt ${attempt}/${retries})${detail ? `: ${detail}` : ''}`,
        );
      }

      await delay(1000 * attempt, undefined, {signal: requestSignal});
    }

    const {choices} = completionSchema.parse(await response.json());
    const message = choices[0].message;

    return {
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    };
  }
  private async errorDetail(
    response: globalThis.Response,
  ): Promise<string | undefined> {
    const body = await response.text();

    try {
      const parsed = z
        .object({
          error: z.union([z.string(), z.object({message: z.string()})]),
        })
        .safeParse(JSON.parse(body));

      if (!parsed.success) {
        return undefined;
      }

      let message =
        typeof parsed.data.error === 'string'
          ? parsed.data.error
          : parsed.data.error.message;

      if (this.apiKey) {
        message = message.split(this.apiKey).join('[redacted]');
      }

      return message
        .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
        .slice(0, 500);
    } catch {
      return undefined;
    }
  }
}
