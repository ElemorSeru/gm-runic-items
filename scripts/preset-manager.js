import { getItemCategory } from "./utils.js";

const MODULE_ID = "gm-runic-items";
const PRESETS_KEY = "presets";

export function getPresets() {
  return game.settings.get(MODULE_ID, PRESETS_KEY) ?? [];
}

export function getCompatiblePresets(item) {
  const category = getItemCategory(item);
  return getPresets().filter(p => p.category === category);
}

export async function savePreset(name, item) {
  const flags = item.flags?.[MODULE_ID] ?? {};
  const category = getItemCategory(item);
  const preset = {
    id: foundry.utils.randomID(),
    name,
    category,
    power: [flags["power-0"] ?? null, flags["power-1"] ?? null, flags["power-2"] ?? null],
    empowerment: Array.from({ length: 5 }, (_, i) => flags[`emp-${i}`] ?? null),
    legacyFeat: flags["legacy-feat"] ?? null,
    legacySpell: flags["legacy-spell"] ?? null
  };
  const all = getPresets();
  all.push(preset);
  await game.settings.set(MODULE_ID, PRESETS_KEY, all);
  return preset;
}

export async function deletePreset(id) {
  const all = getPresets().filter(p => p.id !== id);
  await game.settings.set(MODULE_ID, PRESETS_KEY, all);
}

export async function applyPreset(preset, item) {
  const updates = {};
  preset.power.forEach((id, i) => {
    updates[`flags.${MODULE_ID}.power-${i}`] = id ?? "";
  });
  preset.empowerment.forEach((stat, i) => {
    updates[`flags.${MODULE_ID}.emp-${i}`] = stat ?? "";
  });
  updates[`flags.${MODULE_ID}.legacy-feat`] = preset.legacyFeat ?? "";
  updates[`flags.${MODULE_ID}.legacy-spell`] = preset.legacySpell ?? "";
  await item.update(updates);
}

export function presetRarity(preset) {
  const powerCount = preset.power.filter(Boolean).length;
  const secondaryCount = preset.empowerment.filter(Boolean).length
    + (preset.legacyFeat ? 1 : 0) + (preset.legacySpell ? 1 : 0);
  const score = powerCount * 3 + secondaryCount;
  if (score === 0) return "Common";
  if (score <= 3) return "Uncommon";
  if (score <= 7) return "Rare";
  if (score <= 11) return "Very Rare";
  return "Legendary";
}
