import { registerCombatHooks } from "./combat-effects.js";
import { registerSheetHooks }  from "./sheet-ui.js";
import { clearLegacyCache, refreshLegacyCache } from "./legacy-cache.js";
import { getPresets, deletePreset } from "./preset-manager.js";
import { loadTemplatesCompat } from "./utils.js";

const MODULE_ID = "gm-runic-items";

Hooks.once("init", () => {
  loadTemplatesCompat([`modules/${MODULE_ID}/templates/rune-panel.hbs`]);

  registerCombatHooks();
  registerSheetHooks();

  Handlebars.registerHelper("ifEquals", function(a, b, options) {
    return a === b ? options.fn(this) : options.inverse(this);
  });

  const roleChoices = {};
  for (const [key, value] of Object.entries(CONST.USER_ROLES)) {
    if (value <= 0) continue;
    const label = game.i18n.localize(`USER.Role${key.charAt(0) + key.slice(1).toLowerCase()}`);
    roleChoices[value] = label;
  }

  game.settings.register(MODULE_ID, "minRoleToEdit", {
    name: `${MODULE_ID}.settings.minRoleToEdit.name`,
    hint: `${MODULE_ID}.settings.minRoleToEdit.hint`,
    scope: "world",
    config: true,
    type: Number,
    choices: roleChoices,
    default: CONST.USER_ROLES.GAMEMASTER,
    onChange: () => {}
  });

  game.settings.register(MODULE_ID, "cacheInfo", {
    name: `${MODULE_ID}.settings.cacheInfo.name`,
    hint: `${MODULE_ID}.settings.cacheInfo.hint`,
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => {}
  });

  game.settings.register(MODULE_ID, "presets", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
});

Hooks.on("renderSettingsConfig", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  let section = root.querySelector(`[data-category="${MODULE_ID}"]`);
  if (!section) {
    // v13+ settings layout: anchor on one of our own setting rows instead
    const anySetting = root.querySelector(`[data-setting-id^="${MODULE_ID}."]`);
    section = anySetting?.closest(`section, .category, fieldset, .tab`) ?? anySetting?.parentElement ?? null;
  }
  if (!section) return;

  const existingRow = section.querySelector(`[data-setting-id="${MODULE_ID}.cacheInfo"]`);

  const i18n = game.i18n;
  const row = document.createElement("div");
  row.className = "form-group runic-cache-controls";
  row.innerHTML = `
    <label>${i18n.localize(`${MODULE_ID}.settings.cacheLabel`)}</label>
    <div class="runic-cache-buttons">
      <button type="button" class="runic-btn-clear-cache">
        <i class="fas fa-trash"></i> ${i18n.localize(`${MODULE_ID}.settings.clearCache`)}
      </button>
      <button type="button" class="runic-btn-refresh-cache">
        <i class="fas fa-sync-alt"></i> ${i18n.localize(`${MODULE_ID}.settings.refreshCache`)}
      </button>
    </div>
    <p class="notes">${i18n.localize(`${MODULE_ID}.settings.cacheNotes`)}</p>
  `;

  if (existingRow) {
    existingRow.replaceWith(row);
  } else {
    section.appendChild(row);
  }

  row.querySelector(".runic-btn-clear-cache").addEventListener("click", () => {
    clearLegacyCache();
  });

  row.querySelector(".runic-btn-refresh-cache").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize(`${MODULE_ID}.settings.refreshing`)}`;
    try {
      await refreshLegacyCache();
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="fas fa-sync-alt"></i> ${game.i18n.localize(`${MODULE_ID}.settings.refreshCache`)}`;
    }
  });

  const presetSection = document.createElement("div");
  presetSection.className = "form-group runic-cache-controls";
  presetSection.innerHTML = `
    <label>${game.i18n.localize(`${MODULE_ID}.presets.settingsTitle`)}</label>
    <div class="runic-cache-buttons">
      <button type="button" class="runic-btn-manage-presets">
        <i class="fas fa-bookmark"></i> ${game.i18n.localize(`${MODULE_ID}.presets.settingsTitle`)}
      </button>
    </div>
    <p class="notes">${game.i18n.localize(`${MODULE_ID}.presets.settingsHint`)}</p>
  `;
  section.appendChild(presetSection);

  presetSection.querySelector(".runic-btn-manage-presets").addEventListener("click", () => {
    openPresetManager();
  });
});

function buildPresetManagerContent() {
  const presets = getPresets();
  const categories = [
    { key: "melee", label: game.i18n.localize(`${MODULE_ID}.presets.melee`) },
    { key: "ranged", label: game.i18n.localize(`${MODULE_ID}.presets.ranged`) },
    { key: "armor", label: game.i18n.localize(`${MODULE_ID}.presets.armor`) }
  ];

  let html = `<div class="runic-preset-manager-content">`;

  for (const cat of categories) {
    const group = presets.filter(p => p.category === cat.key);
    html += `<div class="preset-manager-category preset-cat-${cat.key}"><h4>${cat.label}</h4>`;
    if (group.length === 0) {
      html += `<p class="preset-manager-empty">${game.i18n.format(`${MODULE_ID}.presets.noneForCategory`, { category: cat.label })}</p>`;
    } else {
      for (let i = 0; i < group.length; i++) {
        const preset = group[i];
        const shade = i % 2 === 0 ? "row-shade-a" : "row-shade-b";
        html += `
          <div class="preset-manager-row ${shade}" data-preset-id="${preset.id}">
            <span class="preset-manager-name">${preset.name}</span>
            <button type="button" class="preset-manager-delete" data-preset-id="${preset.id}">
              <i class="fas fa-trash"></i> ${game.i18n.localize(`${MODULE_ID}.presets.delete`)}
            </button>
          </div>`;
      }
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function openPresetManager() {
  foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${MODULE_ID}.presets.settingsTitle`) },
    position: { width: 400 },
    content: buildPresetManagerContent(),
    buttons: [{ action: "close", label: game.i18n.localize(`${MODULE_ID}.common.close`), default: true }],
    render: (_event, dialog) => {
      // v12 passes the dialog element, v13+ the application
      const root = dialog instanceof HTMLElement ? dialog : dialog.element;
      wirePresetManagerButtons(root);
    },
    rejectClose: false
  });
}

function wirePresetManagerButtons(root) {
  root.querySelectorAll(".preset-manager-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.presetId;
      const name = btn.closest(".preset-manager-row")?.querySelector(".preset-manager-name")?.textContent ?? "";
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize(`${MODULE_ID}.presets.settingsTitle`) },
        content: `<p>${game.i18n.format(`${MODULE_ID}.presets.confirmDelete`, { name })}</p>`,
        rejectClose: false
      });
      if (!ok) return;
      await deletePreset(id);
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.presets.deleted`, { name }));
      const content = root.querySelector(".runic-preset-manager-content");
      if (content) {
        content.outerHTML = buildPresetManagerContent();
        wirePresetManagerButtons(root);
      }
    });
  });
}
