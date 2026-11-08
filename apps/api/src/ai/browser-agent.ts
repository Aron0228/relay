import {setTimeout as delay} from 'node:timers/promises';
/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol uses snake_case fields. */
import {stageLimits} from './stage-limits';
import {agentPrompt} from './verification-prompt';
import {PlaywrightInterface} from '../workers/playwright.interface';
import {BROWSER_TOOLS, BrowserTools, parseTextVerdict} from './browser-tools';
import {approvedUrl, allowedOrigins, positiveInteger} from './config';
import {
  ReproductionSession,
  REPRODUCTION_TOOLS,
  FIX_VERIFICATION_TOOLS,
  VERIFICATION_TOOLS,
} from './reproduction-session';

import {
  AgentConclusion,
  AgentEvent,
  AgentInput,
  AgentResult,
  AgentStopReason,
  AiProvider,
  ChatMessage,
} from './types';

export class BrowserAgent {
  private readonly maxContext = positiveInteger(
    'AI_MAX_CONTEXT_CHARACTERS',
    80000,
  );
  private readonly maxObservation = positiveInteger(
    'AI_MAX_OBSERVATION_CHARACTERS',
    12000,
  );

  constructor(
    private provider: AiProvider,
    private browser: PlaywrightInterface,
    private emit: AgentEvent,
  ) {}

  async run(
    input: AgentInput,
    cancellation: AbortSignal,
  ): Promise<AgentResult> {
    const {maxTurns, maxToolCalls, timeoutMs} = stageLimits(input);
    const repairInstruction = [
      'Correct only the finish report using observations already collected. Do not repeat successful browser actions.',
      ...(input.verification
        ? [
            'Supply the original sourceStepNumber for each reported verification step, in the original order.',
          ]
        : []),
      'If the scenario was blocked, explain why and report inconclusive.',
    ].join(' ');
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([cancellation, deadline]);
    const reproduction =
      input.reproduction || input.fixVerification
        ? new ReproductionSession(
            input.reproduction,
            this.browser,
            this.emit,
            input.verification,
            input.fixVerification,
          )
        : undefined;
    const tools =
      reproduction ?? new BrowserTools(this.browser, allowedOrigins());
    const {promptVersion, systemPrompt} = agentPrompt(input);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify({
          goal: input.prompt,
          ...(reproduction ? {reproduction: reproduction.context()} : {}),
          targetUrl: input.targetUrl,
          maxTurns,
          maxToolCalls,
        }),
      },
    ];
    let phase: 'browser' | 'provider' = 'browser';
    let turns = 0;
    let toolCalls = 0;
    let failedToolCalls = 0;
    let lastFinishError: string | undefined;
    const tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reportedRequests: 0,
      unreportedRequests: 0,
    };

    const conclude = (
      stopReason: AgentStopReason,
      summary: string,
      details?: AgentConclusion,
    ): AgentResult => {
      if (
        lastFinishError &&
        (stopReason === 'turn_limit' || stopReason === 'tool_limit')
      ) {
        summary = `${input.verification ? 'The verification report' : 'The final report'} could not be validated within the available budget: ${lastFinishError}`;
      }

      const result: AgentResult = {
        verdict: 'inconclusive',
        confidence: 0,
        steps: [],
        observations: [],
        ...reproduction?.inconclusive(),
        ...details,
        summary,
        stopReason,
        turns,
        toolCalls,
        failedToolCalls,
        tokenUsage: {...tokenUsage},
        model: this.provider.model,
        promptVersion,
      };

      if (input.fixVerification) {
        console.info('[PR verification] Browser AI completed', {
          contextId: input.fixVerification.contextId,
          result,
        });
      }

      this.emit('agent.completed', {...result});

      return result;
    };

    try {
      this.emit('agent.started', {
        model: this.provider.model,
        promptVersion,
        maxTurns,
        maxToolCalls,
      });
      signal.throwIfAborted();
      await this.prepareTarget(input, signal);
      const initialObservation = await this.browser.observe();
      messages.push({
        role: 'user',
        content: `Initial browser observation:\n${this.clip(reproduction ? JSON.stringify(reproduction.observation(initialObservation)) : initialObservation)}`,
      });

      while (turns < maxTurns) {
        signal.throwIfAborted();

        if (toolCalls >= maxToolCalls) {
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
          turns >= maxTurns - (input.verification ? 1 : 0) ||
          toolCalls >= maxToolCalls - (input.verification ? 2 : 1);

        if (finishing) {
          messages.push({
            role: 'user',
            content:
              'The remaining budget is low. Call finish now using evidence already collected. If finish rejects the report, correct it without repeating browser actions. Use inconclusive if evidence is insufficient.',
          });
        }

        phase = 'provider';

        if (input.fixVerification) {
          console.info('[PR verification] Browser AI request started', {
            contextId: input.fixVerification.contextId,
            turn: turns,
            model: this.provider.model,
          });
        }

        const response = await this.provider.complete(
          messages,
          input.fixVerification
            ? FIX_VERIFICATION_TOOLS
            : input.verification
              ? VERIFICATION_TOOLS
              : reproduction
                ? REPRODUCTION_TOOLS
                : BROWSER_TOOLS,
          signal,
          finishing ? 'finish' : undefined,
        );
        if (input.fixVerification) {
          console.info(
            '[PR verification] Browser AI response',
            JSON.stringify({
              contextId: input.fixVerification.contextId,
              turn: turns,
              response,
            }),
          );
        }

        signal.throwIfAborted();
        const {usage, ...message} = response;

        if (usage) {
          tokenUsage.inputTokens += usage.inputTokens;
          tokenUsage.outputTokens += usage.outputTokens;
          tokenUsage.totalTokens += usage.totalTokens;
          tokenUsage.reportedRequests++;
        } else {
          tokenUsage.unreportedRequests++;
        }

        this.emit('agent.metrics', {
          failedToolCalls,
          tokenUsage: {...tokenUsage},
        });
        messages.push(message);

        let textVerdict: AgentConclusion | undefined;
        let textFinishError: string | undefined;

        if (!response.tool_calls?.length) {
          try {
            textVerdict = reproduction
              ? reproduction.parseTextVerdict(response.content)
              : parseTextVerdict(response.content);
          } catch (error) {
            textFinishError = (error as Error).message;
            lastFinishError = textFinishError;
            this.emit('agent.verdict_rejected', {
              turn: turns,
              source: 'text',
              error: textFinishError,
            });
            messages.push({
              role: 'user',
              content: `${textFinishError} ${repairInstruction}`,
            });
          }
        }

        if (response.content && !textVerdict && !textFinishError) {
          this.emit('agent.summary', {
            turn: turns,
            text: this.clip(response.content),
          });
        }

        if (!response.tool_calls?.length) {
          const verdict = textVerdict;

          if (verdict) {
            this.emit('agent.verdict_received', {
              turn: turns,
              source: 'text',
              ...verdict,
            });

            return conclude('finished', verdict.summary, verdict);
          }

          if (!textFinishError)
            messages.push({
              role: 'user',
              content: 'Use a browser tool or call finish with your verdict.',
            });

          continue;
        }

        for (const call of response.tool_calls) {
          signal.throwIfAborted();

          if (toolCalls >= maxToolCalls) {
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

            if (value.activity) {
              this.emit('agent.activity', {turn: turns, ...value.activity});
            }

            if (value.result) {
              return conclude('finished', value.result.summary, value.result);
            }
          } catch (error) {
            signal.throwIfAborted();
            const finishFailed = call.function.name === 'finish';

            if (finishFailed) lastFinishError = (error as Error).message;

            output = this.clip(
              JSON.stringify({
                error: (error as Error).message,
                ...(finishFailed
                  ? {
                      instruction: repairInstruction,
                    }
                  : {}),
              }),
            );
            failedToolCalls++;
            this.emit('agent.metrics', {
              failedToolCalls,
              tokenUsage: {...tokenUsage},
            });
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
        phase === 'browser' ? 'browser_error' : 'provider_error',
        `The agent could not continue: ${(error as Error).message}`,
      );
    }
  }

  private async prepareTarget(
    input: AgentInput,
    signal: AbortSignal,
  ): Promise<void> {
    const target = approvedUrl(input.targetUrl, allowedOrigins());

    if (!input.fixVerification) {
      await this.browser.navigate(target);
      return;
    }

    const deadline =
      Date.now() +
      positiveInteger('AI_FIX_PREVIEW_READY_TIMEOUT_SECONDS', 30) * 1000;
    let attempt = 0;

    while (!signal.aborted) {
      signal.throwIfAborted();

      try {
        await this.browser.navigate(
          target,
          true,
          Math.max(1, Math.min(10000, deadline - Date.now())),
        );
        return;
      } catch (error) {
        signal.throwIfAborted();
        attempt++;
        const remaining = deadline - Date.now();
        console.info('[PR verification] Preview readiness check failed', {
          contextId: input.fixVerification.contextId,
          attempt,
          error: (error as Error).message,
        });

        if (remaining <= 0)
          throw new Error(
            `Preview did not become ready: ${(error as Error).message}`,
          );
        if (attempt === 1)
          this.emit('agent.activity', {
            kind: 'message',
            text: 'The preview is not ready yet. I will wait briefly before starting the checks.',
          });

        await delay(Math.min(2000, remaining), undefined, {signal});
      }
    }

    signal.throwIfAborted();
  }

  private clip(value: string): string {
    return value.length > this.maxObservation
      ? `${value.slice(0, this.maxObservation)}\n[truncated]`
      : value;
  }
}
