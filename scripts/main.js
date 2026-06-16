import { registerCombatHooks } from "./combat-effects.js";
import { registerSheetHooks }  from "./sheet-ui.js";
import { clearLegacyCache, refreshLegacyCache } from "./legacy-cache.js";
import { getPresets, deletePreset } from "./preset-manager.js";

const MODULE_ID = "gm-runic-items";

Hooks.once("init", () => {
  loadTemplates([`modules/${MODULE_ID}/templates/rune-panel.hbs`]);

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
  const section = html.querySelector
    ? html.querySelector(`[data-category="${MODULE_ID}"]`)
    : html.find(`[data-category="${MODULE_ID}"]`)[0];

  if (!section) return;

  const existingRow = section.querySelector
    ? section.querySelector(`[data-setting-id="${MODULE_ID}.cacheInfo"]`)
    : null;

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
  const dlg = new Dialog({
    title: game.i18n.localize(`${MODULE_ID}.presets.settingsTitle`),
    content: buildPresetManagerContent(),
    buttons: { close: { label: "Close" } },
    default: "close",
    render: html => wirePresetManagerButtons(html, dlg)
  }, { width: 400 });
  dlg.render(true);
}

function wirePresetManagerButtons(html, dlg) {
  html.find(".preset-manager-delete").on("click", async function() {
    const id = this.dataset.presetId;
    const name = $(this).closest(".preset-manager-row").find(".preset-manager-name").text();
    const ok = await Dialog.confirm({
      title: game.i18n.localize(`${MODULE_ID}.presets.settingsTitle`),
      content: `<p>Delete preset "<strong>${name}</strong>"?</p>`,
      defaultYes: false
    });
    if (!ok) return;
    await deletePreset(id);
    ui.notifications.info(game.i18n.format(`${MODULE_ID}.presets.deleted`, { name }));
    dlg.element.find(".runic-preset-manager-content").replaceWith($(buildPresetManagerContent()));
    wirePresetManagerButtons(dlg.element, dlg);
  });
}

registerCombatHooks();
registerSheetHooks();
