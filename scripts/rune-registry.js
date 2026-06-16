export const RUNE_REGISTRY = {
  melee: [
    {
      id: "stonecleft",
      name: "Stonecleft",
      color: "#a04000",
      glyph: "M12,2L22,20L2,20ZM12,2L12,22M6,14L18,14",
      description: "On a hit, the target makes a DC 13 Strength save or is pushed {die}x5 ft away and has their movement halved for 1 round. On a critical hit, they automatically fail the save.",
      effectKey: "stonecleft"
    },
    {
      id: "mirageward",
      name: "Mirageward",
      color: "#7fb3d3",
      glyph: "M4,12L8,6L12,4L16,6L20,12L16,18L12,20L8,18ZM11,11H13V13H11Z",
      description: "On a hit, the target loses the ability to make opportunity attacks until the start of your next turn.",
      effectKey: "mirageward"
    },
    {
      id: "emberbrand",
      name: "Emberbrand",
      color: "#f39c12",
      glyph: "M12,22L12,9M8,15L12,9L16,15M10,5L12,2L14,5",
      description: "On a critical hit, the target is branded with ember fire. Until the start of your next turn, allies who hit the target deal an extra {die} radiant damage.",
      effectKey: "emberbrand"
    },
    {
      id: "sandgrasp",
      name: "Sandgrasp",
      color: "#6c3483",
      glyph: "M4,4H20V20H4ZM4,12H20M12,4V20",
      description: "On a hit, the target makes a DC 15 Strength save or their speed is reduced by {die}x5 ft until the end of their next turn.",
      effectKey: "sandgrasp"
    },
    {
      id: "ruinmark",
      name: "Ruinmark",
      color: "#c0392b",
      glyph: "M12,2L4,18L12,13L20,18L12,2M12,13L12,22",
      description: "On a hit, the target's armor is cracked. Their AC is reduced by 2 for {die} rounds. Any attacker benefits from this opening.",
      effectKey: "ruinmark"
    },
    {
      id: "forgebell",
      name: "Forgebell",
      color: "#e67e22",
      glyph: "M4,20L4,10L8,4L12,10L16,4L20,10L20,20H4",
      description: "On a hit, the rune rings like a forge bell. One ally within 30 ft may use their reaction to move up to {die}x5 ft toward the target.",
      effectKey: "forgebell"
    }
  ],
  ranged: [
    {
      id: "burntrace",
      name: "Burntrace",
      color: "#27ae60",
      glyph: "M2,12L20,12M14,6L22,12L14,18M5,8V16",
      description: "On a hit, a scorched mark is left on the target. They suffer disadvantage on attack rolls for 1 round.",
      effectKey: "burntrace"
    },
    {
      id: "sandhold",
      name: "Sandhold",
      color: "#85c1e9",
      glyph: "M4,8H20M4,12H20M4,16H20M8,4L4,8M16,4L20,8",
      description: "On a hit, desert sand hardens around the target. Their movement speed is reduced by {die}x5 ft for 1 round.",
      effectKey: "sandhold"
    },
    {
      id: "ashcloud",
      name: "Ashcloud",
      color: "#229954",
      glyph: "M12,4A8,8,0,1,1,11.99,4M6,8L4,6M18,8L20,6M18,16L20,18M6,16L4,18",
      description: "On a hit, a cloud of rift ash erupts at the impact point. Creatures in the cloud must make a DC 14 Constitution save or be poisoned and take {die} poison damage.",
      effectKey: "ashcloud"
    },
    {
      id: "undertow",
      name: "Undertow",
      color: "#5d6d7e",
      glyph: "M12,2L12,22M6,8L12,2L18,8M6,16L12,22L18,16M6,12L18,12",
      description: "On a hit, rift energy drags the target {die}x5 ft toward the impact point.",
      effectKey: "undertow"
    },
    {
      id: "scorcheye",
      name: "Scorcheye",
      color: "#a569bd",
      glyph: "M12,2L22,12L12,22L2,12ZM12,2L12,22M2,12L22,12",
      description: "On a hit, the heat-haze clarity of the desert strips concealment. The target cannot benefit from cover or invisibility until the start of your next turn.",
      effectKey: "scorcheye"
    },
    {
      id: "wasteblight",
      name: "Wasteblight",
      color: "#1e8449",
      glyph: "M4,7L8,4L12,7L16,4L20,7M4,14L8,11L12,14L16,11L20,14M12,14L12,22",
      description: "On a hit, rift corruption spreads through the target. While poisoned, creatures ending their turn adjacent to them must make a DC 13 Constitution save or become poisoned and take {die} poison damage.",
      effectKey: "wasteblight"
    }
  ],
  armor: [
    {
      id: "emberveil",
      name: "Emberveil",
      color: "#f1c40f",
      glyph: "M4,12L12,4L20,12L12,20ZM12,4L12,20M4,12L20,12",
      description: "Grants a passive AC bonus based on runic rarity. When struck by a melee attack, the attacker is pushed {die}x5 ft directly away and cannot re-enter your space until the start of their next turn.",
      effectKey: "emberveil"
    },
    {
      id: "stonewarden",
      name: "Stonewarden",
      color: "#7f8c8d",
      glyph: "M4,20L4,10L12,3L20,10L20,20H4M9,20V13H15V20",
      description: "When the wearer drops below half HP, the rune flares and restores {die} HP. Once per combat.",
      effectKey: "stonewarden"
    },
    {
      id: "vanguard",
      name: "Vanguard",
      color: "#2e86c1",
      glyph: "M5,4L12,2L19,4L19,14L12,22L5,14ZM12,8L12,18M8,12L12,8L16,12",
      description: "When an ally is struck by a melee attack, the wearer may use their reaction to move adjacent to that ally. The attacker suffers disadvantage on all attacks until the end of the round.",
      effectKey: "vanguard"
    },
    {
      id: "wardpulse",
      name: "Wardpulse",
      color: "#5dade2",
      glyph: "M12,3A9,9,0,1,1,11.99,3M12,6A6,6,0,1,1,11.99,6M12,12V20",
      description: "When struck by a melee attack, the attacker makes a DC 14 Constitution save or loses their bonus action until the end of their next turn. Once per round.",
      effectKey: "wardpulse"
    },
    {
      id: "forgeshield",
      name: "Forgeshield",
      color: "#1a5276",
      glyph: "M5,4L12,2L19,4L19,14L12,22L5,14ZM8,7L12,5L16,7L16,14L12,19L8,14Z",
      description: "When struck by a melee attack, allies within 10 ft of the wearer gain +2 AC for 2 rounds.",
      effectKey: "forgeshield"
    },
    {
      id: "ashenmantle",
      name: "Ashen Mantle",
      color: "#922b21",
      glyph: "M4,4H20V20H4ZM4,10H20M4,16H20M10,4V20M16,4V20",
      description: "When the wearer drops to or below half HP for the first time, they gain resistance to all damage types for 1 round and cannot be moved or knocked prone while the resistance is active. Once per rest.",
      effectKey: "ashenmantle"
    }
  ]
};

export const RARITY_DIE = {
  Common: "1d4",
  Uncommon: "1d4",
  Rare: "1d6",
  "Very Rare": "1d8",
  Legendary: "1d10"
};

export const RARITY_AC_BONUS = {
  Common: 0,
  Uncommon: 1,
  Rare: 1,
  "Very Rare": 2,
  Legendary: 3
};

export const ABILITY_OPTIONS = [
  { key: "str", label: "STR", color: "#e74c3c", glyph: "M12,2L4,14H9V22H15V14H20Z", description: "Each inscribed Strength marking grants +1 to the chosen stat." },
  { key: "dex", label: "DEX", color: "#2ecc71", glyph: "M15,2L7,12H12L9,22L17,11H13Z", description: "Each inscribed Dexterity marking grants +1 to the chosen stat." },
  { key: "con", label: "CON", color: "#e67e22", glyph: "M4,22V6L8,2H16L20,6V22M8,22V14H16V22M8,14H16", description: "Each inscribed Constitution marking grants +1 to the chosen stat." },
  { key: "int", label: "INT", color: "#3498db", glyph: "M2,12C6,5,18,5,22,12C18,19,6,19,2,12M10,12A2,2,0,1,1,10,12.01", description: "Each inscribed Intelligence marking grants +1 to the chosen stat." },
  { key: "wis", label: "WIS", color: "#9b59b6", glyph: "M12,2V22M2,12H22M5.6,5.6L18.4,18.4M18.4,5.6L5.6,18.4", description: "Each inscribed Wisdom marking grants +1 to the chosen stat." },
  { key: "cha", label: "CHA", color: "#f0a500", glyph: "M2,18L4,10L8,14L12,6L16,14L20,10L22,18H2", description: "Each inscribed Charisma marking grants +1 to the chosen stat." }
];

export const LEGACY_FEAT_GLYPH = "M12,2L15,9L22,9L16,14L18,21L12,17L6,21L8,14L2,9L9,9Z";
export const LEGACY_SPELL_GLYPH = "M12,2L14,7L19,5L17,10L22,12L17,14L19,19L14,17L12,22L10,17L5,19L7,14L2,12L7,10L5,5L10,7Z";
export const LEGACY_FEAT_COLOR = "#f1c40f";
export const LEGACY_SPELL_COLOR = "#a8d8f0";
