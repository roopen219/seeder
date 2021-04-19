interface EntityConstraint {
  primaryKey: Array<string>;
  unique: Array<string | Array<string>>;
}

export default EntityConstraint;
