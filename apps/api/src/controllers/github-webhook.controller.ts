import {inject, service} from '@loopback/core';
import {post, requestBody, Request, RestBindings} from '@loopback/rest';
import {GithubWebhookService} from '../services';

export class GithubWebhookController {
  constructor(
    @service(GithubWebhookService) private webhooks: GithubWebhookService,
  ) {}

  @post('/api/github/webhooks', {
    responses: {
      '200': {
        description: 'Delivery durably recorded or already received',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {duplicate: {type: 'boolean'}},
            },
          },
        },
      },
      '400': {description: 'Invalid delivery headers or JSON payload'},
      '401': {description: 'Missing or invalid GitHub signature'},
      '413': {description: 'Payload exceeds 25 MB'},
      '415': {description: 'Only uncompressed application/json is supported'},
      '503': {description: 'Webhook secret is not configured'},
    },
  })
  receive(
    @requestBody({
      required: true,
      content: {'application/json': {'x-parser': 'raw'}},
    })
    body: Buffer,
    @inject(RestBindings.Http.REQUEST) request: Request,
  ): Promise<{duplicate: boolean}> {
    console.log('webhook!');
    const signature = request.get('X-Hub-Signature-256');
    const deliveryId = request.get('X-GitHub-Delivery');
    const eventType = request.get('X-GitHub-Event');

    return this.webhooks.receive(body, signature, deliveryId, eventType);
  }
}
