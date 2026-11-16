import {BootMixin} from '@loopback/boot';
import {
  AuthenticationComponent,
  registerAuthenticationStrategy,
} from '@loopback/authentication';
import {
  AuthorizationBindings,
  AuthorizationComponent,
  AuthorizationDecision,
} from '@loopback/authorization';
import {ApplicationConfig, CoreBindings} from '@loopback/core';
import {
  RestExplorerBindings,
  RestExplorerComponent,
} from '@loopback/rest-explorer';
import {RestApplication, RestBindings} from '@loopback/rest';
import {RepositoryMixin} from '@loopback/repository';
import path from 'path';
import {MySequence} from './sequence';
import * as dotenv from 'dotenv';

// We need to call dotenv.config() before we import the PostgresDataSource
// Since it reads environment variables, and if we were to import it
// Before calling dotenv.config(), it would not have access
// To the environment variables defined in the .env file.
dotenv.config();

import {PostgresDataSource} from './datasources/postgres.datasource';
import {SessionStrategy} from './strategies';
import {
  IAM_AUTHORIZER_BINDING_KEY,
  IAM_POLICY_ENGINE_BINDING_KEY,
  IamAuthorizerProvider,
  IamPolicyEngine,
} from './authorization';

export {ApplicationConfig};

export class RelayApplication extends BootMixin(
  RepositoryMixin(RestApplication),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);

    // Set up the custom sequence
    this.sequence(MySequence);

    this.bind(CoreBindings.LIFE_CYCLE_OBSERVER_OPTIONS).to({
      orderedGroups: ['datasource', 'redis', 'worker', 'server'],
      parallel: false,
    });

    this.bind(RestBindings.REQUEST_BODY_PARSER_OPTIONS).to({
      raw: {limit: '25mb', inflate: false},
    });

    this.component(AuthenticationComponent);
    registerAuthenticationStrategy(this, SessionStrategy);

    this.configure(AuthorizationBindings.COMPONENT).to({
      defaultDecision: AuthorizationDecision.DENY,
      precedence: AuthorizationDecision.DENY,
    });
    this.component(AuthorizationComponent);
    this.bind(IAM_POLICY_ENGINE_BINDING_KEY).to(new IamPolicyEngine());
    this.bind(IAM_AUTHORIZER_BINDING_KEY).toProvider(IamAuthorizerProvider);

    // Set up default home page
    this.static('/', path.join(__dirname, '../public'));

    // Customize @loopback/rest-explorer configuration here
    this.configure(RestExplorerBindings.COMPONENT).to({
      path: '/explorer',
    });
    this.component(RestExplorerComponent);

    this.projectRoot = __dirname;
    // Customize @loopback/boot Booter Conventions here
    this.bootOptions = {
      controllers: {
        // Customize ControllerBooter Conventions here
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
      services: {
        dirs: ['services'],
        extensions: ['.service.js'],
        nested: true,
      },
    };

    this.dataSource(PostgresDataSource, 'postgres');
  }
}
