import { RUNE_REGISTRY } from "./rune-registry.js";

export function getItemCategory(item) {
  if (item.type === "equipment") {
    const sub = item.system?.type?.value ?? "";
    if (sub === "natural" || sub === "vehicle") return null;
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
  return RUNE_REGISTRY[category] ?? [];
}

export function getRuneById(id, category) {
  return (RUNE_REGISTRY[category] ?? []).find(r => r.id === id) ?? null;
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

  // power = 3pts each, secondary = 1pt each
  const score = (powerCount * 3) + secondaryCount;

  if (score === 0) return "Common";
  if (score <= 3) return "Uncommon";
  if (score <= 7) return "Rare";
  if (score <= 11) return "Very Rare";
  return "Legendary";
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
