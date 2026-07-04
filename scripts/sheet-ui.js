import {
  getItemCategory, getRunePool,
  computeRunicRarity, getRarityDie, meetsRequirements, withCache,
  renderTemplateCompat
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
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${MODULE_ID}.presets.dialogTitle`) },
    content: `<input type="text" name="presetName" placeholder="${game.i18n.localize(`${MODULE_ID}.presets.namePlaceholder`)}" autofocus/>`,
    ok: {
      icon: "fas fa-bookmark",
      label: game.i18n.localize(`${MODULE_ID}.presets.save`),
      callback: (event, button) => button.form.elements.presetName.value.trim()
    },
    rejectClose: false
  });
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

function clearCrack(rowEl) {
  rowEl?.querySelector(".runic-crack-overlay")?.remove();
  rowEl?.querySelector(".runic-crack-message")?.remove();
}

function isCompendiumRef(ref) {
  return typeof ref === "string" && ref.includes(".");
}

async function resolveLegacyRef(ref) {
  if (!isCompendiumRef(ref)) return null;
  const uuid = ref.startsWith("Compendium.") ? ref : `Compendium.${ref}`;
  return await fromUuid(uuid).catch(() => null);
}

function findLegacyDuplicate(actor, item, flagKey, ref) {
  if (!ref) return null;
  const configured = actor.items.find(i =>
    i.id !== item.id &&
    i.flags?.[MODULE_ID]?.[flagKey] === ref &&
    getItemCategory(i) &&
    meetsRequirements(i)
  );
  if (configured) return configured;
  const granted = actor.items.find(i =>
    i.flags?.[MODULE_ID]?.grantKey === flagKey &&
    i.flags?.[MODULE_ID]?.refId === ref &&
    i.flags?.[MODULE_ID]?.sourceItemId !== item.id
  );
  if (granted) return actor.items.get(granted.flags[MODULE_ID].sourceItemId) ?? granted;
  return null;
}

function checkAndRenderCracks(panelEl, flags, item) {
  const actor = item.actor;
  if (!actor) return;

  const empRow = panelEl.querySelector(".runic-empowerment .rune-slot-row");
  if (empRow) {
    const tally = countEmpowermentTally(flags);

    // bonuses from other active runic items on the same actor
    const otherBonus = {};
    for (const other of actor.items) {
      if (other.id === item.id) continue;
      const oFlags = other.flags?.[MODULE_ID];
      if (!oFlags || !getItemCategory(other) || !meetsRequirements(other)) continue;
      for (let i = 0; i < 5; i++) {
        const stat = oFlags[`emp-${i}`];
        if (stat) otherBonus[stat] = (otherBonus[stat] ?? 0) + 1;
      }
    }

    const offending = [];
    for (const [stat, count] of Object.entries(tally)) {
      // source value ignores active effects, so this stays stable while effect sync is in flight
      const base = actor.system._source?.abilities?.[stat]?.value
        ?? actor.system.abilities?.[stat]?.value ?? 10;
      if (base + stackBonus(count) + (otherBonus[stat] ?? 0) > 30) offending.push(stat);
    }

    if (offending.length > 0) {
      const colors = offending.map(s => ABILITY_OPTIONS.find(o => o.key === s)?.color ?? "#888");
      const label = offending.map(s => s.toUpperCase()).join(", ");
      const anchor = panelEl.querySelector(`.rune-slot[data-section="empowerment"][data-rune-id="${offending[0]}"]`);
      const fingerprint = offending.map(s => s + (tally[s] ?? 0)).join(".");
      renderSectionCrack(
        empRow,
        colors,
        game.i18n.format(`${MODULE_ID}.crack.statOverCap`, { stats: label }),
        crackSeedFor(item, "emp", fingerprint),
        anchor
      );
    } else {
      clearCrackNonce(item, "emp");
      clearCrack(empRow);
    }
  }

  const legacyRow = panelEl.querySelector(".runic-legacy .rune-slot-row");
  if (legacyRow) {
    const featRef = flags["legacy-feat"] || null;
    const spellRef = flags["legacy-spell"] || null;

    if (!featRef && !spellRef) {
      clearCrackNonce(item, "legacy");
      clearCrack(legacyRow);
      return;
    }

    const featDup = findLegacyDuplicate(actor, item, "legacy-feat", featRef);
    const spellDup = findLegacyDuplicate(actor, item, "legacy-spell", spellRef);

    Promise.all([resolveLegacyRef(featRef), resolveLegacyRef(spellRef)]).then(([featDoc, spellDoc]) => {
      if (!legacyRow.isConnected) return;

      const featMissing = !!featRef && isCompendiumRef(featRef) && !featDoc;
      const spellMissing = !!spellRef && isCompendiumRef(spellRef) && !spellDoc;

      const featBroken = featMissing || !!featDup;
      const spellBroken = spellMissing || !!spellDup;

      if (!featBroken && !spellBroken) {
        clearCrackNonce(item, "legacy");
        clearCrack(legacyRow);
        return;
      }

      const colors = [];
      if (featBroken) colors.push(LEGACY_FEAT_COLOR);
      if (spellBroken) colors.push(LEGACY_SPELL_COLOR);

      const parts = [];
      if (featMissing) {
        parts.push(game.i18n.localize(`${MODULE_ID}.crack.featMissing`));
      } else if (featDup) {
        parts.push(game.i18n.format(`${MODULE_ID}.crack.featDuplicate`, { item: featDup.name }));
      }
      if (spellMissing) {
        parts.push(game.i18n.localize(`${MODULE_ID}.crack.spellMissing`));
      } else if (spellDup) {
        parts.push(game.i18n.format(`${MODULE_ID}.crack.spellDuplicate`, { item: spellDup.name }));
      }

      const anchor = featBroken
        ? panelEl.querySelector('.rune-slot[data-section="legacy-feat"]')
        : panelEl.querySelector('.rune-slot[data-section="legacy-spell"]');
      const fingerprint = `${featBroken ? "F" : ""}${spellBroken ? "S" : ""}-${featRef ?? ""}-${spellRef ?? ""}`;
      renderSectionCrack(
        legacyRow,
        colors,
        parts.join("  |  "),
        crackSeedFor(item, "legacy", fingerprint),
        anchor
      );
    });
  }
}

let _crackUid = 0;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function crackDisplace(p0, p1, depth, rough, rnd, W, H) {
  let pts = [p0, p1];
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const off = (rnd() - 0.5) * 2 * len * rough;
      out.push([(a[0] + b[0]) / 2 - dy / len * off, (a[1] + b[1]) / 2 + dx / len * off], b);
    }
    pts = out;
  }
  return pts.map(p => [Math.max(4, Math.min(W - 4, p[0])), Math.max(4, Math.min(H - 4, p[1]))]);
}

function crackTaperPoly(pts, w0, w1, rnd, scale = 1) {
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const jitter = 0.65 + rnd() * 0.7;
    const w = Math.max(0.12, (w0 * (1 - t) + w1 * t) * jitter * scale) / 2;
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  const fmt = p => p[0].toFixed(1) + "," + p[1].toFixed(1);
  return "M " + left.map(fmt).join(" L ") + " L " + right.reverse().map(fmt).join(" L ") + " Z";
}

function crackPolyline(pts) {
  return "M " + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L ");
}

function crackBranches(trunk, count, depth, rough, w0, rnd, lenScale, W, H) {
  const out = [];
  const trunkLen = Math.hypot(trunk[trunk.length - 1][0] - trunk[0][0], trunk[trunk.length - 1][1] - trunk[0][1]);
  for (let b = 0; b < count; b++) {
    const i = Math.floor(trunk.length * (0.15 + 0.65 * rnd()));
    const p = trunk[i], q = trunk[Math.min(trunk.length - 1, i + 1)];
    const baseAng = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const ang = baseAng + (rnd() < 0.5 ? 1 : -1) * (0.55 + 0.9 * rnd());
    const len = trunkLen * lenScale * (0.6 + 0.8 * rnd());
    const end = [p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len];
    const t = i / (trunk.length - 1);
    out.push({ pts: crackDisplace(p, end, depth, rough, rnd, W, H), w0: w0 * (1 - t * 0.6) * 0.5, w1: 0.15 });
  }
  return out;
}

function buildShatterCracks(rnd, W, H, origin) {
  const [cx, cy] = origin;
  const cracks = [];
  const n = 7 + Math.floor(rnd() * 2);
  const angles = [];
  const dir = cx < W / 2 ? 1 : -1;
  const remaining = dir > 0 ? W - cx : cx;
  const vScale = Math.max(0.6, H / 88);
  for (let i = 0; i < n; i++) angles.push((i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5);
  let bestIdx = 0;
  for (let i = 1; i < n; i++) {
    if (Math.cos(angles[i]) * dir > Math.cos(angles[bestIdx]) * dir) bestIdx = i;
  }
  for (let i = 0; i < n; i++) {
    const ang = angles[i];
    const horiz = Math.cos(ang) * dir;
    let len = (36 + rnd() * 44) * vScale;

    if (i === bestIdx) {
      len = remaining * (0.8 + 0.15 * rnd()) / Math.max(horiz, 0.35);
    } else if (horiz > 0.2) {
      len = Math.max(len, remaining * (0.45 + 0.5 * rnd()) / Math.max(horiz, 0.35));
    }
    const end = [cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.42];
    const pts = crackDisplace([cx, cy], end, 4, 0.13, rnd, W, H);
    cracks.push({ pts, w0: 4.4, w1: 0.15 });
    if (len > W * 0.4) cracks.push(...crackBranches(pts, 2, 3, 0.22, 3.2, rnd, 0.16, W, H));
  }
  for (let i = 0; i < 3; i++) {
    const k = Math.floor(rnd() * n);
    const r = (15 + rnd() * 24) * vScale;
    const a1 = angles[k] + 0.15, a2 = angles[(k + 1) % n] - 0.15;
    const p1 = [cx + Math.cos(a1) * r * 1.5, cy + Math.sin(a1) * r * 0.45];
    const p2 = [cx + Math.cos(a2) * r * 1.5, cy + Math.sin(a2) * r * 0.45];
    cracks.push({ pts: crackDisplace(p1, p2, 3, 0.2, rnd, W, H), w0: 1.5, w1: 0.5 });
  }
  return cracks;
}

function buildFissureCracks(rnd, W, H, origin) {
  const [cx, cy] = origin;
  const dir = cx < W / 2 ? 1 : -1;
  const remaining = dir > 0 ? W - cx : cx;
  const backSpan = dir > 0 ? cx : W - cx;
  const cracks = [];
  const trunk = crackDisplace(
    [cx, cy],
    [cx + dir * remaining * (0.8 + 0.15 * rnd()), cy + (rnd() - 0.5) * H * 0.5],
    5, 0.16, rnd, W, H
  );
  cracks.push({ pts: trunk, w0: 5.5, w1: 0.2 });
  const back = crackDisplace(
    [cx, cy],
    [cx - dir * backSpan * (0.35 + 0.35 * rnd()), cy + (rnd() - 0.5) * H * 0.4],
    4, 0.2, rnd, W, H
  );
  cracks.push({ pts: back, w0: 4.0, w1: 0.15 });
  cracks.push(...crackBranches(trunk, 3, 3, 0.24, 5.5, rnd, 0.14, W, H));
  cracks.push(...crackBranches(back, 1, 3, 0.24, 4.0, rnd, 0.16, W, H));
  return cracks;
}

const _crackNonce = new Map();

function crackSeedFor(item, section, fingerprint) {
  const key = `${item.id}-${section}`;
  if (!_crackNonce.has(key)) _crackNonce.set(key, Math.floor(Math.random() * 1e9));
  return `${key}-${fingerprint}-${_crackNonce.get(key)}`;
}

function clearCrackNonce(item, section) {
  _crackNonce.delete(`${item.id}-${section}`);
}

function renderSectionCrack(sectionEl, colors, message, seedKey, anchorEl = null, retried = false) {
  sectionEl.querySelector(".runic-crack-overlay")?.remove();
  sectionEl.querySelector(".runic-crack-message")?.remove();

  if (!sectionEl.clientWidth && !retried) {
    requestAnimationFrame(() => {
      if (sectionEl.isConnected) renderSectionCrack(sectionEl, colors, message, seedKey, anchorEl, true);
    });
    return;
  }

  const W = sectionEl.clientWidth || 420;
  const H = sectionEl.clientHeight || 88;
  const rnd = mulberry32(hashSeed(seedKey));
  const id = `runic-crk-${_crackUid++}`;

  let origin = [W * (0.18 + rnd() * 0.16), H * (0.38 + rnd() * 0.24)];
  if (anchorEl) {
    const rowRect = sectionEl.getBoundingClientRect();
    const aRect = anchorEl.getBoundingClientRect();
    if (aRect.width) {
      origin = [
        aRect.left - rowRect.left + aRect.width / 2,
        aRect.top - rowRect.top + aRect.height / 2
      ];
    }
  }

  // mix of shatter webs and fissures to randomize
  const buildCracks = rnd() < 0.55 ? buildShatterCracks : buildFissureCracks;
  const cracks = buildCracks(rnd, W, H, origin);

  const col = colors.length > 1 ? `url(#${id}-g)` : colors[0];
  const gradDef = colors.length > 1
    ? `<linearGradient id="${id}-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">` +
      colors.map((c, i) => `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}"/>`).join("") +
      `</linearGradient>`
    : "";

  const strokePass = (wMul, op) => cracks.map(c =>
    `<path d="${crackPolyline(c.pts)}" stroke="${col}" stroke-width="${Math.max(0.8, c.w0 * wMul).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`
  ).join("");

  const hotColor = colors[0];
  const hotDef = `<radialGradient id="${id}-h"><stop offset="0%" stop-color="${hotColor}" stop-opacity="0.35"/><stop offset="45%" stop-color="${hotColor}" stop-opacity="0.1"/><stop offset="100%" stop-color="${hotColor}" stop-opacity="0"/></radialGradient>`;
  const hotspot = `<ellipse cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" rx="${Math.min(W * 0.18, H * 1.3).toFixed(0)}" ry="${(H * 0.42).toFixed(0)}" fill="url(#${id}-h)"/>`;

  // screen blended multi-pass glow
  const glow = `<g class="runic-crack-pulse" style="mix-blend-mode:screen">${hotspot}<g filter="url(#${id}-b1)">${strokePass(4.0, 0.07)}</g><g filter="url(#${id}-b2)">${strokePass(2.0, 0.13)}${strokePass(1.0, 0.2)}</g></g>`;
  const fissure = cracks.map(c => `<path d="${crackTaperPoly(c.pts, c.w0, c.w1, rnd)}" fill="rgba(5,3,12,0.96)"/>`).join("");
  const core = cracks.map(c => `<path d="${crackTaperPoly(c.pts, c.w0, c.w1, rnd, 0.38)}" fill="${col}" opacity="0.95"/>`).join("");

  let embers = "";
  for (let i = 0; i < 10; i++) {
    const c = cracks[Math.floor(rnd() * cracks.length)];
    const p = c.pts[Math.floor(rnd() * c.pts.length)];
    const dur = (1.5 + rnd() * 2.4).toFixed(2);
    const delay = (rnd() * 2.6).toFixed(2);
    const dx = ((rnd() - 0.5) * 20).toFixed(1);
    const dy = (-(9 + rnd() * 18)).toFixed(1);
    embers += `<circle class="runic-crack-ember" style="--d:${delay}s;--dur:${dur}s;--dx:${dx}px;--dy:${dy}px" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(0.6 + rnd() * 1.1).toFixed(1)}" fill="${colors[i % colors.length]}"/>`;
  }

  const rMax = Math.ceil(Math.max(
    Math.hypot(origin[0], origin[1]),
    Math.hypot(W - origin[0], origin[1]),
    Math.hypot(origin[0], H - origin[1]),
    Math.hypot(W - origin[0], H - origin[1])
  ) + 70);
  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const maskDef =
    `<mask id="${id}-m" maskUnits="userSpaceOnUse" x="-60" y="-60" width="${W + 120}" height="${H + 120}">` +
    `<circle cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${reducedMotion ? rMax : 0}" fill="#fff">` +
    (reducedMotion ? "" : `<animate attributeName="r" values="0;${Math.round(rMax * 0.22)};${rMax}" keyTimes="0;0.5;1" dur="1.9s" fill="freeze" calcMode="spline" keySplines="0.45 0.05 0.55 0.5;0.15 0.6 0.25 1"/>`) +
    `</circle></mask>`;

  const svgMarkup =
    `<svg class="runic-crack-overlay" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    `<defs>${gradDef}${hotDef}` +
    `<filter id="${id}-b1" filterUnits="userSpaceOnUse" x="-60" y="-60" width="${W + 120}" height="${H + 120}"><feGaussianBlur stdDeviation="6"/></filter>` +
    `<filter id="${id}-b2" filterUnits="userSpaceOnUse" x="-60" y="-60" width="${W + 120}" height="${H + 120}"><feGaussianBlur stdDeviation="2.5"/></filter>` +
    `</defs>` +
    maskDef +
    `<g mask="url(#${id}-m)">${glow}${fissure}${core}${embers}</g>` +
    `</svg>`;

  sectionEl.insertAdjacentHTML("afterbegin", svgMarkup);

  const msg = document.createElement("div");
  msg.className = "runic-crack-message";
  msg.style.borderColor = colors[0];
  msg.style.color = colors[0];
  msg.textContent = message;
  sectionEl.appendChild(msg);
}

export function registerSheetHooks() {
  // AppV1 sheets (dnd5e 3.x/4.x) fire renderItemSheet5e with jQuery html;
  // AppV2 sheets (dnd5e 5.x / core v13+) fire render hooks with an HTMLElement
  Hooks.on("renderItemSheet5e", onRenderItemSheet);
  Hooks.on("renderItemSheetV2", onRenderItemSheet);
  Hooks.on("updateItem", onUpdateItem);
  Hooks.on("renderActorSheet", onRenderActorSheet);
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
}

async function onRenderItemSheet(app, html, data) {
  const item = app.item ?? app.object ?? app.document;
  if (!item || !getItemCategory(item)) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  const detailsTab = root?.querySelector('.tab[data-tab="details"]');
  if (!detailsTab) return;

  // sibling render hooks fire this in the same tick; claim synchronously
  // before the await so only one invocation injects the panel
  if (app._runicInjecting) return;
  app._runicInjecting = true;
  try {
    const scrollTop = app._runicScrollRestore ?? detailsTab.scrollTop;
    delete app._runicScrollRestore;
    detailsTab.querySelectorAll(".runic-panel").forEach(p => p.remove());

    const flags = foundry.utils.getProperty(item, `flags.${MODULE_ID}`) ?? {};
    const runePool = getRunePool(item);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = await renderTemplateCompat(TEMPLATE, buildTemplateContext(flags, item));
    const panel = wrapper.querySelector(".runic-panel");
    if (!panel) return;

    detailsTab.appendChild(panel);
    detailsTab.scrollTop = scrollTop;

    initAllSockets(panel, flags, runePool, item);

    const minRole = game.settings.get(MODULE_ID, "minRoleToEdit") ?? 4;
    const editable = app.isEditable ?? data?.editable ?? false;
    const canEdit = editable && (game.user.role >= minRole);

    if (canEdit) {
      bindPanelEvents(panel, item, runePool, flags);
    } else {
      panel.classList.add("runic-panel-readonly");
    }
  } finally {
    app._runicInjecting = false;
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

  const onDocClick = () => {
    if (!panelEl.isConnected) {
      document.removeEventListener("click", onDocClick);
      return;
    }
    closeAllPickers(panelEl);
    const presetPicker = panelEl.querySelector(".runic-preset-picker");
    if (presetPicker) presetPicker.style.display = "none";
  };
  document.addEventListener("click", onDocClick);
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
