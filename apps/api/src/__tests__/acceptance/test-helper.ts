import {RelayApplication} from '../../application';
import {
  createRestAppClient,
  givenHttpServerConfig,
  Client,
} from '@loopback/testlab';
import path from 'path';
import {POSTGRES_CONFIG_BINDING_KEY} from '../../datasources/postgres.datasource';
import {ISSUE_REPRODUCTION_OPTIONS_BINDING_KEY} from '../../services/issue-reproduction.service';
import {WORKER_SERVICE_OPTIONS_BINDING_KEY} from '../../services/worker.service';

const testPostgresConfig = {
  name: 'postgres',
  connector: 'postgresql',
  url:
    process.env.POSTGRES_TEST_URL ??
    'postgres://postgres:postgres@localhost/relay_test',
};

export async function setupApplication(
  options: {workers?: boolean; recovery?: boolean} = {},
): Promise<AppWithClient> {
  const restConfig = givenHttpServerConfig({
    // Customize the server configuration here.
    // Empty values (undefined, '') will be ignored by the helper.
    //
    // host: process.env.HOST,
    // port: +process.env.PORT,
  });

  const app = new RelayApplication({
    rest: restConfig,
  });

  app.projectRoot = path.resolve(__dirname, '../../../dist');

  app.bind(POSTGRES_CONFIG_BINDING_KEY).to(testPostgresConfig);
  app
    .bind(WORKER_SERVICE_OPTIONS_BINDING_KEY)
    .to({enabled: options.workers ?? false});

  app
    .bind(ISSUE_REPRODUCTION_OPTIONS_BINDING_KEY)
    .to({recoveryEnabled: options.recovery ?? false});

  await app.boot();
  await app.start();

  const client = createRestAppClient(app);

  return {app, client};
}

export interface AppWithClient {
  app: RelayApplication;
  client: Client;
}
