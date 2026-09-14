import {BootMixin} from '@loopback/boot';
import {ApplicationConfig} from '@loopback/core';
import {
  RestExplorerBindings,
  RestExplorerComponent,
} from '@loopback/rest-explorer';
import {RestApplication} from '@loopback/rest';
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

export {ApplicationConfig};

export class RelayApplication extends BootMixin(
  RepositoryMixin(RestApplication),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);

    // Set up the custom sequence
    this.sequence(MySequence);

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
    };

    this.dataSource(PostgresDataSource, 'postgres');
  }
}
