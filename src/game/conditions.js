function compare(actual, operator, expected) {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
    case "in":
      return expected.includes(actual);
    default:
      throw new RangeError(`Unsupported condition operator "${operator}".`);
  }
}

export function evaluateCondition(condition, state) {
  const groups = [];
  if (Array.isArray(condition.all)) {
    groups.push(condition.all.every((child) => evaluateCondition(child, state)));
  }
  if (Array.isArray(condition.any)) {
    groups.push(condition.any.some((child) => evaluateCondition(child, state)));
  }
  if (groups.length > 0) {
    return groups.every(Boolean);
  }
  if (typeof condition.parameter === "string") {
    return compare(state[condition.parameter], condition.operator, condition.value);
  }
  if (typeof condition.flag === "string") {
    return compare(state.storyFlags[condition.flag], condition.operator, condition.value);
  }

  throw new TypeError("Condition must be an all/any group or a parameter/flag expression.");
}
