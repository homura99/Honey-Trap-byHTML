export function applyEffects(gameData, state, effects, difficulty) {
  const settings = gameData["data/settings.yaml"];
  const changes = effects?.parameterChanges ?? {};
  const flags = effects?.flagChanges ?? {};

  for (const [parameter, amount] of Object.entries(changes)) {
    const adjusted = parameter === "affection"
      ? amount * difficulty.affectionChangeMultiplier
      : amount;
    const definition = settings.parameters[parameter];
    if (!definition || typeof state[parameter] !== "number") {
      throw new RangeError(`Unknown game parameter "${parameter}".`);
    }

    let value = state[parameter] + adjusted;
    if (parameter !== "stamina") {
      value = Math.max(definition.min, value);
    }
    if (typeof definition.max === "number") {
      value = Math.min(definition.max, value);
    }
    if (parameter === "subscribers") {
      value = Math.floor(value);
    }
    state[parameter] = value;
  }

  Object.assign(state.storyFlags, flags);
}

export function getDisplayStamina(gameData, state) {
  const maximum = gameData["data/settings.yaml"].parameters.stamina.max;
  return Math.min(maximum, Math.max(0, state.stamina));
}
