import faker from 'faker';
import {
  castArray,
  each,
  flatten,
  includes,
  invoke,
  join,
  keys,
  map,
  omit,
  pickBy,
  random,
  reduce,
  sample,
  times,
  uniq,
} from 'lodash';
import sift from 'sift';
import Entity from './Entity';
import SeederEntityStore from './SeederEntityStore';
import { isReferenceEntityField } from './ReferenceEntityField';
import EntityField from './EntityField';
import { Knex } from 'knex';
import mapFieldTypeToDbType from './mapFieldTypeToDbType';
import nanoid from 'nanoid';
import format from 'pg-format';

export type SeederRecord = Record<string, unknown>;

class SeederEntity {
  private store: SeederEntityStore;
  private entity: Entity;
  private sequenceCounter: Record<string, number>;
  private name: string;
  private records: Array<SeederRecord>;
  private dbType: string;
  private knex: Knex;
  private dbSchema: string;

  constructor(
    name: string,
    entity: Entity,
    dbType: string,
    knex: Knex,
    seederEntityStore: SeederEntityStore,
    dbSchema: string
  ) {
    this.store = seederEntityStore;
    this.entity = entity;
    this.name = name;
    this.dbType = dbType;
    this.knex = knex;
    this.records = [];
    this.dbSchema = dbSchema;
    this.initSequenceCounter();
  }

  initSequenceCounter(): void {
    this.sequenceCounter = reduce(
      this.entity.fields,
      (acc, field, name) => {
        if (field.type === 'sequence') {
          acc[name] = 1;
        }
        return acc;
      },
      {}
    );
  }

  getFieldDbType(fieldName: string): string {
    const field = this.entity.fields[fieldName];
    if (isReferenceEntityField(field)) {
      return this.store[field.entity].getFieldDbType(field.field);
    }
    return mapFieldTypeToDbType(field.type, this.dbType);
  }

  async deleteTable() {
    if (this.dbType === 'postgres') {
      await this.knex.raw(
        format('drop table if exists %I.%I cascade', this.dbSchema, this.name)
      );
    } else {
      await this.knex.schema
        .withSchema(this.dbSchema)
        .dropTableIfExists(this.name);
    }
  }

  async createTable() {
    await this.knex.schema
      .withSchema(this.dbSchema)
      .createTable(this.name, (table) => {
        each(this.entity.fields, (field, name) => {
          if (
            isReferenceEntityField(field) &&
            (field.referenceType === 'hasMany' ||
              field.referenceType === 'belongsToMany')
          ) {
            return;
          }
          const column = table.specificType(name, this.getFieldDbType(name));
          if (isReferenceEntityField(field)) {
            if (
              field.referenceType === 'belongsToOne' ||
              field.referenceType === 'hasOne'
            ) {
              column.references(`${field.entity}.${field.field}`).notNullable();
              if (field.onDelete) {
                column.onDelete(field.onDelete);
              }
            }
          }
        });
        this.entity.constraints?.primaryKey &&
          table.primary(this.entity.constraints?.primaryKey);
        if (this.entity.constraints?.unique) {
          each(this.entity.constraints.unique, (col) =>
            table.unique(castArray(col))
          );
        }
      });
  }

  flushToTable() {
    return this.knex.batchInsert(this.name, this.records);
  }

  getPrimaryKeyDataForRecord(record: SeederRecord): SeederRecord {
    return reduce(
      this.entity.constraints?.primaryKey,
      (acc, field) => {
        acc[`${this.name}_${field}`] = record[field];
        return acc;
      },
      {}
    );
  }

  getDataForField(
    name: string,
    field: EntityField,
    record: SeederRecord
  ): unknown {
    const types = castArray(field.type);
    const data = map(types, (type) => {
      if (type === 'sequence') {
        return this.sequenceCounter[name]++;
      }
      if (type === 'space') {
        return ' ';
      }
      if (isReferenceEntityField(field)) {
        if (field.referenceType === 'hasOne') {
          const data = this.store[field.entity].generate();
          return data[field.field];
        }
        if (field.referenceType === 'belongsToOne') {
          const data = this.store[field.entity].getRandomRecord();
          return data[field.field];
        }
        if (field.referenceType === 'hasMany') {
          const minCount = field.count?.min || 0;
          const maxCount = field.count?.max || 1;
          const referenceEntitiesToGenerate = random(minCount, maxCount);
          const data = times(referenceEntitiesToGenerate, () =>
            this.store[field.entity].generate()
          );
          each(data, (datum) => {
            this.store[`${field.entity}_${this.name}`].generate({
              [`${field.entity}_${field.field}`]: datum[field.field],
              ...this.getPrimaryKeyDataForRecord(record),
            });
          });
        }
        if (field.referenceType === 'belongsToMany') {
          const minCount = field.count?.min || 0;
          const maxCount = field.count?.max || 1;
          const referenceEntitiesToGenerate = random(minCount, maxCount);
          const data = uniq(
            times(referenceEntitiesToGenerate, () =>
              this.store[field.entity].getRandomRecord()
            )
          );
          each(data, (datum) => {
            this.store[`${field.entity}_${this.name}`].generate({
              [`${field.entity}_${field.field}`]: datum[field.field],
              ...this.getPrimaryKeyDataForRecord(record),
            });
          });
        }
        return '';
      }
      const fakeData = invoke(faker, type) as string;
      return this.isFieldUnique(name) ? nanoid.nanoid(6) + fakeData : fakeData;
    });
    return data.length === 1 ? data[0] : join(data, '');
  }

  isFieldUnique(fieldName: string): boolean {
    return (
      includes(flatten(this.entity.constraints?.unique), fieldName) ||
      includes(flatten(this.entity.constraints?.primaryKey), fieldName)
    );
  }

  generate(prefillData: Record<string, unknown> = {}): SeederRecord {
    const data: SeederRecord = { ...prefillData };
    const fields: Record<string, EntityField> = omit(
      this.entity.fields,
      keys(prefillData)
    );
    const nonReferenceFields = pickBy(
      fields,
      (field) => !isReferenceEntityField(field)
    );
    const referenceFields = pickBy(fields, (fields) =>
      isReferenceEntityField(fields)
    );

    reduce(
      nonReferenceFields,
      (acc, field: EntityField, name) => {
        acc[name] = this.getDataForField(name, field, data);
        return acc;
      },
      data
    );

    reduce(
      referenceFields,
      (acc, field: EntityField, name) => {
        if (
          isReferenceEntityField(field) &&
          (field.referenceType === 'hasMany' ||
            field.referenceType === 'belongsToMany')
        ) {
          this.getDataForField(name, field, data);
          return acc;
        }
        acc[name] = this.getDataForField(name, field, data);
        return acc;
      },
      data
    );

    this.records.push(data);

    return data;
  }

  getRandomRecord(query: Record<string, unknown> = {}): SeederRecord {
    return sample(this.records.filter(sift(query))) || {};
  }

  getRecords(): Array<SeederRecord> {
    return this.records;
  }

  resetRecords(): void {
    this.records = [];
  }
}

export default SeederEntity;
