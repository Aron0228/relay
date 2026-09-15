import {Client} from '@loopback/testlab';
import {afterAll, beforeAll, describe, it} from 'vitest';
import type {RelayApplication} from '../../application';
import {setupApplication} from './test-helper';

describe('HomePage', () => {
  let app: RelayApplication;
  let client: Client;

  beforeAll(async () => {
    ({app, client} = await setupApplication());
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('exposes a default home page', async () => {
    await client
      .get('/')
      .expect(200)
      .expect('Content-Type', /text\/html/);
  });

  it('exposes self-hosted explorer', async () => {
    await client
      .get('/explorer/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect(/<title>LoopBack API Explorer/);
  });
});
