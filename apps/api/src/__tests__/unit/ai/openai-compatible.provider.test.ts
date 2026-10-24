/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol fields. */
import {afterEach, expect, it, vi} from 'vitest';
import {OpenAiCompatibleProvider} from '../../../ai/openai-compatible.provider';
import {BROWSER_TOOLS} from '../../../ai/browser-tools';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('requests a structured finish tool call from the provider on the final turn', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'bmo-finish',
                  type: 'function',
                  function: {name: 'finish', arguments: '{}'},
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const provider = new OpenAiCompatibleProvider();

  const response = await provider.complete(
    [],
    BROWSER_TOOLS,
    new AbortController().signal,
    'finish',
  );
  const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);

  expect(request.tool_choice).toEqual({
    type: 'function',
    function: {name: 'finish'},
  });
  expect(response.tool_calls?.[0].function.name).toBe('finish');
});

it('retries a temporary provider error without repeating browser actions', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({error: 'Temporary inference failure'}), {
        status: 500,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{message: {role: 'assistant', content: 'Recovered'}}],
        }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);

  const result = await new OpenAiCompatibleProvider().complete(
    [],
    BROWSER_TOOLS,
    new AbortController().signal,
  );

  expect(result.content).toBe('Recovered');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
});

it('reports the provider error and redacts credentials when attempts are exhausted', async () => {
  vi.stubEnv('AI_REQUEST_MAX_ATTEMPTS', '1');
  vi.stubEnv('AI_API_KEY', 'bmo-secret');
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          message: 'Inference failed with bmo-secret and Bearer finn-token',
        },
      }),
      {status: 500},
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const promise = new OpenAiCompatibleProvider().complete(
    [],
    BROWSER_TOOLS,
    new AbortController().signal,
  );

  await expect(promise).rejects.toThrow(
    'HTTP 500, attempt 1/1): Inference failed with [redacted] and Bearer [redacted]',
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not retry authentication errors', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response('{"error":"Unauthorized"}', {status: 401}));
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    new OpenAiCompatibleProvider().complete(
      [],
      BROWSER_TOOLS,
      new AbortController().signal,
    ),
  ).rejects.toThrow('HTTP 401');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('cancels during retry backoff without sending another request', async () => {
  const cancellation = new AbortController();
  const fetchMock = vi.fn().mockImplementation(() => {
    cancellation.abort();

    return Promise.resolve(
      new Response('{"error":"Unavailable"}', {status: 503}),
    );
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    new OpenAiCompatibleProvider().complete(
      [],
      BROWSER_TOOLS,
      cancellation.signal,
    ),
  ).rejects.toMatchObject({name: 'AbortError'});
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('retains provider-reported token usage', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{message: {role: 'assistant', content: 'BMO is ready'}}],
          usage: {prompt_tokens: 120, completion_tokens: 30, total_tokens: 150},
        }),
      ),
    ),
  );

  const response = await new OpenAiCompatibleProvider().complete(
    [],
    BROWSER_TOOLS,
    new AbortController().signal,
  );

  expect(response.usage).toEqual({
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
});
