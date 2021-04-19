import Entity from './Entity';
import {
  chain,
  each,
  flatten,
  includes,
  isEmpty,
  keys,
  map,
  reduce,
  times,
  join,
  random,
} from 'lodash';
import stringify from 'fast-safe-stringify';
import { isReferenceEntityField } from './ReferenceEntityField';
import SeederConfig from './SeederConfig';
import { knex, Knex } from 'knex';
import deepmerge from 'deepmerge';
import { seed } from 'faker';
import SeederEntity, { SeederRecord } from './SeederEntity';
import SeederEntityStore from './SeederEntityStore';
import fs from 'fs/promises';
import { parallel, series } from 'asyncro';
import ora from 'ora';

class Seeder {
  private knex: Knex<any, unknown[]>;
  private schema: Record<string, Entity>;
  private iterations: number;
  private continuousIterations: number;
  private entities: Record<string, Entity>;
  private dependencyQueue: Array<Array<{ name: string; entity: Entity }>>;
  private seed: number | null;
  private seederEntities: SeederEntityStore;
  private dbType: string;
  private ora: ora.Ora;

  constructor(config: SeederConfig) {
    this.knex = knex(config.connectionConfig);
    this.dbType = config.connectionConfig.client;
    this.schema = config.schema;
    this.iterations = config.iterations ?? 1;
    this.continuousIterations = config.continuousIterations ?? 0;
    this.seed = config.seed ?? null;
    this.parseSchema();
    console.log(
      'Dependency queue: ',
      map(this.dependencyQueue, (queue) => map(queue, 'name'))
    );
    this.createSeederEntities();
    if (this.seed) {
      seed(this.seed);
    }
    this.ora = ora('Seeder...').start();
  }

  async start(): Promise<void> {
    this.ora.text = 'Creating tables...';
    await this.createTables();
    this.ora.succeed('Tables created');
    this.ora.start('Starting iterations');
    await this.seedInitialData(this.iterations);
    this.ora.start('Starting iterations');
    await this.seedContinuousData(this.continuousIterations);
    void this.knex.destroy();
    this.ora.stop();
  }

  async seedInitialData(count: number): Promise<void> {
    this.ora.text = `Initial seeding of tables, pending iterations: ${count}`;
    each(this.dependencyQueue, (entities) => {
      each(entities, ({ name, entity }) => {
        times(entity.count || 0, () => this.seederEntities[name].generate());
      });
    });
    await this.flushToTables();
    this.resetRecords();
    if (count) {
      return this.seedInitialData(--count);
    }
    this.ora.succeed(
      `Initial seed complete: ${join(
        map(flatten(this.dependencyQueue), 'name'),
        ', '
      )}`
    );
    return;
  }

  async seedContinuousData(
    count: number,
    updateQueue: SeederRecord[] = [],
    deleteQueue: SeederRecord[] = []
  ): Promise<void> {
    this.ora.text = `Continuous seeding of tables, pending iterations: ${count}`;
    let breakIteration = false;
    each(this.dependencyQueue, (entities) => {
      if (!breakIteration) {
        each(entities, ({ name, entity }) => {
          const hasCountCriteria = !!entity.count;
          const entityCount = hasCountCriteria ? random(0, 5) : 0;
          if (hasCountCriteria && !entityCount) {
            breakIteration = true; // dont generate dependent entities further down
          }
          times(entityCount, () => {
            const seederRecord = this.seederEntities[name].generate();
            const rand = Math.random();
            if (rand <= 0.3) {
              updateQueue.push(seederRecord);
            } else if (rand >= 0.7) {
              deleteQueue.push(seederRecord);
            }
          });
        });
      }
    });
    await this.flushToTables();
    this.resetRecords();
    if (count) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.seedContinuousData(--count, updateQueue, deleteQueue);
    }
    this.ora.succeed(
      `Continuous seed complete: ${join(
        map(flatten(this.dependencyQueue), 'name'),
        ', '
      )}`
    );
    return;
  }

  resetRecords() {
    each(flatten(this.dependencyQueue), ({ name }) => {
      this.seederEntities[name].resetRecords();
    });
  }

  flushToTables() {
    return series(
      map(this.dependencyQueue, (entities) => () => {
        return parallel(
          map(entities, ({ name }) => () => {
            return this.seederEntities[name].flushToTable();
          })
        );
      })
    );
  }

  createTables() {
    return series(
      map(this.dependencyQueue, (entities) => () => {
        return parallel(
          map(entities, ({ name }) => () => {
            return this.seederEntities[name].createTable();
          })
        );
      })
    );
  }

  async saveToFile(): Promise<void> {
    await Promise.all(
      map(this.seederEntities, (entity, name) => {
        return fs.writeFile(
          `./${name}.json`,
          stringify(entity.getRecords()),
          'utf-8'
        );
      })
    );
  }
  createSeederEntities(): void {
    this.seederEntities = {};
    each(this.entities, (entity, name) => {
      this.seederEntities[name] = new SeederEntity(
        name,
        entity,
        this.dbType,
        this.knex,
        this.seederEntities
      );
    });
  }
  parseSchema(): void {
    this.entities = Seeder.getNormalizedEntitiesFromSchema(this.schema);
    this.dependencyQueue = Seeder.getEntityDependencyQueueFromSchema(
      this.entities
    );
  }
  static generateDependencyQueue(
    entities: Record<string, Entity>,
    result: Array<Array<{ name: string; entity: Entity }>>
  ): Array<Array<{ name: string; entity: Entity }>> {
    const entitiesForNextIteration: Record<string, Entity> = {};
    const dependenciesToPush: Array<{ name: string; entity: Entity }> = [];
    if (isEmpty(entities)) {
      return result;
    }
    const entityNames = keys(entities);
    const allExistingDependencies = map(flatten(result), 'name');
    each(entities, (entity, name) => {
      const dependencies = chain(entity.fields)
        .filter((field) => {
          return (
            (isReferenceEntityField(field) &&
              field.referenceType.startsWith('belong') &&
              field.entity !== name &&
              includes(entityNames, field.entity)) ||
            (isReferenceEntityField(field) && field.referenceType === 'hasOne')
          );
        })
        .map('entity')
        .value();
      if (
        chain(dependencies)
          .difference(allExistingDependencies)
          .isEmpty()
          .value()
      ) {
        dependenciesToPush.push({ name, entity });
      } else {
        entitiesForNextIteration[name] = entity;
      }
    });
    if (!isEmpty(dependenciesToPush)) {
      result.push(dependenciesToPush);
    }
    return Seeder.generateDependencyQueue(entitiesForNextIteration, result);
  }
  static getEntityDependencyQueueFromSchema(
    entities: Record<string, Entity>
  ): Array<Array<{ name: string; entity: Entity }>> {
    return Seeder.generateDependencyQueue(entities, []);
  }

  static getNormalizedEntitiesFromSchema(
    entities: Record<string, Entity>
  ): Record<string, Entity> {
    const normalizedEntities: Record<string, Entity> = {};
    each(entities, (entity, name) => {
      normalizedEntities[name] = deepmerge(normalizedEntities[name], entity);
      const primaryKey: Array<string> = entity.constraints?.primaryKey || [];
      each(entity.fields, (field) => {
        if (isReferenceEntityField(field) && field.entity !== name) {
          const referenceType = field.referenceType;
          const referenceEntity = field.entity;
          const referenceField = field.field;
          const referenceOnDelete = field.onDelete;

          if (
            referenceType === 'belongsToMany' ||
            referenceType === 'hasMany'
          ) {
            normalizedEntities[`${referenceEntity}_${name}`] = deepmerge(
              normalizedEntities[`${referenceEntity}_${name}`],
              {
                fields: {
                  [`${referenceEntity}_${referenceField}`]: {
                    type: 'reference',
                    referenceType: 'belongsToOne',
                    entity: referenceEntity,
                    field: referenceField,
                    onDelete: referenceOnDelete,
                  },
                  ...reduce(
                    primaryKey,
                    (acc, field) => {
                      acc[`${name}_${field}`] = {
                        type: 'reference',
                        referenceType: 'belongsToOne',
                        entity: name,
                        field,
                        onDelete: referenceOnDelete,
                      };
                      return acc;
                    },
                    {}
                  ),
                },
              }
            );
          }
        }
      });
    });
    return normalizedEntities;
  }
}

export default Seeder;
