import { getItemCategory, meetsRequirements, computeRunicRarity, getRarityAcBonus, withCache } from "./utils.js";
import { ABILITY_OPTIONS } from "./rune-registry.js";

const MODULE_ID = "gm-runic-items";

function empowermentIcon(item) {
  const category = item.type === "weapon"
    ? (item.system?.activities?.find?.(a => a.type === "attack")?.attack?.type?.value ?? item.system?._source?.actionType)
    : null;
  if (category === "melee" || item.system?._source?.actionType === "mwak") return "icons/weapons/swords/sword-flanged-lightning.webp";
  if (category === "ranged" || item.system?._source?.actionType === "rwak") return "icons/weapons/ammunition/arrowhead-glowing-blue.webp";
  if (item.type === "equipment") return "icons/magic/defensive/shield-barrier-blue.webp";
  return item.img ?? "icons/svg/aura.svg";
}

export async function evaluateItem(item) {
  const actor = item.actor;
  if (!actor) return;
  if (!item.flags?.[MODULE_ID]) return;
  if (!getItemCategory(item)) return;

  return withCache("evaluate", `${actor.id}::${item.id}`, 500, async () => {
    const active = meetsRequirements(item);
    await syncArmorAcEffect(item, actor, active);
    await syncEmpowermentEffect(item, actor, active);
    await syncLegacyGrants(item, actor, active);
  });
}

async function syncArmorAcEffect(item, actor, active) {
  if (item.type !== "equipment") return;

  const rarity = computeRunicRarity(item);
  const bonus = getRarityAcBonus(rarity);
  const flags = item.flags[MODULE_ID] ?? {};
  const hasWard = [flags["power-0"], flags["power-1"], flags["power-2"]].includes("emberveil");
  const want = active && hasWard && bonus > 0;

  const existing = actor.effects.find(e =>
    e.origin === item.uuid && e.flags?.[MODULE_ID]?.effectKey === "armorAc"
  );

  if (existing) {
    if (!want) { await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]); return; }
    const existingBonus = existing.changes?.find(c => c.key === "system.attributes.ac.bonus")?.value;
    if (existingBonus === String(bonus)) return;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
  } else if (!want) {
    return;
  }

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `Runic Ward (${item.name})`,
    img: "icons/magic/defensive/shield-barrier-glowing-blue.webp",
    origin: item.uuid,
    disabled: false,
    changes: [{ key: "system.attributes.ac.bonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(bonus), priority: 20 }],
    description: game.i18n.format(`${MODULE_ID}.effects.armorAc`, { bonus }),
    flags: { [MODULE_ID]: { effectKey: "armorAc", sourceItem: item.id } }
  }]);
}

async function syncEmpowermentEffect(item, actor, active) {
  const existing = actor.effects.find(e =>
    e.origin === item.uuid && e.flags?.[MODULE_ID]?.effectKey === "empowerment"
  );

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
    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
    value: String(count),
    priority: 20
  }));

  if (existing) {
    const existingChanges = existing.changes ?? [];
    const match =
      existingChanges.length === changes.length &&
      changes.every(c => existingChanges.some(e => e.key === c.key && String(e.value) === c.value));
    if (match) return;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
  }

  const desc = Object.entries(tally).map(([stat, count]) => `${stat.toUpperCase()}: +${count}`).join(", ");

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `Runic Empowerment (${item.name})`,
    img: empowermentIcon(item),
    origin: item.uuid,
    disabled: false,
    changes,
    description: desc,
    flags: { [MODULE_ID]: { effectKey: "empowerment", sourceItem: item.id } }
  }]);
}

async function syncLegacyGrants(item, actor, active) {
  const flags = item.flags[MODULE_ID] ?? {};
  await syncGrantedItem(actor, item, "legacy-feat", flags["legacy-feat"] ?? null, active, resolveFeat);
  await syncGrantedItem(actor, item, "legacy-spell", flags["legacy-spell"] ?? null, active, resolveSpell);
}

async function syncGrantedItem(actor, sourceItem, grantKey, refId, active, resolver) {
  const existing = actor.items.find(i =>
    i.flags?.[MODULE_ID]?.grantKey === grantKey &&
    i.flags?.[MODULE_ID]?.sourceItemId === sourceItem.id
  );

  if (existing && (!active || !refId || existing.flags[MODULE_ID]?.refId !== refId)) {
    if (actor.items.has(existing.id)) {
      await actor.deleteEmbeddedDocuments("Item", [existing.id]).catch(() => {});
    }
  }
  if (!active || !refId) return;
  if (existing?.flags[MODULE_ID]?.refId === refId) return;

  return withCache("grant", `${actor.id}::${sourceItem.id}::${grantKey}::${refId}`, 500, async () => {
    const data = await resolver(refId);
    if (!data) return;
    data.name = `${data.name} (${sourceItem.name})`;
    data.flags = data.flags ?? {};
    data.flags[MODULE_ID] = { grantKey, sourceItemId: sourceItem.id, refId };
    if (data.system?.description?.value !== undefined) {
      data.system.description.value += `<p><em>${game.i18n.format(`${MODULE_ID}.notify.grantedBy`, { item: sourceItem.name })}</em></p>`;
    }
    await actor.createEmbeddedDocuments("Item", [data]);
  });
}

// Formats (oldest to newest):
// 1) "great-weapon-master" / "Meteor Swarm" (name/identifier string)
// 2) "dnd5e.spells.abc123" (old malformed UUID)
// 3) "Compendium.dnd5e.spells.Item.abc123" (current UUID (pack.getUuid())
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
  if (!actor) return;

  const effectIds = actor.effects
    .filter(e => e.origin === item.uuid && e.flags?.[MODULE_ID])
    .map(e => e.id);
  if (effectIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);

  const itemIds = actor.items
    .filter(i => i.flags?.[MODULE_ID]?.sourceItemId === item.id)
    .map(i => i.id);
  if (itemIds.length) await actor.deleteEmbeddedDocuments("Item", itemIds);
}
