import { measureDist } from "./movement.js";
import { dnd5eDisplayDistance, sceneDistanceToFeet } from "./utils.js";

const MODULE_ID = "gm-runic-items";

export const CANCELLED = Symbol("runic-picker-cancelled");

function i18n(key, data) {
  return data
    ? game.i18n.format(`${MODULE_ID}.picker.${key}`, data)
    : game.i18n.localize(`${MODULE_ID}.picker.${key}`);
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function tokenImage(token) {
  return token.document?.texture?.src || token.document?.img || token.actor?.img || "icons/svg/mystery-man.svg";
}

function distanceFrom(originToken, token) {
  if (!originToken || originToken === token) return null;
  try {
    // measureDist returns scene units but the display helper expects feet
    return dnd5eDisplayDistance(sceneDistanceToFeet(measureDist(originToken, token)));
  } catch {
    return null;
  }
}

// pan and pulse the way the reference board locates a target
function focusToken(token) {
  const point = token?.center;
  if (!point || typeof canvas?.animatePan !== "function") return;
  try {
    canvas.animatePan({ x: point.x, y: point.y, duration: 250 });
    const style = CONFIG.Canvas?.pings?.types?.PULSE;
    if (style !== undefined) {
      canvas.controls?.handlePing?.(game.user, point, {
        scene: canvas.scene?.id, style, zoom: canvas.stage?.scale?.x ?? 1
      });
    }
  } catch (err) {
    console.error(`[${MODULE_ID}] target focus failed:`, err);
  }
}

function buildRow(token, originToken) {
  const dist = distanceFrom(originToken, token);
  const meta = dist ? i18n("away", { distance: dist.value, unit: dist.unit }) : "";
  return `
    <button type="button" class="runic-pick runic-pick-row" data-token-id="${esc(token.id)}">
      <img class="runic-pick-img" src="${esc(tokenImage(token))}" alt="">
      <span class="runic-pick-text">
        <span class="runic-pick-name">${esc(token.name)}</span>
        <span class="runic-pick-meta">${esc(meta)}</span>
      </span>
    </button>
  `;
}

export async function promptRiderTarget(item, hitTargets, originToken) {
  const sorted = [...hitTargets].sort((a, b) => {
    if (!originToken) return 0;
    return measureDist(originToken, a) - measureDist(originToken, b);
  });

  const content = `
    <div class="runic-pick-body">
      <p class="runic-pick-intro">${i18n("intro", { item: esc(item?.name ?? "") })}</p>
      <div class="runic-pick-list">${sorted.map(t => buildRow(t, originToken)).join("")}</div>
    </div>
  `;

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: i18n("title") },
      content,
      classes: ["runic-pick-dialog"],
      buttons: [{
        action: "cancel",
        label: game.i18n.localize(`${MODULE_ID}.common.cancel`),
        callback: () => null
      }]
    });

    dialog.addEventListener("render", () => {
      const root = dialog.element;
      const rows = root?.querySelectorAll?.(".runic-pick-row") ?? [];
      // without rows there is nothing to click so never leave the attack waiting
      if (!rows.length) {
        finish(CANCELLED);
        dialog.close();
        return;
      }
      for (const row of rows) {
        const token = canvas.tokens?.get(row.dataset.tokenId) ?? null;
        row.addEventListener("mouseenter", () => focusToken(token));
        row.addEventListener("focus", () => focusToken(token));
        row.addEventListener("click", () => {
          finish(token);
          dialog.close();
        });
      }
    });

    // covers the cancel button, the window X, and Esc
    dialog.addEventListener("close", () => finish(CANCELLED), { once: true });

    dialog.render(true);
  });
}
