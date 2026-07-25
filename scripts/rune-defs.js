import { RUNE_REGISTRY } from "./rune-registry.js";

const MODULE_ID = "gm-runic-items";

export const RUNE_SCHEMA_VERSION = 2;

export const TRIGGER_DEFS = {
  onHit: { cats: ["melee", "ranged"], roles: ["target", "self", "allies", "enemies"] },
  onCrit: { cats: ["melee", "ranged"], roles: ["target", "self", "allies", "enemies"] },
  onMiss: { cats: ["melee", "ranged"], roles: ["target", "self"] },
  onKill: { cats: ["melee", "ranged"], roles: ["self", "allies", "enemies"] },
  onSpellCast: { cats: ["melee", "ranged"], roles: ["self"] },
  whenStruck: { cats: ["armor"], roles: ["attacker", "self", "allies"] },
  whenMissed: { cats: ["armor"], roles: ["attacker", "self"] },
  halfHp: { cats: ["armor"], roles: ["self", "allies"] },
  concBreak: { cats: ["armor"], roles: ["self"] },
  proximity: { cats: ["armor"], roles: ["attacker", "self"] },
  allyStruck: { cats: ["armor"], roles: ["attacker", "self", "target"] },
  whenProne: { cats: ["armor"], roles: ["self", "allies"] },
  combatStart: { cats: ["melee", "ranged", "armor"], roles: ["self", "allies", "enemies"] },
  turnStart: { cats: ["melee", "ranged", "armor"], roles: ["area"] },
  turnEnd: { cats: ["melee", "ranged", "armor"], roles: ["area"] }
};

export const SAVE_WHO = ["target", "attacker", "self"];
export const SAVE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const ON_SAVE = ["negate", "half", "full"];
export const USE_LIMITS = ["round", "combat", "rest"];
export const AURA_RADIUS = 15;

export const STAT_KEYS = [
  "ac-bonus", "ac-penalty", "speed-penalty", "speed-half", "speed-zero",
  "disadv-attack", "disadv-check", "temp-hp", "resist-all", "init-adv"
];

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning",
  "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];

export const STATUS_KEYS = ["poisoned", "blinded", "deafened", "frightened", "prone", "restrained"];

export const ACTION_TYPES = {
  move: { cfg: { dir: ["away", "toward"] } },
  stat: { cfg: { stat: STAT_KEYS } },
  damage: { cfg: { kind: ["damage", "heal"], dtype: DAMAGE_TYPES } },
  status: { cfg: { status: STATUS_KEYS } },
  reminder: { cfg: { text: "string" } },
  cloud: { point: true, cfg: {} },
  light: { cfg: {} },
  teleport: { cfg: {} },
  brand: { cfg: {}, triggers: ["onHit", "onCrit"] },
  contagion: { cfg: { dc: "number", ability: SAVE_ABILITIES } },
  allyDash: { point: true, cfg: { radius: "number" }, triggers: ["onHit", "onCrit", "onKill"] },
  guardianRush: { point: true, cfg: {}, triggers: ["allyStruck"] },
  scripted: { cfg: { key: "string" } }
};

export const CLOUD_AFFECTS = ["all", "enemies"];

export const CONTAGION_AFFECTS = ["allies", "enemies", "all"];

export const GLYPH_CHOICES = [
  "M12,2L4,14H9V22H15V14H20Z",
  "M12,2L22,12L12,22L2,12ZM12,7L17,12L12,17L7,12Z",
  "M12,3A9,9,0,1,1,11.99,3M12,8L12,16M8,12L16,12",
  "M4,20L12,4L20,20M8,14L16,14",
  "M12,2V22M5,7L19,17M19,7L5,17",
  "M6,3L18,3L21,12L18,21L6,21L3,12ZM12,7V17",
  "M12,2L14,9L21,9L15,13L17,20L12,16L7,20L9,13L3,9L10,9Z",
  "M3,12C7,4,17,4,21,12C17,20,7,20,3,12M12,9A3,3,0,1,1,12,15",
  "M12,22C7,18,4,14,4,9A8,8,0,0,1,20,9C20,14,17,18,12,22M9,9L15,9",
  "M5,19L12,3L19,19M12,3V13M9,16H15",
  "M4,17L8,7L12,14L16,5L20,17M4,21H20",
  "M12,2A10,10,0,0,1,12,22M12,2A10,10,0,0,0,12,22M12,6V18M8,10L16,14M16,10L8,14",
  "M12,2L17,8L15,20L9,20L7,8ZM7,8L12,11L17,8M12,11L12,20",
  "M5,12A7,7,0,0,1,12,5M19,12A7,7,0,0,1,12,19M12,5L15,3M12,5L15,8M12,19L9,21M12,19L9,16",
  "M12,2L12,5M12,19L12,22M2,12H5M19,12H22M12,8A4,4,0,1,1,11.99,8",
  "M2,20L10,12M9,5L13,2L20,9L17,13L9,5ZM12,8L14,10"
];

const CORE_TRIGGERS = {
  stonecleft: "onHit", mirageward: "onHit", emberbrand: "onCrit",
  sandgrasp: "onHit", ruinmark: "onHit", forgebell: "onHit",
  burntrace: "onHit", sandhold: "onHit", ashcloud: "onHit",
  undertow: "onHit", scorcheye: "onHit", wasteblight: "onHit",
  emberveil: "whenStruck", wardpulse: "whenStruck", forgeshield: "whenStruck",
  stonewarden: "halfHp", ashenmantle: "halfHp", vanguard: "allyStruck"
};

// mirror each core rune's locked behavior
function coreTemplates() {
  const t = key => game.i18n.localize(`${MODULE_ID}.runeforge.tmpl.${key}`);
  return {
    stonecleft: {
      save: { who: "target", ability: "str", dc: 13, critAutoFails: true },
      actions: [
        { type: "move", dir: "away", target: "target", onSave: "negate" },
        { type: "stat", stat: "speed-half", target: "target", onSave: "negate" }
      ]
    },
    mirageward: { actions: [{ type: "reminder", text: t("mirageward"), target: "target" }] },
    emberbrand: { actions: [{ type: "brand", target: "target" }] },
    sandgrasp: {
      save: { who: "target", ability: "str", dc: 15, critAutoFails: false },
      actions: [{ type: "stat", stat: "speed-penalty", target: "target", onSave: "negate" }]
    },
    ruinmark: { actions: [{ type: "stat", stat: "ac-penalty", rounds: "die", target: "target" }] },
    forgebell: { actions: [{ type: "allyDash", radius: 30, target: "point" }] },
    burntrace: { actions: [{ type: "stat", stat: "disadv-attack", target: "target" }] },
    sandhold: { actions: [{ type: "stat", stat: "speed-penalty", target: "target" }] },
    ashcloud: { actions: [{ type: "cloud", dc: 14, ability: "con", status: "poisoned", affects: "enemies", rounds: 3, immediate: true, target: "point" }] },
    undertow: { actions: [{ type: "move", dir: "toward", target: "target" }] },
    scorcheye: { actions: [{ type: "reminder", text: t("scorcheye"), target: "target" }] },
    wasteblight: {
      actions: [
        { type: "status", status: "poisoned", target: "target" },
        { type: "contagion", dc: 13, ability: "con", status: "poisoned", rounds: 10, target: "target" }
      ]
    },
    emberveil: {
      passiveAc: true,
      actions: [
        { type: "move", dir: "away", target: "attacker" },
        { type: "reminder", text: t("emberveil"), target: "attacker" }
      ]
    },
    stonewarden: { uses: { per: "combat" }, actions: [{ type: "damage", kind: "heal", target: "self" }] },
    vanguard: { uses: { per: "combat" }, actions: [{ type: "guardianRush", target: "point" }] },
    wardpulse: {
      uses: { per: "round" },
      save: { who: "attacker", ability: "con", dc: 14, critAutoFails: false },
      actions: [{ type: "reminder", text: t("wardpulse"), target: "attacker", onSave: "negate" }]
    },
    forgeshield: { actions: [{ type: "stat", stat: "ac-bonus", target: "allies", radius: 10, rounds: 2 }] },
    ashenmantle: {
      uses: { per: "rest" },
      actions: [
        { type: "stat", stat: "resist-all", target: "self" },
        { type: "reminder", text: t("ashenmantle"), target: "self" }
      ]
    }
  };
}

const _coreDefCache = new Map();
let _templateCache = null;

export function getCoreDefs(category) {
  if (!_coreDefCache.has(category)) {
    if (!_templateCache) _templateCache = coreTemplates();
    const defs = (RUNE_REGISTRY[category] ?? []).map(r => {
      const tmpl = _templateCache[r.id] ?? null;
      return {
        schemaVersion: RUNE_SCHEMA_VERSION,
        id: r.id,
        name: r.name,
        category,
        color: r.color,
        glyph: r.glyph,
        glyphMode: "path",
        cursed: false,
        description: r.description,
        trigger: CORE_TRIGGERS[r.id] ?? "onHit",
        save: null,
        uses: null,
        actions: [{ type: "scripted", key: r.effectKey ?? r.id }],
        template: tmpl,
        ...(tmpl?.passiveAc ? { passiveAc: true } : {}),
        core: true
      };
    });
    _coreDefCache.set(category, defs);
  }
  return _coreDefCache.get(category);
}

export function getCoreDefById(id) {
  for (const category of Object.keys(RUNE_REGISTRY)) {
    const def = getCoreDefs(category).find(d => d.id === id);
    if (def) return def;
  }
  return null;
}

export function slugifyRuneName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "rune";
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function validateRuneDef(def) {
  const errors = [];
  const e = (code, data) => errors.push({ code, data: data ?? {} });

  if (!def || typeof def !== "object") return { ok: false, errors: [{ code: "notObject", data: {} }] };
  if (typeof def.name !== "string" || !def.name.trim() || def.name.length > 60) e("name");
  if (!["melee", "ranged", "armor"].includes(def.category)) e("category");
  if (typeof def.color !== "string" || !HEX_COLOR.test(def.color)) e("color");
  if (typeof def.glyph !== "string" || !def.glyph.trim() || def.glyph.length > 4000) e("glyph");
  if (def.glyphMode != null && !["path", "silhouette"].includes(def.glyphMode)) e("glyphMode");
  if (def.glyphView != null && !/^[-\d.\s]+$/.test(String(def.glyphView))) e("glyphView");
  if (def.passiveAc != null) {
    if (typeof def.passiveAc !== "boolean") e("passiveAcType");
    else if (def.passiveAc && def.category !== "armor") e("passiveAcCategory");
  }

  const trig = TRIGGER_DEFS[def.trigger];
  if (!trig) {
    e("triggerUnknown", { trigger: def.trigger });
  } else if (def.category && !trig.cats.includes(def.category)) {
    e("triggerCategory", { trigger: def.trigger, category: def.category });
  }

  if (def.save != null) {
    const s = def.save;
    if (typeof s !== "object") e("saveType");
    else {
      if (!SAVE_WHO.includes(s.who)) e("saveWho");
      else if (trig && !trig.roles.includes(s.who) && s.who !== "self") e("saveWhoTrigger", { who: s.who });
      if (!SAVE_ABILITIES.includes(s.ability)) e("saveAbility");
      const dc = Number(s.dc);
      if (!Number.isInteger(dc) || dc < 5 || dc > 30) e("saveDc");
      if (s.critAutoFails != null && typeof s.critAutoFails !== "boolean") e("saveCritType");
    }
  }

  if (def.uses != null) {
    if (typeof def.uses !== "object" || !USE_LIMITS.includes(def.uses.per)) e("usesPer");
  }

  if (!Array.isArray(def.actions) || def.actions.length < 1 || def.actions.length > 8) {
    e("actionsCount");
  } else {
    def.actions.forEach((a, i) => {
      const index = i + 1;
      const meta = ACTION_TYPES[a?.type];
      if (!meta) { e("actionType", { index, type: a?.type }); return; }
      if (a.type === "scripted") {
        if (typeof a.key !== "string" || !a.key) e("actionKey", { index });
        return;
      }
      if (meta.triggers && def.trigger && !meta.triggers.includes(def.trigger)) {
        e("actionTypeTrigger", { index, type: a.type, trigger: def.trigger });
      }
      if (a.rounds != null && a.rounds !== "die" && !(Number.isInteger(a.rounds) && a.rounds >= 1 && a.rounds <= 10)) {
        e("actionRounds", { index });
      }
      if (a.radius != null && !(Number.isInteger(a.radius) && a.radius >= 5 && a.radius <= 60)) {
        e("actionRadius", { index });
      }
      if (a.type === "cloud" || a.type === "contagion") {
        if (a.dc != null && !(Number.isInteger(a.dc) && a.dc >= 5 && a.dc <= 30)) e("actionDc", { index });
        if (a.ability != null && !SAVE_ABILITIES.includes(a.ability)) e("actionAbility", { index });
        if (a.status != null && !STATUS_KEYS.includes(a.status)) e("actionStatus", { index });
      }
      if (a.type === "cloud") {
        if (a.affects != null && !CLOUD_AFFECTS.includes(a.affects)) e("actionAffectsCloud", { index });
        if (a.immediate != null && typeof a.immediate !== "boolean") e("actionImmediate", { index });
      }
      if (a.type === "contagion") {
        if (a.affects != null && !CONTAGION_AFFECTS.includes(a.affects)) e("actionAffectsContagion", { index });
      }
      if (meta.point) {
        if (a.target != null && a.target !== "point") e("actionTargetPoint", { index, type: a.type });
      } else if (trig && !trig.roles.includes(a.target)) {
        e("actionTargetTrigger", { index, trigger: def.trigger });
      }
      if (a.onSave != null && !ON_SAVE.includes(a.onSave)) e("actionOnSave", { index });
      if (a.onSave === "half" && !(a.type === "damage" && a.kind === "damage")) e("actionOnSaveHalf", { index });
      if (a.type === "move" && !["away", "toward"].includes(a.dir)) e("actionDir", { index });
      if (a.type === "stat" && !STAT_KEYS.includes(a.stat)) e("actionStat", { index });
      if (a.type === "damage") {
        if (!["damage", "heal"].includes(a.kind)) e("actionKind", { index });
        if (a.kind === "damage" && !DAMAGE_TYPES.includes(a.dtype)) e("actionDtype", { index });
      }
      if (a.type === "status" && !STATUS_KEYS.includes(a.status)) e("actionStatus", { index });
      if (a.type === "reminder" && (typeof a.text !== "string" || !a.text.trim() || a.text.length > 200)) e("actionText", { index });
    });
  }

  return { ok: errors.length === 0, errors };
}

export function validateComboDef(combo, resolveRune) {
  const errors = [];
  const e = (code, data) => errors.push({ code, data: data ?? {} });
  if (!combo || typeof combo !== "object") return { ok: false, errors: [{ code: "notObject", data: {} }] };
  if (typeof combo.name !== "string" || !combo.name.trim() || combo.name.length > 60) e("name");
  if (typeof combo.color !== "string" || !HEX_COLOR.test(combo.color)) e("color");
  if (typeof combo.glyph !== "string" || !combo.glyph.trim()) e("comboGlyph");
  if (!Array.isArray(combo.runes) || combo.runes.length !== 3 || new Set(combo.runes).size !== 3) {
    e("comboRunesCount");
  } else {
    let category = null;
    for (const id of combo.runes) {
      const def = resolveRune ? resolveRune(id) : null;
      if (!def) { e("comboRuneUnresolved", { id }); continue; }
      if (category === null) category = def.category;
      else if (def.category !== category) e("comboRuneCategory");
    }
  }
  if (combo.skipSaveFor != null) {
    if (!Array.isArray(combo.skipSaveFor) || combo.skipSaveFor.some(id => !combo.runes?.includes(id))) {
      e("comboSkipSaveFor");
    }
  }
  if (combo.extraActions != null) {
    if (!Array.isArray(combo.extraActions) || combo.extraActions.length > 4) e("comboExtraActions");
  }
  if (typeof combo.description !== "string" || combo.description.length > 400) e("comboDescription");
  return { ok: errors.length === 0, errors };
}

export function formatValidationError(err) {
  return game.i18n.format(`${MODULE_ID}.validate.${err.code}`, err.data ?? {});
}

export function customRuneId(name) {
  return `custom.${slugifyRuneName(name)}-${foundry.utils.randomID(6)}`;
}
