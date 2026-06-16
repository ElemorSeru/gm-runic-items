import {
  getItemCategory, getRunePool,
  computeRunicRarity, getRarityDie, meetsRequirements, withCache
} from "./utils.js";
import {
  RUNE_REGISTRY,
  ABILITY_OPTIONS,
  LEGACY_FEAT_GLYPH, LEGACY_SPELL_GLYPH,
  LEGACY_FEAT_COLOR, LEGACY_SPELL_COLOR
} from "./rune-registry.js";
import { getActiveCombo } from "./combo-registry.js";
import { getCompatiblePresets, savePreset, applyPreset, presetRarity } from "./preset-manager.js";
import {
  getLegacyFeats, getLegacySpells,
  ensureLegacyCacheLoaded, isLegacyCacheLoaded
} from "./legacy-cache.js";
import { evaluateItem } from "./effect-manager.js";

const MODULE_ID = "gm-runic-items";
const TEMPLATE = `modules/${MODULE_ID}/templates/rune-panel.hbs`;
const SVG_NS = "http://www.w3.org/2000/svg";

let _tipEl = null;
let _currentTipAnchor = null;
const _descCache = new Map();

function getTipEl() {
  if (!_tipEl) {
    _tipEl = document.createElement("div");
    _tipEl.id = "runic-global-tip";
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}

function showTip(anchor, name, desc) {
  _currentTipAnchor = anchor;
  const el = getTipEl();
  el.innerHTML = `<strong>${name}</strong><p>${desc}</p>`;
  el.style.visibility = "hidden";
  el.style.display = "block";

  requestAnimationFrame(() => {
    const r = anchor.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const vw = window.innerWidth;
    let top = r.top - th - 8;
    let left = r.left + r.width / 2 - tw / 2;
    if (top < 8) top = r.bottom + 8;
    left = Math.max(8, Math.min(left, vw - tw - 8));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "visible";
    el.style.opacity = "1";
  });
}

function hideTip() {
  _currentTipAnchor = null;
  if (!_tipEl) return;
  _tipEl.style.opacity = "0";
  _tipEl.style.display = "none";
}

async function _loadDesc(uuid, doc = null) {
  if (_descCache.has(uuid)) return _descCache.get(uuid);
  const item = doc ?? await fromUuid(uuid).catch(() => null);
  const desc = truncateWords(item?.system?.description?.value ?? "");
  if (desc) _descCache.set(uuid, desc);
  return desc;
}

function updateTip(anchor, desc) {
  if (_currentTipAnchor !== anchor || !_tipEl || _tipEl.style.display !== "block") return;
  const p = _tipEl.querySelector("p");
  if (p) p.textContent = desc;
}

function truncateWords(html, maxWords = 38) {
  if (!html) return "";

  let processed = html.replace(
    /@Damage\[([^\]]+)\](?:\[([^\]]+)\])?(?:\{[^}]*\})?/g,
    (_, formula, type) => {
      const clean = formula.replace(/@\w+/g, "").replace(/\s+/g, " ").trim();
      return type ? `${clean} ${type}` : clean;
    }
  );

  processed = processed.replace(/@\w+\[[^\]]+\]\{([^}]+)\}/g, "$1");
  processed = processed.replace(/@\w+\[[^\]]+\]/g, "");

  // Strip HTML tags
  const div = document.createElement("div");
  div.innerHTML = processed;
  const text = (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const words = text.split(" ");
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

function formatDesc(description, item) {
  if (!description) return "";
  const die = getRarityDie(computeRunicRarity(item));
  return description.replace(/\{die\}/g, die);
}

const _allRunes = Object.values(RUNE_REGISTRY).flat();

function initComboSlot(panelEl, flags, animate = false) {
  const powerRow = panelEl.querySelector('.runic-power .rune-slot-row');
  if (!powerRow) return;

  const existing = powerRow.querySelector('.rune-slot-combo');
  const combo = getActiveCombo([flags["power-0"], flags["power-1"], flags["power-2"]]);

  if (!combo) {
    if (existing) dissolveComboSlot(existing);
    return;
  }

  if (existing) {
    if (existing.dataset.comboId === combo.id) return;
    dissolveComboSlot(existing, () => appendComboSlot(powerRow, combo, true));
    return;
  }

  appendComboSlot(powerRow, combo, animate);
}

function appendComboSlot(powerRow, combo, animate) {
  const slot = document.createElement("div");
  slot.className = "rune-slot-combo";
  slot.dataset.comboId = combo.id;
  slot.dataset.tipName = combo.name;
  slot.dataset.tipDesc = combo.description;
  slot.style.setProperty("--rune-color", combo.color);

  const socket = document.createElement("div");
  socket.className = "rune-socket sock-filled";
  slot.appendChild(socket);

  const label = document.createElement("span");
  label.className = "rune-slot-label";
  label.textContent = game.i18n.localize(`${MODULE_ID}.combo.label`);
  slot.appendChild(label);

  powerRow.appendChild(slot);

  if (animate) {
    slot.style.animation = "combo-forge 0.85s cubic-bezier(0.22,1,0.36,1) forwards";
    slot.addEventListener("animationend", () => {
      slot.style.animation = "";
      socket.classList.add("sock-flashing");
      setTimeout(() => {
        socket.classList.remove("sock-flashing");
        const svg = buildGlyphSvg(combo.glyph, combo.color, 26);
        const path = svg.querySelector(".rune-path");
        if (path) {
          const len = path.getTotalLength();
          path.style.strokeDasharray = len;
          path.style.strokeDashoffset = len;
          socket.appendChild(svg);
          requestAnimationFrame(() => {
            path.style.transition = "stroke-dashoffset 1.4s ease-in-out 0.05s";
            path.style.strokeDashoffset = "0";
          });
        } else {
          socket.appendChild(svg);
        }
      }, 220);
    }, { once: true });
  } else {
    socket.appendChild(buildGlyphSvg(combo.glyph, combo.color, 26));
  }
}

function dissolveComboSlot(slotEl, onComplete = null) {
  slotEl.style.animation = "combo-dissolve 0.7s ease-in forwards";
  slotEl.addEventListener("animationend", () => {
    slotEl.remove();
    if (onComplete) onComplete();
  }, { once: true });
}

function updateComboSlot(panelEl, flags) {
  initComboSlot(panelEl, flags, true);
}

function addPresetButtons(panelEl, item) {
  const header = panelEl.querySelector(".runic-panel-header");
  if (!header) return;

  const btns = document.createElement("div");
  btns.className = "runic-preset-btns";
  btns.innerHTML = `
    <button type="button" class="runic-preset-btn runic-btn-save-preset" title="${game.i18n.localize(`${MODULE_ID}.presets.save`)}">
      <i class="fas fa-bookmark"></i>
    </button>
    <button type="button" class="runic-preset-btn runic-btn-load-preset" title="${game.i18n.localize(`${MODULE_ID}.presets.load`)}">
      <i class="fas fa-folder-open"></i>
    </button>
  `;
  header.appendChild(btns);

  const picker = document.createElement("div");
  picker.className = "runic-preset-picker";
  header.insertAdjacentElement("afterend", picker);

  btns.querySelector(".runic-btn-save-preset").addEventListener("click", e => {
    e.stopPropagation();
    picker.style.display = "none";
    showSavePresetDialog(panelEl, item);
  });

  btns.querySelector(".runic-btn-load-preset").addEventListener("click", e => {
    e.stopPropagation();
    if (picker.style.display === "block") {
      picker.style.display = "none";
    } else {
      buildPresetPicker(picker, item);
      picker.style.display = "block";
    }
  });
}

function buildPresetPicker(pickerEl, item) {
  pickerEl.innerHTML = "";
  const presets = getCompatiblePresets(item);

  if (presets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "runic-preset-picker-empty";
    empty.textContent = game.i18n.localize(`${MODULE_ID}.presets.empty`);
    pickerEl.appendChild(empty);
    return;
  }

  for (const preset of presets) {
    const entry = document.createElement("div");
    entry.className = "preset-entry";

    const sockWrap = document.createElement("div");
    sockWrap.className = "preset-mini-sockets";

    for (const runeId of preset.power) {
      const sock = document.createElement("div");
      sock.className = "preset-mini-sock";
      const rune = _allRunes.find(r => r.id === runeId);
      if (rune) {
        sock.classList.add("mini-filled");
        sock.style.setProperty("--rune-color", rune.color);
        sock.appendChild(buildGlyphSvg(rune.glyph, rune.color, 12));
      }
      sockWrap.appendChild(sock);
    }

    const name = document.createElement("span");
    name.className = "preset-entry-name";
    name.textContent = preset.name;

    const rarity = document.createElement("span");
    const r = presetRarity(preset);
    rarity.className = "preset-entry-rarity";
    rarity.dataset.rarity = r;
    rarity.textContent = r;

    entry.appendChild(sockWrap);
    entry.appendChild(name);
    entry.appendChild(rarity);

    entry.addEventListener("click", async () => {
      pickerEl.style.display = "none";
      await applyPreset(preset, item);
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.presets.applied`, { name: preset.name }));
    });

    pickerEl.appendChild(entry);
  }
}

async function showSavePresetDialog(panelEl, item) {
  new Dialog({
    title: game.i18n.localize(`${MODULE_ID}.presets.dialogTitle`),
    content: `<div style="margin:8px 0"><input type="text" name="presetName" placeholder="${game.i18n.localize(`${MODULE_ID}.presets.namePlaceholder`)}" style="width:100%"/></div>`,
    buttons: {
      save: {
        icon: '<i class="fas fa-bookmark"></i>',
        label: game.i18n.localize(`${MODULE_ID}.presets.save`),
        callback: async html => {
          const name = html.find('[name="presetName"]').val().trim();
          if (!name) return;
          await savePreset(name, item);
          const btn = panelEl.querySelector(".runic-btn-save-preset");
          if (btn) {
            const icon = btn.querySelector("i");
            icon.className = "fas fa-check";
            btn.classList.add("preset-saved");
            setTimeout(() => {
              icon.className = "fas fa-bookmark";
              btn.classList.remove("preset-saved");
            }, 1500);
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "save",
    render: html => {
      const input = html.find('[name="presetName"]');
      input.focus();
      input.on("keydown", e => {
        if (e.key === "Enter") html.closest(".dialog").find(".dialog-button.save").click();
      });
    }
  }).render(true);
}

function clearCrack(rowEl) {
  rowEl?.querySelector(".runic-crack-overlay")?.remove();
  rowEl?.querySelector(".runic-crack-message")?.remove();
}

function checkAndRenderCracks(panelEl, flags, item) {
  const actor = item.actor;
  if (!actor) return;

  const empSection = panelEl.querySelector(".runic-empowerment");
  const empRow = empSection?.querySelector(".rune-slot-row");
  if (empRow) {
    const empEffect = actor.effects.find(e =>
      e.origin === item.uuid && e.flags?.[MODULE_ID]?.effectKey === "empowerment"
    );
    const applied = {};
    for (const change of (empEffect?.changes ?? [])) {
      const m = change.key.match(/system\.abilities\.(\w+)\.value/);
      if (m) applied[m[1]] = parseInt(change.value) || 0;
    }

    const tally = {};
    for (let i = 0; i < 5; i++) {
      const stat = flags[`emp-${i}`];
      if (stat) tally[stat] = (tally[stat] ?? 0) + 1;
    }

    const offending = [];
    for (const [stat, count] of Object.entries(tally)) {
      const base = (actor.system.abilities[stat]?.value ?? 10) - (applied[stat] ?? 0);
      if (base + stackBonus(count) > 30) offending.push(stat);
    }

    if (offending.length > 0) {
      const colors = offending.map(s => ABILITY_OPTIONS.find(o => o.key === s)?.color ?? "#888");
      const label = offending.map(s => s.toUpperCase()).join(", ");
      renderSectionCrack(
        empRow,
        colors,
        game.i18n.format(`${MODULE_ID}.crack.statOverCap`, { stats: label }),
        item.id + "-emp",
        "M 47,45 L 53,22 L 60,58 L 67,20 L 74,50 L 80,18 L 87,52 L 93,30 L 98,45 M 53,22 L 57,38 L 63,28 M 60,58 L 55,66 L 58,74 M 67,20 L 71,10 L 76,22"
      );
    } else {
      clearCrack(empRow);
    }
  }

  const legacySection = panelEl.querySelector(".runic-legacy");
  const legacyRow = legacySection?.querySelector(".rune-slot-row");
  if (legacyRow) {
    const featUuid = flags["legacy-feat"] ?? null;
    const spellUuid = flags["legacy-spell"] ?? null;

    if (featUuid || spellUuid) {
      Promise.all([
        featUuid ? fromUuid(featUuid).catch(() => null) : Promise.resolve(null),
        spellUuid ? fromUuid(spellUuid).catch(() => null) : Promise.resolve(null)
      ]).then(([featDoc, spellDoc]) => {
        const featMissing = featUuid && !featDoc;
        const spellMissing = spellUuid && !spellDoc;

        const featDupGranted = featUuid && !featMissing && actor.items.find(i =>
          i.flags?.[MODULE_ID]?.refId === featUuid &&
          i.flags?.[MODULE_ID]?.sourceItemId !== item.id &&
          i.flags?.[MODULE_ID]?.grantKey === "legacy-feat"
        );
        const spellDupGranted = spellUuid && !spellMissing && actor.items.find(i =>
          i.flags?.[MODULE_ID]?.refId === spellUuid &&
          i.flags?.[MODULE_ID]?.sourceItemId !== item.id &&
          i.flags?.[MODULE_ID]?.grantKey === "legacy-spell"
        );

        const featBroken = featMissing || !!featDupGranted;
        const spellBroken = spellMissing || !!spellDupGranted;

        if (!featBroken && !spellBroken) {
          clearCrack(legacyRow);
          return;
        }

        const colors = [];
        if (featBroken) colors.push(LEGACY_FEAT_COLOR);
        if (spellBroken) colors.push(LEGACY_SPELL_COLOR);

        const parts = [];
        if (featMissing) {
          parts.push(game.i18n.localize(`${MODULE_ID}.crack.featMissing`));
        } else if (featDupGranted) {
          const origin = actor.items.get(featDupGranted.flags[MODULE_ID].sourceItemId);
          parts.push(game.i18n.format(`${MODULE_ID}.crack.featDuplicate`, { item: origin?.name ?? "another item" }));
        }
        if (spellMissing) {
          parts.push(game.i18n.localize(`${MODULE_ID}.crack.spellMissing`));
        } else if (spellDupGranted) {
          const origin = actor.items.get(spellDupGranted.flags[MODULE_ID].sourceItemId);
          parts.push(game.i18n.format(`${MODULE_ID}.crack.spellDuplicate`, { item: origin?.name ?? "another item" }));
        }

        renderSectionCrack(
          legacyRow,
          colors,
          parts.join("  |  "),
          item.id + "-legacy",
          "M 42,48 L 50,24 L 58,58 L 66,30 M 66,30 L 74,14 L 83,24 L 92,16 M 66,30 L 73,52 L 82,64 L 92,56 M 50,24 L 46,38 M 58,58 L 54,68 L 56,74"
        );
      });
    } else {
      clearCrack(legacyRow);
    }
  }
}

function parseCrackSubpaths(pathD) {
  return pathD.trim().split(/(?=M[\s\d])/).filter(s => s.trim()).map(sub => {
    const tokens = sub.replace(/[ML]/g, " ").trim().split(/[\s,]+/).filter(Boolean);
    const pts = [];
    for (let i = 0; i + 1 < tokens.length; i += 2)
      pts.push([parseFloat(tokens[i]), parseFloat(tokens[i + 1])]);
    return pts;
  }).filter(pts => pts.length >= 2);
}

function renderSectionCrack(sectionEl, colors, message, uid, pathD) {
  sectionEl.querySelector(".runic-crack-overlay")?.remove();
  sectionEl.querySelector(".runic-crack-message")?.remove();

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("runic-crack-overlay");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");

  let strokeColor = colors[0];
  if (colors.length > 1) {
    const gradId = `crack-grad-${uid}`;
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("y1", "0%");
    grad.setAttribute("x2", "100%");
    grad.setAttribute("y2", "0%");
    colors.forEach((color, ci) => {
      const stop = document.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", `${(ci / (colors.length - 1)) * 100}%`);
      stop.setAttribute("stop-color", color);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);
    strokeColor = `url(#${gradId})`;
  }

  const subpaths = parseCrackSubpaths(pathD);
  const trunk = subpaths[0] ?? [];
  const SD = 0.09, SA = 0.16;

  subpaths.forEach((pts, pathIdx) => {
    const isBranch = pathIdx > 0;
    const n = pts.length - 1;
    let t0 = 0;
    if (isBranch) {
      for (let ti = 0; ti < trunk.length; ti++) {
        if (Math.abs(trunk[ti][0] - pts[0][0]) < 0.5 && Math.abs(trunk[ti][1] - pts[0][1]) < 0.5) {
          t0 = ti * SD;
          break;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const bell = Math.sin(Math.PI * (i + 0.5) / n);
      const ratio = n > 1 ? i / (n - 1) : 0;
      const dw = isBranch ? (4.5 - ratio * 3.0).toFixed(1) : (2.5 + bell * 6.0).toFixed(1);
      const lw = isBranch ? (2.0 - ratio * 1.4).toFixed(1) : (1.0 + bell * 2.8).toFixed(1);
      const delay = (t0 + i * SD).toFixed(2);
      const len = (Math.hypot(x2 - x1, y2 - y1) * 4 + 8).toFixed(1);
      const d = `M ${x1},${y1} L ${x2},${y2}`;
      [["rgba(0,0,0,.92)", dw], [strokeColor, lw]].forEach(([s, w]) => {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("stroke", s);
        p.setAttribute("stroke-width", w);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("vector-effect", "non-scaling-stroke");
        p.style.cssText = `stroke-dasharray:${len};stroke-dashoffset:${len};animation:crack-draw ${SA}s ease-out ${delay}s forwards`;
        svg.appendChild(p);
      });
    }
  });

  sectionEl.prepend(svg);

  const msg = document.createElement("div");
  msg.className = "runic-crack-message";
  msg.style.borderColor = colors[0];
  msg.style.color = colors[0];
  msg.textContent = message;
  sectionEl.appendChild(msg);
}

export function registerSheetHooks() {
  Hooks.on("renderItemSheet5e", onRenderItemSheet);
  Hooks.on("updateItem", onUpdateItem);
  Hooks.on("renderActorSheet", onRenderActorSheet);
}

async function onRenderItemSheet(app, html, data) {
  const item = app.object;
  if (!getItemCategory(item)) return;

  const detailsTab = html.find('.tab.details[data-tab="details"]');
  if (!detailsTab.length) return;

  const scrollTop = app._runicScrollRestore ?? detailsTab.scrollTop();
  delete app._runicScrollRestore;
  detailsTab.find(".runic-panel").remove();

  const flags = foundry.utils.getProperty(item, `flags.${MODULE_ID}`) ?? {};
  const runePool = getRunePool(item);
  const panel = $(await renderTemplate(TEMPLATE, buildTemplateContext(flags, item)));

  detailsTab.append(panel);
  detailsTab.scrollTop(scrollTop);

  initAllSockets(panel[0], flags, runePool, item);

  const minRole = game.settings.get(MODULE_ID, "minRoleToEdit") ?? 4;
  const canEdit = data.editable && (game.user.role >= minRole);

  if (canEdit) {
    bindPanelEvents(panel[0], item, runePool, flags);
  } else {
    panel[0].classList.add("runic-panel-readonly");
  }
}

function buildTemplateContext(flags, item) {
  return {
    powerSlots: Array.from({ length: 3 }, (_, i) => ({ index: i, runeId: flags[`power-${i}`] ?? null })),
    empowermentSlots: Array.from({ length: 5 }, (_, i) => ({ index: i, stat: flags[`emp-${i}`] ?? null })),
    legacyFeat: { id: flags["legacy-feat"] ?? null },
    legacySpell: { id: flags["legacy-spell"] ?? null },
    runicRarity: computeRunicRarity(item)
  };
}

function initAllSockets(panelEl, flags, runePool, item) {
  panelEl.querySelectorAll('.rune-slot[data-section="power"]').forEach(slotEl => {
    const rune = runePool.find(r => r.id === slotEl.dataset.runeId);
    if (rune) fillSocket(slotEl, rune.glyph, rune.color, rune.name, rune.description, false, item);
  });

  initComboSlot(panelEl, flags, false);
  checkAndRenderCracks(panelEl, flags, item);

  const progress = {};
  panelEl.querySelectorAll('.rune-slot[data-section="empowerment"]').forEach(slotEl => {
    const stat = slotEl.dataset.runeId;
    if (!stat) return;
    const opt = ABILITY_OPTIONS.find(o => o.key === stat);
    if (!opt) return;
    progress[stat] = (progress[stat] ?? 0) + 1;
    fillSocket(slotEl, opt.glyph, opt.color, `${opt.label} +${stackBonus(progress[stat])}`, opt.description, false, item);
  });

  panelEl.querySelectorAll('.rune-slot[data-section="legacy-feat"]').forEach(async slotEl => {
    const uuid = slotEl.dataset.runeId;
    if (!uuid) return;

    const cached = getLegacyFeats().find(f => f.uuid === uuid);
    const name = cached?.name;
    const img = cached?.img;

    if (!name) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc) return;
      const desc = await _loadDesc(uuid, doc);
      fillSocket(slotEl, null, LEGACY_FEAT_COLOR, doc.name, desc, false, item, doc.img);
      return;
    }

    fillSocket(slotEl, null, LEGACY_FEAT_COLOR, name, _descCache.get(uuid) ?? game.i18n.localize(`${MODULE_ID}.picker.featInscribed`), false, item, img);
    if (!_descCache.has(uuid)) {
      const doc = await fromUuid(uuid).catch(() => null);
      const desc = await _loadDesc(uuid, doc);
      slotEl.dataset.tipDesc = desc;
    }
  });

  panelEl.querySelectorAll('.rune-slot[data-section="legacy-spell"]').forEach(async slotEl => {
    const uuid = slotEl.dataset.runeId;
    if (!uuid) return;

    const cached = getLegacySpells().find(s => s.uuid === uuid);
    const name = cached?.name;
    const img = cached?.img;
    const level = cached?.level;

    if (!name) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc) return;
      const desc = await _loadDesc(uuid, doc);
      fillSocket(slotEl, null, LEGACY_SPELL_COLOR, doc.name, desc, false, item, doc.img);
      return;
    }

    fillSocket(slotEl, null, LEGACY_SPELL_COLOR, name, _descCache.get(uuid) ?? game.i18n.format(`${MODULE_ID}.picker.spellInscribed`, { level: level ?? "?" }), false, item, img);
    if (!_descCache.has(uuid)) {
      const doc  = await fromUuid(uuid).catch(() => null);
      const desc = await _loadDesc(uuid, doc);
      slotEl.dataset.tipDesc = desc;
    }
  });
}

function bindPanelEvents(panelEl, item, runePool, flags) {
  addPresetButtons(panelEl, item);

  panelEl.addEventListener("click", async (event) => {
    const presetPicker = panelEl.querySelector(".runic-preset-picker");
    if (presetPicker && !event.target.closest(".runic-preset-btns") && !event.target.closest(".runic-preset-picker")) {
      presetPicker.style.display = "none";
    }
    const option = event.target.closest(".rune-option");
    const slot = event.target.closest(".rune-slot");

    if (option) {
      event.stopPropagation();
      const pickerEl = option.closest(".rune-picker-panel");
      const section = pickerEl?.dataset.section;
      if (section) await applySelection(panelEl, item, section, option.dataset.value ?? "", runePool, flags);
      closeAllPickers(panelEl);
      return;
    }

    if (slot) {
      event.stopPropagation();
      const section = slot.dataset.section;
      const pickerEl = panelEl.querySelector(`.rune-picker-panel[data-section="${section}"]`);
      if (!pickerEl) return;

      const isOpen = pickerEl.style.display === "block" && slot.classList.contains("picker-active");
      closeAllPickers(panelEl);
      if (!isOpen) {
        slot.classList.add("picker-active");
        buildPickerContent(pickerEl, section, runePool, flags, slot, item);
        pickerEl.style.display = "block";
      }
      return;
    }

    if (event.target.closest(".rune-picker-panel")) return;

    closeAllPickers(panelEl);
  });

  panelEl.addEventListener("mouseover", event => {
    const el = event.target.closest("[data-tip-name]");
    if (el) showTip(el, el.dataset.tipName, el.dataset.tipDesc ?? "");
  });
  panelEl.addEventListener("mouseout", event => {
    const el = event.target.closest("[data-tip-name]");
    if (el && !el.contains(event.relatedTarget)) hideTip();
  });

  document.addEventListener("click", () => {
    closeAllPickers(panelEl);
    const presetPicker = panelEl.querySelector(".runic-preset-picker");
    if (presetPicker) presetPicker.style.display = "none";
  });
  panelEl.addEventListener("click", e => e.stopPropagation());
}

async function applySelection(panelEl, item, section, value, runePool, flags) {
  let flagKey, slotEl;

  if (section === "power" || section === "empowerment") {
    const active = panelEl.querySelector(`.rune-slot[data-section="${section}"].picker-active`);
    const index = active ? parseInt(active.dataset.index) : 0;
    flagKey = section === "power" ? `power-${index}` : `emp-${index}`;
    slotEl = panelEl.querySelector(`.rune-slot[data-section="${section}"][data-index="${index}"]`);
  } else {
    flagKey = section;
    slotEl  = panelEl.querySelector(`.rune-slot[data-section="${section}"]`);
  }

  if (!flagKey || !slotEl) return;

  await item.update({ [`flags.${MODULE_ID}.${flagKey}`]: value || "" }, { render: false });
  flags[flagKey] = value || null;
  slotEl.dataset.runeId = value;

  if (!value) {
    clearSocket(slotEl);
  } else if (section === "power") {
    const rune = runePool.find(r => r.id === value);
    if (rune) fillSocket(slotEl, rune.glyph, rune.color, rune.name, rune.description, true, item);
  } else if (section === "empowerment") {
    const opt = ABILITY_OPTIONS.find(o => o.key === value);
    if (opt) {
      const tally = countEmpowermentTally(flags);
      fillSocket(slotEl, opt.glyph, opt.color, `${opt.label} +${stackBonus(tally[value] ?? 1)}`, opt.description, true, item);
    }
  } else if (section === "legacy-feat") {
    if (value) {
      const cached = getLegacyFeats().find(f => f.uuid === value);
      if (cached) {
        const desc = await _loadDesc(value);
        fillSocket(slotEl, null, LEGACY_FEAT_COLOR, cached.name, desc || game.i18n.localize(`${MODULE_ID}.picker.featInscribed`), true, item, cached.img);
      }
    }
  } else if (section === "legacy-spell") {
    if (value) {
      const cached = getLegacySpells().find(s => s.uuid === value);
      if (cached) {
        const desc = await _loadDesc(value);
        fillSocket(slotEl, null, LEGACY_SPELL_COLOR, cached.name, desc || game.i18n.format(`${MODULE_ID}.picker.spellInscribed`, { level: cached.level ?? "?" }), true, item, cached.img);
      }
    }
  }

  if (section === "power") updateComboSlot(panelEl, flags);

  updateRarityBadge(panelEl, item);
  refreshSocketTooltips(panelEl, item);
  await evaluateItem(item);
  checkAndRenderCracks(panelEl, flags, item);

  if ((section === "legacy-feat" || section === "legacy-spell") && value && item.actor) {
    if (!meetsRequirements(item)) {
      const warnKey = item.system?.attunement === "required"
        ? `${MODULE_ID}.notify.legacyAttuneRequired`
        : `${MODULE_ID}.notify.legacyEquipRequired`;
      ui.notifications.warn(game.i18n.format(warnKey, { item: item.name }));
    } else {
      const cached = section === "legacy-feat"
        ? getLegacyFeats().find(f => f.uuid === value)
        : getLegacySpells().find(s => s.uuid === value);
      if (cached) ui.notifications.info(game.i18n.format(`${MODULE_ID}.notify.legacyGranted`, { name: cached.name, actor: item.actor.name }));
    }
  }
}

function buildPickerContent(pickerEl, section, runePool, flags, activeSlotEl, item) {
  pickerEl.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "rune-picker-grid";

  grid.appendChild(makePickerOption("", game.i18n.localize(`${MODULE_ID}.picker.remove`), null, null, "opt-sock-remove", false, null));

  if (section === "power") {
    const currentId = activeSlotEl?.dataset.runeId ?? "";
    const panelEl = pickerEl.closest(".runic-panel");
    const takenIds = new Set();
    panelEl?.querySelectorAll('.rune-slot[data-section="power"]').forEach(sl => {
      if (sl !== activeSlotEl && sl.dataset.runeId) takenIds.add(sl.dataset.runeId);
    });

    for (const rune of runePool) {
      if (takenIds.has(rune.id)) continue;
      grid.appendChild(makePickerOption(rune.id, rune.name, rune.glyph, rune.color, "opt-sock-power", rune.id === currentId, item ? formatDesc(rune.description, item) : rune.description));
    }
  } else if (section === "empowerment") {
    const currentStat = activeSlotEl?.dataset.runeId ?? "";

    const liveFlags = item?.flags?.[MODULE_ID] ?? {};
    const tally = countEmpowermentTally(liveFlags);

    const baseTally = { ...tally };
    if (currentStat && (baseTally[currentStat] ?? 0) > 0) baseTally[currentStat]--;

    const actor = item?.actor;
    const empEffect = actor?.effects?.find(e =>
      e.flags?.["gm-runic-items"]?.effectKey === "empowerment" &&
      e.origin === item.uuid
    );
    const appliedBonuses = {};
    for (const change of (empEffect?.changes ?? [])) {
      const m = change.key.match(/system\.abilities\.(\w+)\.value/);
      if (m) appliedBonuses[m[1]] = parseInt(change.value) || 0;
    }

    for (const opt of ABILITY_OPTIONS) {
      const newCount = (baseTally[opt.key] ?? 0) + 1;
      const newBonus = stackBonus(newCount);

      if (actor) {
        const currentTotal = actor.system.abilities[opt.key]?.value ?? 10;
        const actorBase = currentTotal - (appliedBonuses[opt.key] ?? 0);
        if (actorBase + newBonus > 30) continue;
      }

      const label = `${opt.label} +${newBonus}`;
      grid.appendChild(makePickerOption(opt.key, label, opt.glyph, opt.color, "opt-sock-emp", opt.key === currentStat, opt.description));
    }
  } else if (section === "legacy-feat" || section === "legacy-spell") {
    const liveFlags = item?.flags?.[MODULE_ID] ?? {};
    const currentVal = liveFlags[section] ?? "";
    buildLegacySearchPicker(pickerEl, section === "legacy-feat", currentVal, item);
    return;
  }

  pickerEl.appendChild(grid);
}

function buildLegacySearchPicker(pickerEl, isFeats, currentValue, item) {
  pickerEl.innerHTML = "";
  pickerEl.classList.add("legacy-picker");

  const color = isFeats ? LEGACY_FEAT_COLOR : LEGACY_SPELL_COLOR;
  const placeholder = isFeats
    ? game.i18n.localize(`${MODULE_ID}.picker.searchFeats`)
    : game.i18n.localize(`${MODULE_ID}.picker.searchSpells`);

  const searchRow = document.createElement("div");
  searchRow.className = "legacy-search-row";

  const inputWrap = document.createElement("div");
  inputWrap.className = "legacy-search-input-wrap";
  inputWrap.style.setProperty("--legacy-focus-color", color);

  const searchSvg = document.createElementNS(SVG_NS, "svg");
  searchSvg.setAttribute("viewBox", "0 0 24 24");
  searchSvg.setAttribute("width", "12");
  searchSvg.setAttribute("height", "12");
  searchSvg.classList.add("legacy-search-icon");
  const searchPath = document.createElementNS(SVG_NS, "path");
  searchPath.setAttribute("d", "M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z");
  searchPath.setAttribute("stroke", "currentColor");
  searchPath.setAttribute("fill", "none");
  searchPath.setAttribute("stroke-width", "2");
  searchPath.setAttribute("stroke-linecap", "round");
  searchSvg.appendChild(searchPath);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "legacy-search-input";
  input.placeholder = placeholder;

  inputWrap.appendChild(searchSvg);
  inputWrap.appendChild(input);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "legacy-remove-btn";
  removeBtn.innerHTML = `&#x2715; ${game.i18n.localize(`${MODULE_ID}.picker.remove`)}`;

  searchRow.appendChild(inputWrap);
  searchRow.appendChild(removeBtn);
  pickerEl.appendChild(searchRow);

  const hintEl = document.createElement("div");
  hintEl.className = "legacy-search-hint";
  pickerEl.appendChild(hintEl);

  const grid = document.createElement("div");
  grid.className = "rune-picker-grid";
  pickerEl.appendChild(grid);

  const removeOpt = document.createElement("div");
  removeOpt.className = "rune-option";
  removeOpt.dataset.value = "";
  removeOpt.style.display = "none";
  grid.appendChild(removeOpt);

  removeBtn.addEventListener("click", e => {
    e.stopPropagation();
    removeOpt.click();
  });

  function renderResults(query) {
    Array.from(grid.children).forEach(c => { if (c !== removeOpt) c.remove(); });

    const allItems = isFeats ? getLegacyFeats() : getLegacySpells();
    const q = query.toLowerCase().trim();
    const LIMIT    = 12;

    let filtered;
    if (q.length === 0) {
      filtered = allItems.slice(0, LIMIT);
      const typeStr = game.i18n.localize(`${MODULE_ID}.picker.${isFeats ? "typeFeats" : "typeSpells"}`);
      hintEl.style.display = "";
      hintEl.textContent = allItems.length > LIMIT
        ? game.i18n.format(`${MODULE_ID}.picker.showingFirst`, { limit: LIMIT, total: allItems.length })
        : game.i18n.format(`${MODULE_ID}.picker.countAvailable`, { total: allItems.length, type: typeStr });
    } else {
      filtered = allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 20);
      if (filtered.length === 0) {
        hintEl.style.display = "";
        hintEl.textContent   = game.i18n.format(`${MODULE_ID}.picker.noMatch`, { type: game.i18n.localize(`${MODULE_ID}.picker.${isFeats ? "typeFeats" : "typeSpells"}`), query });
      } else {
        hintEl.style.display = "none";
      }
    }

    for (const entry of filtered) {
      const isSelected = entry.uuid === currentValue;
      const el = document.createElement("div");
      el.className = "rune-option" + (isSelected ? " opt-selected" : "");
      el.dataset.value = entry.uuid;
      if (isSelected) el.style.setProperty("--rune-color", color);

      const sock = document.createElement("div");
      sock.className = "rune-option-socket opt-sock-legacy";
      if (isSelected) sock.style.setProperty("--rune-color", color);

      const img = document.createElement("img");
      img.src = entry.img || "icons/svg/item-bag.svg";
      img.alt = entry.name;
      img.className = "legacy-item-img";
      sock.appendChild(img);

      const nameEl = document.createElement("span");
      nameEl.className = "rune-option-name";
      nameEl.textContent = isFeats
        ? entry.name
        : `${entry.name}${entry.level != null ? ` (${entry.level})` : ""}`;

      el.appendChild(sock);
      el.appendChild(nameEl);

      // Tooltip
      el.dataset.tipName = entry.name;
      el.dataset.tipDesc = isFeats
        ? game.i18n.localize(`${MODULE_ID}.picker.featInscribed`)
        : game.i18n.format(`${MODULE_ID}.picker.spellInscribed`, { level: entry.level ?? "?" });

      grid.insertBefore(el, removeOpt);
    }
  }

  input.addEventListener("input", () => {
    if (isLegacyCacheLoaded()) renderResults(input.value);
  });

  grid.addEventListener("mouseover", async (event) => {
    const opt = event.target.closest(".rune-option");
    if (!opt?.dataset.value?.startsWith("Compendium.")) return;

    const uuid = opt.dataset.value;
    const desc = await _loadDesc(uuid);
    if (!desc) return;

    opt.dataset.tipDesc = desc;
    updateTip(opt, desc); // patch the live tooltip if user is still hovering
  });

  if (isLegacyCacheLoaded()) {
    renderResults("");
  } else {
    hintEl.textContent = game.i18n.localize(`${MODULE_ID}.picker.loading`);
    ensureLegacyCacheLoaded().then(() => {
      if (pickerEl.style.display !== "none") renderResults(input.value || "");
    });
  }

  requestAnimationFrame(() => input.focus());
}

function makePickerOption(value, label, glyph, color, sockClass, selected, description) {
  const el = document.createElement("div");
  el.className = "rune-option" + (selected ? " opt-selected" : "");
  el.dataset.value = value;
  if (color) el.style.setProperty("--rune-color", color);

  const sock = document.createElement("div");
  sock.className = `rune-option-socket ${sockClass}`;
  if (color) sock.style.setProperty("--rune-color", color);

  if (glyph) {
    sock.appendChild(buildGlyphSvg(glyph, color ?? "#888", 18));
  } else {
    const dash = document.createElement("span");
    dash.style.cssText = "font-size:0.8em;color:rgba(255,255,255,0.25)";
    dash.textContent = "-";
    sock.appendChild(dash);
  }

  const name = document.createElement("span");
  name.className = "rune-option-name";
  name.textContent = label;

  el.appendChild(sock);
  el.appendChild(name);

  if (description) {
    el.dataset.tipName = label;
    el.dataset.tipDesc = description;
  }

  return el;
}

function fillSocket(slotEl, glyph, color, name, description, animate, item, imgSrc = null) {
  const socketEl = slotEl.querySelector(".rune-socket");
  if (!socketEl) return;

  socketEl.innerHTML = "";
  socketEl.style.setProperty("--rune-color", color);
  slotEl.style.setProperty("--rune-color", color);
  slotEl.classList.add("slot-filled");
  socketEl.classList.add("sock-filled");

  slotEl.dataset.tipName = name;
  slotEl.dataset.tipTemplate = description ?? "";
  slotEl.dataset.tipDesc = item ? formatDesc(description, item) : (description ?? "");

  if (imgSrc) {
      const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = name;
    img.className = "legacy-item-img";
    socketEl.appendChild(img);
    if (animate) {
      socketEl.classList.add("sock-flashing");
      setTimeout(() => socketEl.classList.remove("sock-flashing"), 1500);
    }
  } else {
    const size = slotEl.classList.contains("rune-slot-emp") ? 18
               : slotEl.classList.contains("rune-slot-legacy") ? 20
               : 26;
    const svg = buildGlyphSvg(glyph, color, size);
    socketEl.appendChild(svg);
    if (animate) {
      const path = svg.querySelector(".rune-path");
      if (path) {
        const length = path.getTotalLength();
        path.style.strokeDasharray = length;
        path.style.strokeDashoffset = length;
        socketEl.classList.add("sock-flashing");
        requestAnimationFrame(() => {
          path.style.transition = "stroke-dashoffset 1.1s ease-in-out 0.25s";
          path.style.strokeDashoffset = "0";
          setTimeout(() => socketEl.classList.remove("sock-flashing"), 1500);
        });
      }
    }
  }
}

function clearSocket(slotEl) {
  const socketEl = slotEl.querySelector(".rune-socket");
  if (!socketEl) return;
  socketEl.innerHTML = "";
  socketEl.classList.remove("sock-filled", "sock-flashing");
  socketEl.style.removeProperty("--rune-color");
  slotEl.style.removeProperty("--rune-color");
  slotEl.classList.remove("slot-filled");
  delete slotEl.dataset.tipName;
  delete slotEl.dataset.tipDesc;
}

function buildGlyphSvg(glyph, color, size) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.classList.add("rune-glyph");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", glyph);
  path.setAttribute("stroke", color);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.classList.add("rune-path");

  svg.appendChild(path);
  return svg;
}

function closeAllPickers(panelEl) {
  panelEl.querySelectorAll(".rune-picker-panel").forEach(p => (p.style.display = "none"));
  panelEl.querySelectorAll(".rune-slot.picker-active").forEach(s => s.classList.remove("picker-active"));
}

function updateRarityBadge(panelEl, item) {
  const badge = panelEl.querySelector(".runic-rarity-badge");
  if (!badge) return;
  const rarity = computeRunicRarity(item);
  badge.textContent = rarity;
  badge.dataset.rarity = rarity;
}

function refreshSocketTooltips(panelEl, item) {
  panelEl.querySelectorAll(".rune-slot[data-tip-template]").forEach(slotEl => {
    const template = slotEl.dataset.tipTemplate;
    if (template) slotEl.dataset.tipDesc = formatDesc(template, item);
  });
}

function countEmpowermentTally(flags) {
  const tally = {};
  for (let i = 0; i < 5; i++) {
    const stat = flags[`emp-${i}`];
    if (stat) tally[stat] = (tally[stat] ?? 0) + 1;
  }
  return tally;
}

function stackBonus(count) {
  return count;
}

async function onUpdateItem(item, changes) {
  if (!item.flags?.[MODULE_ID]) return;
  if (!getItemCategory(item)) return;

  const flat = Object.keys(foundry.utils.flattenObject(changes));
  if (flat.length > 0 && flat.every(k =>
    k.startsWith("system.damage") || k === `flags.${MODULE_ID}.injectedDamageTypes`
  )) return;

  return withCache("updateItem", item.id, 150, () => evaluateItem(item));
}

async function onRenderActorSheet(sheet, html, data) {
  const actor = sheet.actor;
  if (!actor) return;
  return withCache("actorSheet", actor.id, 500, () => {
    const targets = actor.items.filter(i => i.flags?.[MODULE_ID] && getItemCategory(i));
    return Promise.all(targets.map(i => evaluateItem(i)));
  });
}
