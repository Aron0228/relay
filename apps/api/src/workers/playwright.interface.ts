import {allowedOrigins} from '../ai/config';
import {
  Browser,
  BrowserContext,
  CDPSession,
  chromium,
  Page,
  Locator,
} from 'playwright';
import {WorkerInput, WorkerMessage} from './protocol';

export interface BrowserLocator {
  selector?: string;
  role?: string;
  name?: string;
}

export class PlaywrightInterface {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private screencast?: CDPSession;
  private lastFrameAt = 0;

  constructor(
    private input: WorkerInput,
    private emit: (message: WorkerMessage) => void,
  ) {}

  async start(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    this.context = await this.browser.newContext({
      viewport: {width: 1280, height: 720},
      recordVideo: {
        dir: this.input.videoDirectory,
        size: {width: 1280, height: 720},
      },
    });

    this.page = await this.context.newPage();
    if (this.input.agentInput) {
      const origins = allowedOrigins();
      const protectNavigation = async (page: Page) => {
        const session = await this.context!.newCDPSession(page);

        session.on(
          'Fetch.requestPaused',
          ({
            requestId,
            request,
          }: {
            requestId: string;
            request: {url: string};
          }) => {
            const approved = origins.includes(new URL(request.url).origin);
            const command = approved
              ? 'Fetch.continueRequest'
              : 'Fetch.failRequest';
            const parameters = approved
              ? {requestId}
              : {requestId, errorReason: 'BlockedByClient'};

            session.send(command, parameters).catch(() => {});
          },
        );

        await session.send('Fetch.enable', {
          patterns: [{resourceType: 'Document', requestStage: 'Request'}],
        });
      };

      await protectNavigation(this.page);
      this.context.on('page', page => {
        protectNavigation(page).catch(() => page.close());
      });
    }

    this.page.setDefaultTimeout(10000);
    this.page.on('console', message =>
      this.event('browser.console', {
        type: message.type(),
        text: message.text(),
      }),
    );
    this.page.on('pageerror', error =>
      this.event('browser.error', {message: error.message}),
    );
    this.page.on('requestfailed', request =>
      this.event('browser.request_failed', {
        url: request.url(),
        error: request.failure()?.errorText,
      }),
    );
    this.screencast = await this.context.newCDPSession(this.page);
    this.screencast.on(
      'Page.screencastFrame',
      ({data, sessionId}: {data: string; sessionId: number}) => {
        this.screencast
          ?.send('Page.screencastFrameAck', {sessionId})
          .catch(() => {});

        if (Date.now() - this.lastFrameAt < 200) {
          return;
        }

        this.lastFrameAt = Date.now();
        this.emit({type: 'frame', data});
      },
    );

    await this.screencast.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: 1280,
      maxHeight: 720,
    });
    this.event('browser.started', {});
  }

  async navigate(url: string): Promise<void> {
    await this.perform('navigate', {url}, () =>
      this.getPage().goto(url, {waitUntil: 'domcontentloaded'}),
    );
  }

  async fill(selector: string | BrowserLocator, value: string): Promise<void> {
    await this.perform('fill', {selector, value}, () =>
      this.locator(selector).fill(value),
    );
  }

  async click(selector: string | BrowserLocator): Promise<void> {
    await this.perform('click', {selector}, () =>
      this.locator(selector).click(),
    );
  }

  async press(selector: string | BrowserLocator, key: string): Promise<void> {
    await this.perform('press', {selector, key}, () =>
      this.locator(selector).press(key),
    );
  }

  async text(selector: string | BrowserLocator): Promise<string> {
    return this.locator(selector).innerText();
  }

  async snapshot(): Promise<string> {
    return this.getPage().locator('body').ariaSnapshot();
  }

  async observe(): Promise<string> {
    return `URL: ${this.getPage().url()}\n${await this.snapshot()}`;
  }

  private locator(target: string | BrowserLocator): Locator {
    if (typeof target === 'string') {
      return this.getPage().locator(target);
    }

    if (target.selector) {
      return this.getPage().locator(target.selector);
    }

    return this.getPage().getByRole(
      target.role as Parameters<Page['getByRole']>[0],
      {name: target.name, exact: true},
    );
  }

  async assertText(selector: string, expected: string): Promise<void> {
    const actual = await this.text(selector);

    if (!actual.includes(expected)) {
      throw new Error(
        `Expected ${selector} to contain ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }

    this.event('assertion.passed', {selector, expected});
  }

  async close(): Promise<string | undefined> {
    const video = this.page?.video();

    try {
      await this.context?.close();

      if (video) {
        await video.saveAs(`${this.input.videoDirectory}/session.webm`);
        await video.delete();

        return `${this.input.runId}/session.webm`;
      }
    } finally {
      await this.browser?.close();
      this.event('browser.closed', {});
    }
  }

  async cancel(): Promise<void> {
    await this.context?.close();
  }

  private getPage(): Page {
    if (!this.page) {
      throw new Error('The browser session has not started');
    }

    return this.page;
  }

  private event(event: string, payload: Record<string, unknown>): void {
    this.emit({type: 'event', event, payload});
  }

  private async perform(
    action: string,
    payload: Record<string, unknown>,
    execute: () => Promise<unknown>,
  ): Promise<void> {
    this.event('action.started', {action, ...payload});
    await execute();
    this.emit({
      type: 'frame',
      data: (
        await this.getPage().screenshot({type: 'jpeg', quality: 70})
      ).toString('base64'),
    });
    this.event('action.completed', {action, ...payload});
    await this.getPage().waitForTimeout(this.input.actionDelayMs);
  }
}
