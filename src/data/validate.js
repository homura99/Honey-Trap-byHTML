import { parseDocument } from "yaml";

const PARAMETER_NAMES = new Set(["affection", "stamina", "subscribers"]);
const CONDITION_OPERATORS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);
const IDENTIFIER_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;
const FLAG_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_OPERATORS = new Set(["gt", "gte", "lt", "lte"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseYamlSources(sources, errors, warnings) {
  const parsed = {};

  for (const [sourceName, sourceText] of Object.entries(sources)) {
    if (sourceName === "endingScenarios") {
      parsed.endingScenarios = {};
      for (const [scenarioPath, scenarioText] of Object.entries(sourceText)) {
        parsed.endingScenarios[scenarioPath] = parseYamlSource(
          scenarioText,
          `data/endings/${scenarioPath}`,
          errors,
          warnings,
        );
      }
      continue;
    }

    parsed[sourceName] = parseYamlSource(sourceText, sourceName, errors, warnings);
  }

  return parsed;
}

function parseYamlSource(sourceText, sourceName, errors, warnings) {
  const document = parseDocument(sourceText, { uniqueKeys: true, version: "1.2" });
  for (const error of document.errors) {
    errors.push(`${sourceName}: ${error.message}`);
  }
  for (const warning of document.warnings) {
    warnings.push(`${sourceName}: ${warning.message}`);
  }

  return document.errors.length === 0 ? document.toJS() : null;
}

function validateCondition(condition, path, errors) {
  if (!isRecord(condition)) {
    errors.push(`${path}: condition must be an object.`);
    return;
  }

  const groupKeys = ["all", "any"].filter((key) => key in condition);
  const leafKeys = ["parameter", "flag"].filter((key) => key in condition);
  const allowedKeys = groupKeys.length > 0
    ? new Set(["all", "any"])
    : new Set(["parameter", "flag", "operator", "value"]);
  for (const key of Object.keys(condition)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}: unexpected condition field "${key}".`);
    }
  }

  if ((groupKeys.length === 0 && leafKeys.length !== 1) ||
    (groupKeys.length > 0 && leafKeys.length > 0)) {
    errors.push(`${path}: condition must be an all/any group or a parameter/flag condition.`);
    return;
  }

  if (groupKeys.length > 0) {
    for (const groupKey of groupKeys) {
      const group = condition[groupKey];
      if (!Array.isArray(group) || group.length === 0) {
        errors.push(`${path}.${groupKey}: expected a non-empty array of conditions.`);
        continue;
      }
      group.forEach((child, index) =>
        validateCondition(child, `${path}.${groupKey}[${index}]`, errors),
      );
    }
    return;
  }

  const subjectKey = leafKeys[0];
  const subject = condition[subjectKey];
  if (subjectKey === "parameter" && !PARAMETER_NAMES.has(subject)) {
    errors.push(`${path}: invalid parameter name "${String(subject)}".`);
  }
  if (subjectKey === "flag" && (typeof subject !== "string" || !FLAG_PATTERN.test(subject))) {
    errors.push(`${path}: invalid flag name.`);
  }

  const { operator, value } = condition;
  if (!CONDITION_OPERATORS.has(operator)) {
    errors.push(`${path}: invalid condition operator "${String(operator)}".`);
    return;
  }
  if (!("value" in condition)) {
    errors.push(`${path}: condition value is required.`);
    return;
  }
  if (operator === "in" && (!Array.isArray(value) || value.length === 0)) {
    errors.push(`${path}: "in" requires a non-empty array value.`);
  } else if (operator !== "in" && Array.isArray(value)) {
    errors.push(`${path}: operator "${operator}" does not accept an array value.`);
  }
  if (NUMERIC_OPERATORS.has(operator) && typeof value !== "number") {
    errors.push(`${path}: operator "${operator}" requires a numeric value.`);
  }
  if (subjectKey === "parameter" && operator === "in" && Array.isArray(value) &&
    value.some((entry) => typeof entry !== "number")) {
    errors.push(`${path}: parameter conditions require numeric values.`);
  }
  if (subjectKey === "parameter" && operator !== "in" && typeof value !== "number") {
    errors.push(`${path}: parameter conditions require a numeric value.`);
  }
  if (subjectKey === "flag") {
    const values = operator === "in" ? value : [value];
    if (Array.isArray(values) && values.some((entry) =>
      !["boolean", "number", "string"].includes(typeof entry))) {
      errors.push(`${path}: flag conditions require scalar values.`);
    }
  }
}

function validateDialogue(dialogue, path, errors) {
  if (!Array.isArray(dialogue) || dialogue.length === 0) {
    errors.push(`${path}: expected a non-empty dialogue array.`);
    return;
  }

  dialogue.forEach((line, index) => {
    if (!isRecord(line) || typeof line.speaker !== "string" || !line.speaker.trim() ||
      typeof line.text !== "string" || !line.text.trim()) {
      errors.push(`${path}[${index}]: speaker and text are required.`);
    }
  });
}

function validateEffects(effects, path, errors) {
  if (!isRecord(effects) || !isRecord(effects.parameterChanges) || !isRecord(effects.flagChanges)) {
    errors.push(`${path}: parameterChanges and flagChanges objects are required.`);
    return;
  }

  for (const [parameter, amount] of Object.entries(effects.parameterChanges)) {
    if (!PARAMETER_NAMES.has(parameter)) {
      errors.push(`${path}: invalid parameter name "${parameter}".`);
    }
    if (typeof amount !== "number") {
      errors.push(`${path}.${parameter}: parameter changes must be numeric.`);
    }
  }
  for (const [flag, value] of Object.entries(effects.flagChanges)) {
    if (!FLAG_PATTERN.test(flag) || !["boolean", "string", "number"].includes(typeof value)) {
      errors.push(`${path}: flag changes require valid flag names and scalar values.`);
    }
  }
}

function validateStages(stages, errors) {
  if (!isRecord(stages) || !Array.isArray(stages.stages)) {
    errors.push("data/stages.yaml: stages must be an array.");
    return [];
  }

  if (stages.stages.length !== 52) {
    errors.push(`data/stages.yaml: expected 52 stages, found ${stages.stages.length}.`);
  }

  const ids = new Set();
  stages.stages.forEach((stage, index) => {
    const path = `data/stages.yaml: stages[${index}]`;
    if (!isRecord(stage)) {
      errors.push(`${path}: stage must be an object.`);
      return;
    }

    for (const key of ["id", "number", "title", "startDate", "endDate"]) {
      if (!(key in stage)) {
        errors.push(`${path}: missing required field "${key}".`);
      }
    }
    if (typeof stage.id !== "string" || !IDENTIFIER_PATTERN.test(stage.id)) {
      errors.push(`${path}: invalid stage ID.`);
    } else if (ids.has(stage.id)) {
      errors.push(`${path}: duplicate stage ID "${stage.id}".`);
    } else {
      ids.add(stage.id);
    }
    if (stage.number !== index + 1) {
      errors.push(`${path}: number must be ${index + 1}.`);
    }
    if (typeof stage.title !== "string" || !stage.title.trim()) {
      errors.push(`${path}: title must be a non-empty string.`);
    }
    if (!isDate(stage.startDate) || !isDate(stage.endDate) || stage.startDate > stage.endDate) {
      errors.push(`${path}: startDate and endDate must be valid ordered YYYY-MM-DD dates.`);
    }
  });

  return [...ids];
}

function validateEndings(indexData, scenarioSources, errors, warnings) {
  if (!isRecord(indexData) || !Array.isArray(indexData.endings)) {
    errors.push("data/endings/index.yaml: endings must be an array.");
    return new Set();
  }

  const ids = new Set();
  const referencedScenarios = new Set();
  indexData.endings.forEach((ending, index) => {
    const path = `data/endings/index.yaml: endings[${index}]`;
    if (!isRecord(ending)) {
      errors.push(`${path}: ending must be an object.`);
      return;
    }
    for (const key of ["id", "title", "scenario"]) {
      if (!(key in ending)) {
        errors.push(`${path}: missing required field "${key}".`);
      }
    }
    if (typeof ending.id !== "string" || !IDENTIFIER_PATTERN.test(ending.id)) {
      errors.push(`${path}: invalid ending ID.`);
    } else if (ids.has(ending.id)) {
      errors.push(`${path}: duplicate ending ID "${ending.id}".`);
    } else {
      ids.add(ending.id);
    }
    if (typeof ending.title !== "string" || !ending.title.trim()) {
      errors.push(`${path}: title must be a non-empty string.`);
    }
    if (typeof ending.scenario !== "string" || !(ending.scenario in scenarioSources)) {
      errors.push(`${path}: scenario "${String(ending.scenario)}" does not exist.`);
    } else {
      referencedScenarios.add(ending.scenario);
      const scenario = scenarioSources[ending.scenario];
      if (!isRecord(scenario) || scenario.endingId !== ending.id) {
        errors.push(`${path}: scenario endingId must match "${ending.id}".`);
      } else {
        validateDialogue(scenario.dialogue, `data/endings/${ending.scenario}: dialogue`, errors);
      }
    }
  });

  for (const scenarioPath of Object.keys(scenarioSources)) {
    if (!referencedScenarios.has(scenarioPath)) {
      warnings.push(`data/endings/${scenarioPath}: scenario is not listed in the ending index.`);
    }
  }

  return ids;
}

function validateEvents(eventData, stageIds, endingIds, errors, warnings) {
  if (!isRecord(eventData) || !Array.isArray(eventData.events)) {
    errors.push("data/events.yaml: events must be an array.");
    return;
  }

  const eventIds = new Set();
  for (const [index, event] of eventData.events.entries()) {
    const path = `data/events.yaml: events[${index}]`;
    if (!isRecord(event)) {
      errors.push(`${path}: event must be an object.`);
      continue;
    }
    for (const key of [
      "id", "stageId", "type", "priority", "probability", "repeatPolicy",
      "condition", "dialogue", "choices", "relatedEndingIds", "deferPolicy",
    ]) {
      if (!(key in event)) {
        errors.push(`${path}: missing required field "${key}".`);
      }
    }
    if (typeof event.id !== "string" || !IDENTIFIER_PATTERN.test(event.id)) {
      errors.push(`${path}: invalid event ID.`);
    } else if (eventIds.has(event.id)) {
      errors.push(`${path}: duplicate event ID "${event.id}".`);
    } else {
      eventIds.add(event.id);
    }
    if (typeof event.stageId !== "string" || !stageIds.has(event.stageId)) {
      errors.push(`${path}: stage "${String(event.stageId)}" does not exist.`);
    }
    if (typeof event.type !== "string" || !event.type.trim()) {
      errors.push(`${path}: type must be a non-empty string.`);
    }
    if (!Number.isInteger(event.priority)) {
      errors.push(`${path}: priority must be an integer.`);
    }
    if (typeof event.probability !== "number" || event.probability < 0 || event.probability > 1) {
      errors.push(`${path}: probability must be between 0 and 1.`);
    } else if (event.probability === 0) {
      warnings.push(`${path}: probability is zero, so this event cannot occur.`);
    }
    if (!isRecord(event.repeatPolicy) ||
      !["once", "repeat", "cooldown"].includes(event.repeatPolicy.mode)) {
      errors.push(`${path}: repeatPolicy.mode must be once, repeat, or cooldown.`);
    } else if (event.repeatPolicy.mode === "cooldown" &&
      (!Number.isInteger(event.repeatPolicy.cooldownStages) || event.repeatPolicy.cooldownStages < 1)) {
      errors.push(`${path}: cooldown policy requires a positive cooldownStages value.`);
    }

    validateCondition(event.condition, `${path}.condition`, errors);
    validateDialogue(event.dialogue, `${path}.dialogue`, errors);
    if (!Array.isArray(event.choices)) {
      errors.push(`${path}: choices must be an array.`);
    } else {
      const choiceIds = new Set();
      event.choices.forEach((choice, choiceIndex) => {
        const choicePath = `${path}.choices[${choiceIndex}]`;
        if (!isRecord(choice) || typeof choice.id !== "string" ||
          typeof choice.text !== "string" || !choice.text.trim()) {
          errors.push(`${choicePath}: choice id and text are required.`);
          return;
        }
        if (!IDENTIFIER_PATTERN.test(choice.id)) {
          errors.push(`${choicePath}: invalid choice ID.`);
        }
        if (choiceIds.has(choice.id)) {
          errors.push(`${choicePath}: duplicate choice ID "${choice.id}".`);
        }
        choiceIds.add(choice.id);
        validateEffects(choice.effects, `${choicePath}.effects`, errors);
      });
    }

    if (!Array.isArray(event.relatedEndingIds)) {
      errors.push(`${path}: relatedEndingIds must be an array.`);
    } else {
      for (const endingId of event.relatedEndingIds) {
        if (!endingIds.has(endingId)) {
          errors.push(`${path}: ending "${String(endingId)}" does not exist.`);
        }
      }
    }

    if (!isRecord(event.deferPolicy) || typeof event.deferPolicy.enabled !== "boolean") {
      errors.push(`${path}: deferPolicy.enabled must be a boolean.`);
    } else if (event.deferPolicy.enabled) {
      validateCondition(event.deferPolicy.retryCondition, `${path}.deferPolicy.retryCondition`, errors);
    } else if (event.deferPolicy.retryCondition !== undefined) {
      validateCondition(event.deferPolicy.retryCondition, `${path}.deferPolicy.retryCondition`, errors);
    }
  }

  for (const [index, event] of eventData.events.entries()) {
    if (!isRecord(event)) {
      continue;
    }
    const targets = [
      event.nextEventId,
      ...(Array.isArray(event.choices)
        ? event.choices.filter(isRecord).map((choice) => choice.nextEventId)
        : []),
    ].filter((target) => target !== undefined);
    for (const target of targets) {
      if (typeof target !== "string" || !eventIds.has(target)) {
        errors.push(`data/events.yaml: events[${index}]: event "${String(target)}" does not exist.`);
      }
    }
  }
}

export function loadGameData(sources) {
  const errors = [];
  const warnings = [];
  const parsed = parseYamlSources(sources, errors, warnings);

  if (errors.length === 0) {
    const stageIds = new Set(validateStages(parsed["data/stages.yaml"], errors));
    const endingIds = validateEndings(
      parsed["data/endings/index.yaml"],
      parsed.endingScenarios ?? {},
      errors,
      warnings,
    );
    validateEvents(parsed["data/events.yaml"], stageIds, endingIds, errors, warnings);
  }

  return {
    data: errors.length === 0 ? parsed : null,
    errors,
    warnings,
  };
}
