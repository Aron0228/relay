import {inject, LifeCycleObserver, lifeCycleObserver} from '@loopback/core';
import {juggler} from '@loopback/repository';

export const POSTGRES_CONFIG_BINDING_KEY = 'datasources.config.postgres';
export const POSTGRES_DATASOURCE_BINDING_KEY = 'datasources.postgres';

const config = {
  name: 'postgres',
  connector: 'postgresql',
  url:
    process.env.POSTGRES_URL ?? 'postgres://postgres:postgres@localhost/relay',
};

// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
@lifeCycleObserver('datasource')
export class PostgresDataSource
  extends juggler.DataSource
  implements LifeCycleObserver
{
  static dataSourceName = 'postgres';
  static readonly defaultConfig = config;

  constructor(
    @inject(POSTGRES_CONFIG_BINDING_KEY, {optional: true})
    dsConfig: object = config,
  ) {
    super(dsConfig);
  }
}
