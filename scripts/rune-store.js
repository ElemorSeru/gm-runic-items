import {
  RUNE_SCHEMA_VERSION, validateRuneDef, validateComboDef, formatValidationError,
  getCoreDefById, getCoreDefs, customRuneId
} from "./rune-defs.js";
import { COMBO_REGISTRY, getActiveCombo } from "./combo-registry.js";

const MODULE_ID = "gm-runic-items";
const RUNES_KEY = "customRunes";
const COMBOS_KEY = "customCombos";

function i18n(key, data) {
  return data ? game.i18n.format(`${MODULE_ID}.store.${key}`, data) : game.i18n.localize(`${MODULE_ID}.store.${key}`);
}

export function canForge() {
  return game.user.role >= CONST.USER_ROLES.ASSISTANT;
}

export function getCustomRunes() {
  const stored = game.settings.get(MODULE_ID, RUNES_KEY) ?? [];
  return Array.isArray(stored) ? stored : [];
}

export function getCustomRunesByCategory(category) {
  return getCustomRunes().filter(d => d.category === category);
}

export function getRuneDef(id) {
  if (!id) return null;
  return getCoreDefById(id) ?? getCustomRunes().find(d => d.id === id) ?? null;
}

export function getOrderedActiveDefs(item, category, slotIds) {
  const active = new Set(slotIds.filter(Boolean));
  const defs = [];
  for (const def of getCoreDefs(category)) {
    if (active.has(def.id)) defs.push(def);
  }
  for (const id of slotIds) {
    if (!id || getCoreDefById(id)) continue;
    const def = getCustomRunes().find(d => d.id === id);
    if (def) defs.push(def);
  }
  return defs;
}

export async function saveCustomRune(def) {
  const check = validateRuneDef(def);
  if (!check.ok) throw new Error(check.errors.map(formatValidationError).join("; "));
  if (!def.id || getCoreDefById(def.id)) def.id = customRuneId(def.name);
  def.schemaVersion = RUNE_SCHEMA_VERSION;
  delete def.core;
  delete def.template;
  const all = getCustomRunes().filter(d => d.id !== def.id);
  all.push(def);
  await game.settings.set(MODULE_ID, RUNES_KEY, all);
  return def;
}

export async function deleteCustomRune(id) {
  await game.settings.set(MODULE_ID, RUNES_KEY, getCustomRunes().filter(d => d.id !== id));
}

export function getCustomCombos() {
  const stored = game.settings.get(MODULE_ID, COMBOS_KEY) ?? [];
  return Array.isArray(stored) ? stored : [];
}

export function getActiveComboMerged(powerSlotIds) {
  const core = getActiveCombo(powerSlotIds);
  if (core) return core;
  const filled = powerSlotIds.filter(Boolean);
  return getCustomCombos().find(c => c.runes.every(r => filled.includes(r))) ?? null;
}

export async function saveCustomCombo(combo) {
  const check = validateComboDef(combo, getRuneDef);
  if (!check.ok) throw new Error(check.errors.map(formatValidationError).join("; "));
  const trioKey = ids => [...ids].sort().join("|");
  const key = trioKey(combo.runes);
  if (COMBO_REGISTRY.some(c => trioKey(c.runes) === key)) throw new Error(i18n("trioCoreCombo"));
  if (getCustomCombos().some(c => c.id !== combo.id && trioKey(c.runes) === key)) throw new Error(i18n("trioCustomCombo"));
  if (!combo.id) combo.id = `custom-combo.${foundry.utils.randomID(8)}`;
  const all = getCustomCombos().filter(c => c.id !== combo.id);
  all.push(combo);
  await game.settings.set(MODULE_ID, COMBOS_KEY, all);
  return combo;
}

export async function deleteCustomCombo(id) {
  await game.settings.set(MODULE_ID, COMBOS_KEY, getCustomCombos().filter(c => c.id !== id));
}

export function exportRunesJson(defs = null, combos = null) {
  return JSON.stringify({
    module: MODULE_ID,
    schemaVersion: RUNE_SCHEMA_VERSION,
    exported: new Date().toISOString(),
    runes: defs ?? getCustomRunes(),
    combos: combos ?? getCustomCombos()
  }, null, 2);
}

// upgrades applied when export shape changes
const RUNE_FILE_UPGRADERS = {};

function upgradeImportFile(data, fromVersion) {
  let version = fromVersion;
  while (version < RUNE_SCHEMA_VERSION) {
    const upgrade = RUNE_FILE_UPGRADERS[version];
    if (!upgrade) break;
    data = upgrade(data);
    version += 1;
  }
  return data;
}

export async function importRunesJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { runes: 0, combos: 0, errors: [i18n("invalidJson", { message: err.message })] };
  }

  const errors = [];
  const fileVersion = Number(data?.schemaVersion) || 1;
  if (fileVersion > RUNE_SCHEMA_VERSION) {
    return {
      runes: 0, combos: 0,
      errors: [i18n("newerSchema", { fileVersion, maxSchema: RUNE_SCHEMA_VERSION })]
    };
  }
  data = upgradeImportFile(data, fileVersion);

  const runes = Array.isArray(data?.runes) ? data.runes : Array.isArray(data) ? data : [];
  const combos = Array.isArray(data?.combos) ? data.combos : [];
  if (!runes.length && !combos.length) return { runes: 0, combos: 0, errors: [i18n("emptyImport")] };

  const existing = getCustomRunes();
  const idMap = new Map();
  const accepted = [];
  for (const raw of runes) {
    const def = foundry.utils.deepClone(raw);
    const check = validateRuneDef(def);
    if (!check.ok) {
      errors.push(i18n("runeImportError", { name: def?.name ?? "?", errors: check.errors.map(formatValidationError).join("; ") }));
      continue;
    }
    const oldId = def.id;
    if (!def.id || getCoreDefById(def.id) || existing.some(d => d.id === def.id) || accepted.some(d => d.id === def.id)) {
      def.id = customRuneId(def.name);
    }
    if (oldId && oldId !== def.id) idMap.set(oldId, def.id);
    def.schemaVersion = RUNE_SCHEMA_VERSION;
    delete def.core;
    accepted.push(def);
  }
  if (accepted.length) {
    await game.settings.set(MODULE_ID, RUNES_KEY, [...existing, ...accepted]);
  }

  let comboCount = 0;
  for (const raw of combos) {
    const combo = foundry.utils.deepClone(raw);
    combo.runes = (combo.runes ?? []).map(id => idMap.get(id) ?? id);
    combo.skipSaveFor = (combo.skipSaveFor ?? []).map(id => idMap.get(id) ?? id);
    combo.id = null;
    try {
      await saveCustomCombo(combo);
      comboCount++;
    } catch (err) {
      errors.push(i18n("comboImportError", { name: combo?.name ?? "?", message: err.message }));
    }
  }

  return { runes: accepted.length, combos: comboCount, errors };
}
