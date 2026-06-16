export const COMBO_REGISTRY = [
  {
    id: "ember-surge",
    runes: ["emberbrand", "ruinmark", "forgebell"],
    name: "Ember Surge",
    description: "On an Emberbrand crit, Ruinmark's AC crack applies to all attacks while the target burns and Forgebell calls all nearby allies forward at once.",
    glyph: "M12,2L8,8L4,6L8,14L5,13L10,20L9,18L12,22L15,18L14,20L19,13L16,14L20,6L16,8Z",
    color: "#d4621a"
  },
  {
    id: "rift-break",
    runes: ["stonecleft", "sandgrasp", "mirageward"],
    name: "Rift Break",
    description: "When Stonecleft lands, Sandgrasp triggers with no save and Mirageward shields the entire party from opportunity attacks for the round.",
    glyph: "M2,20L12,2L22,20H2M7,14L17,14M10,8L14,8",
    color: "#8b5a2b"
  },
  {
    id: "crystal-anchor",
    runes: ["undertow", "sandhold", "burntrace"],
    name: "Crystal Anchor",
    description: "Undertow's pull triggers Sandhold automatically, dropping speed to zero, while Burntrace's disorientation extends to all ability checks.",
    glyph: "M12,2L12,14M8,6L12,2L16,6M6,10L18,10M4,14A8,4,0,0,0,20,14M8,20L12,14L16,20",
    color: "#2980b9"
  },
  {
    id: "blight-field",
    runes: ["wasteblight", "ashcloud", "scorcheye"],
    name: "Blight Field",
    description: "The Ashcloud follows the blighted target as they move. Anyone in the cloud loses cover and invisibility.",
    glyph: "M12,4A8,8,0,1,0,20,12M12,4L12,14M10,8A2,2,0,1,0,14,8M8,16L12,22L16,16",
    color: "#2ecc71"
  },
  {
    id: "ironwall",
    runes: ["emberveil", "wardpulse", "forgeshield"],
    name: "Ironwall",
    description: "Emberveil's push triggers Wardpulse with no save, and Forgeshield's AC bonus extends to all allies within 20 ft.",
    glyph: "M5,3L12,1L19,3L19,13L12,22L5,13ZM7,5L12,3L17,5L17,13L12,20L7,13ZM12,3L12,20",
    color: "#1a5276"
  },
  {
    id: "morrains-resolve",
    runes: ["vanguard", "stonewarden", "ashenmantle"],
    name: "Morrain's Resolve",
    description: "Guardian's Rush becomes a free action. The defender rushes to protect allies without spending their reaction.",
    glyph: "M5,4L12,2L19,4L19,14L12,22L5,14ZM12,20L12,10M9,14L12,10L15,14M10,7L12,4L14,7M8,17L12,20L16,17",
    color: "#6d4c9f"
  }
];

export function getActiveCombo(powerSlotIds) {
  const filled = powerSlotIds.filter(Boolean);
  return COMBO_REGISTRY.find(c => c.runes.every(r => filled.includes(r))) ?? null;
}
