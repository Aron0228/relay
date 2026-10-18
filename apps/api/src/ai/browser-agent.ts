/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol uses snake_case fields. */
import {PlaywrightInterface} from '../workers/playwright.interface';
import {BROWSER_TOOLS, BrowserTools, parseTextVerdict} from './browser-tools';
import {approvedUrl, allowedOrigins, positiveInteger} from './config';
import {AGENT_PROMPT_VERSION, AGENT_SYSTEM_PROMPT} from './system-prompt';
import {
  AgentEvent,
  AgentInput,
  AgentResult,
  AgentStopReason,
  AiProvider,
  ChatMessage,
} from './types';

export class BrowserAgent {
  private readonly maxTurns = positiveInteger('AI_MAX_TURNS', 20);
  private readonly maxToolCalls = positiveInteger('AI_MAX_TOOL_CALLS', 40);
  private readonly maxContext = positiveInteger(
    'AI_MAX_CONTEXT_CHARACTERS',
    80000,
  );
  private readonly maxObservation = positiveInteger(
    'AI_MAX_OBSERVATION_CHARACTERS',
    12000,
  );
  private readonly timeoutMs =
    positiveInteger('AI_RUN_TIMEOUT_SECONDS', 180) * 1000;

  constructor(
    private provider: AiProvider,
    private browser: PlaywrightInterface,
    private emit: AgentEvent,
  ) {}

  async run(
    input: AgentInput,
    cancellation: AbortSignal,
  ): Promise<AgentResult> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([cancellation, deadline]);
    const tools = new BrowserTools(this.browser, allowedOrigins());
    const messages: ChatMessage[] = [
      {role: 'system', content: AGENT_SYSTEM_PROMPT},
      {
        role: 'user',
        content: JSON.stringify({
          goal: input.prompt,
          targetUrl: input.targetUrl,
          maxTurns: this.maxTurns,
          maxToolCalls: this.maxToolCalls,
        }),
      },
    ];
    let turns = 0;
    let toolCalls = 0;

    const conclude = (
      stopReason: AgentStopReason,
      summary: string,
      details?: Pick<
        AgentResult,
        'verdict' | 'confidence' | 'steps' | 'observations'
      >,
    ): AgentResult => {
      const result: AgentResult = {
        verdict: 'inconclusive',
        confidence: 0,
        steps: [],
        observations: [],
        ...details,
        summary,
        stopReason,
        turns,
        toolCalls,
        model: this.provider.model,
        promptVersion: AGENT_PROMPT_VERSION,
      };

      this.emit('agent.completed', {...result});

      return result;
    };

    try {
      this.emit('agent.started', {
        model: this.provider.model,
        promptVersion: AGENT_PROMPT_VERSION,
        maxTurns: this.maxTurns,
        maxToolCalls: this.maxToolCalls,
      });
      signal.throwIfAborted();
      await this.browser.navigate(
        approvedUrl(input.targetUrl, allowedOrigins()),
      );
      messages.push({
        role: 'user',
        content: `Initial browser observation:\n${this.clip(await this.browser.observe())}`,
      });

      while (turns < this.maxTurns) {
        signal.throwIfAborted();

        if (toolCalls >= this.maxToolCalls) {
          return conclude(
            'tool_limit',
            'The tool-call limit was reached before testing finished.',
          );
        }

        if (JSON.stringify(messages).length > this.maxContext) {
          return conclude(
            'context_limit',
            'The context limit was reached before testing finished.',
          );
        }

        turns++;
        this.emit('agent.turn_started', {turn: turns});
        const finishing =
          turns === this.maxTurns || toolCalls === this.maxToolCalls - 1;

        if (finishing) {
          messages.push({
            role: 'user',
            content:
              'This is your final available turn or tool call. Call finish now using the evidence already collected. Use inconclusive if evidence is insufficient.',
          });
        }

        const response = await this.provider.complete(
          messages,
          BROWSER_TOOLS,
          signal,
          finishing ? 'finish' : undefined,
        );
        signal.throwIfAborted();
        messages.push(response);

        if (response.content) {
          this.emit('agent.summary', {
            turn: turns,
            text: this.clip(response.content),
          });
        }

        if (!response.tool_calls?.length) {
          const verdict = parseTextVerdict(response.content);

          if (verdict) {
            this.emit('agent.verdict_received', {
              turn: turns,
              source: 'text',
              ...verdict,
            });

            return conclude('finished', verdict.summary, verdict);
          }

          messages.push({
            role: 'user',
            content: 'Use a browser tool or call finish with your verdict.',
          });

          continue;
        }

        for (const call of response.tool_calls) {
          signal.throwIfAborted();

          if (toolCalls >= this.maxToolCalls) {
            return conclude(
              'tool_limit',
              'The tool-call limit was reached before testing finished.',
            );
          }

          toolCalls++;
          this.emit('agent.tool_called', {
            turn: turns,
            callId: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
          let output: string;

          try {
            const value = await tools.execute(
              call.function.name,
              call.function.arguments,
            );
            signal.throwIfAborted();
            output = this.clip(JSON.stringify(value));
            this.emit('agent.tool_completed', {
              callId: call.id,
              name: call.function.name,
              output,
            });

            if (value.result) {
              return conclude('finished', value.result.summary, value.result);
            }
          } catch (error) {
            signal.throwIfAborted();
            output = this.clip(
              JSON.stringify({error: (error as Error).message}),
            );
            this.emit('agent.tool_failed', {
              callId: call.id,
              name: call.function.name,
              output,
            });
          }

          messages.push({role: 'tool', tool_call_id: call.id, content: output});
        }
      }

      return conclude(
        'turn_limit',
        'The turn limit was reached before testing finished.',
      );
    } catch (error) {
      if (cancellation.aborted) {
        return conclude('cancelled', 'The agent run was cancelled.');
      }

      if (deadline.aborted || (error as Error).name === 'TimeoutError') {
        return conclude('timeout', 'The agent or provider request timed out.');
      }

      return conclude(
        'provider_error',
        `The agent could not continue: ${(error as Error).message}`,
      );
    }
  }

  private clip(value: string): string {
    return value.length > this.maxObservation
      ? `${value.slice(0, this.maxObservation)}\n[truncated]`
      : value;
  }
}
