/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol fields. */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {BrowserAgent} from '../../../ai/browser-agent';
import {BrowserTools} from '../../../ai/browser-tools';
import {AiProvider, ChatMessage} from '../../../ai/types';
import {PlaywrightInterface} from '../../../workers/playwright.interface';

const input = {
  prompt: 'Help Finn check the shop',
  targetUrl: 'https://academybugs.com/',
};
const verdict = {
  verdict: 'passed',
  summary: 'Finn found the shop',
  confidence: 0.9,
  steps: ['Read the page'],
  observations: ['Shop visible'],
};

function call(name: string, args: object = {}): ChatMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'bmo-call',
        type: 'function',
        function: {name, arguments: JSON.stringify(args)},
      },
    ],
  };
}

function fixture(reply: ChatMessage = call('finish', verdict)) {
  const browser = {
    navigate: vi.fn(),
    observe: vi.fn().mockResolvedValue('Shop'),
    click: vi.fn(),
  } as unknown as PlaywrightInterface;
  const complete = vi.fn<AiProvider['complete']>().mockResolvedValue(reply);
  const emit = vi.fn();
  const agent = new BrowserAgent({model: 'bmo', complete}, browser, emit);

  return {agent, browser, complete, emit};
}

afterEach(() => vi.unstubAllEnvs());

describe('Browser agent', () => {
  it('returns a structured verdict and emits public tool activity', async () => {
    const {agent, emit} = fixture();
    const result = await agent.run(input, new AbortController().signal);

    expect(result).toMatchObject({
      ...verdict,
      stopReason: 'finished',
      turns: 1,
      toolCalls: 1,
    });
    expect(emit).toHaveBeenCalledWith(
      'agent.tool_completed',
      expect.objectContaining({name: 'finish'}),
    );
  });

  it('stops an agent that repeatedly calls tools at the configured cap', async () => {
    vi.stubEnv('AI_MAX_TOOL_CALLS', '2');
    const {agent, complete} = fixture(call('browserSnapshot'));
    const result = await agent.run(input, new AbortController().signal);

    expect(result).toMatchObject({
      verdict: 'inconclusive',
      stopReason: 'tool_limit',
      toolCalls: 2,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('caps turns even when a provider returns only text', async () => {
    vi.stubEnv('AI_MAX_TURNS', '2');
    const {agent, complete} = fixture({
      role: 'assistant',
      content: 'Thinking about the shop',
    });

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      stopReason: 'turn_limit',
      turns: 2,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('feeds tool errors back to the provider so it can recover', async () => {
    const {agent, complete, emit} = fixture();
    complete.mockResolvedValueOnce(call('shell', {command: 'whoami'}));

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      stopReason: 'finished',
      toolCalls: 2,
      failedToolCalls: 1,
    });
    expect(emit).toHaveBeenCalledWith(
      'agent.tool_failed',
      expect.objectContaining({name: 'shell'}),
    );
    expect(complete.mock.calls[1][0]).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('Unknown tool'),
      }),
    );
  });

  it('stops before contacting a provider when context exceeds the cap', async () => {
    vi.stubEnv('AI_MAX_CONTEXT_CHARACTERS', '1');
    const {agent, complete} = fixture();

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      stopReason: 'context_limit',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('reports cancellation and provider failure as inconclusive', async () => {
    const {agent, complete} = fixture();
    const cancellation = new AbortController();
    cancellation.abort();

    expect(await agent.run(input, cancellation.signal)).toMatchObject({
      stopReason: 'cancelled',
      verdict: 'inconclusive',
    });
    complete.mockRejectedValueOnce(new Error('Provider unavailable'));
    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      stopReason: 'provider_error',
      verdict: 'inconclusive',
    });
  });

  it('accepts an empty unused selector with a role locator', async () => {
    const {browser} = fixture();
    const tools = new BrowserTools(browser, ['https://academybugs.com']);

    await tools.execute(
      'browserClick',
      JSON.stringify({selector: '', role: 'button', name: 'Send'}),
    );

    expect(browser.click).toHaveBeenCalledWith({
      selector: '',
      role: 'button',
      name: 'Send',
    });
  });

  it('requests finish on the final turn so a text verdict is not lost', async () => {
    vi.stubEnv('AI_MAX_TURNS', '2');
    const {agent, complete} = fixture();
    complete.mockResolvedValueOnce(call('browserSnapshot'));

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      stopReason: 'finished',
      turns: 2,
    });
    expect(complete.mock.calls[0][3]).toBeUndefined();
    expect(complete.mock.calls[1][3]).toBe('finish');
  });

  it('finishes immediately when the provider returns a complete JSON text verdict', async () => {
    const {agent, complete} = fixture({
      role: 'assistant',
      content: JSON.stringify({...verdict, verdict: 'Failed'}),
    });

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      verdict: 'failed',
      summary: verdict.summary,
      stopReason: 'finished',
      turns: 1,
      toolCalls: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('accepts a JSON verdict enclosed in a code fence', async () => {
    const {agent} = fixture({
      role: 'assistant',
      content: '```json\n' + JSON.stringify(verdict) + '\n```',
    });

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      verdict: 'passed',
      stopReason: 'finished',
    });
  });

  it('keeps the hard cap for incomplete or malformed text verdicts', async () => {
    vi.stubEnv('AI_MAX_TURNS', '1');

    for (const content of [
      JSON.stringify({verdict: 'failed'}),
      '{"verdict": "failed", // invalid JSON',
      JSON.stringify({...verdict, confidence: 2}),
    ]) {
      const {agent} = fixture({role: 'assistant', content});

      expect(
        await agent.run(input, new AbortController().signal),
      ).toMatchObject({verdict: 'inconclusive', stopReason: 'turn_limit'});
    }
  });

  it('does not accept a text verdict while the provider also requests browser actions', async () => {
    vi.stubEnv('AI_MAX_TURNS', '1');
    const {agent} = fixture({
      ...call('browserSnapshot'),
      content: JSON.stringify(verdict),
    });

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      verdict: 'inconclusive',
      stopReason: 'turn_limit',
      toolCalls: 1,
    });
  });

  it('publishes typed public updates that can be persisted and replayed', async () => {
    const {agent, complete, emit} = fixture();
    complete.mockResolvedValueOnce(
      call('reportProgress', {
        kind: 'observation',
        text: 'The Candy Kingdom shop is visible.',
      }),
    );

    expect(await agent.run(input, new AbortController().signal)).toMatchObject({
      stopReason: 'finished',
      toolCalls: 2,
      failedToolCalls: 0,
    });
    expect(emit).toHaveBeenCalledWith('agent.activity', {
      turn: 1,
      kind: 'observation',
      text: 'The Candy Kingdom shop is visible.',
    });
  });

  it('rejects unapproved navigation and malformed locators before browser actions', async () => {
    const {browser} = fixture();
    const tools = new BrowserTools(browser, ['https://academybugs.com']);

    await expect(
      tools.execute(
        'browserNavigate',
        JSON.stringify({url: 'http://127.0.0.1/private'}),
      ),
    ).rejects.toThrow();
    await expect(
      tools.execute(
        'browserClick',
        JSON.stringify({selector: '#shop', role: 'button'}),
      ),
    ).rejects.toThrow();
    await expect(tools.execute('constructor', '{}')).rejects.toThrow(
      'Unknown tool',
    );
    expect(browser.navigate).not.toHaveBeenCalled();
    expect(browser.click).not.toHaveBeenCalled();
  });
});

it('accumulates usage without sending metric metadata back to the model', async () => {
  const {agent, complete, emit} = fixture();
  complete.mockResolvedValueOnce({
    ...call('browserSnapshot'),
    usage: {inputTokens: 100, outputTokens: 10, totalTokens: 110},
  });
  complete.mockResolvedValueOnce({
    ...call('finish', verdict),
    usage: {inputTokens: 150, outputTokens: 20, totalTokens: 170},
  });

  const result = await agent.run(input, new AbortController().signal);

  expect(result.tokenUsage).toEqual({
    inputTokens: 250,
    outputTokens: 30,
    totalTokens: 280,
    reportedRequests: 2,
    unreportedRequests: 0,
  });
  expect(emit).toHaveBeenCalledWith(
    'agent.metrics',
    expect.objectContaining({
      tokenUsage: expect.objectContaining({totalTokens: 110}),
    }),
  );
  expect(complete.mock.calls[1][0].some(message => message.usage)).toBe(false);
});

it('records missing provider usage rather than estimating tokens', async () => {
  const {agent} = fixture();

  const result = await agent.run(input, new AbortController().signal);

  expect(result.tokenUsage).toMatchObject({
    reportedRequests: 0,
    unreportedRequests: 1,
  });
});
