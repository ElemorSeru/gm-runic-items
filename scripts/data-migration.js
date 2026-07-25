import { getRuneDef } from "./rune-store.js";

const MODULE_ID = "gm-runic-items";

// bump for consistency pass
export const WORLD_DATA_VERSION = 1;

const POWER_KEYS = ["power-0", "power-1", "power-2"];

function checkItemRuneFlags(item, warnings) {
  const flags = item.flags?.[MODULE_ID];
  if (!flags) return;
  for (const key of POWER_KEYS) {
    const runeId = flags[key];
    if (!runeId) continue;
    if (!getRuneDef(runeId)) {
      warnings.push(`${item.name ?? item.id} (${key}): rune "${runeId}" not found in the core registry or custom runes`);
    }
  }
}

function* iterateCandidateItems() {
  for (const actor of game.actors ?? []) {
    for (const item of actor.items) {
      if (item.type === "equipment" || item.type === "weapon") yield item;
    }
  }
  for (const item of game.items ?? []) {
    if (item.type === "equipment" || item.type === "weapon") yield item;
  }
}

export async function runWorldDataCheck() {
  if (!game.user?.isGM || game.users?.activeGM !== game.user) return;

  const stored = game.settings.get(MODULE_ID, "worldDataVersion") ?? 0;
  if (stored >= WORLD_DATA_VERSION) return;

  const warnings = [];
  for (const item of iterateCandidateItems()) {
    checkItemRuneFlags(item, warnings);
  }

  if (warnings.length) {
    console.warn(`[${MODULE_ID}] world data check found ${warnings.length} unresolved rune reference(s):`);
    for (const w of warnings) console.warn(`[${MODULE_ID}]   ${w}`);
    ui.notifications.warn(game.i18n.format(`${MODULE_ID}.migration.warnFound`, { count: warnings.length }));
  } else {
    console.log(`[${MODULE_ID}] world data check: no unresolved rune references found.`);
  }

  await game.settings.set(MODULE_ID, "worldDataVersion", WORLD_DATA_VERSION);
}
