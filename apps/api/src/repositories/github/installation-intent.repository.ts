import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {InstallationIntent} from '../../models';

export const INSTALLATION_INTENT_REPOSITORY_BINDING_KEY =
  'repositories.InstallationIntentRepository';

export class InstallationIntentRepository extends DefaultCrudRepository<
  InstallationIntent,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(InstallationIntent, dataSource);
  }

  async consume(stateHash: string): Promise<InstallationIntent | null> {
    const rows = (await this.dataSource.execute(
      `WITH consumed AS (
         DELETE FROM github.installation_intent WHERE state_hash = $1 AND expires_at > now()
         RETURNING state_hash AS "stateHash", workspace_id AS "workspaceId", user_id AS "userId", expires_at AS "expiresAt"
       ) SELECT * FROM consumed`,
      [stateHash],
    )) as Partial<InstallationIntent>[];

    return rows.length ? new InstallationIntent(rows[0]) : null;
  }
}
