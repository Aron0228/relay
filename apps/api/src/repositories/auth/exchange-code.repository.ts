import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {ExchangeCode} from '../../models';

export const EXCHANGE_CODE_REPOSITORY_BINDING_KEY =
  'repositories.ExchangeCodeRepository';

export class ExchangeCodeRepository extends DefaultCrudRepository<
  ExchangeCode,
  typeof ExchangeCode.prototype.codeHash
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY)
    postgresDataSource: PostgresDataSource,
  ) {
    super(ExchangeCode, postgresDataSource);
  }

  async consume(codeHash: string): Promise<ExchangeCode | null> {
    const {rows} = (await this.dataSource.execute(
      `DELETE FROM auth.exchange_code
       WHERE code_hash = $1 AND expires_at > CURRENT_TIMESTAMP
       RETURNING code_hash AS "codeHash", user_id AS "userId", client_type AS "clientType",
                 created_at AS "createdAt", expires_at AS "expiresAt"`,
      [codeHash],
    )) as {rows: ExchangeCode[]};

    return rows[0] ? new ExchangeCode(rows[0]) : null;
  }
}
