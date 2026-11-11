import {BindingScope, injectable, service} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {positiveInteger} from '../ai/config';
import {
  CommandReplyRepository,
  GithubInstallationRepository,
  GithubRepositoryRepository,
} from '../repositories';
import {GithubAppService} from './github-app.service';

export const GITHUB_COMMAND_REPLY_SERVICE_BINDING_KEY =
  'services.GithubCommandReplyService';
const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const actor = z.object({id: githubId, type: z.literal('User')});
const relayComment = z.object({
  action: z.literal('created'),
  installation: z.object({id: githubId}),
  repository: z.object({id: githubId}),
  issue: z.object({number: z.number().int().positive().max(2147483647)}),
  comment: z.object({
    id: githubId,
    body: z.string().refine(value => /\brelay\b/i.test(value)),
    user: actor,
  }),
  sender: actor,
});

@injectable({scope: BindingScope.SINGLETON})
export class GithubCommandReplyService {
  private readonly maxAttempts = positiveInteger(
    'GITHUB_FEEDBACK_MAX_ATTEMPTS',
    5,
  );

  constructor(
    @repository(CommandReplyRepository) private replies: CommandReplyRepository,
    @repository(GithubInstallationRepository)
    private installations: GithubInstallationRepository,
    @repository(GithubRepositoryRepository)
    private repositories: GithubRepositoryRepository,
    @service(GithubAppService) private github: GithubAppService,
  ) {}

  async reply(payload: object, reason?: string): Promise<boolean> {
    if (process.env.GITHUB_FEEDBACK_ENABLED === 'false') return false;

    const parsed = relayComment.safeParse(payload);

    if (
      !parsed.success ||
      parsed.data.sender.id !== parsed.data.comment.user.id
    )
      return false;

    const source = parsed.data;
    const installation = await this.installations.findOne({
      where: {
        githubId: source.installation.id,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });

    if (!installation) return false;

    const linked = await this.repositories.findOne({
      where: {
        githubId: source.repository.id,
        installationId: installation.id,
        workspaceId: installation.workspaceId,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });

    if (!linked) return false;

    const marker = `<!-- relay-command:${source.comment.id} -->`;
    const explanation = reason
      ?.replace(/[\\`*_[\]<>]/g, '\\$&')
      .replace(/@/g, '@\u200b')
      .slice(0, 1000);
    const body = [
      marker,
      '## How to start an investigation',
      explanation ??
        'That comment is not a supported command. Post one of the following commands as a separate comment:',
      '**On an Issue:** reproduce the reported problem in the repository’s default test environment.',
      '```text\nrelay run\n```',
      '**On a pull request:** check the fix at the supplied preview address.',
      '```text\nrelay verify https://example-url.com/\n```',
      'The preview address must be allowed by an environment assigned to this repository. Both commands require workspace membership.',
    ].join('\n\n');
    await this.replies.execute(
      `INSERT INTO github.command_reply (source_comment_id, repository_id, number, body)
      VALUES ($1, $2, $3, $4) ON CONFLICT (source_comment_id) DO NOTHING`,
      [source.comment.id, linked.id, source.issue.number, body],
    );
    const reply = await this.replies.findOne({
      where: {sourceCommentId: source.comment.id},
    });

    if (
      !reply ||
      reply.status === 'sent' ||
      (reply.status === 'failed' && reply.attempts >= this.maxAttempts)
    )
      return true;

    const token = randomUUID();
    const claimed = (await this.replies.execute(
      `WITH claimed AS (UPDATE github.command_reply SET status = 'sending',
      lease_token = $2, lease_expires_at = now() + interval '2 minutes', attempts = attempts + 1
      WHERE id = $1 AND ((status IN ('pending', 'failed') AND attempts < $3)
        OR (status = 'sending' AND lease_expires_at <= now())) RETURNING id) SELECT id FROM claimed`,
      [reply.id, token, this.maxAttempts],
    )) as {id: string}[];

    if (!claimed.length)
      throw new HttpErrors.ServiceUnavailable(
        'Command usage reply is already being delivered',
      );

    const current = await this.replies.findById(reply.id);
    let attemptedPost = false;

    try {
      let commentId = await this.github.findTaskComment(
        Number(installation.githubId),
        Number(linked.githubId),
        current.number,
        marker,
      );

      if (!commentId) {
        if (current.attempts > this.maxAttempts)
          throw new Error('Command reply delivery attempt limit reached');

        const owned = (await this.replies.execute(
          `WITH renewed AS (UPDATE github.command_reply
          SET lease_expires_at = now() + interval '2 minutes'
          WHERE id = $1 AND lease_token = $2 AND lease_expires_at > now() RETURNING id)
          SELECT id FROM renewed`,
          [current.id, token],
        )) as {id: string}[];

        if (!owned.length)
          throw new HttpErrors.ServiceUnavailable(
            'Command reply delivery lease expired',
          );

        attemptedPost = true;
        commentId = (
          await this.github.createComment(
            Number(installation.githubId),
            Number(linked.githubId),
            current.number,
            current.body,
          )
        ).githubId;
      }
      await this.replies.updateAll(
        {status: 'sent', commentId, leaseToken: null, leaseExpiresAt: null},
        {id: current.id, leaseToken: token},
      );
    } catch (error) {
      const status = (error as {statusCode?: number}).statusCode;
      const permanent =
        status !== undefined && [400, 401, 403, 404, 409, 422].includes(status);
      const reconcile =
        attemptedPost && !permanent && current.attempts === this.maxAttempts;
      await this.replies.updateAll(
        {
          status: reconcile ? 'sending' : 'failed',
          attempts: permanent ? this.maxAttempts : current.attempts,
          leaseToken: reconcile ? token : null,
          leaseExpiresAt: reconcile ? new Date(Date.now() + 15000) : null,
          error: (error as Error).message.slice(0, 2000),
        },
        {id: current.id, leaseToken: token},
      );

      if (reconcile || (!permanent && current.attempts < this.maxAttempts))
        throw error;
    }

    return true;
  }
}
