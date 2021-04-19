import Entity from './Entity';

interface SeederConfig {
  connectionConfig: {
    client: string;
    connection: Record<string, unknown>;
  };
  seed?: number;
  iterations?: number;
  continuousIterations?: number;
  schema: Record<string, Entity>;
}

export default SeederConfig;
