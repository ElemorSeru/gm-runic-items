import { dnd5eDisplayDistance } from "./utils.js";

const MODULE_ID = "gm-runic-items";

function cbI18n(key, data) {
  return data ? game.i18n.format(`${MODULE_ID}.combo.description.${key}`, data) : game.i18n.localize(`${MODULE_ID}.combo.description.${key}`);
}

export const COMBO_REGISTRY = [
  {
    id: "ember-surge",
    runes: ["emberbrand", "ruinmark", "forgebell"],
    name: "Ember Surge",
    get description() { return cbI18n("ember-surge"); },
    glyph: "M12,2L8,8L4,6L8,14L5,13L10,20L9,18L12,22L15,18L14,20L19,13L16,14L20,6L16,8Z",
    color: "#d4621a"
  },
  {
    id: "rift-break",
    runes: ["stonecleft", "sandgrasp", "mirageward"],
    name: "Rift Break",
    get description() { return cbI18n("rift-break"); },
    glyph: "M2,20L12,2L22,20H2M7,14L17,14M10,8L14,8",
    color: "#8b5a2b"
  },
  {
    id: "crystal-anchor",
    runes: ["undertow", "sandhold", "burntrace"],
    name: "Crystal Anchor",
    get description() { return cbI18n("crystal-anchor"); },
    glyph: "M12,2L12,14M8,6L12,2L16,6M6,10L18,10M4,14A8,4,0,0,0,20,14M8,20L12,14L16,20",
    color: "#2980b9"
  },
  {
    id: "blight-field",
    runes: ["wasteblight", "ashcloud", "scorcheye"],
    name: "Blight Field",
    get description() { return cbI18n("blight-field"); },
    glyph: "M12,4A8,8,0,1,0,20,12M12,4L12,14M10,8A2,2,0,1,0,14,8M8,16L12,22L16,16",
    color: "#2ecc71"
  },
  {
    id: "ironwall",
    runes: ["emberveil", "wardpulse", "forgeshield"],
    name: "Ironwall",
    get description() { const d = dnd5eDisplayDistance(20); return cbI18n("ironwall", { radius: d.value, unit: d.unit }); },
    glyph: "M5,3L12,1L19,3L19,13L12,22L5,13ZM7,5L12,3L17,5L17,13L12,20L7,13ZM12,3L12,20",
    color: "#1a5276"
  },
  {
    id: "morrains-resolve",
    runes: ["vanguard", "stonewarden", "ashenmantle"],
    name: "Morrain's Resolve",
    get description() { return cbI18n("morrains-resolve"); },
    glyph: "M5,4L12,2L19,4L19,14L12,22L5,14ZM12,20L12,10M9,14L12,10L15,14M10,7L12,4L14,7M8,17L12,20L16,17",
    color: "#6d4c9f"
  }
];

export function getActiveCombo(powerSlotIds) {
  const filled = powerSlotIds.filter(Boolean);
  return COMBO_REGISTRY.find(c => c.runes.every(r => filled.includes(r))) ?? null;
}
