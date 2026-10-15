import {
  TRIGGER_DEFS, SAVE_WHO, SAVE_ABILITIES, STAT_KEYS, DAMAGE_TYPES, STATUS_KEYS,
  GLYPH_CHOICES, ACTION_TYPES, CLOUD_AFFECTS, CONTAGION_AFFECTS, getCoreDefs,
  validateRuneDef, validateComboDef, formatValidationError,
  TELEPORT_DISTANCES, teleportDir, teleportFeet,
  actionUsesDie, actionUsesRoundsDie, isValidDieFormula, dieFormulaRange
} from "./rune-defs.js";
import {
  canForge, getCustomRunes, getCustomRunesByCategory, getRuneDef, saveCustomRune, deleteCustomRune,
  getCustomCombos, saveCustomCombo, deleteCustomCombo,
  exportRunesJson, importRunesJson
} from "./rune-store.js";
import { resolveFilePicker } from "./compat.js";
import { dnd5eDisplayDistance } from "./utils.js";

const MODULE_ID = "gm-runic-items";
const SVG_NS = "http://www.w3.org/2000/svg";
const SWATCH_COLORS = ["#5dade2", "#85c1e9", "#2e86c1", "#27ae60", "#2ecc71", "#1e8449", "#f1c40f", "#f39c12", "#e67e22", "#c0392b", "#a04000", "#8e44ad", "#a569bd", "#7f8c8d", "#d4621a", "#922b21"];
const ABILITY_COLORS = { str: "#e74c3c", dex: "#2ecc71", con: "#e67e22", int: "#3498db", wis: "#9b59b6", cha: "#f0a500" };
const STAT_OPT_KEYS = {
  "ac-bonus": "acBonus", "ac-penalty": "acPenalty", "speed-penalty": "speedPenalty",
  "speed-half": "speedHalf", "speed-zero": "speedZero", "disadv-attack": "disadvAttack", "disadv-check": "disadvCheck",
  "temp-hp": "tempHp", "resist-all": "resistAll", "init-adv": "initAdv",
  "deny-bonus": "denyBonus", "deny-reaction": "denyReaction"
};
const ACTION_ORDER = ["move", "stat", "damage", "status", "reminder", "brand", "contagion", "cloud", "allyDash", "guardianRush", "light", "teleport"];

function rf(key, data) {
  const str = game.i18n.localize(`${MODULE_ID}.runeforge.${key}`);
  if (!data) return str;
  return str.replace(/\{(\w+)\}/g, (match, k) => (k in data ? data[k] : match));
}

export function buildForgeGlyphSvg(glyph, color, size, opts = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  const view = opts.view ?? "0 0 24 24";
  svg.setAttribute("viewBox", view);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.classList.add("rune-glyph");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", glyph);
  if (opts.fill) {
    path.setAttribute("fill", color);
    path.setAttribute("stroke", "none");
    path.setAttribute("fill-rule", "evenodd");
  } else {
    const parts = String(view).trim().split(/[\s,]+/).map(Number);
    const scale = Math.max(parts[2] ?? 24, parts[3] ?? 24) / 24;
    path.setAttribute("stroke", color);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", String(1.6 * scale));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  path.classList.add("rune-path");
  svg.appendChild(path);
  return svg;
}

function defaultState(category) {
  return {
    editingId: null,
    locked: false,
    name: "",
    category: category ?? "melee",
    color: "#f0a500",
    glyph: GLYPH_CHOICES[0],
    glyphMode: "path",
    glyphView: null,
    cursed: false,
    passiveAc: false,
    trigger: "onHit",
    save: { on: false, who: "target", abil: "con", dc: 13, critAuto: false },
    limit: "none",
    actions: []
  };
}

export function stateFromDef(def, locked) {
  const src = def.template
    ? { ...def, save: def.template.save ?? null, uses: def.template.uses ?? null, actions: def.template.actions ?? [], passiveAc: def.template.passiveAc === true }
    : def;
  const trigger = TRIGGER_DEFS[src.trigger] ? src.trigger : "onHit";
  const trig = TRIGGER_DEFS[trigger];
  const declaredActions = (src.actions ?? []).filter(a => a.type !== "scripted").map(a => {
    const { type, target, onSave, ...cfg } = a;
    const point = ACTION_TYPES[type]?.point === true;
    return { type, target: point ? "point" : (trig.roles.includes(target) ? target : trig.roles[0]), onSave: onSave ?? "negate", cfg };
  });
  // fall back to the authored description
  const actions = declaredActions.length ? declaredActions : (src.description
    ? [{ type: "reminder", target: trig.roles[0], onSave: "negate", cfg: { text: src.description.length > 200 ? `${src.description.slice(0, 197)}...` : src.description } }]
    : []);
  return {
    editingId: locked ? null : def.id,
    locked,
    name: src.name,
    category: src.category,
    color: src.color,
    glyph: src.glyph,
    glyphMode: src.glyphMode ?? "path",
    glyphView: src.glyphView ?? null,
    cursed: src.cursed === true,
    passiveAc: src.passiveAc === true,
    trigger,
    save: src.save
      ? { on: true, who: src.save.who, abil: src.save.ability, dc: src.save.dc, critAuto: src.save.critAutoFails === true }
      : { on: false, who: "target", abil: "con", dc: 13, critAuto: false },
    limit: src.uses?.per ?? "none",
    actions
  };
}

export function stateToDef(st, description) {
  const trig = TRIGGER_DEFS[st.trigger];
  return {
    id: st.editingId,
    name: st.name.trim(),
    category: st.category,
    color: st.color,
    glyph: st.glyph,
    glyphMode: st.glyphMode,
    glyphView: st.glyphView ?? undefined,
    cursed: st.cursed,
    passiveAc: st.passiveAc === true && st.category === "armor" ? true : undefined,
    description,
    trigger: st.trigger,
    save: st.save.on
      ? { who: st.save.who, ability: st.save.abil, dc: st.save.dc, critAutoFails: st.save.critAuto }
      : null,
    uses: st.limit === "none" ? null : { per: st.limit },
    actions: st.actions.map(a => {
      const out = { type: a.type, ...a.cfg };
      if (ACTION_TYPES[a.type]?.point) out.target = "point";
      else out.target = trig.roles.includes(a.target) ? a.target : trig.roles[0];
      if (st.save.on) out.onSave = a.onSave;
      return out;
    })
  };
}

function whoPhrase(role, category, radius = 15) {
  if (role === "self") return rf(category === "armor" ? "phrase.who.selfArmor" : "phrase.who.self");
  if (role === "allies" || role === "enemies" || role === "area") {
    const d = dnd5eDisplayDistance(radius);
    return rf(`phrase.who.${role}`, { radius: d.value, unit: d.unit });
  }
  return rf(`phrase.who.${role}`);
}

const DIE_UNITS = {
  move: { key: "squares", mult: 5 },
  allyDash: { key: "squares", mult: 5 },
  damage: { key: "damage", mult: 1 },
  brand: { key: "damage", mult: 1 },
  contagion: { key: "damage", mult: 1 },
  cloud: { key: "cloudDamage", mult: 1 }
};

const DIE_WARN_MAX = { cloud: 20 };
const DIE_WARN_DEFAULT = 40;

function dieUnitFor(flat) {
  if (flat.type === "damage" && flat.kind === "heal") return { key: "healing", mult: 1 };
  if (flat.type === "stat") {
    if (flat.stat === "temp-hp") return { key: "tempHp", mult: 1 };
    if (flat.stat === "speed-penalty") return { key: "squares", mult: 5 };
    return null;
  }
  if (DIE_UNITS[flat.type]) return DIE_UNITS[flat.type];
  return null;
}

const ROUNDS_UNIT = { key: "rounds", mult: 1 };

// duration pills stop at 10
const ROUNDS_WARN_MAX = 10;

const DURATION_STATS = new Set(["ac-bonus", "ac-penalty", "speed-penalty", "speed-half", "speed-zero", "disadv-attack", "disadv-check", "resist-all", "deny-bonus", "deny-reaction"]);

function dieSub(text, value, token, index) {
  const v = typeof value === "string" ? value.trim() : "";
  return String(text).split("{die}").join(v || `{${token}${index + 1}}`);
}

function actionPhrase(a, category, index = 0) {
  const withDie = text => dieSub(text, a.cfg.die, "die", index);
  let base = "";
  if (a.type === "move") {
    const d = dnd5eDisplayDistance(5);
    base = rf(`phrase.action.move.${a.cfg.dir ?? "away"}`, { pip: d.value, unit: d.unit });
  }
  else if (a.type === "stat") {
    const statKey = STAT_OPT_KEYS[a.cfg.stat];
    if (!statKey) console.warn(`[gm-runic-items] no label mapped for stat "${a.cfg.stat}"`);
    if (statKey === "speedPenalty") {
      const d = dnd5eDisplayDistance(5);
      base = rf("phrase.action.stat.speedPenalty", { pip: d.value, unit: d.unit });
    } else base = rf(`phrase.action.stat.${statKey}`);
  }
  else if (a.type === "damage") {
    if (a.cfg.kind === "heal") return withDie(rf("phrase.action.heal"));
    const cfg = CONFIG.DND5E?.damageTypes?.[a.cfg.dtype];
    const type = cfg ? game.i18n.localize(cfg.label ?? cfg) : (a.cfg.dtype ?? "");
    base = rf("phrase.action.damage", { type });
  }
  else if (a.type === "status") {
    const entry = CONFIG.statusEffects?.find(s => s.id === a.cfg.status);
    base = rf("phrase.action.status", { status: entry ? game.i18n.localize(entry.name) : a.cfg.status });
  }
  else if (a.type === "reminder") return a.cfg.text ?? "";
  else if (a.type === "brand") base = rf("phrase.action.brand");
  else if (a.type === "contagion") base = rf("phrase.action.contagion", { dc: a.cfg.dc ?? 13, ability: String(a.cfg.ability ?? "con").toUpperCase() });
  else if (a.type === "light") { const d = dnd5eDisplayDistance(20); base = rf("phrase.action.light", { radius: d.value, unit: d.unit }); }
  else if (a.type === "teleport") {
    const d = dnd5eDisplayDistance(teleportFeet(a.cfg.distance));
    base = rf(`phrase.action.teleport.${teleportDir(a.cfg.dir, a.target)}`, { radius: d.value, unit: d.unit });
  }
  const r = a.cfg.rounds ?? 1;
  const hasDuration = (a.type === "stat" && DURATION_STATS.has(a.cfg.stat)) || a.type === "contagion";
  let tail = "";
  if (r === "die") tail = dieSub(rf("phrase.forRoundsDie"), a.cfg.roundsDie, "rdie", index);
  else if (Number(r) > 1) tail = rf("phrase.forRounds", { rounds: r });
  else if (hasDuration) tail = rf("phrase.forRound");
  return withDie(base) + tail;
}

export function buildDescription(st) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const join = arr => arr.length === 1 ? arr[0] : arr.slice(0, -1).join(", ") + " " + rf("phrase.and") + " " + arr[arr.length - 1];
  let lead;
  if (st.trigger === "proximity") {
    const d = dnd5eDisplayDistance(10);
    lead = rf("phrase.trigger.proximity", { radius: d.value, unit: d.unit });
  } else lead = rf(`phrase.trigger.${st.trigger}`);
  const sentences = [];
  const standalone = [];

  const groups = [];
  st.actions.forEach((a, i) => {
    if (ACTION_TYPES[a.type]?.point) {
      let pointData;
      if (a.type === "cloud") { const d = dnd5eDisplayDistance(7.5); pointData = { radius: d.value, unit: d.unit }; }
      else if (a.type === "allyDash") { const d = dnd5eDisplayDistance(5); pointData = { pip: d.value, unit: d.unit }; }
      standalone.push(dieSub(rf(`phrase.action.${a.type}`, pointData), a.cfg.die, "die", i));
      return;
    }
    const radius = a.cfg.radius ?? 15;
    const key = `${a.target}|${radius}|${st.save.on ? a.onSave : "none"}`;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, target: a.target, radius, onSave: a.onSave, phrases: [] }; groups.push(g); }
    g.phrases.push(actionPhrase(a, st.category, i));
  });

  const suffix = g => {
    if (!st.save.on) return "";
    if (g.onSave === "half") return rf("phrase.onSaveHalf");
    if (g.onSave === "full") return rf("phrase.onSaveFull");
    return g.target === st.save.who ? "" : rf("phrase.onSaveFail");
  };

  let leadUsed = false;
  if (st.save.on) {
    const saveClause = rf("phrase.save", { who: whoPhrase(st.save.who, st.category), dc: st.save.dc, ability: st.save.abil.toUpperCase() });
    const attached = groups.filter(g => g.target === st.save.who && g.onSave === "negate");
    let first = `${lead} ${saveClause}`;
    if (attached.length) first += ` ${rf("phrase.saveOr")} ${join(attached.flatMap(g => g.phrases))}`;
    sentences.push(first + ".");
    leadUsed = true;
    for (const g of groups) {
      if (attached.includes(g)) continue;
      sentences.push(cap(`${whoPhrase(g.target, st.category, g.radius)} ${join(g.phrases)}${suffix(g)}.`));
    }
  } else {
    groups.forEach((g, i) => {
      const body = `${whoPhrase(g.target, st.category, g.radius)} ${join(g.phrases)}.`;
      if (i === 0) { sentences.push(`${lead} ${body}`); leadUsed = true; }
      else sentences.push(cap(body));
    });
  }
  for (const s of standalone) {
    if (!leadUsed) { sentences.push(`${lead} ${s.charAt(0).toLowerCase()}${s.slice(1)}`); leadUsed = true; }
    else sentences.push(s);
  }
  if (!sentences.length) sentences.push(lead);
  if (st.save.on && st.save.critAuto) sentences.push(rf("phrase.critAuto"));
  if (st.passiveAc) sentences.push(rf("phrase.passiveAc"));
  if (st.limit !== "none") sentences.push(rf(`phrase.limit.${st.limit}`));
  return sentences.join(" ");
}

let _app = null;

export function openRuneforge(opts = {}) {
  if (!canForge()) return;
  if (!_app) _app = new RuneforgeApp();
  if (opts.category) {
    _app.st = defaultState(opts.category);
    _app.view = "editor";
  }
  _app.render(true);
}

const AppV2 = foundry.applications.api.ApplicationV2;

export class RuneforgeApp extends AppV2 {
  static DEFAULT_OPTIONS = {
    id: "runeforge-app",
    classes: ["runeforge-app"],
    window: { title: "gm-runic-items.runeforge.title", resizable: true },
    position: { width: 1040, height: 720 }
  };

  constructor(options = {}) {
    super(options);
    this.view = "library";
    this.st = defaultState("melee");
    this.comboSt = { category: "melee", slots: [null, null, null], name: "", description: "", color: "#5dade2", glyph: GLYPH_CHOICES[13], skipSaveFor: [], editingId: null };
  }

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "rf-root";
    this._root = root;
    this._buildChrome(root);
    this._showView(this.view);
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _buildChrome(root) {
    const tabs = document.createElement("nav");
    tabs.className = "rf-tabs";
    for (const view of ["library", "editor", "combo"]) {
      const tab = document.createElement("a");
      tab.className = "rf-tab";
      tab.dataset.view = view;
      tab.textContent = rf(`tabs.${view}`);
      tab.addEventListener("click", () => this._showView(view));
      tabs.appendChild(tab);
    }
    root.appendChild(tabs);
    const body = document.createElement("div");
    body.className = "rf-body";
    root.appendChild(body);
    this._body = body;
  }

  _showView(view) {
    const sameView = this.view === view && this._body;
    const scrollTop = sameView ? this._body.scrollTop : 0;
    this.view = view;
    if (!this._root) return;
    this._root.querySelectorAll(".rf-tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
    this._body.replaceChildren();
    if (view === "library") this._buildLibrary();
    else if (view === "editor") this._buildEditor();
    else this._buildCombo();
    if (sameView) this._body.scrollTop = scrollTop;
  }

  _openInEditor(def, locked) {
    this.st = stateFromDef(def, locked);
    this._showView("editor");
  }

  /* Library */
  _buildLibrary() {
    const body = this._body;
    const bar = document.createElement("div");
    bar.className = "rf-toolbar";
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `rf-btn ${cls}`;
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    bar.appendChild(mkBtn(rf("lib.new"), "", () => { this.st = defaultState(this.st.category); this._showView("editor"); }));
    const spacer = document.createElement("span");
    spacer.className = "rf-spacer";
    bar.appendChild(spacer);
    const mkIconBtn = (icon, tip, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rf-btn ghost rf-icon-btn";
      b.dataset.tooltip = tip;
      b.setAttribute("aria-label", tip);
      const i = document.createElement("i");
      i.className = `fas ${icon}`;
      b.appendChild(i);
      b.addEventListener("click", fn);
      return b;
    };
    bar.appendChild(mkIconBtn("fa-angles-up", rf("lib.collapseAll"), () => this._toggleAllSections(true)));
    bar.appendChild(mkIconBtn("fa-angles-down", rf("lib.expandAll"), () => this._toggleAllSections(false)));
    bar.appendChild(mkBtn(rf("lib.import"), "ghost", () => this._importDialog()));
    bar.appendChild(mkBtn(rf("lib.export"), "ghost", () => this._exportAll()));
    body.appendChild(bar);

    const filter = this._libraryFilter();
    const subtabs = document.createElement("div");
    subtabs.className = "rf-subtabs";
    for (const [key, labelKey] of [["all", "lib.filterAll"], ["mine", "lib.filterCustom"], ["core", "lib.filterCore"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `rf-subtab${filter === key ? " active" : ""}`;
      b.textContent = rf(labelKey);
      b.addEventListener("click", () => {
        if (this._libraryFilter() === key) return;
        game.settings.set(MODULE_ID, "libraryFilter", key);
        this._showView("library");
      });
      subtabs.appendChild(b);
    }
    body.appendChild(subtabs);

    const collapsed = this._collapsedSections();

    const addSection = (key, labelKey, cls, defs, locked) => {
      const shut = collapsed.has(key);

      const head = document.createElement("div");
      head.className = `rf-cat-head ${cls}${shut ? " is-collapsed" : ""}`;
      head.dataset.rfSection = key;
      head.setAttribute("role", "button");
      head.setAttribute("aria-expanded", String(!shut));
      head.tabIndex = 0;

      const caret = document.createElement("i");
      caret.className = "fas fa-chevron-down rf-cat-caret";
      head.appendChild(caret);

      const label = document.createElement("span");
      label.className = "rf-cat-label";
      label.textContent = rf(labelKey);
      head.appendChild(label);

      const count = document.createElement("span");
      count.className = "rf-cat-count";
      count.textContent = String(defs.length);
      head.appendChild(count);

      const grid = document.createElement("div");
      grid.className = `rf-card-grid${shut ? " is-collapsed" : ""}`;
      grid.dataset.rfSection = key;
      if (!defs.length) {
        const empty = document.createElement("div");
        empty.className = "rf-empty";
        empty.textContent = rf("lib.empty");
        grid.appendChild(empty);
      }
      for (const def of defs) grid.appendChild(this._runeCard(def, locked));

      const toggle = () => this._toggleSection(key, head, grid);
      caret.addEventListener("click", e => { e.stopPropagation(); toggle(); });
      head.addEventListener("dblclick", e => {
        e.preventDefault();
        toggle();
      });
      head.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggle();
      });

      body.appendChild(head);
      body.appendChild(grid);
    };

    if (filter !== "core") {
      addSection("mine-melee", "lib.customMelee", "rf-cat-melee rf-cat-mine", getCustomRunesByCategory("melee"), false);
      addSection("mine-ranged", "lib.customRanged", "rf-cat-ranged rf-cat-mine", getCustomRunesByCategory("ranged"), false);
      addSection("mine-armor", "lib.customArmor", "rf-cat-armor rf-cat-mine", getCustomRunesByCategory("armor"), false);
    }
    if (filter !== "mine") {
      addSection("core-melee", "lib.coreMelee", "rf-cat-melee", getCoreDefs("melee"), true);
      addSection("core-ranged", "lib.coreRanged", "rf-cat-ranged", getCoreDefs("ranged"), true);
      addSection("core-armor", "lib.coreArmor", "rf-cat-armor", getCoreDefs("armor"), true);
    }
  }

  _libraryFilter() {
    const v = game.settings.get(MODULE_ID, "libraryFilter");
    return ["all", "mine", "core"].includes(v) ? v : "all";
  }

  _collapsedSections() {
    const stored = game.settings.get(MODULE_ID, "libraryCollapsed");
    return new Set(Array.isArray(stored) ? stored : []);
  }

  _applySectionState(head, grid, shut) {
    head.classList.toggle("is-collapsed", shut);
    grid.classList.toggle("is-collapsed", shut);
    head.setAttribute("aria-expanded", String(!shut));
  }

  _toggleSection(key, head, grid) {
    const collapsed = this._collapsedSections();
    const shut = !collapsed.has(key);
    if (shut) collapsed.add(key);
    else collapsed.delete(key);
    this._applySectionState(head, grid, shut);
    game.settings.set(MODULE_ID, "libraryCollapsed", Array.from(collapsed));
  }

  _toggleAllSections(shut) {
    const collapsed = this._collapsedSections();
    for (const head of this._body.querySelectorAll(".rf-cat-head[data-rf-section]")) {
      const key = head.dataset.rfSection;
      const grid = this._body.querySelector(`.rf-card-grid[data-rf-section="${key}"]`);
      if (!grid) continue;
      this._applySectionState(head, grid, shut);
      if (shut) collapsed.add(key);
      else collapsed.delete(key);
    }
    game.settings.set(MODULE_ID, "libraryCollapsed", Array.from(collapsed));
  }

  _runeCard(def, locked) {
    const card = document.createElement("div");
    card.className = `rf-card ${locked ? "core" : "mine"}`;
    card.style.setProperty("--rune-color", def.color);

    const visual = document.createElement("div");
    visual.className = "rf-card-visual";
    const sock = document.createElement("div");
    sock.className = "rf-card-sock";
    sock.appendChild(buildForgeGlyphSvg(def.glyph, def.color, 24, { fill: def.glyphMode === "silhouette", view: def.glyphView }));
    visual.appendChild(sock);
    card.appendChild(visual);

    const fold = document.createElement("div");
    fold.className = "rf-card-fold";
    card.appendChild(fold);

    const badge = document.createElement("span");
    badge.className = `rf-card-badge ${locked ? "core" : "mine"}`;
    badge.textContent = rf(locked ? "lib.core" : "lib.customBadge");
    card.appendChild(badge);

    if (!locked) {
      const del = document.createElement("span");
      del.className = "rf-card-del";
      del.innerHTML = "&#x2715;";
      del.dataset.tooltip = rf("act.remove");
      del.addEventListener("click", async e => {
        e.stopPropagation();
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: rf("title") },
          content: `<p>${rf("lib.confirmDelete", { name: def.name })}</p>`,
          rejectClose: false
        });
        if (!ok) return;
        await deleteCustomRune(def.id);
        ui.notifications.info(rf("lib.deleted", { name: def.name }));
        this._showView("library");
      });
      card.appendChild(del);
    }

    const strip = document.createElement("div");
    strip.className = "rf-card-strip";
    const name = document.createElement("div");
    name.className = "rf-card-name";
    name.textContent = def.name;
    strip.appendChild(name);
    card.appendChild(strip);

    card.addEventListener("click", () => this._openInEditor(def, locked));
    return card;
  }

  _exportAll() {
    const json = exportRunesJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "runic-items-custom-runes.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    ui.notifications.info(rf("lib.exportDone"));
  }

  async _importDialog() {
    const content = `<input type="file" name="runeFile" accept=".json,application/json" style="width:100%">`;
    const file = await foundry.applications.api.DialogV2.prompt({
      window: { title: rf("lib.import") },
      content,
      ok: {
        label: rf("lib.import"),
        callback: (event, button) => button.form.elements.runeFile.files?.[0] ?? null
      },
      rejectClose: false
    });
    if (!file) return;
    const text = await file.text();
    const result = await importRunesJson(text);
    ui.notifications.info(rf("lib.importResult", { runes: result.runes, combos: result.combos }));
    if (result.errors.length) {
      ui.notifications.warn(rf("lib.importErrors", { errors: result.errors.join(" | ") }));
      console.warn(`[${MODULE_ID}] import errors:`, result.errors);
    }
    this._showView("library");
  }

  /* Editor */
  _buildEditor() {
    const st = this.st;
    const body = this._body;

    if (st.locked) {
      const banner = document.createElement("div");
      banner.className = "rf-locked-banner";
      const text = document.createElement("span");
      text.textContent = rf("locked.text");
      banner.appendChild(text);
      const dup = document.createElement("button");
      dup.type = "button";
      dup.textContent = rf("locked.duplicate");
      dup.addEventListener("click", () => {
        st.locked = false;
        st.editingId = null;
        st.name = `${st.name} ${rf("locked.copySuffix")}`;
        this._showView("editor");
      });
      banner.appendChild(dup);
      const fresh = document.createElement("button");
      fresh.type = "button";
      fresh.className = "rf-locked-new";
      fresh.textContent = rf("locked.new");
      fresh.addEventListener("click", () => {
        this.st = defaultState(st.category);
        this._showView("editor");
      });
      banner.appendChild(fresh);
      body.appendChild(banner);
    }

    const grid = document.createElement("div");
    grid.className = "rf-ed-grid";
    body.appendChild(grid);

    const form = document.createElement("div");
    form.className = "rf-ed-form rf-steps" + (st.locked ? " locked" : "");
    grid.appendChild(form);

    form.appendChild(this._sectionIdentity());
    form.appendChild(this._sectionTrigger());
    form.appendChild(this._sectionSave());
    form.appendChild(this._sectionLimit());
    form.appendChild(this._sectionActions());

    const pv = document.createElement("div");
    pv.className = "rf-preview";
    grid.appendChild(pv);
    this._pv = pv;
    this._renderPreview();
  }

  _section(labelKey, step) {
    const sec = document.createElement("fieldset");
    sec.className = "rf-section";
    const legend = document.createElement("legend");
    const num = document.createElement("span");
    num.className = "rf-step-num";
    num.textContent = String(step);
    legend.appendChild(num);
    legend.appendChild(document.createTextNode(rf(labelKey)));
    sec.appendChild(legend);
    return sec;
  }

  _pills(options, current, onPick, colors = null) {
    const row = document.createElement("div");
    row.className = "rf-pill-row";
    for (const [value, label] of options) {
      const pill = document.createElement("span");
      pill.className = "rf-pill" + (value === current ? " on" : "");
      if (colors?.[value]) pill.style.setProperty("--pc", colors[value]);
      pill.textContent = label;
      pill.addEventListener("click", () => onPick(value));
      row.appendChild(pill);
    }
    return row;
  }

  _sectionIdentity() {
    const st = this.st;
    const sec = this._section("step.identity", 1);

    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = rf("identity.namePh");
    name.value = st.name;
    name.addEventListener("input", () => { st.name = name.value; this._renderPreview(); });
    sec.appendChild(name);

    const catRow = this._pills(
      ["melee", "ranged", "armor"].map(c => [c, game.i18n.localize(`${MODULE_ID}.presets.${c}`)]),
      st.category,
      value => {
        st.category = value;
        if (value !== "armor") st.passiveAc = false;
        const trig = TRIGGER_DEFS[st.trigger];
        if (!trig?.cats.includes(value)) {
          st.trigger = Object.entries(TRIGGER_DEFS).find(([, t]) => t.cats.includes(value))[0];
        }
        this._sanitizeTargets();
        this._showView("editor");
      },
      { melee: "#c0392b", ranged: "#27ae60", armor: "#2e86c1" }
    );
    catRow.style.marginTop = "8px";
    sec.appendChild(catRow);

    const swatches = document.createElement("div");
    swatches.className = "rf-swatches";
    for (const c of SWATCH_COLORS) {
      const s = document.createElement("span");
      s.className = "rf-swatch" + (c === st.color ? " on" : "");
      s.style.background = c;
      s.addEventListener("click", () => { st.color = c; this._showView("editor"); });
      swatches.appendChild(s);
    }
    sec.appendChild(swatches);

    const glyphGrid = document.createElement("div");
    glyphGrid.className = "rf-glyph-grid";
    for (const g of GLYPH_CHOICES) {
      const cell = document.createElement("div");
      const selected = g === st.glyph && st.glyphMode === "path" && !st.glyphView;
      cell.className = "rf-glyph-cell" + (selected ? " on" : "");
      cell.style.setProperty("--rune-color", st.color);
      cell.appendChild(buildForgeGlyphSvg(g, selected ? st.color : "rgba(255,255,255,0.4)", 20));
      cell.addEventListener("click", () => {
        st.glyph = g;
        st.glyphMode = "path";
        st.glyphView = null;
        this._showView("editor");
      });
      glyphGrid.appendChild(cell);
    }
    sec.appendChild(glyphGrid);

    const tools = document.createElement("div");
    tools.className = "rf-glyph-tools";
    const browse = document.createElement("button");
    browse.type = "button";
    browse.className = "rf-btn ghost";
    browse.textContent = rf("identity.browse");
    browse.addEventListener("click", () => this._browseSvg());
    tools.appendChild(browse);
    sec.appendChild(tools);

    const cursed = document.createElement("label");
    cursed.className = "rf-chk";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = st.cursed;
    box.addEventListener("change", () => { st.cursed = box.checked; this._renderPreview(); });
    cursed.appendChild(box);
    cursed.appendChild(document.createTextNode(` ${rf("identity.cursed")}`));
    sec.appendChild(cursed);

    if (st.category === "armor") {
      const pac = document.createElement("label");
      pac.className = "rf-chk";
      const pbox = document.createElement("input");
      pbox.type = "checkbox";
      pbox.checked = st.passiveAc;
      pbox.addEventListener("change", () => { st.passiveAc = pbox.checked; this._renderPreview(); });
      pac.appendChild(pbox);
      pac.appendChild(document.createTextNode(` ${rf("identity.passiveAc")}`));
      sec.appendChild(pac);
    }

    return sec;
  }

  async _browseSvg() {
    const cls = resolveFilePicker();
    const picker = new cls({
      type: "image",
      callback: async path => {
        if (!/\.svg(\?.*)?$/i.test(path)) {
          ui.notifications.warn(rf("svg.pickImage"));
          return;
        }
        try {
          const text = await (await fetch(path)).text();
          const parsed = this._extractSvgPaths(text);
          if (!parsed) throw new Error("no drawable shapes found");
          await this._svgModeDialog(parsed);
        } catch (err) {
          ui.notifications.warn(rf("svg.failed", { error: err.message }));
        }
      }
    });
    picker.browse();
  }

  _extractSvgPaths(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg || doc.querySelector("parsererror")) return null;
    const parts = [];
    const num = v => Number(v) || 0;
    for (const el of svg.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon")) {
      const tag = el.tagName.toLowerCase();
      if (tag === "path") {
        const d = el.getAttribute("d");
        if (d) parts.push(d);
      } else if (tag === "rect") {
        const x = num(el.getAttribute("x")), y = num(el.getAttribute("y"));
        const w = num(el.getAttribute("width")), h = num(el.getAttribute("height"));
        if (w && h) parts.push(`M${x},${y}H${x + w}V${y + h}H${x}Z`);
      } else if (tag === "circle" || tag === "ellipse") {
        const cx = num(el.getAttribute("cx")), cy = num(el.getAttribute("cy"));
        const rx = tag === "circle" ? num(el.getAttribute("r")) : num(el.getAttribute("rx"));
        const ry = tag === "circle" ? rx : num(el.getAttribute("ry"));
        if (rx && ry) parts.push(`M${cx - rx},${cy}A${rx},${ry},0,1,0,${cx + rx},${cy}A${rx},${ry},0,1,0,${cx - rx},${cy}Z`);
      } else if (tag === "line") {
        parts.push(`M${num(el.getAttribute("x1"))},${num(el.getAttribute("y1"))}L${num(el.getAttribute("x2"))},${num(el.getAttribute("y2"))}`);
      } else {
        const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
        if (pts.length >= 4) {
          let d = `M${pts[0]},${pts[1]}`;
          for (let i = 2; i < pts.length - 1; i += 2) d += `L${pts[i]},${pts[i + 1]}`;
          if (tag === "polygon") d += "Z";
          parts.push(d);
        }
      }
    }
    if (!parts.length) return null;
    const d = parts.join(" ");

    // measure real bounds for a tight fit
    const measure = document.createElementNS(SVG_NS, "svg");
    measure.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:10px;height:10px";
    const mp = document.createElementNS(SVG_NS, "path");
    mp.setAttribute("d", d);
    measure.appendChild(mp);
    document.body.appendChild(measure);
    let view = svg.getAttribute("viewBox");
    try {
      const box = mp.getBBox();
      if (box.width > 0 && box.height > 0) {
        const pad = Math.max(box.width, box.height) * 0.06;
        view = `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`;
      }
    } catch (err) {
      // keep previous box if measurement fails
    } finally {
      measure.remove();
    }
    return { d, view: view ?? "0 0 24 24" };
  }

  async _svgModeDialog(parsed) {
    const st = this.st;
    const content = document.createElement("div");
    content.className = "rf-svg-preview-row";
    for (const mode of ["path", "silhouette"]) {
      const cell = document.createElement("div");
      cell.className = "rf-svg-preview";
      const sock = document.createElement("div");
      sock.className = "rf-card-sock";
      sock.appendChild(buildForgeGlyphSvg(parsed.d, st.color, 28, { fill: mode === "silhouette", view: parsed.view }));
      cell.appendChild(sock);
      const label = document.createElement("div");
      label.className = "rf-svg-label";
      label.textContent = rf(`svg.${mode}`);
      cell.appendChild(label);
      const note = document.createElement("div");
      note.className = "rf-svg-note";
      note.textContent = rf(`svg.${mode}Note`);
      cell.appendChild(note);
      content.appendChild(cell);
    }
    const mode = await foundry.applications.api.DialogV2.wait({
      window: { title: rf("svg.title") },
      content: content.outerHTML,
      buttons: [
        { action: "path", label: rf("svg.path"), default: true },
        { action: "silhouette", label: rf("svg.silhouette") },
        { action: "cancel", label: game.i18n.localize(`${MODULE_ID}.common.cancel`) }
      ],
      rejectClose: false
    });
    if (mode !== "path" && mode !== "silhouette") return;
    st.glyph = parsed.d;
    st.glyphView = parsed.view;
    st.glyphMode = mode;
    this._showView("editor");
  }

  _sectionTrigger() {
    const st = this.st;
    const sec = this._section("step.trigger", 2);
    const row = document.createElement("div");
    row.className = "rf-trig-row";
    for (const [id, trig] of Object.entries(TRIGGER_DEFS)) {
      if (!trig.cats.includes(st.category)) continue;
      const card = document.createElement("div");
      card.className = "rf-trig-card" + (id === st.trigger ? " on" : "");
      card.style.setProperty("--rune-color", st.color);
      const name = document.createElement("div");
      name.className = "rf-trig-name";
      name.textContent = rf(`trigger.${id}.name`);
      card.appendChild(name);
      const desc = document.createElement("div");
      desc.className = "rf-trig-desc";
      let triggerDescData;
      if (id === "turnStart" || id === "turnEnd") { const d = dnd5eDisplayDistance(15); triggerDescData = { radius: d.value, unit: d.unit }; }
      else if (id === "proximity") { const d = dnd5eDisplayDistance(10); triggerDescData = { radius: d.value, unit: d.unit }; }
      desc.textContent = rf(`trigger.${id}.desc`, triggerDescData);
      card.appendChild(desc);
      card.addEventListener("click", () => {
        st.trigger = id;
        this._sanitizeTargets();
        this._showView("editor");
      });
      row.appendChild(card);
    }
    sec.appendChild(row);
    return sec;
  }

  _sanitizeTargets() {
    const st = this.st;
    const roles = TRIGGER_DEFS[st.trigger].roles;
    st.actions = st.actions.filter(a => {
      const meta = ACTION_TYPES[a.type];
      return !meta?.triggers || meta.triggers.includes(st.trigger);
    });
    for (const a of st.actions) {
      if (ACTION_TYPES[a.type]?.point) continue;
      if (!roles.includes(a.target)) a.target = roles[0];
    }
    const whoOpts = this._whoOptions();
    if (!whoOpts.includes(st.save.who)) st.save.who = whoOpts[0];
  }

  _whoOptions() {
    const roles = TRIGGER_DEFS[this.st.trigger].roles.filter(r => SAVE_WHO.includes(r));
    if (!roles.includes("self")) roles.push("self");
    return roles;
  }

  _roleLabel(role) {
    if (role === "self") return rf(this.st.category === "armor" ? "who.selfArmor" : "who.self");
    return rf(`who.${role}`);
  }

  _sectionSave() {
    const st = this.st;
    const sec = this._section("step.save", 3);

    const toggleRow = document.createElement("label");
    toggleRow.className = "rf-chk";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = st.save.on;
    box.addEventListener("change", () => { st.save.on = box.checked; this._showView("editor"); });
    toggleRow.appendChild(box);
    toggleRow.appendChild(document.createTextNode(` ${rf("save.enable")}`));
    sec.appendChild(toggleRow);

    if (!st.save.on) return sec;

    const whoLabel = document.createElement("div");
    whoLabel.className = "rf-dim-label";
    whoLabel.textContent = rf("save.who");
    sec.appendChild(whoLabel);
    sec.appendChild(this._pills(
      this._whoOptions().map(r => [r, this._roleLabel(r)]),
      st.save.who,
      value => { st.save.who = value; this._showView("editor"); }
    ));

    const abilLabel = document.createElement("div");
    abilLabel.className = "rf-dim-label";
    abilLabel.textContent = rf("save.ability");
    sec.appendChild(abilLabel);
    sec.appendChild(this._pills(
      SAVE_ABILITIES.map(a => [a, a.toUpperCase()]),
      st.save.abil,
      value => { st.save.abil = value; this._showView("editor"); },
      ABILITY_COLORS
    ));

    const dcRow = document.createElement("div");
    dcRow.className = "rf-dc-row";
    const dcLabel = document.createElement("span");
    dcLabel.className = "rf-dim-label";
    dcLabel.textContent = rf("save.dc");
    dcRow.appendChild(dcLabel);
    const mkStep = (delta, symbol) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = symbol;
      b.addEventListener("click", () => {
        st.save.dc = Math.max(5, Math.min(30, st.save.dc + delta));
        val.textContent = String(st.save.dc);
        this._renderPreview();
      });
      return b;
    };
    dcRow.appendChild(mkStep(-1, "-"));
    const val = document.createElement("span");
    val.className = "rf-dc-val";
    val.textContent = String(st.save.dc);
    dcRow.appendChild(val);
    dcRow.appendChild(mkStep(1, "+"));

    const crit = document.createElement("label");
    crit.className = "rf-chk inline";
    const critBox = document.createElement("input");
    critBox.type = "checkbox";
    critBox.checked = st.save.critAuto;
    critBox.addEventListener("change", () => { st.save.critAuto = critBox.checked; this._renderPreview(); });
    crit.appendChild(critBox);
    crit.appendChild(document.createTextNode(` ${rf("save.critAuto")}`));
    dcRow.appendChild(crit);
    sec.appendChild(dcRow);

    return sec;
  }

  _sectionLimit() {
    const st = this.st;
    const sec = this._section("step.limit", 4);
    sec.appendChild(this._pills(
      ["none", "round", "combat", "rest"].map(l => [l, rf(`limit.${l}`)]),
      st.limit,
      value => { st.limit = value; this._showView("editor"); }
    ));
    return sec;
  }

  _sectionActions() {
    const st = this.st;
    const sec = this._section("step.actions", 5);
    const list = document.createElement("div");
    list.className = "rf-action-list";
    st.actions.forEach((a, i) => list.appendChild(this._actionRow(a, i)));
    sec.appendChild(list);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "rf-add-action";
    add.textContent = rf("act.add");
    sec.appendChild(add);

    const palette = document.createElement("div");
    palette.className = "rf-action-palette";
    palette.style.display = "none";
    for (const type of ACTION_ORDER) {
      const meta = ACTION_TYPES[type];
      if (meta?.triggers && !meta.triggers.includes(st.trigger)) continue;
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "rf-btn ghost";
      opt.textContent = rf(`action.${type}.label`);
      opt.addEventListener("click", () => {
        const roles = TRIGGER_DEFS[st.trigger].roles;
        const defaults = {
          move: { dir: "away" }, stat: { stat: "speed-penalty" },
          damage: { kind: "damage", dtype: "fire" }, status: { status: "poisoned" },
          reminder: { text: "" }, brand: {}, contagion: { dc: 13, ability: "con", status: "poisoned" },
          cloud: { dc: 13, ability: "con", affects: "all", immediate: true },
          allyDash: { radius: 30 }, guardianRush: {}, light: {},
          teleport: { dir: teleportDir(null, meta?.point ? "point" : roles[0]), distance: 15 }
        };
        st.actions.push({ type, target: meta?.point ? "point" : roles[0], onSave: "negate", cfg: defaults[type] });
        this._showView("editor");
      });
      palette.appendChild(opt);
    }
    sec.appendChild(palette);
    add.addEventListener("click", () => {
      palette.style.display = palette.style.display === "none" ? "flex" : "none";
    });
    return sec;
  }

  _actionRow(a, index) {
    const st = this.st;
    const row = document.createElement("div");
    row.className = "rf-action-row";

    const head = document.createElement("div");
    head.className = "rf-action-head";

    const ord = document.createElement("span");
    ord.className = "rf-a-ord";
    ord.textContent = String(index + 1);
    head.appendChild(ord);

    const mkArrow = (delta, symbol, disabled) => {
      const b = document.createElement("span");
      b.className = "rf-a-arrow" + (disabled ? " off" : "");
      b.innerHTML = symbol;
      b.addEventListener("click", e => {
        e.stopPropagation();
        if (disabled) return;
        st.actions.splice(index + delta, 0, st.actions.splice(index, 1)[0]);
        this._showView("editor");
      });
      return b;
    };
    head.appendChild(mkArrow(-1, "&#x25B2;", index === 0));
    head.appendChild(mkArrow(1, "&#x25BC;", index === st.actions.length - 1));

    const title = document.createElement("span");
    title.className = "rf-a-title";
    title.textContent = rf(`action.${a.type}.label`);
    head.appendChild(title);

    const sum = document.createElement("span");
    sum.className = "rf-a-sum";
    sum.textContent = actionPhrase(a, st.category);
    head.appendChild(sum);

    const del = document.createElement("span");
    del.className = "rf-a-del";
    del.innerHTML = "&#x2715;";
    del.addEventListener("click", e => {
      e.stopPropagation();
      st.actions.splice(index, 1);
      this._showView("editor");
    });
    head.appendChild(del);
    row.appendChild(head);

    const cfg = document.createElement("div");
    cfg.className = "rf-action-cfg";

    if (!ACTION_TYPES[a.type]?.point) {
      const tLabel = document.createElement("span");
      tLabel.className = "rf-dim-label";
      tLabel.textContent = rf("act.applies");
      cfg.appendChild(tLabel);
      cfg.appendChild(this._pills(
        TRIGGER_DEFS[st.trigger].roles.map(r => [r, this._roleLabel(r)]),
        a.target,
        value => { a.target = value; this._showView("editor"); }
      ));
      if (a.target === "allies" || a.target === "enemies" || a.target === "area") {
        const rLabel = document.createElement("span");
        rLabel.className = "rf-dim-label";
        rLabel.textContent = rf("act.radius");
        cfg.appendChild(rLabel);
        cfg.appendChild(this._pills(
          [10, 15, 30].map(r => { const d = dnd5eDisplayDistance(r); return [r, rf("act.feet", { value: d.value, unit: d.unit })]; }),
          a.cfg.radius ?? 15,
          value => { a.cfg.radius = value; this._showView("editor"); }
        ));
      }
    }

    cfg.appendChild(this._actionConfig(a));
    this._dieField(cfg, a);

    if (st.save.on) {
      const sLabel = document.createElement("span");
      sLabel.className = "rf-dim-label";
      sLabel.textContent = rf("act.onSave");
      cfg.appendChild(sLabel);
      const opts = [["negate", rf("act.negate")]];
      if (a.type === "damage" && a.cfg.kind === "damage") opts.push(["half", rf("act.half")]);
      opts.push(["full", rf("act.full")]);
      if (!opts.some(o => o[0] === a.onSave)) a.onSave = "negate";
      cfg.appendChild(this._pills(opts, a.onSave, value => { a.onSave = value; this._showView("editor"); }));
    }
    row.appendChild(cfg);
    return row;
  }

  _dieField(parent, a) {
    const flat = { type: a.type, ...a.cfg };
    const unit = actionUsesDie(flat) ? dieUnitFor(flat) : null;
    if (!unit) return;
    this._overrideField(parent, {
      label: rf("act.die"),
      value: a.cfg.die,
      unit,
      ceiling: DIE_WARN_MAX[flat.type] ?? DIE_WARN_DEFAULT,
      onInput: v => { a.cfg.die = v; }
    });
  }

  _overrideField(parent, { label, value, unit, ceiling, onInput }) {
    this._dimLabel(parent, label);

    const row = document.createElement("div");
    row.className = "rf-die-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "rf-die-input";
    input.maxLength = 40;
    input.placeholder = rf("act.diePlaceholder");
    input.value = typeof value === "string" ? value : "";

    const hint = document.createElement("span");
    hint.className = "rf-die-hint";

    const warn = document.createElement("i");
    warn.className = "fa-solid fa-triangle-exclamation rf-die-warn";

    const refresh = () => {
      const raw = input.value.trim();
      row.classList.remove("is-invalid", "is-warned");
      warn.removeAttribute("data-tooltip");
      if (!raw) {
        hint.textContent = rf("act.dieDefault");
        warn.style.display = "none";
        return;
      }
      if (!isValidDieFormula(raw)) {
        row.classList.add("is-invalid");
        hint.textContent = rf("act.dieInvalid");
        warn.style.display = "none";
        return;
      }
      const range = dieFormulaRange(raw);
      if (!range) { hint.textContent = ""; warn.style.display = "none"; return; }
      if (unit.mult === 5) {
        const lo = dnd5eDisplayDistance(range.min * 5);
        const hi = dnd5eDisplayDistance(range.max * 5);
        hint.textContent = rf("act.dieRangeDistance", { min: lo.value, max: hi.value, unit: hi.unit });
      } else {
        hint.textContent = rf(`act.dieRange.${unit.key}`, { min: range.min, max: range.max });
      }
      if (range.max > ceiling) {
        row.classList.add("is-warned");
        warn.style.display = "";
        warn.setAttribute("data-tooltip", rf("act.dieWarn", { max: range.max, ceiling }));
      } else {
        warn.style.display = "none";
      }
    };

    input.addEventListener("input", () => {
      onInput(input.value);
      refresh();
      this._renderPreview();
    });

    row.appendChild(input);
    row.appendChild(warn);
    row.appendChild(hint);
    parent.appendChild(row);
    refresh();
  }

  _dimLabel(parent, text) {
    const el = document.createElement("span");
    el.className = "rf-dim-label";
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  _actionConfig(a) {
    const wrap = document.createElement("div");
    wrap.className = "rf-action-opts";
    const rerender = () => this._showView("editor");

    if (a.type === "move") {
      this._dimLabel(wrap, rf("act.direction"));
      wrap.appendChild(this._pills(
        [["away", rf("opt.move.away")], ["toward", rf("opt.move.toward")]],
        a.cfg.dir, value => { a.cfg.dir = value; rerender(); }
      ));
    } else if (a.type === "teleport") {
      // runes saved before the option existed adopt the role default once opened
      a.cfg.dir = teleportDir(a.cfg.dir, a.target);
      a.cfg.distance = teleportFeet(a.cfg.distance);
      this._dimLabel(wrap, rf("act.direction"));
      wrap.appendChild(this._pills(
        [["away", rf("opt.teleport.away")], ["toward", rf("opt.teleport.toward")]],
        a.cfg.dir, value => { a.cfg.dir = value; rerender(); }
      ));
      this._dimLabel(wrap, rf("act.distance"));
      wrap.appendChild(this._pills(
        TELEPORT_DISTANCES.map(n => { const d = dnd5eDisplayDistance(n); return [n, rf("act.feet", { value: d.value, unit: d.unit })]; }),
        a.cfg.distance, value => { a.cfg.distance = value; rerender(); }
      ));
    } else if (a.type === "stat") {
      this._dimLabel(wrap, rf("act.effect"));
      wrap.appendChild(this._pills(
        STAT_KEYS.map(k => [k, rf(`opt.stat.${STAT_OPT_KEYS[k]}`)]),
        a.cfg.stat, value => { a.cfg.stat = value; rerender(); }
      ));
    } else if (a.type === "damage") {
      this._dimLabel(wrap, rf("act.mode"));
      wrap.appendChild(this._pills(
        [["damage", rf("opt.damage.damage")], ["heal", rf("opt.damage.heal")]],
        a.cfg.kind, value => { a.cfg.kind = value; rerender(); }
      ));
      if (a.cfg.kind === "damage") {
        this._dimLabel(wrap, rf("act.damageType"));
        wrap.appendChild(this._pills(
          DAMAGE_TYPES.map(t => {
            const cfg = CONFIG.DND5E?.damageTypes?.[t];
            return [t, cfg ? game.i18n.localize(cfg.label ?? cfg) : t];
          }),
          a.cfg.dtype, value => { a.cfg.dtype = value; rerender(); }
        ));
      }
    } else if (a.type === "status") {
      this._dimLabel(wrap, rf("act.condition"));
      wrap.appendChild(this._pills(
        STATUS_KEYS.map(s => {
          const entry = CONFIG.statusEffects?.find(x => x.id === s);
          return [s, entry ? game.i18n.localize(entry.name) : s];
        }),
        a.cfg.status, value => { a.cfg.status = value; rerender(); }
      ));
    } else if (a.type === "reminder") {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = rf("reminderPh");
      input.value = a.cfg.text ?? "";
      input.addEventListener("input", () => { a.cfg.text = input.value; this._renderPreview(); });
      wrap.appendChild(input);
    } else if (a.type === "cloud") {
      const note = document.createElement("span");
      note.className = "rf-note";
      note.textContent = rf("cloudNote");
      wrap.appendChild(note);
      this._dcRow(wrap, a);
      this._abilityPills(wrap, a);
      this._statusPills(wrap, a, true);
      const affLabel = document.createElement("span");
      affLabel.className = "rf-dim-label";
      affLabel.textContent = rf("act.affects");
      wrap.appendChild(affLabel);
      wrap.appendChild(this._pills(
        CLOUD_AFFECTS.map(x => [x, rf(`opt.affects.${x}`)]),
        a.cfg.affects ?? "all",
        value => { a.cfg.affects = value; rerender(); }
      ));
      const imm = document.createElement("label");
      imm.className = "rf-chk inline";
      const ibox = document.createElement("input");
      ibox.type = "checkbox";
      ibox.checked = a.cfg.immediate === true;
      ibox.addEventListener("change", () => { a.cfg.immediate = ibox.checked; this._renderPreview(); });
      imm.appendChild(ibox);
      imm.appendChild(document.createTextNode(` ${rf("act.immediate")}`));
      wrap.appendChild(imm);
    } else if (a.type === "brand") {
      const note = document.createElement("span");
      note.className = "rf-note";
      note.textContent = rf("brandNote");
      wrap.appendChild(note);
    } else if (a.type === "contagion") {
      const note = document.createElement("span");
      note.className = "rf-note";
      note.textContent = rf("contagionNote");
      wrap.appendChild(note);
      this._dcRow(wrap, a);
      this._abilityPills(wrap, a);
      this._statusPills(wrap, a, false);
      if (a.target === "self") {
        const affLabel = document.createElement("span");
        affLabel.className = "rf-dim-label";
        affLabel.textContent = rf("act.affects");
        wrap.appendChild(affLabel);
        wrap.appendChild(this._pills(
          CONTAGION_AFFECTS.map(x => [x, rf(`opt.affects.${x}`)]),
          a.cfg.affects ?? "all",
          value => { a.cfg.affects = value; rerender(); }
        ));
      }
    } else if (a.type === "allyDash") {
      const rLabel = document.createElement("span");
      rLabel.className = "rf-dim-label";
      rLabel.textContent = rf("act.radius");
      wrap.appendChild(rLabel);
      wrap.appendChild(this._pills(
        [10, 15, 30].map(r => { const d = dnd5eDisplayDistance(r); return [r, rf("act.feet", { value: d.value, unit: d.unit })]; }),
        a.cfg.radius ?? 30,
        value => { a.cfg.radius = value; rerender(); }
      ));
    } else if (a.type === "guardianRush") {
      const note = document.createElement("span");
      note.className = "rf-note";
      note.textContent = rf("guardianNote");
      wrap.appendChild(note);
    }
    if ((a.type === "stat" && a.cfg.stat !== "temp-hp") || a.type === "reminder" || a.type === "contagion") {
      const dLabel = document.createElement("span");
      dLabel.className = "rf-dim-label";
      dLabel.textContent = rf("act.duration");
      wrap.appendChild(dLabel);
      const opts = a.type === "contagion" ? [1, 3, 5, 10, "die"] : [1, 2, 3, "die"];
      wrap.appendChild(this._pills(
        opts.map(r => [r, r === "die" ? rf("act.roundsDie") : rf("act.rounds", { rounds: r })]),
        a.cfg.rounds ?? (a.type === "contagion" ? 10 : 1),
        value => { a.cfg.rounds = value; rerender(); }
      ));
      if (actionUsesRoundsDie({ type: a.type, ...a.cfg })) {
        this._overrideField(wrap, {
          label: rf("act.durationDie"),
          value: a.cfg.roundsDie,
          unit: ROUNDS_UNIT,
          ceiling: ROUNDS_WARN_MAX,
          onInput: v => { a.cfg.roundsDie = v; }
        });
      }
    }
    return wrap;
  }

  _dcRow(wrap, a) {
    const row = document.createElement("div");
    row.className = "rf-dc-row";
    const label = document.createElement("span");
    label.className = "rf-dim-label";
    label.textContent = rf("save.dc");
    row.appendChild(label);
    const mk = (delta, symbol) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = symbol;
      b.addEventListener("click", () => {
        a.cfg.dc = Math.max(5, Math.min(30, (a.cfg.dc ?? 13) + delta));
        val.textContent = String(a.cfg.dc);
        this._renderPreview();
      });
      return b;
    };
    row.appendChild(mk(-1, "-"));
    const val = document.createElement("span");
    val.className = "rf-dc-val";
    val.textContent = String(a.cfg.dc ?? 13);
    row.appendChild(val);
    row.appendChild(mk(1, "+"));
    wrap.appendChild(row);
  }

  _abilityPills(wrap, a) {
    const label = document.createElement("span");
    label.className = "rf-dim-label";
    label.textContent = rf("save.ability");
    wrap.appendChild(label);
    wrap.appendChild(this._pills(
      SAVE_ABILITIES.map(x => [x, x.toUpperCase()]),
      a.cfg.ability ?? "con",
      value => { a.cfg.ability = value; this._showView("editor"); },
      ABILITY_COLORS
    ));
  }

  _statusPills(wrap, a, allowNone) {
    const label = document.createElement("span");
    label.className = "rf-dim-label";
    label.textContent = rf("act.status");
    wrap.appendChild(label);
    const opts = STATUS_KEYS.map(s => {
      const entry = CONFIG.statusEffects?.find(x => x.id === s);
      return [s, entry ? game.i18n.localize(entry.name) : s];
    });
    if (allowNone) opts.unshift([null, rf("act.statusNone")]);
    wrap.appendChild(this._pills(
      opts,
      a.cfg.status ?? null,
      value => { a.cfg.status = value; this._showView("editor"); }
    ));
  }

  _runeCheck(description) {
    const st = this.st;
    const def = stateToDef(st, description ?? (st.actions.length ? buildDescription(st) : ""));
    const check = validateRuneDef(def);
    return { ok: check.ok, messages: check.errors.map(m => this._humanizeRuneIssue(m)) };
  }

  _humanizeRuneIssue(err) {
    if (err.code === "name") return rf("issues.name");
    if (err.code === "actionsCount") return rf("issues.actionsNone");
    if (err.code === "actionText") return rf("issues.reminderText", { index: err.data.index });
    if (err.code === "actionTypeTrigger" || err.code === "actionTargetTrigger") return rf("issues.actionTrigger", { index: err.data.index });
    if (err.code === "triggerUnknown" || err.code === "triggerCategory") return rf("issues.trigger");
    return rf("issues.other", { message: formatValidationError(err) });
  }

  _issuesPanel(headKey, messages) {
    const wrap = document.createElement("div");
    wrap.className = "rf-issues";
    const head = document.createElement("div");
    head.className = "rf-issues-head";
    head.textContent = rf(headKey);
    wrap.appendChild(head);
    const ul = document.createElement("ul");
    for (const m of messages) {
      const li = document.createElement("li");
      li.textContent = m;
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    return wrap;
  }

  _renderPreview() {
    const st = this.st;
    const pv = this._pv;
    if (!pv) return;
    pv.replaceChildren();
    pv.style.setProperty("--rune-color", st.color);

    const head = document.createElement("div");
    head.className = "rf-pv-head";
    const headLabel = document.createElement("span");
    headLabel.textContent = rf("preview.title");
    head.appendChild(headLabel);
    const dot = document.createElement("span");
    dot.className = "rf-pv-dot";
    head.appendChild(dot);
    pv.appendChild(head);

    const body = document.createElement("div");
    body.className = "rf-pv-body";
    pv.appendChild(body);

    const stage = document.createElement("div");
    stage.className = "rf-pv-stage";
    const sock = document.createElement("div");
    sock.className = "rf-pv-socket";
    sock.appendChild(buildForgeGlyphSvg(st.glyph, st.color, 30, { fill: st.glyphMode === "silhouette", view: st.glyphView }));
    stage.appendChild(sock);
    const nameWrap = document.createElement("div");
    const name = document.createElement("div");
    name.className = "rf-pv-name";
    name.style.color = st.color;
    name.textContent = st.name.trim() || rf("identity.namePh");
    nameWrap.appendChild(name);
    const cat = document.createElement("div");
    cat.className = "rf-pv-cat";
    cat.textContent = `${game.i18n.localize(`${MODULE_ID}.presets.${st.category}`)} - ${rf(`trigger.${st.trigger}.name`)}`
      + (st.locked ? ` - ${rf("preview.locked")}` : "")
      + (st.cursed ? ` - ${rf("identity.cursedShort")}` : "");
    nameWrap.appendChild(cat);
    stage.appendChild(nameWrap);
    body.appendChild(stage);

    const description = st.actions.length ? buildDescription(st) : "";
    const desc = document.createElement("div");
    desc.className = "rf-pv-desc";
    desc.textContent = description || rf("preview.noActions");
    body.appendChild(desc);

    if (!st.locked) {
      const check = this._runeCheck(description);
      if (!check.ok) body.appendChild(this._issuesPanel("issues.head", check.messages));

      const btns = document.createElement("div");
      btns.className = "rf-pv-btns";
      const forge = document.createElement("button");
      forge.type = "button";
      forge.className = "rf-btn";
      forge.textContent = rf("preview.forge");
      forge.disabled = !check.ok;
      if (!check.ok) forge.dataset.tooltip = rf("issues.head");
      forge.addEventListener("click", () => this._forge(forge));
      btns.appendChild(forge);
      const exp = document.createElement("button");
      exp.type = "button";
      exp.className = "rf-btn ghost";
      exp.textContent = rf("preview.export");
      exp.addEventListener("click", () => {
        const def = stateToDef(st, buildDescription(st));
        const blob = new Blob([exportRunesJson([def], [])], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `rune-${(st.name || "rune").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
      btns.appendChild(exp);
      body.appendChild(btns);
    }
  }

  async _forge(button) {
    const st = this.st;
    try {
      const def = stateToDef(st, buildDescription(st));
      const saved = await saveCustomRune(def);
      st.editingId = saved.id;
      ui.notifications.info(rf("lib.saved", { name: saved.name }));
      button.textContent = rf("preview.forged");
      setTimeout(() => { button.textContent = rf("preview.forge"); }, 1400);
    } catch (err) {
      ui.notifications.warn(rf("err.invalid", { errors: err.message }));
    }
  }

  /* Combo editor */
  _comboDefFromState() {
    const cs = this.comboSt;
    return {
      id: cs.editingId,
      name: cs.name.trim(),
      description: cs.description.trim(),
      color: cs.color,
      glyph: GLYPH_CHOICES[13],
      runes: cs.slots.filter(Boolean),
      skipSaveFor: cs.skipSaveFor
    };
  }

  _comboCheck() {
    const combo = this._comboDefFromState();
    const check = validateComboDef(combo, getRuneDef);
    return { ok: check.ok, messages: check.errors.map(m => this._humanizeComboIssue(m)) };
  }

  _humanizeComboIssue(err) {
    if (err.code === "name") return rf("combo.issueName");
    if (err.code === "comboRunesCount" || err.code === "comboRuneUnresolved" || err.code === "comboRuneCategory") return rf("combo.issueRunes");
    if (err.code === "comboDescription") return rf("combo.issueDescription");
    return rf("combo.issueOther", { message: formatValidationError(err) });
  }

  _renderComboFoot() {
    const foot = this._comboFoot;
    if (!foot) return;
    foot.replaceChildren();
    const check = this._comboCheck();
    if (!check.ok) foot.appendChild(this._issuesPanel("combo.issuesHead", check.messages));

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "rf-btn";
    saveBtn.style.marginTop = "10px";
    saveBtn.textContent = rf("combo.save");
    saveBtn.disabled = !check.ok;
    if (!check.ok) saveBtn.dataset.tooltip = rf("combo.issuesHead");
    saveBtn.addEventListener("click", async () => {
      try {
        const combo = this._comboDefFromState();
        const saved = await saveCustomCombo(combo);
        this.comboSt.editingId = saved.id;
        ui.notifications.info(rf("combo.saved", { name: saved.name }));
        this._showView("combo");
      } catch (err) {
        ui.notifications.warn(rf("err.invalid", { errors: err.message }));
      }
    });
    foot.appendChild(saveBtn);
  }

  _buildCombo() {
    const cs = this.comboSt;
    const body = document.createElement("div");
    body.className = "rf-steps";
    this._body.appendChild(body);

    const sec = this._section("combo.trio", 1);
    this._dimLabel(sec, rf("combo.category"));
    sec.appendChild(this._pills(
      ["melee", "ranged", "armor"].map(c => [c, game.i18n.localize(`${MODULE_ID}.presets.${c}`)]),
      cs.category,
      value => {
        cs.category = value;
        cs.slots = [null, null, null];
        cs.skipSaveFor = [];
        this._showView("combo");
      },
      { melee: "#c0392b", ranged: "#27ae60", armor: "#2e86c1" }
    ));

    const slotRow = document.createElement("div");
    slotRow.className = "rf-combo-slots";
    cs.slots.forEach((id, i) => {
      const slot = document.createElement("div");
      slot.className = "rf-combo-slot" + (id ? " filled" : "");
      const def = id ? getRuneDef(id) : null;
      if (def) {
        slot.style.setProperty("--rune-color", def.color);
        slot.appendChild(buildForgeGlyphSvg(def.glyph, def.color, 24, { fill: def.glyphMode === "silhouette", view: def.glyphView }));
        slot.dataset.tooltip = def.name;
      }
      slot.addEventListener("click", () => {
        if (cs.slots[i]) {
          cs.slots[i] = null;
          cs.skipSaveFor = cs.skipSaveFor.filter(x => x !== id);
          this._showView("combo");
        }
      });
      slotRow.appendChild(slot);
    });
    sec.appendChild(slotRow);

    const hint = document.createElement("div");
    hint.className = "rf-note";
    hint.textContent = cs.slots.every(Boolean) ? rf("combo.complete") : rf("combo.pickHint");
    sec.appendChild(hint);

    const pick = document.createElement("div");
    pick.className = "rf-glyph-grid";
    const pool = [...getCoreDefs(cs.category), ...getCustomRunes().filter(d => d.category === cs.category)];
    for (const def of pool) {
      const taken = cs.slots.includes(def.id);
      const cell = document.createElement("div");
      cell.className = "rf-glyph-cell" + (taken ? " on" : "");
      cell.style.setProperty("--rune-color", def.color);
      cell.dataset.tooltip = def.name;
      cell.appendChild(buildForgeGlyphSvg(def.glyph, def.color, 20, { fill: def.glyphMode === "silhouette", view: def.glyphView }));
      cell.addEventListener("click", () => {
        if (taken) return;
        const idx = cs.slots.findIndex(s => !s);
        if (idx === -1) return;
        cs.slots[idx] = def.id;
        this._showView("combo");
      });
      pick.appendChild(cell);
    }
    sec.appendChild(pick);
    body.appendChild(sec);

    const idSec = this._section("combo.identity", 2);
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = rf("combo.namePh");
    name.value = cs.name;
    name.addEventListener("input", () => { cs.name = name.value; this._renderComboFoot(); });
    idSec.appendChild(name);

    const desc = document.createElement("textarea");
    desc.className = "rf-combo-desc";
    desc.placeholder = rf("combo.descPh");
    desc.value = cs.description;
    desc.addEventListener("input", () => { cs.description = desc.value; this._renderComboFoot(); });
    idSec.appendChild(desc);

    const swatches = document.createElement("div");
    swatches.className = "rf-swatches";
    for (const c of SWATCH_COLORS) {
      const s = document.createElement("span");
      s.className = "rf-swatch" + (c === cs.color ? " on" : "");
      s.style.background = c;
      s.addEventListener("click", () => { cs.color = c; this._showView("combo"); });
      swatches.appendChild(s);
    }
    idSec.appendChild(swatches);

    const skipLabel = document.createElement("div");
    skipLabel.className = "rf-dim-label";
    skipLabel.textContent = rf("combo.skipSave");
    idSec.appendChild(skipLabel);
    for (const id of cs.slots.filter(Boolean)) {
      const def = getRuneDef(id);
      if (!def) continue;
      const chk = document.createElement("label");
      chk.className = "rf-chk";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = cs.skipSaveFor.includes(id);
      box.addEventListener("change", () => {
        cs.skipSaveFor = box.checked
          ? [...cs.skipSaveFor, id]
          : cs.skipSaveFor.filter(x => x !== id);
      });
      chk.appendChild(box);
      chk.appendChild(document.createTextNode(` ${rf("combo.skipSaveFor", { name: def.name })}`));
      idSec.appendChild(chk);
    }

    const foot = document.createElement("div");
    idSec.appendChild(foot);
    this._comboFoot = foot;
    this._renderComboFoot();
    body.appendChild(idSec);

    const listSec = this._section("combo.existing", 3);
    const combos = getCustomCombos();
    if (!combos.length) {
      const empty = document.createElement("div");
      empty.className = "rf-empty";
      empty.textContent = rf("combo.empty");
      listSec.appendChild(empty);
    }
    for (const combo of combos) {
      const row = document.createElement("div");
      row.className = "rf-combo-row";
      row.style.setProperty("--rune-color", combo.color);
      const label = document.createElement("span");
      label.className = "rf-combo-row-name";
      label.textContent = `${combo.name} (${combo.runes.map(id => getRuneDef(id)?.name ?? "?").join(" + ")})`;
      row.appendChild(label);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "rf-btn ghost";
      edit.textContent = rf("combo.edit");
      edit.addEventListener("click", () => {
        this.comboSt = {
          category: getRuneDef(combo.runes[0])?.category ?? "melee",
          slots: [...combo.runes],
          name: combo.name,
          description: combo.description ?? "",
          color: combo.color,
          glyph: combo.glyph,
          skipSaveFor: [...(combo.skipSaveFor ?? [])],
          editingId: combo.id
        };
        this._showView("combo");
      });
      row.appendChild(edit);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "rf-btn ghost danger";
      del.textContent = rf("act.remove");
      del.addEventListener("click", async () => {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: rf("title") },
          content: `<p>${rf("combo.confirmDelete", { name: combo.name })}</p>`,
          rejectClose: false
        });
        if (!ok) return;
        await deleteCustomCombo(combo.id);
        this._showView("combo");
      });
      row.appendChild(del);
      listSec.appendChild(row);
    }
    body.appendChild(listSec);
  }
}
