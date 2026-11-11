import type {Environment, GithubIssue, Task} from '../models';
import {AgentInput} from './types';

function section(body: string, headings: string[]): string | null {
  const block = body.split(/(?=^#{1,6}\s)/m).find(part =>
    headings.includes(
      part
        .split('\n')[0]
        .replace(/^#+\s*/, '')
        .trim()
        .toLowerCase(),
    ),
  );
  const content = block?.split('\n').slice(1).join('\n').trim();

  return content ? content.slice(0, 4000) : null;
}

export function reproductionInput(
  task: Pick<Task, 'issueTitle' | 'issueBody'>,
  issue: Pick<GithubIssue, 'githubId' | 'number' | 'url'>,
  environment: Pick<Environment, 'id' | 'name' | 'baseUrl'>,
): AgentInput {
  const baseUrl = environment.baseUrl;

  if (!baseUrl)
    throw new Error(
      'Issue reproduction requires a concrete environment base URL',
    );

  return {
    prompt:
      'Investigate whether the reported GitHub issue can be reproduced in the configured environment.',
    targetUrl: baseUrl,
    reproduction: {
      issue: {
        id: String(issue.githubId),
        number: issue.number,
        url: issue.url,
        title: task.issueTitle,
        body: task.issueBody,
      },
      environment: {
        id: environment.id,
        name: environment.name,
        baseUrl,
      },
      expectedBehavior: section(task.issueBody, [
        'expected behavior',
        'expected behaviour',
        'elvárt működés',
      ]),
      reportedBehavior: section(task.issueBody, [
        'actual behavior',
        'actual behaviour',
        'reported behavior',
        'tényleges működés',
      ]),
    },
  };
}
