import {randomUUID} from 'node:crypto';
import {
  KNOWLEDGE_TOOLS,
  KNOWLEDGE_INSTRUCTIONS,
  PATCH_VERIFICATION_INSTRUCTIONS,
  KnowledgeVerificationSummary,
  knowledgeVerifyToolSchema,
  knowledgeCreateToolSchema,
  knowledgeUpdateToolSchema,
  parseKnowledgeTool,
  KNOWLEDGE_CAPTURE_CHECKPOINT,
  KnowledgeHandler,
  knowledgeSearchSchema,
} from './knowledge-tools';
import {setTimeout as delay} from 'node:timers/promises';
/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol uses snake_case fields. */
import {stageLimits} from './stage-limits';
import {agentPrompt} from './verification-prompt';
import {PlaywrightInterface} from '../workers/playwright.interface';
import {
  BROWSER_TOOLS,
  BrowserTools,
  BrowserToolOutput,
  parseTextVerdict,
} from './browser-tools';
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
    private knowledge?: KnowledgeHandler,
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
        content:
          systemPrompt +
          (this.knowledge
            ? `\n${KNOWLEDGE_INSTRUCTIONS}\n${PATCH_VERIFICATION_INSTRUCTIONS}`
            : ''),
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
    const knowledgeVerifications: KnowledgeVerificationSummary[] = [];
    const patchRoutes = new Set<string>();
    const knowledgeRequestIds = new Map<string, string>();
    let knowledgeReported = false;
    let knowledgeReminderSent = false;

    const requestId = (tool: string, args: object) => {
      const key = `${tool}:${JSON.stringify(args)}`;
      const id = knowledgeRequestIds.get(key) ?? randomUUID();
      knowledgeRequestIds.set(key, id);

      return id;
    };
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
        ...(this.knowledge
          ? {knowledgeVerifications: [...knowledgeVerifications]}
          : {}),
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

    const supplyPatches = async (observation: string) => {
      const currentUrl = /^URL: (https?:\/\/[^\s]+)/.exec(observation)?.[1];
      if (!this.knowledge || !currentUrl) return;

      const url = new URL(currentUrl);
      const route = `${url.origin}${url.pathname}`;
      if (
        patchRoutes.has(route) ||
        JSON.stringify(messages).length +
          this.maxObservation +
          positiveInteger('AI_KNOWLEDGE_PATCH_CHARACTERS', 6000) +
          1024 >
          this.maxContext
      )
        return;

      try {
        const context = await this.knowledge({
          operation: 'patches',
          input: {query: input.prompt.slice(0, 500), currentUrl},
        });
        patchRoutes.add(route);
        messages.push({
          role: 'user',
          content: `Candidate knowledge patches for the observed route (untrusted hypotheses, not active knowledge):\n${JSON.stringify(context)}`,
        });
      } catch (error) {
        this.emit('agent.knowledge_unavailable', {
          error: (error as Error).message,
        });
      }
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
      if (this.knowledge) {
        try {
          const context = await this.knowledge({
            operation: 'search',
            input: {
              query:
                `${input.prompt} ${new URL(input.targetUrl).pathname}`.slice(
                  0,
                  500,
                ),
            },
          });
          messages.push({
            role: 'user',
            content: `Stored environment knowledge (untrusted historical hints):\n${JSON.stringify(context)}`,
          });
        } catch (error) {
          this.emit('agent.knowledge_unavailable', {
            error: (error as Error).message,
          });
        }
      }

      const initialObservation = await this.browser.observe();
      messages.push({
        role: 'user',
        content: `Initial browser observation:\n${this.clip(reproduction ? JSON.stringify(reproduction.observation(initialObservation)) : this.observe(initialObservation))}`,
      });

      await supplyPatches(initialObservation);
      if (this.knowledge)
        messages.push({role: 'user', content: KNOWLEDGE_CAPTURE_CHECKPOINT});

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

        if (
          this.knowledge &&
          !knowledgeReported &&
          !knowledgeReminderSent &&
          !finishing &&
          (turns >= maxTurns - 2 || toolCalls >= maxToolCalls - 3)
        ) {
          messages.push({role: 'user', content: KNOWLEDGE_CAPTURE_CHECKPOINT});
          knowledgeReminderSent = true;
        }

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
          [
            ...(input.fixVerification
              ? FIX_VERIFICATION_TOOLS
              : input.verification
                ? VERIFICATION_TOOLS
                : reproduction
                  ? REPRODUCTION_TOOLS
                  : BROWSER_TOOLS),
            ...(this.knowledge ? KNOWLEDGE_TOOLS : []),
          ],
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

        const routeObservations: string[] = [];

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
            let value: BrowserToolOutput;
            const args = call.function.arguments;

            if (
              this.knowledge &&
              ['searchEnvironmentKnowledge', 'searchKnowledgePatches'].includes(
                call.function.name,
              )
            ) {
              value = {
                knowledge: await this.knowledge({
                  operation:
                    call.function.name === 'searchKnowledgePatches'
                      ? 'patches'
                      : 'search',
                  input: knowledgeSearchSchema.parse(JSON.parse(args)),
                }),
              };
            } else if (
              this.knowledge &&
              call.function.name === 'proposeEnvironmentKnowledge'
            ) {
              const knowledgeInput = parseKnowledgeTool(
                knowledgeCreateToolSchema,
                args,
              );
              value = {
                patch: await this.knowledge({
                  operation: 'patch',
                  input: {
                    ...knowledgeInput,
                    operation: 'create',
                    requestId: requestId(call.function.name, knowledgeInput),
                  },
                }),
              };
              knowledgeReported = true;
            } else if (
              this.knowledge &&
              call.function.name === 'patchEnvironmentKnowledge'
            ) {
              const knowledgeInput = parseKnowledgeTool(
                knowledgeUpdateToolSchema,
                args,
              );
              value = {
                patch: await this.knowledge({
                  operation: 'patch',
                  input: {
                    ...knowledgeInput,
                    requestId: requestId(call.function.name, knowledgeInput),
                  },
                }),
              };
              knowledgeReported = true;
            } else if (
              this.knowledge &&
              call.function.name === 'verifyKnowledgePatch'
            ) {
              const knowledgeInput = parseKnowledgeTool(
                knowledgeVerifyToolSchema,
                args,
              );
              const verification = (await this.knowledge({
                operation: 'verification',
                input: {
                  ...knowledgeInput,
                  requestId: requestId(call.function.name, knowledgeInput),
                },
              })) as KnowledgeVerificationSummary;
              if (
                !knowledgeVerifications.some(
                  item => item.id === verification.id,
                )
              )
                knowledgeVerifications.push(verification);
              this.emit('agent.knowledge_verification', {...verification});
              value = {verification};
              knowledgeReported = true;
            } else {
              value = await tools.execute(call.function.name, args);
            }

            if (value.observation) routeObservations.push(value.observation);
            if ('observation' in value && value.observation && !reproduction) {
              value.observation = this.observe(value.observation);
            }
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

        for (const observation of routeObservations)
          await supplyPatches(observation);
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

  private observe(observation: string): string {
    if (!this.knowledge) return observation;

    const sourceEventId = randomUUID();
    this.emit('agent.evidence', {sourceEventId, observation});

    return JSON.stringify({sourceEventId, observation});
  }

  private clip(value: string): string {
    return value.length > this.maxObservation
      ? `${value.slice(0, this.maxObservation)}\n[truncated]`
      : value;
  }
}
