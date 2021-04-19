import EntityField from './EntityField';
import EntityConstraint from './EntityConstraint';

interface Entity {
  fields: Record<string, EntityField>;
  constraints?: EntityConstraint;
  count?: number;
}

export default Entity;
