import {Getter, inject} from '@loopback/core';
import {
  BelongsToAccessor,
  DefaultTransactionalRepository,
  repository,
} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {Run, Task} from '../../models';
import {TaskRepository} from './task.repository';

export const RUN_REPOSITORY_BINDING_KEY = 'repositories.RunRepository';

export class RunRepository extends DefaultTransactionalRepository<
  Run,
  typeof Run.prototype.id
> {
  readonly task: BelongsToAccessor<Task, string>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
    @repository.getter(TaskRepository) taskGetter: Getter<TaskRepository>,
  ) {
    super(Run, dataSource);

    this.task = this.createBelongsToAccessorFor('task', taskGetter);
  }
}
