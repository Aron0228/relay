import {Browser, BrowserContext, CDPSession, chromium, Page} from 'playwright';
import {WorkerInput, WorkerMessage} from './protocol';

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

  async fill(selector: string, value: string): Promise<void> {
    await this.perform('fill', {selector, value}, () =>
      this.getPage().locator(selector).fill(value),
    );
  }

  async click(selector: string): Promise<void> {
    await this.perform('click', {selector}, () =>
      this.getPage().locator(selector).click(),
    );
  }

  async press(selector: string, key: string): Promise<void> {
    await this.perform('press', {selector, key}, () =>
      this.getPage().locator(selector).press(key),
    );
  }

  async text(selector: string): Promise<string> {
    return this.getPage().locator(selector).innerText();
  }

  async snapshot(): Promise<string> {
    return this.getPage().locator('body').ariaSnapshot();
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
