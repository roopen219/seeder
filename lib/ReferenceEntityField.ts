import EntityField from './EntityField';

interface ReferenceEntityField extends EntityField {
  referenceType: 'hasMany' | 'hasOne' | 'belongsToOne' | 'belongsToMany';
  entity: string;
  field: string;
  count?: {
    min: number;
    max: number;
  };
  onDelete?: 'cascade' | 'null';
  where?: Record<string, unknown>;
}

export function isReferenceEntityField(
  field: EntityField
): field is ReferenceEntityField {
  return field.type === 'reference';
}

export default ReferenceEntityField;
