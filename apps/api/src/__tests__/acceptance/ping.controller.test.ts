import {Client} from '@loopback/testlab';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {RelayApplication} from '../../application';
import {setupApplication} from './test-helper';

describe('PingController (acceptance)', () => {
  let app: RelayApplication;
  let client: Client;

  beforeAll(async () => {
    ({app, client} = await setupApplication());
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('invokes GET /ping', async () => {
    const res = await client.get('/ping?msg=world').expect(200);
    expect(res.body).toMatchObject({greeting: 'Hello from LoopBack'});
  });
});
