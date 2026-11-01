import {BindingScope, injectable} from '@loopback/core';
import {IsolationLevel, repository} from '@loopback/repository';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {positiveInteger} from '../ai/config';
import {RunRepository} from '../repositories';

export const WORKER_CAPACITY_SERVICE_BINDING_KEY =
  'services.WorkerCapacityService';

@injectable({scope: BindingScope.SINGLETON})
export class WorkerCapacityService {
  readonly leaseSeconds = positiveInteger('WORKER_LEASE_SECONDS', 30);
  private readonly globalLimit = positiveInteger('WORKER_GLOBAL_LIMIT', 6);
  private readonly workspaceLimit = positiveInteger(
    'WORKER_WORKSPACE_LIMIT',
    3,
  );
  private readonly workspaceLimits = z
    .record(z.uuid(), z.number().int().positive())
    .parse(JSON.parse(process.env.WORKER_WORKSPACE_LIMITS ?? '{}'));

  constructor(@repository(RunRepository) private runs: RunRepository) {
    if (this.leaseSeconds < 10) {
      throw new Error('WORKER_LEASE_SECONDS must be at least 10');
    }
  }

  async register(queue: string, id: string): Promise<void> {
    await this.runs.execute(
      `INSERT INTO execution.worker_slot (queue_name, run_id)
       VALUES ($1, $2) ON CONFLICT (run_id) DO NOTHING`,
      [queue, id],
    );
  }

  async dispatched(id: string): Promise<void> {
    await this.runs.execute(
      'UPDATE execution.worker_slot SET dispatched_at = clock_timestamp() WHERE run_id = $1',
      [id],
    );
  }

  async undispatched(queue: string): Promise<{id: string}[]> {
    return this.runs.execute(
      `SELECT s.run_id AS id FROM execution.worker_slot s JOIN execution.run r ON r.id = s.run_id
       WHERE s.queue_name = $1 AND s.dispatched_at IS NULL AND r.status = 'queued'
       ORDER BY s.position LIMIT 100`,
      [queue],
    ) as Promise<{id: string}[]>;
  }

  async claim(queue: string, id: string): Promise<string | undefined> {
    const transaction = await this.runs.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};
    const token = randomUUID();

    try {
      await this.runs.execute(
        "SELECT set_config('statement_timeout', '5000', true), set_config('idle_in_transaction_session_timeout', '10000', true)",
        [],
        options,
      );
      await this.runs.execute(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`worker-capacity:${queue}`],
        options,
      );
      const candidates = (await this.runs.execute(
        `SELECT s.run_id AS id FROM execution.worker_slot s
         JOIN execution.run r ON r.id = s.run_id
         WHERE s.queue_name = $1 AND s.token IS NULL
           AND r.status = 'queued' AND NOT r.cancel_requested
           AND (SELECT count(*) FROM execution.worker_slot WHERE queue_name = $1 AND token IS NOT NULL) < $2
           AND (r.workspace_id IS NULL OR
             (SELECT count(*) FROM execution.worker_slot a JOIN execution.run ar ON ar.id = a.run_id
              WHERE a.queue_name = $1 AND a.token IS NOT NULL AND ar.workspace_id = r.workspace_id)
             < COALESCE(($4::jsonb ->> r.workspace_id::text)::integer, $3))
         ORDER BY s.position LIMIT 1 FOR UPDATE OF r`,
        [
          queue,
          this.globalLimit,
          this.workspaceLimit,
          JSON.stringify(this.workspaceLimits),
        ],
        options,
      )) as {id: string}[];

      if (candidates[0]?.id !== id) {
        await transaction.commit();

        return undefined;
      }

      await this.runs.execute(
        `UPDATE execution.worker_slot SET token = $2, expires_at = clock_timestamp() + $3 * interval '1 second' WHERE run_id = $1`,
        [id, token, this.leaseSeconds],
        options,
      );
      await this.runs.updateById(
        id,
        {status: 'running', startedAt: new Date()},
        options,
      );
      await transaction.commit();

      return token;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async renew(id: string, token: string): Promise<boolean> {
    const rows = (await this.runs.execute(
      `WITH renewed AS (
         UPDATE execution.worker_slot SET expires_at = clock_timestamp() + $3 * interval '1 second'
         WHERE run_id = $1 AND token = $2 AND expires_at > clock_timestamp() RETURNING run_id
       ) SELECT run_id AS id FROM renewed`,
      [id, token, this.leaseSeconds],
    )) as {id: string}[];

    return rows.length === 1;
  }

  async release(id: string, token: string): Promise<void> {
    await this.runs.execute(
      'DELETE FROM execution.worker_slot WHERE run_id = $1 AND token = $2',
      [id, token],
    );
  }

  async discardFinished(queue: string): Promise<void> {
    await this.runs.execute(
      `DELETE FROM execution.worker_slot s USING execution.run r
       WHERE s.run_id = r.id AND s.queue_name = $1 AND s.token IS NULL
         AND r.status NOT IN ('queued', 'running')`,
      [queue],
    );
  }

  async expired(queue: string): Promise<{id: string; token: string}[]> {
    return this.runs.execute(
      `SELECT run_id AS id, token FROM execution.worker_slot
       WHERE queue_name = $1 AND expires_at <= clock_timestamp()`,
      [queue],
    ) as Promise<{id: string; token: string}[]>;
  }
}
