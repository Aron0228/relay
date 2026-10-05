import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {OAuthTransaction} from '../../models';

export const OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY =
  'repositories.OAuthTransactionRepository';

export class OAuthTransactionRepository extends DefaultCrudRepository<
  OAuthTransaction,
  typeof OAuthTransaction.prototype.state
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY)
    postgresDataSource: PostgresDataSource,
  ) {
    super(OAuthTransaction, postgresDataSource);
  }

  async consume(state: string): Promise<OAuthTransaction | null> {
    const {rows} = (await this.dataSource.execute(
      `DELETE FROM auth.oauth_transaction
       WHERE state = $1 AND expires_at > CURRENT_TIMESTAMP
       RETURNING state, code_verifier AS "codeVerifier", client_type AS "clientType",
                 redirect_uri AS "redirectUri", created_at AS "createdAt", expires_at AS "expiresAt"`,
      [state],
    )) as {rows: OAuthTransaction[]};

    return rows[0] ? new OAuthTransaction(rows[0]) : null;
  }
}
