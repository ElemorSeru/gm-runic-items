export function dnd5eVersionAtLeast(major, minor = 0, patch = 0) {
  const parts = String(game.system?.version ?? "0").split(".").map(n => parseInt(n, 10) || 0);
  const a = parts[0] ?? 0, b = parts[1] ?? 0, c = parts[2] ?? 0;
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

const midiChange = key => ({ key, type: "override", value: "1", priority: 20 });

// v12 and v13 store modes as numbers instead
const LEGACY_MODES = { custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 };
const LEGACY_TYPES = Object.fromEntries(Object.entries(LEGACY_MODES).map(([type, mode]) => [mode, type]));

// v14 migrated JSON values handling
function parseChangeValue(value) {
  if (typeof value !== "string" || value === "") return value;
  try {
    return parseChangeValue(JSON.parse(value));
  } catch {
    return value;
  }
}

export function toEffectData(data) {
  const { changes: topChanges, duration, system, ...rest } = data;
  const { changes: systemChanges, ...systemRest } = system ?? {};
  const changes = topChanges ?? systemChanges ?? [];
  const rounds = duration?.rounds ?? (duration?.units === "rounds" ? duration.value : null);
  const out = { ...rest };
  if (CONST.ACTIVE_EFFECT_CHANGE_TYPES) {
    out.system = {
      ...systemRest,
      changes: changes.map(c => ({
        key: c.key,
        type: c.type ?? LEGACY_TYPES[c.mode] ?? `custom.${c.mode}`,
        value: parseChangeValue(c.value),
        priority: c.priority
      }))
    };
    // v14 fills start from the running combat
    if (rounds != null) out.duration = { value: rounds, units: "rounds" };
    else if (duration) out.duration = duration;
    return out;
  }
  if (Object.keys(systemRest).length) out.system = systemRest;
  out.changes = changes.map(c => ({
    key: c.key,
    mode: c.mode ?? LEGACY_MODES[c.type] ?? LEGACY_MODES.custom,
    value: typeof c.value === "string" ? c.value : JSON.stringify(c.value),
    priority: c.priority
  }));
  if (rounds != null) out.duration = { rounds, startRound: duration?.startRound ?? game.combat?.round ?? 0 };
  else if (duration) out.duration = duration;
  return out;
}

export function effectChanges(effect) {
  return Array.isArray(effect?.system?.changes) ? effect.system.changes : (effect?.changes ?? []);
}

// dnd5e 6 moved speeds under movement.speeds
function hasSpeedsField(actor) {
  const movement = actor?.system?.attributes?.movement;
  if (movement) return !!movement.speeds && typeof movement.speeds === "object";
  return !!CONFIG.Actor?.dataModels?.character?.schema?.getField?.("attributes.movement.speeds");
}

export function speedKey(actor, type = "walk") {
  return hasSpeedsField(actor) ? `system.attributes.movement.speeds.${type}` : `system.attributes.movement.${type}`;
}

export function movementSpeed(actor, type = "walk") {
  const movement = actor?.system?.attributes?.movement;
  return movement?.speeds?.[type] ?? movement?.[type];
}

// midiqol 13.0.18 switched to used/max counters
export function midiUsesActionCounters() {
  const midi = globalThis.game?.modules?.get?.("midi-qol");
  if (!midi?.active) return true;
  const [a, b, c] = String(midi.version ?? "").replace(/^[^\d]*/, "").split(".").map(n => parseInt(n, 10));
  if (!Number.isFinite(a)) return true;
  if (a !== 13) return a > 13;
  if ((b || 0) !== 0) return (b || 0) > 0;
  return (c || 0) >= 18;
}

export function midiDenyBonusChanges() {
  return [midiChange(midiUsesActionCounters()
    ? "flags.midi-qol.actions.bonusActionsUsed"
    : "flags.midi-qol.actions.bonus")];
}

export function midiDenyReactionChanges() {
  return [midiChange(midiUsesActionCounters()
    ? "flags.midi-qol.actions.reactionsUsed"
    : "flags.midi-qol.actions.reaction")];
}

// midi 13.0.38 renamed the key so write both
export function midiDisadvCheckChanges() {
  return [
    midiChange("flags.midi-qol.disadvantage.ability.check.all"),
    midiChange("flags.midi-qol.disadvantage.check.all")
  ];
}

// v12 FilePicker isn't on globalThis so handle that
export function resolveFilePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? foundry.applications?.apps?.FilePicker
    ?? (typeof FilePicker !== "undefined" ? FilePicker : null);
}
