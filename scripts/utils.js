import { measureDist } from "./movement.js";
import { RUNE_REGISTRY } from "./rune-registry.js";
import { getCustomRunesByCategory } from "./rune-store.js";

const ARMOR_AMBIGUOUS_SUBTYPES = ["clothing", "rod", "trinket", "wondrous"];

export function findAttackActivity(item) {
  const acts = item?.system?.activities;
  if (!acts) return null;
  const list = typeof acts.find === "function" ? acts : Object.values(acts);
  return list.find?.(a => a?.type === "attack") ?? null;
}

export function getAttackCategory(item) {
  const attack = findAttackActivity(item);
  const declared = attack?.attack?.type?.value;
  if (declared === "melee") return "melee";
  if (declared === "ranged") return "ranged";

  if (item?.type !== "weapon") return attack ? "melee" : null;

  const sub = item.system?.type?.value ?? "";
  if (sub.endsWith("M") || sub === "improv") return "melee";
  if (sub.endsWith("R") || sub === "siege") return "ranged";

  const legacy = item.system?._source?.actionType ?? item.system?.actionType ?? "";
  if (legacy === "mwak") return "melee";
  if (legacy === "rwak") return "ranged";

  const props = item.system?.properties;
  const thrown = props instanceof Set ? props.has("thr") : props?.thr === true;
  return thrown ? "ranged" : "melee";
}

export function getItemCategory(item) {
  if (item.type === "equipment") {
    const sub = item.system?.type?.value ?? "";
    if (sub === "natural" || sub === "vehicle" || sub === "wand") return null;

    // ambiguous subtypes need a real AC value
    if (ARMOR_AMBIGUOUS_SUBTYPES.includes(sub) && !(Number(item.system?.armor?.value) > 0)) return null;

    return "armor";
  }

  if (item.type !== "weapon") return null;

  const weaponSub = item.system?.type?.value ?? "";
  if (weaponSub === "natural") return null;

  // dnd5e 4.x activity system
  const activities = item.system?.activities;
  if (activities) {
    const attack = activities.find?.(a => a.type === "attack");
    if (attack) {
      const v = attack.attack?.type?.value;
      if (v === "melee") return "melee";
      if (v === "ranged") return "ranged";
    }
  }

  // subtype options: simpleM / martialM / simpleR / martialR / improv / siege
  if (weaponSub.endsWith("M") || weaponSub === "improv") return "melee";
  if (weaponSub.endsWith("R")) return "ranged";

  // pre-4.x actionType fallback
  const legacy = item.system?._source?.actionType ?? item.system?.actionType ?? "";
  if (legacy === "mwak") return "melee";
  if (legacy === "rwak") return "ranged";

  const props = item.system?.properties;
  const thrown = props instanceof Set ? props.has("thr") : props?.thr === true;
  if (thrown) return "ranged";

  return "melee";
}

export function meetsRequirements(item) {
  const isEquipped = item.system?.equipped ?? false;
  const attunement = item.system?.attunement ?? "";
  const isAttuned = item.system?.attuned ?? false;
  const requiresAttunement = Object.keys(CONFIG?.DND5E?.attunementTypes ?? {}).includes("required")
    && attunement === "required";
  return isEquipped && (!requiresAttunement || isAttuned);
}

export function getRunePool(item) {
  const category = getItemCategory(item);
  if (!category) return [];
  const core = RUNE_REGISTRY[category] ?? [];
  const customs = getCustomRunesByCategory(category).map(d => ({
    id: d.id,
    name: d.name,
    color: d.color,
    glyph: d.glyph,
    glyphMode: d.glyphMode ?? "path",
    glyphView: d.glyphView ?? null,
    cursed: d.cursed === true,
    description: d.description ?? "",
    custom: true
  }));
  return [...core, ...customs];
}

export function getRuneById(id, category) {
  return (RUNE_REGISTRY[category] ?? []).find(r => r.id === id) ?? null;
}

export function rarityFromCounts(powerCount, secondaryCount) {
  const score = (powerCount * 3) + secondaryCount;
  if (score === 0) return "Common";
  if (score <= 3) return "Uncommon";
  if (score <= 7) return "Rare";
  if (score <= 11) return "Very Rare";
  return "Legendary";
}

export function computeRunicRarity(item) {
  const flags = item.flags?.["gm-runic-items"] ?? {};

  const powerCount = [flags["power-0"], flags["power-1"], flags["power-2"]]
    .filter(Boolean).length;

  const secondaryCount = [
    ...Array.from({ length: 5 }, (_, i) => flags[`emp-${i}`]),
    flags["legacy-feat"],
    flags["legacy-spell"]
  ].filter(Boolean).length;

  return rarityFromCounts(powerCount, secondaryCount);
}

export function getRarityDie(rarity) {
  const map = { "Common": "1d4", "Uncommon": "1d4", "Rare": "1d6", "Very Rare": "1d8", "Legendary": "1d10" };
  return map[rarity] ?? "1d4";
}

export function getRarityAcBonus(rarity) {
  const map = { "Common": 0, "Uncommon": 1, "Rare": 1, "Very Rare": 2, "Legendary": 3 };
  return map[rarity] ?? 0;
}

// handlebars helpers moved to foundry.applications.handlebars in v13
export function renderTemplateCompat(path, data) {
  const fn = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return fn(path, data);
}

export function loadTemplatesCompat(paths) {
  const fn = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  return fn(paths);
}

function dnd5eConvertLength(value, from, to) {
  const convert = globalThis.dnd5e?.utils?.convertLength;
  if (typeof convert !== "function") return value;
  try {
    return convert(value, from, to, { strict: false });
  } catch {
    return value;
  }
}

function sceneGridInfo() {
  const units = canvas?.scene?.grid?.units || canvas?.grid?.units || "ft";
  const distance = canvas?.scene?.grid?.distance || canvas?.grid?.distance || 5;
  return { units, distance };
}

export function feetPerGridSquare() {
  const { units, distance } = sceneGridInfo();
  return dnd5eConvertLength(distance, units, "ft") || 5;
}

export function gridSquaresForFeet(feet) {
  const perSquare = feetPerGridSquare();
  if (!perSquare) return 0;
  return Math.max(0, Math.round(feet / perSquare));
}

export function feetToSceneDistance(feet) {
  const { units } = sceneGridInfo();
  return dnd5eConvertLength(feet, "ft", units);
}

export function sceneDistanceToFeet(distance) {
  const { units } = sceneGridInfo();
  return dnd5eConvertLength(distance, units, "ft");
}

function dnd5eDisplayUnitKey() {
  const api = globalThis.dnd5e?.utils;
  if (typeof api?.convertLength !== "function") return "ft";
  try {
    if (typeof api.defaultUnits === "function") return api.defaultUnits("length") || "ft";
    if (game.settings.settings.has("dnd5e.metricLengthUnits") && game.settings.get("dnd5e", "metricLengthUnits")) {
      return CONFIG.DND5E?.defaultUnits?.length?.metric ?? "m";
    }
  } catch {
    // dnd5e < 4.4 doesn't have defaultUnits or metric settings
  }
  return "ft";
}

export function withinFeet(a, b, feet) {
  return measureDist(a, b) <= feetToSceneDistance(feet);
}
function actorLengthUnits(actor) {
  const units = actor?.system?.attributes?.movement?.units;
  if (units) return units;
  try {
    const fallback = globalThis.dnd5e?.utils?.defaultUnits;
    if (typeof fallback === "function") return fallback("length") || "ft";
  } catch {
    // dnd5e < 4.4 doesn't have defaultUnits or metric settings so feet is the only unit
  }
  return "ft";
}
export function feetToActorUnits(actor, feet) {
  return dnd5eConvertLength(feet, "ft", actorLengthUnits(actor));
}
export function actorUnitsToFeet(actor, value) {
  return dnd5eConvertLength(value, actorLengthUnits(actor), "ft");
}
export function actorSpeedInSceneUnits(actor, key = "walk") {
  const units = actorLengthUnits(actor);
  const raw = actor?.system?.attributes?.movement?.[key] ?? dnd5eConvertLength(30, "ft", units);
  return dnd5eConvertLength(raw, units, sceneGridInfo().units);
}
export function dnd5eDisplayDistance(feet) {
  const unitKey = dnd5eDisplayUnitKey();
  const value = Math.round(dnd5eConvertLength(feet, "ft", unitKey) * 10) / 10;
  const unit = CONFIG.DND5E?.movementUnits?.[unitKey]?.abbreviation ?? unitKey;
  return { value, unit };
}

// rollAbilitySave was replaced by rollSavingThrow in dnd5e 4.x
export async function rollSave(actor, ability, dc, flavor) {
  let result;
  if (typeof actor.rollSavingThrow === "function") {
    result = await actor.rollSavingThrow({ ability, target: dc }, {}, { data: { flavor } });
  } else {
    result = await actor.rollAbilitySave(ability, { flavor, targetValue: dc });
  }
  const roll = Array.isArray(result) ? result[0] : result;
  return roll?.total ?? Infinity;
}

const _caches = new Map();

export function getCache(key) {
  if (!_caches.has(key)) _caches.set(key, new Set());
  return _caches.get(key);
}

export function withCache(cacheKey, id, ttl, fn) {
  const cache = getCache(cacheKey);
  if (cache.has(id)) return;
  cache.add(id);
  setTimeout(() => cache.delete(id), ttl);
  return fn();
}
