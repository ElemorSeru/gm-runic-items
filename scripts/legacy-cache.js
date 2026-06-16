const MODULE_ID = "gm-runic-items";

let _feats = null;
let _spells = null;
let _buildPromise = null;

export function isLegacyCacheLoaded() {
  return _feats !== null && _spells !== null;
}

export function getLegacyFeats() {
  return _feats ?? [];
}

export function getLegacySpells() {
  return _spells ?? [];
}

export function ensureLegacyCacheLoaded() {
  if (isLegacyCacheLoaded()) return Promise.resolve();
  if (_buildPromise) return _buildPromise;
  _buildPromise = _buildCache().finally(() => { _buildPromise = null; });
  return _buildPromise;
}

export function clearLegacyCache() {
  _feats = null;
  _spells = null;
  const msg = game.i18n.localize(`${MODULE_ID}.notify.cacheCleared`);
  ui.notifications.info(msg);
  console.log("[gm-runic-items]", msg);
}

export async function refreshLegacyCache() {
  if (isLegacyCacheLoaded()) {
    _feats = null;
    _spells = null;
  }
  await ensureLegacyCacheLoaded();
}

async function _buildCache() {

  const feats = [];
  const spells = [];

  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    try {
      const index = await pack.getIndex({ fields: ["name", "type", "img", "system.level"] });
      for (const entry of index) {
        const base = {
          id: entry._id,
          name: entry.name,
          img: entry.img ?? "icons/svg/item-bag.svg",
          uuid: pack.getUuid(entry._id),
          pack: pack.collection
        };
        if (entry.type === "feat") {
          feats.push(base);
        } else if (entry.type === "spell") {
          spells.push({ ...base, level: entry.system?.level ?? 0 });
        }
      }
    } catch (e) {
      console.warn(`[gm-runic-items] Could not index pack "${pack.collection}":`, e);
    }
  }

  _feats = feats.sort((a, b) => a.name.localeCompare(b.name));
  _spells = spells.sort((a, b) => a.name.localeCompare(b.name));

  const msg = game.i18n.format(`${MODULE_ID}.notify.cacheReady`, {
    feats: _feats.length, spells: _spells.length, packs: game.packs.size
  });
  ui.notifications.info(msg);
  console.log("[gm-runic-items]", msg);
}
