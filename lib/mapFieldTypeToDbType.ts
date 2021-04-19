import PostgresDataTypes from './postgres/PostgresDataTypes';

function mapFieldTypeToDbType(fieldType: string, dbType: string): string {
  switch (dbType) {
    case 'postgres':
      switch (fieldType) {
        case 'sequence':
        case 'random.number':
        case 'internet.port':
          return PostgresDataTypes.INTEGER;
        case 'random.float':
          return PostgresDataTypes.REAL;
        case 'commerce.price':
          return PostgresDataTypes.MONEY;
        case 'commerce.productDescription':
          return `${PostgresDataTypes.VARCHAR}(512)`;
        case 'date.past':
        case 'date.future':
        case 'date.between':
        case 'date.recent':
          return PostgresDataTypes.TIMESTAMP_WITH_TIMEZONE;
        case 'random.boolean':
          return PostgresDataTypes.BOOLEAN;
        default:
          return `${PostgresDataTypes.VARCHAR}(256)`;
      }
    case 'mysql':
    case 'mysql2':
      switch (fieldType) {
        case 'sequence':
        case 'random.number':
        case 'internet.port':
          return 'integer';
        case 'random.float':
          return 'real';
        case 'commerce.productDescription':
          return `varchar(512)`;
        case 'date.past':
        case 'date.future':
        case 'date.between':
        case 'date.recent':
          return 'timestamp';
        case 'random.boolean':
          return 'boolean';
        default:
          return `varchar(256)`;
      }
    default:
      throw new Error('Invalid DB type');
  }
}

export default mapFieldTypeToDbType;
