import Entity from './Entity';

interface SeederConfig {
  connectionConfig: {
    client: string;
    connection: {
      database: string;
      [prop: string]: unknown;
    };
  };
  seed?: number;
  iterations?: number;
  continuousIterations?: number;
  schema: Record<string, Entity>;
}

export default SeederConfig;
