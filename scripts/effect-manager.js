import { getItemCategory, meetsRequirements, computeRunicRarity, getRarityAcBonus } from "./utils.js";
import { ABILITY_OPTIONS } from "./rune-registry.js";
import { getRuneDef } from "./rune-store.js";
import { toEffectData, effectChanges } from "./compat.js";

const MODULE_ID = "gm-runic-items";
const DRAIN_ROUND_CAP = 5;
const DRAIN_SETTLE_MS = 1000;
const _drains = new Map();

function empowermentIcon(item) {
  const category = item.type === "weapon"
    ? (item.system?.activities?.find?.(a => a.type === "attack")?.attack?.type?.value ?? item.system?._source?.actionType)
    : null;
  if (category === "melee" || item.system?._source?.actionType === "mwak") return "icons/weapons/swords/sword-flanged-lightning.webp";
  if (category === "ranged" || item.system?._source?.actionType === "rwak") return "icons/weapons/ammunition/arrowhead-glowing-blue.webp";
  if (item.type === "equipment") return "icons/magic/defensive/shield-barrier-blue.webp";
  return item.img ?? "icons/svg/aura.svg";
}

async function pruneExtras(actor, type, docs) {
  if (docs.length > 1) {
    await actor.deleteEmbeddedDocuments(type, docs.slice(1).map(d => d.id))
      .catch(err => console.warn(`[${MODULE_ID}] prune skipped a missing ${type}`, err));
  }
  return docs[0] ?? null;
}

export async function evaluateItem(item) {
  if (game.users?.activeGM !== game.user) return;

  const actor = item.actor;
  if (!actor) return;
  if (!item.flags?.[MODULE_ID]) return;
  if (!getItemCategory(item)) return;

  // one pass per actor at a time, overlapping passes double-delete
  const drain = drainFor(actor);
  if (drain.tripped) {
    drain.held.add(item.id);
    return;
  }
  nextBatch(drain).ids.add(item.id);
  return startDrain(drain);
}

function drainFor(actor) {
  let drain = _drains.get(actor.uuid);
  if (!drain) {
    drain = { actor, next: null, running: false, streak: 0, lastEnd: 0, tripped: false, held: new Set(), heldRemoved: new Map(), changed: new Map(), idle: 0 };
    _drains.set(actor.uuid, drain);
  }
  drain.actor = actor;
  clearTimeout(drain.idle);
  return drain;
}

function nextBatch(drain) {
  if (!drain.next) {
    let resolve;
    const done = new Promise(r => { resolve = r; });
    drain.next = { ids: new Set(), removed: new Map(), done, resolve };
  }
  return drain.next;
}

function startDrain(drain) {
  const done = drain.next.done;
  if (!drain.running) runDrain(drain);
  return done;
}

// a sibling with the same inscription may need to take over
function queueRemoval(drain, id, uuid) {
  const batch = nextBatch(drain);
  batch.removed.set(id, uuid);
  for (const sibling of drain.actor.items) {
    const flags = sibling.flags?.[MODULE_ID];
    if (sibling.id !== id && (flags?.["legacy-feat"] || flags?.["legacy-spell"])) batch.ids.add(sibling.id);
  }
}

// effects list this module derives onto the items own actor
const DERIVED_EFFECTS = ["armorAc", "empowerment"];

async function removeLeftovers(actor, id, uuid) {
  // a duplicated actor keeps item ids but its effects keep the old
  const effectIds = actor.effects.filter(e => {
    const flags = e.flags?.[MODULE_ID];
    return !!flags && ((e.origin === uuid) || (DERIVED_EFFECTS.includes(flags.effectKey) && (flags.sourceItem === id)));
  }).map(e => e.id);
  const itemIds = actor.items.filter(i => i.flags?.[MODULE_ID]?.sourceItemId === id).map(i => i.id);
  try {
    if (effectIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
    if (itemIds.length) await actor.deleteEmbeddedDocuments("Item", itemIds);
  } catch (err) {
    console.warn(`[${MODULE_ID}] cleanup skipped a missing document`, err);
  }
}

function actorSignature(actor) {
  return [...actor.items.keys(), "|", ...actor.effects.keys()].join(",");
}

function itemInputs(item) {
  return JSON.stringify([meetsRequirements(item), item.flags?.[MODULE_ID] ?? {}]);
}

function forgetWhenIdle(drain) {
  clearTimeout(drain.idle);
  drain.idle = setTimeout(() => {
    if (!drain.running && !drain.next && !drain.tripped) _drains.delete(drain.actor.uuid);
  }, DRAIN_SETTLE_MS);
}

// hold calls during the pause, then retry only items that changed since
function trip(drain) {
  drain.tripped = true;
  console.warn(`[${MODULE_ID}] stopped re-evaluating ${drain.actor.name} after ${DRAIN_ROUND_CAP} passes that kept changing it`);
  if (drain.next) {
    for (const id of drain.next.ids) drain.held.add(id);
    for (const [id, uuid] of drain.next.removed) drain.heldRemoved.set(id, uuid);
    drain.next.resolve();
    drain.next = null;
  }
  setTimeout(() => {
    drain.tripped = false;
    drain.streak = 0;
    const retry = [...drain.held].map(id => drain.actor.items.get(id))
      .filter(item => item && itemInputs(item) !== drain.changed.get(item.id));
    drain.held.clear();
    drain.changed.clear();
    // deletions always finish, they can't be part of a loop
    for (const [id, uuid] of drain.heldRemoved) queueRemoval(drain, id, uuid);
    drain.heldRemoved.clear();
    if (drain.next) startDrain(drain);
    if (retry.length) for (const item of retry) evaluateItem(item);
    else if (!drain.next) forgetWhenIdle(drain);
  }, DRAIN_SETTLE_MS);
}

async function runDrain(drain) {
  drain.running = true;
  if (Date.now() - drain.lastEnd > DRAIN_SETTLE_MS) drain.streak = 0;
  try {
    while (drain.next) {
      const batch = drain.next;
      drain.next = null;

      const actor = drain.actor;
      for (const [id, uuid] of batch.removed) {
        drain.changed.delete(id);
        await removeLeftovers(actor, id, uuid);
      }
      let repeats = 0;
      for (const id of batch.ids) {
        const item = actor.items.get(id);
        if (!item?.flags?.[MODULE_ID] || !getItemCategory(item)) continue;
        const inputs = itemInputs(item);
        const before = actorSignature(actor);
        try {
          const active = meetsRequirements(item);
          await syncArmorAcEffect(item, actor, active);
          await syncEmpowermentEffect(item, actor, active);
          await syncLegacyGrants(item, actor, active);
        } catch (err) {
          console.error(`[${MODULE_ID}] evaluate failed for ${item.name}`, err);
        }
        if (actorSignature(actor) === before) {
          drain.changed.delete(id);
          continue;
        }
        // rewriting an item whose inputs didn't change
        if (drain.changed.get(id) === inputs) repeats++;
        drain.changed.set(id, inputs);
      }
      drain.streak = repeats ? drain.streak + 1 : 0;
      batch.resolve();
      if (drain.streak >= DRAIN_ROUND_CAP) {
        trip(drain);
        break;
      }
    }
  } finally {
    drain.running = false;
    drain.lastEnd = Date.now();
    if (!drain.tripped) forgetWhenIdle(drain);
  }
}

async function syncArmorAcEffect(item, actor, active) {
  if (item.type !== "equipment") return;

  const rarity = computeRunicRarity(item);
  const bonus = getRarityAcBonus(rarity);
  const flags = item.flags[MODULE_ID] ?? {};
  const hasWard = [flags["power-0"], flags["power-1"], flags["power-2"]]
    .filter(Boolean)
    .some(id => getRuneDef(id)?.passiveAc === true);
  const want = active && hasWard && bonus > 0;

  const existing = await pruneExtras(actor, "ActiveEffect", actor.effects.filter(e =>
    e.origin === item.uuid && e.flags?.[MODULE_ID]?.effectKey === "armorAc"
  ));

  if (existing) {
    if (!want) { await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]); return; }
    const existingBonus = effectChanges(existing).find(c => c.key === "system.attributes.ac.bonus")?.value;
    // v14 stores the value as a number
    if (String(existingBonus) === String(bonus)) return;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
  } else if (!want) {
    return;
  }

  await actor.createEmbeddedDocuments("ActiveEffect", [toEffectData({
    name: game.i18n.format(`${MODULE_ID}.effectNames.armorAc`, { item: item.name }),
    img: "icons/magic/defensive/shield-barrier-glowing-blue.webp",
    origin: item.uuid,
    disabled: false,
    changes: [{ key: "system.attributes.ac.bonus", type: "add", value: String(bonus), priority: 20 }],
    description: game.i18n.format(`${MODULE_ID}.effects.armorAc`, { bonus }),
    flags: { [MODULE_ID]: { effectKey: "armorAc", sourceItem: item.id } }
  })]);
}

async function syncEmpowermentEffect(item, actor, active) {
  const existing = await pruneExtras(actor, "ActiveEffect", actor.effects.filter(e =>
    e.origin === item.uuid && e.flags?.[MODULE_ID]?.effectKey === "empowerment"
  ));

  const flags = item.flags[MODULE_ID] ?? {};
  const boosts = Array.from({ length: 5 }, (_, i) => flags[`emp-${i}`]).filter(Boolean);

  if (!active || boosts.length === 0) {
    if (existing) await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
    return;
  }

  const tally = {};
  for (const stat of boosts) tally[stat] = (tally[stat] ?? 0) + 1;

  const changes = Object.entries(tally).map(([stat, count]) => ({
    key: `system.abilities.${stat}.value`,
    type: "add",
    value: String(count),
    priority: 20
  }));

  if (existing) {
    const existingChanges = effectChanges(existing);
    const match =
      existingChanges.length === changes.length &&
      changes.every(c => existingChanges.some(e => e.key === c.key && String(e.value) === c.value));
    if (match) return;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
  }

  const desc = Object.entries(tally).map(([stat, count]) => `${stat.toUpperCase()}: +${count}`).join(", ");

  await actor.createEmbeddedDocuments("ActiveEffect", [toEffectData({
    name: game.i18n.format(`${MODULE_ID}.effectNames.empowerment`, { item: item.name }),
    img: empowermentIcon(item),
    origin: item.uuid,
    disabled: false,
    changes,
    description: desc,
    flags: { [MODULE_ID]: { effectKey: "empowerment", sourceItem: item.id } }
  })]);
}

async function syncLegacyGrants(item, actor, active) {
  const flags = item.flags[MODULE_ID] ?? {};
  await syncGrantedItem(actor, item, "legacy-feat", flags["legacy-feat"] ?? null, active, resolveFeat);
  await syncGrantedItem(actor, item, "legacy-spell", flags["legacy-spell"] ?? null, active, resolveSpell);
}

async function syncGrantedItem(actor, sourceItem, grantKey, refId, active, resolver) {
  const existing = await pruneExtras(actor, "Item", actor.items.filter(i =>
    i.flags?.[MODULE_ID]?.grantKey === grantKey &&
    i.flags?.[MODULE_ID]?.sourceItemId === sourceItem.id
  ));

  if (existing && (!active || !refId || existing.flags[MODULE_ID]?.refId !== refId)) {
    if (actor.items.has(existing.id)) {
      await actor.deleteEmbeddedDocuments("Item", [existing.id]).catch(() => {});
      await resyncSiblingLegacyGrants(actor, sourceItem.id, grantKey);
    }
  }
  if (!active || !refId) return;
  if (existing?.flags[MODULE_ID]?.refId === refId) return;

  const dupe = actor.items.find(i =>
    i.flags?.[MODULE_ID]?.grantKey === grantKey &&
    i.flags?.[MODULE_ID]?.refId === refId &&
    i.flags?.[MODULE_ID]?.sourceItemId !== sourceItem.id
  );
  if (dupe) return;

  const data = await resolver(refId);
  if (!data) return;
  data.name = `${data.name} (${sourceItem.name})`;
  data.flags = data.flags ?? {};
  data.flags[MODULE_ID] = { grantKey, sourceItemId: sourceItem.id, refId };
  if (data.system?.description?.value !== undefined) {
    data.system.description.value += `<p><em>${game.i18n.format(`${MODULE_ID}.notify.grantedBy`, { item: sourceItem.name })}</em></p>`;
  }
  await actor.createEmbeddedDocuments("Item", [data]);
}

async function resyncSiblingLegacyGrants(actor, excludeItemId, grantKey) {
  const resolver = grantKey === "legacy-feat" ? resolveFeat : resolveSpell;
  for (const sibling of actor.items) {
    if (sibling.id === excludeItemId || !getItemCategory(sibling)) continue;
    const refId = sibling.flags?.[MODULE_ID]?.[grantKey] ?? null;
    if (!refId) continue;
    await syncGrantedItem(actor, sibling, grantKey, refId, meetsRequirements(sibling), resolver);
  }
}

// refs may be full UUIDs or legacy "dnd5e.spells.abc123" ids
async function _resolveByUuid(ref) {
  if (ref.startsWith("Compendium.")) {
    return (await fromUuid(ref).catch(() => null)) ?? null;
  }
  if (ref.includes(".")) {
    return (await fromUuid(`Compendium.${ref}`).catch(() => null)) ?? null;
  }
  return null;
}

async function resolveFeat(ref) {
  if (!ref) return null;

  const byUuid = await _resolveByUuid(ref);
  if (byUuid) return byUuid.toObject();

  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["name", "type", "system.identifier"] });
    const match = index.find(e =>
      e.type === "feat" && (
        e.system?.identifier === ref ||
        e.name.toLowerCase().replace(/[\s-]+/g, "-") === ref
      )
    );
    if (match) {
      const doc = await pack.getDocument(match._id);
      if (doc) return doc.toObject();
    }
  }

  console.warn(`[gm-runic-items] Feat ref not resolved: ${ref}`);
  return null;
}

async function resolveSpell(ref) {
  if (!ref) return null;

  const byUuid = await _resolveByUuid(ref);
  if (byUuid) return byUuid.toObject();

  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["name", "type"] });
    const match = index.find(e => e.type === "spell" && e.name === ref);
    if (match) {
      const doc = await pack.getDocument(match._id);
      if (doc) return doc.toObject();
    }
  }

  console.warn(`[gm-runic-items] Legacy spell ref not found in any compendium: ${ref}`);
  return null;
}

export async function clearItemEffects(item, actor) {
  if (game.users?.activeGM !== game.user) return;
  if (!actor) return;
  // granted feats and spells have nothing to clear, and shouldn't come back by themselves
  if (item.flags?.[MODULE_ID]?.grantKey) return;

  // through the queue so it cant race a pass that's running
  const drain = drainFor(actor);
  if (drain.tripped) {
    drain.heldRemoved.set(item.id, item.uuid);
    return;
  }
  queueRemoval(drain, item.id, item.uuid);
  return startDrain(drain);
}

// A source thats deleted while no GM was connected leaves these behind
function orphanSources(actor) {
  const sources = new Set();
  for (const effect of actor.effects) {
    const flags = effect.flags?.[MODULE_ID];
    if (DERIVED_EFFECTS.includes(flags?.effectKey) && flags.sourceItem && !actor.items.has(flags.sourceItem)) sources.add(flags.sourceItem);
  }
  for (const item of actor.items) {
    const flags = item.flags?.[MODULE_ID];
    if (flags?.grantKey && flags.sourceItemId && !actor.items.has(flags.sourceItemId)) sources.add(flags.sourceItemId);
  }
  return sources;
}

function clearOrphans(actor) {
  const sources = orphanSources(actor);
  if (!sources.size) return;
  const drain = drainFor(actor);
  for (const id of sources) {
    const uuid = `${actor.uuid}.Item.${id}`;
    if (drain.tripped) drain.heldRemoved.set(id, uuid);
    else queueRemoval(drain, id, uuid);
  }
  if (!drain.tripped) return startDrain(drain);
}

export async function reconcileAllEffects() {
  if (game.users?.activeGM !== game.user) return;

  for (const actor of game.actors) {
    await clearOrphans(actor);
    for (const item of actor.items) {
      if (!item.flags?.[MODULE_ID] || !getItemCategory(item)) continue;
      await evaluateItem(item);
    }
  }
  // unlinked tokens own their derived documents too
  for (const scene of game.scenes) {
    for (const tokenDoc of scene.tokens) {
      if (!tokenDoc.actorLink && tokenDoc.actor) await clearOrphans(tokenDoc.actor);
    }
  }
}
