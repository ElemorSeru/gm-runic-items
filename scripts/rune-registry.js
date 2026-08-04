import { dnd5eDisplayDistance } from "./utils.js";

const MODULE_ID = "gm-runic-items";

function rrI18n(key, data) {
  const str = game.i18n.localize(`${MODULE_ID}.rune.${key}`);
  if (!data) return str;

  return str.replace(/\{(\w+)\}/g, (match, k) => (k in data ? data[k] : match));
}

function pipDistance() {
  return dnd5eDisplayDistance(5);
}

export const RUNE_REGISTRY = {
  melee: [
    {
      id: "stonecleft",
      name: "Stonecleft",
      color: "#a04000",
      glyph: "M12,2L22,20L2,20ZM12,2L12,22M6,14L18,14",
      get description() { const d = pipDistance(); return rrI18n("stonecleft.description", { pip: d.value, unit: d.unit }); },
      effectKey: "stonecleft"
    },
    {
      id: "mirageward",
      name: "Mirageward",
      color: "#7fb3d3",
      glyph: "M4,12L8,6L12,4L16,6L20,12L16,18L12,20L8,18ZM11,11H13V13H11Z",
      get description() { return rrI18n("mirageward.description"); },
      effectKey: "mirageward"
    },
    {
      id: "emberbrand",
      name: "Emberbrand",
      color: "#f39c12",
      glyph: "M12,22L12,9M8,15L12,9L16,15M10,5L12,2L14,5",
      get description() { return rrI18n("emberbrand.description"); },
      effectKey: "emberbrand"
    },
    {
      id: "sandgrasp",
      name: "Sandgrasp",
      color: "#6c3483",
      glyph: "M4,4H20V20H4ZM4,12H20M12,4V20",
      get description() { const d = pipDistance(); return rrI18n("sandgrasp.description", { pip: d.value, unit: d.unit }); },
      effectKey: "sandgrasp"
    },
    {
      id: "ruinmark",
      name: "Ruinmark",
      color: "#c0392b",
      glyph: "M12,2L4,18L12,13L20,18L12,2M12,13L12,22",
      get description() { return rrI18n("ruinmark.description"); },
      effectKey: "ruinmark"
    },
    {
      id: "forgebell",
      name: "Forgebell",
      color: "#e67e22",
      glyph: "M4,20L4,10L8,4L12,10L16,4L20,10L20,20H4",
      get description() {
        const move = pipDistance();
        const radius = dnd5eDisplayDistance(30);
        return rrI18n("forgebell.description", { pip: move.value, radius: radius.value, unit: move.unit });
      },
      effectKey: "forgebell"
    }
  ],
  ranged: [
    {
      id: "burntrace",
      name: "Burntrace",
      color: "#27ae60",
      glyph: "M2,12L20,12M14,6L22,12L14,18M5,8V16",
      get description() { return rrI18n("burntrace.description"); },
      effectKey: "burntrace"
    },
    {
      id: "sandhold",
      name: "Sandhold",
      color: "#85c1e9",
      glyph: "M4,8H20M4,12H20M4,16H20M8,4L4,8M16,4L20,8",
      get description() { const d = pipDistance(); return rrI18n("sandhold.description", { pip: d.value, unit: d.unit }); },
      effectKey: "sandhold"
    },
    {
      id: "ashcloud",
      name: "Ashcloud",
      color: "#229954",
      glyph: "M12,4A8,8,0,1,1,11.99,4M6,8L4,6M18,8L20,6M18,16L20,18M6,16L4,18",
      get description() { return rrI18n("ashcloud.description"); },
      effectKey: "ashcloud"
    },
    {
      id: "undertow",
      name: "Undertow",
      color: "#5d6d7e",
      glyph: "M12,2L12,22M6,8L12,2L18,8M6,16L12,22L18,16M6,12L18,12",
      get description() { const d = pipDistance(); return rrI18n("undertow.description", { pip: d.value, unit: d.unit }); },
      effectKey: "undertow"
    },
    {
      id: "scorcheye",
      name: "Scorcheye",
      color: "#a569bd",
      glyph: "M12,2L22,12L12,22L2,12ZM12,2L12,22M2,12L22,12",
      get description() { return rrI18n("scorcheye.description"); },
      effectKey: "scorcheye"
    },
    {
      id: "wasteblight",
      name: "Wasteblight",
      color: "#1e8449",
      glyph: "M4,7L8,4L12,7L16,4L20,7M4,14L8,11L12,14L16,11L20,14M12,14L12,22",
      get description() { return rrI18n("wasteblight.description"); },
      effectKey: "wasteblight"
    }
  ],
  armor: [
    {
      id: "emberveil",
      name: "Emberveil",
      color: "#f1c40f",
      glyph: "M4,12L12,4L20,12L12,20ZM12,4L12,20M4,12L20,12",
      get description() { const d = pipDistance(); return rrI18n("emberveil.description", { pip: d.value, unit: d.unit }); },
      effectKey: "emberveil"
    },
    {
      id: "stonewarden",
      name: "Stonewarden",
      color: "#7f8c8d",
      glyph: "M4,20L4,10L12,3L20,10L20,20H4M9,20V13H15V20",
      get description() { return rrI18n("stonewarden.description"); },
      effectKey: "stonewarden"
    },
    {
      id: "vanguard",
      name: "Vanguard",
      color: "#2e86c1",
      glyph: "M5,4L12,2L19,4L19,14L12,22L5,14ZM12,8L12,18M8,12L12,8L16,12",
      get description() { return rrI18n("vanguard.description"); },
      effectKey: "vanguard"
    },
    {
      id: "wardpulse",
      name: "Wardpulse",
      color: "#5dade2",
      glyph: "M12,3A9,9,0,1,1,11.99,3M12,6A6,6,0,1,1,11.99,6M12,12V20",
      get description() { return rrI18n("wardpulse.description"); },
      effectKey: "wardpulse"
    },
    {
      id: "forgeshield",
      name: "Forgeshield",
      color: "#1a5276",
      glyph: "M5,4L12,2L19,4L19,14L12,22L5,14ZM8,7L12,5L16,7L16,14L12,19L8,14Z",
      get description() { const d = dnd5eDisplayDistance(10); return rrI18n("forgeshield.description", { radius: d.value, unit: d.unit }); },
      effectKey: "forgeshield"
    },
    {
      id: "ashenmantle",
      name: "Ashen Mantle",
      color: "#922b21",
      glyph: "M4,4H20V20H4ZM4,10H20M4,16H20M10,4V20M16,4V20",
      get description() { return rrI18n("ashenmantle.description"); },
      effectKey: "ashenmantle"
    }
  ]
};

export const ABILITY_OPTIONS = [
  { key: "str", label: "STR", color: "#e74c3c", glyph: "M12,2L4,14H9V22H15V14H20Z", get description() { return rrI18n("ability.str.description"); } },
  { key: "dex", label: "DEX", color: "#2ecc71", glyph: "M15,2L7,12H12L9,22L17,11H13Z", get description() { return rrI18n("ability.dex.description"); } },
  { key: "con", label: "CON", color: "#e67e22", glyph: "M4,22V6L8,2H16L20,6V22M8,22V14H16V22M8,14H16", get description() { return rrI18n("ability.con.description"); } },
  { key: "int", label: "INT", color: "#3498db", glyph: "M2,12C6,5,18,5,22,12C18,19,6,19,2,12M10,12A2,2,0,1,1,10,12.01", get description() { return rrI18n("ability.int.description"); } },
  { key: "wis", label: "WIS", color: "#9b59b6", glyph: "M12,2V22M2,12H22M5.6,5.6L18.4,18.4M18.4,5.6L5.6,18.4", get description() { return rrI18n("ability.wis.description"); } },
  { key: "cha", label: "CHA", color: "#f0a500", glyph: "M2,18L4,10L8,14L12,6L16,14L20,10L22,18H2", get description() { return rrI18n("ability.cha.description"); } }
];

export const LEGACY_FEAT_GLYPH = "M12,2L15,9L22,9L16,14L18,21L12,17L6,21L8,14L2,9L9,9Z";
export const LEGACY_SPELL_GLYPH = "M12,2L14,7L19,5L17,10L22,12L17,14L19,19L14,17L12,22L10,17L5,19L7,14L2,12L7,10L5,5L10,7Z";
export const LEGACY_FEAT_COLOR = "#f1c40f";
export const LEGACY_SPELL_COLOR = "#a8d8f0";
