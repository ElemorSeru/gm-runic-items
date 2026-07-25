import { getItemCategory, getRunePool } from "./utils.js";
import { TEMPLATE, buildTemplateContext, initAllSockets, bindPanelEvents, onRenderActorSheet } from "./sheet-ui.js";

const MODULE_ID = "gm-runic-items";

function flagsFor(item) {
  return foundry.utils.getProperty(item, `flags.${MODULE_ID}`) ?? {};
}

const DETAILS_TAB_SELECTOR = '[data-tab-contents-for="details"]';

// saves scroll position before Tidy's re-render
function onContentReady({ app, element }) {
  const detailsTab = element?.querySelector(DETAILS_TAB_SELECTOR);
  if (app && detailsTab) app._runicTidyScrollTop = detailsTab.scrollTop;
}

function onContentRender({ app, data, element }) {
  const item = app?.item ?? app?.document;
  const detailsTab = element?.querySelector(DETAILS_TAB_SELECTOR);
  const panel = detailsTab?.querySelector(".runic-panel");
  if (!item || !panel) return;

  detailsTab.scrollTop = app._runicTidyScrollTop ?? 0;

  const flags = flagsFor(item);
  const runePool = getRunePool(item);

  initAllSockets(panel, flags, runePool, item);

  const minRole = game.settings.get(MODULE_ID, "minRoleToEdit") ?? 4;
  const editable = app.isEditable ?? data?.editable ?? false;
  const canEdit = editable && (game.user.role >= minRole);

  if (canEdit) {
    bindPanelEvents(panel, item, runePool, flags);
  } else {
    panel.classList.add("runic-panel-readonly");
  }
}

function registerRunicItemContent(api) {
  if (typeof api?.models?.HandlebarsContent !== "function" || typeof api?.registerItemContent !== "function") {
    console.warn(`[${MODULE_ID}] Tidy5e's content-registration API doesn't match the expected shape; skipping rune panel integration.`);
    return;
  }

  const content = new api.models.HandlebarsContent({
    path: TEMPLATE,
    injectParams: { selector: DETAILS_TAB_SELECTOR, position: "beforeend" },
    getData: context => buildTemplateContext(flagsFor(context.item ?? context.document), context.item ?? context.document),
    enabled: context => !!getItemCategory(context.item ?? context.document),
    onContentReady,
    onRender: onContentRender
  });

  api.registerItemContent(content);
}

export function registerTidy5eIntegration() {
  Hooks.once("tidy5e-sheet.ready", api => {
    registerRunicItemContent(api);
    Hooks.on("tidy5e-sheet.renderActorSheet", onRenderActorSheet);
  });
}
