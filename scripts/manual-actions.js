import { dnd5eDisplayDistance } from "./utils.js";
import { toEffectData } from "./compat.js";

const MODULE_ID = "gm-runic-items";

function i18n(key, data) {
  if (!data) return game.i18n.localize(`${MODULE_ID}.manual.${key}`);
  const out = { ...data };
  for (const field of ["distance", "penalty", "remaining", "radius"]) {
    if (typeof out[field] !== "number") continue;
    const shown = dnd5eDisplayDistance(out[field]);
    out[field] = shown.value;
    out.unit = shown.unit;
  }
  return game.i18n.format(`${MODULE_ID}.manual.${key}`, out);
}

export function isManualMode() {
  if (!game.settings.settings?.get(`${MODULE_ID}.automationMode`)?.config) return false;
  return game.settings.get(MODULE_ID, "automationMode") === "manual";
}

export function damageTypeLabel(dtype) {
  const cfg = CONFIG.DND5E?.damageTypes?.[dtype];
  return cfg ? game.i18n.localize(cfg.label ?? cfg) : dtype;
}

function abilityLabel(ability) {
  return CONFIG.DND5E?.abilities?.[ability]?.label ?? ability;
}

async function resolveActor(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.documentName === "Token") return doc.actor ?? null;
  return null;
}

function canActOnActor(actor) {
  return !!(game.user.isGM || actor?.isOwner);
}

function actorForCardSync(data) {
  if (game.user.isGM) return null;
  try {
    if (data.kind === "save") {
      const snap = data.resolved.ctxSnapshot;
      const tokenId = data.resolved.who === "target" ? snap.targetTokenId
        : data.resolved.who === "attacker" ? snap.attackerTokenId
        : snap.ownerTokenId;
      return tokenId ? canvas.tokens?.get(tokenId)?.actor ?? null : null;
    }
    const r = data.resolved;
    if (r.tokenUuid) return fromUuidSync(r.tokenUuid)?.actor ?? null;
    if (r.actorUuid) return fromUuidSync(r.actorUuid) ?? null;
    if (r.docUuid) {
      const doc = fromUuidSync(r.docUuid);
      return doc?.documentName === "Actor" ? doc : (doc?.actor ?? null);
    }
  } catch {
    return null;
  }
  return null;
}

function cardIcon(meta) {
  return meta?.icon ?? "icons/svg/aura.svg";
}

function cardHeader(meta) {
  return `
    <header class="runic-manual-header">
      <img src="${cardIcon(meta)}" alt="${meta?.name ?? ""}">
      <span class="runic-manual-name">${meta?.name ?? ""}</span>
    </header>
  `;
}

function cardWrapper(bodyHtml, buttonsHtml) {
  return `
    <div class="runic-manual-card chat-card">
      ${bodyHtml}
      <div class="runic-manual-buttons">
        ${buttonsHtml}
      </div>
    </div>
  `;
}

async function postManualCard(kind, resolved, meta) {
  const bodyText = describeManualAction(kind, resolved, meta);
  const applyLabel = i18n("apply");
  const content = cardWrapper(
    `${cardHeader(meta)}<p class="runic-manual-body">${bodyText}</p>`,
    `<button type="button" data-action="runic-apply">
      <i class="fa-solid fa-reply-all fa-flip-horizontal" inert></i> ${applyLabel}
    </button>`
  );

  await ChatMessage.create({
    speaker: meta?.speaker ?? undefined,
    content,
    flags: {
      [MODULE_ID]: {
        manualAction: { kind, resolved, meta, state: "pending" }
      }
    }
  });
}

function describeManualAction(kind, resolved, meta) {
  switch (kind) {
    case "damage": {
      if (resolved.opts?.multiplier === -1) {
        return i18n("bodyHeal", { name: resolved.tokenName, total: resolved.total });
      }
      const type = resolved.dtype ? damageTypeLabel(resolved.dtype) : i18n("genericDamage");
      return i18n("bodyDamage", { name: resolved.tokenName, total: resolved.total, type });
    }
    case "move":
      return i18n(resolved.verb === "pulled" ? "bodyPulled" : resolved.verb === "pushed" ? "bodyPushed" : "bodyMoved",
        { name: resolved.tokenName, distance: resolved.distance });
    case "status":
      return i18n("bodyStatus", { name: resolved.actorName, status: resolved.statusLabel });
    case "effect":
      return i18n("bodyEffect", { name: resolved.actorName, effect: resolved.effectName });
    case "update":
      return i18n("bodyUpdate", { name: resolved.docName });
    case "template":
      return i18n("bodyTemplate", { name: meta?.name ?? "" });
    default:
      return "";
  }
}

async function performResolved(kind, resolved) {
  switch (kind) {
    case "damage": {
      const token = await fromUuid(resolved.tokenUuid).catch(() => null);
      const actor = token?.actor ?? token;
      if (!actor?.applyDamage) return;
      await actor.applyDamage(resolved.damages, resolved.opts ?? {});
      return;
    }
    case "move": {
      const tokenDoc = await fromUuid(resolved.tokenUuid).catch(() => null);
      if (!tokenDoc) return;
      await tokenDoc.update({ x: resolved.dest.x, y: resolved.dest.y });
      return;
    }
    case "status": {
      const actor = await resolveActor(resolved.actorUuid);
      if (!actor) return;
      await actor.toggleStatusEffect(resolved.statusId, { active: true });
      return;
    }
    case "effect": {
      const actor = await resolveActor(resolved.actorUuid);
      if (!actor) return;
      await actor.createEmbeddedDocuments("ActiveEffect", [toEffectData(resolved.effectData)]);
      return;
    }
    case "update": {
      const doc = await fromUuid(resolved.docUuid).catch(() => null);
      if (!doc) return;
      await doc.update(resolved.data);
      return;
    }
    case "template": {
      const scene = game.scenes.get(resolved.sceneId);
      if (!scene) return null;
      const [doc] = await scene.createEmbeddedDocuments("MeasuredTemplate", [resolved.templateData]);
      if (resolved.immediate && doc) await runImmediateTick(doc);
      return doc;
    }
    default:
      return;
  }
}

async function markCardApplied(message) {
  await message.update({
    content: message.content.replace(
      /<div class="runic-manual-buttons">[\s\S]*?<\/div>/,
      `<div class="runic-manual-buttons runic-manual-applied">${i18n("applied")}</div>`
    ),
    flags: { [MODULE_ID]: { manualAction: { ...message.flags[MODULE_ID].manualAction, state: "applied" } } }
  });
}

async function resolveManualCard(message) {
  const data = message.flags?.[MODULE_ID]?.manualAction;
  if (!data || data.state !== "pending") return;

  if (data.kind === "save") {
    return resolveSaveCard(message, data);
  }

  const actor = await resolveActorForKind(data.kind, data.resolved);
  if (!canActOnActor(actor)) return;

  if (game.user.isGM || actor?.isOwner) {
    await performResolved(data.kind, data.resolved);
    await markCardApplied(message);
  } else {
    game.socket.emit(`module.${MODULE_ID}`, { type: "manualAction", messageId: message.id });
  }
}

async function resolveActorForKind(kind, resolved) {
  switch (kind) {
    case "damage":
    case "move": {
      const token = await fromUuid(resolved.tokenUuid).catch(() => null);
      return token?.actor ?? null;
    }
    case "status":
    case "effect":
      return resolveActor(resolved.actorUuid);
    case "update": {
      const doc = await fromUuid(resolved.docUuid).catch(() => null);
      return doc?.documentName === "Actor" ? doc : (doc?.actor ?? null);
    }
    case "template":
      return null;
    default:
      return null;
  }
}

export async function handleManualActionSocket(data) {
  if (game.users?.activeGM !== game.user) return;
  const message = game.messages.get(data.messageId);
  if (!message) return;
  const flags = message.flags?.[MODULE_ID]?.manualAction;
  if (!flags || flags.state !== "pending") return;
  if (flags.kind === "save") return resolveSaveCard(message, flags, true);
  await performResolved(flags.kind, flags.resolved);
  await markCardApplied(message);
}

export function registerManualActionHooks() {
  const generation = game.release?.generation ?? 12;
  Hooks.on(generation >= 13 ? "renderChatMessageHTML" : "renderChatMessage", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const data = message.flags?.[MODULE_ID]?.manualAction;
    if (!data) return;
    const cardActor = actorForCardSync(data);
    const permitted = game.user.isGM || !!cardActor?.isOwner;
    const disabled = data.state !== "pending" || !permitted;

    const applyBtn = root.querySelector("[data-action='runic-apply']");
    if (applyBtn) {
      applyBtn.disabled = disabled;
      if (!disabled) applyBtn.addEventListener("click", () => resolveManualCard(message));
    }

    const saveBtn = root.querySelector("[data-action='runic-roll-save']");
    if (saveBtn) {
      saveBtn.disabled = disabled;
      if (!disabled) saveBtn.addEventListener("click", () => resolveSaveCard(message, data));
    }
  });
}

async function gatePayload(kind, resolved, meta) {
  if (isManualMode()) {
    await postManualCard(kind, resolved, meta);
    return true;
  }
  await performResolved(kind, resolved);
  return true;
}

export async function gateMove(token, dest, meta) {
  if (!isManualMode()) {
    await token.document.update({ x: dest.x, y: dest.y });
    return true;
  }
  return gatePayload("move", {
    tokenUuid: token.document.uuid,
    tokenName: token.name,
    dest: { x: dest.x, y: dest.y },
    verb: meta?.verb ?? "moved",
    distance: meta?.distance
  }, meta);
}

export async function gateDocUpdate(doc, data, meta) {
  if (!isManualMode()) {
    await doc.update(data);
    return true;
  }
  return gatePayload("update", { docUuid: doc.uuid, docName: doc.name ?? "", data }, meta);
}

export async function gateDamage(token, damages, opts, meta) {
  if (!isManualMode()) {
    await token.actor.applyDamage(damages, opts ?? {});
    return true;
  }
  const total = Array.isArray(damages) ? damages.reduce((s, d) => s + (d.value ?? 0), 0) : damages;
  const dtype = Array.isArray(damages) ? damages[0]?.type : undefined;
  return gatePayload("damage", {
    tokenUuid: token.document.uuid,
    tokenName: token.name,
    damages,
    opts: opts ?? {},
    total,
    dtype
  }, meta);
}

export async function gateStatus(actor, statusId, meta) {
  if (!isManualMode()) {
    await actor.toggleStatusEffect(statusId, { active: true });
    return true;
  }
  const label = CONFIG.statusEffects?.find(s => s.id === statusId)?.name;
  return gatePayload("status", {
    actorUuid: actor.uuid,
    actorName: actor.name,
    statusId,
    statusLabel: label ? game.i18n.localize(label) : statusId
  }, meta);
}

export async function gateEffect(actor, effectData, meta) {
  if (!isManualMode()) {
    await actor.createEmbeddedDocuments("ActiveEffect", [toEffectData(effectData)]);
    return true;
  }
  return gatePayload("effect", {
    actorUuid: actor.uuid,
    actorName: actor.name,
    effectData,
    effectName: effectData.name
  }, meta);
}

async function runImmediateTick(doc) {
  if (!doc) return;
  const kind = doc.flags?.[MODULE_ID]?.clusterEffect;
  if (kind === "ashcloud") {
    const { triggerAshcloud } = await import("./combat-effects.js");
    await triggerAshcloud(doc, doc.flags?.[MODULE_ID]?.damageDie ?? "1d4");
    return;
  }
  const { applyCloudTick } = await import("./rune-engine.js");
  await applyCloudTick(canvas.templates?.get(doc.id));
}

export async function gateTemplate(scene, templateData, meta, immediate) {
  if (!isManualMode()) {
    const [doc] = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    if (immediate && doc) await runImmediateTick(doc);
    return doc;
  }
  await postManualCard("template", { sceneId: scene.id, templateData, immediate: !!immediate }, meta);
  return null;
}

function serializeCtx(ctx) {
  return {
    trigger: ctx.trigger,
    itemUuid: ctx.item?.uuid ?? null,
    actorUuid: ctx.actor?.uuid ?? null,
    ownerTokenId: ctx.ownerToken?.id ?? null,
    attackerTokenId: ctx.attackerToken?.id ?? null,
    targetTokenId: ctx.targetToken?.id ?? null,
    isCritical: !!ctx.isCritical,
    die: ctx.die,
    rarity: ctx.rarity ?? null,
    combo: ctx.combo ?? null,
    runes: ctx.runes ?? null
  };
}

async function deserializeCtx(snap) {
  const item = snap.itemUuid ? await fromUuid(snap.itemUuid).catch(() => null) : null;
  const actor = snap.actorUuid ? await fromUuid(snap.actorUuid).catch(() => null) : null;
  return {
    trigger: snap.trigger,
    item,
    actor,
    ownerToken: snap.ownerTokenId ? canvas.tokens?.get(snap.ownerTokenId) ?? null : null,
    attackerToken: snap.attackerTokenId ? canvas.tokens?.get(snap.attackerTokenId) ?? null : null,
    targetToken: snap.targetTokenId ? canvas.tokens?.get(snap.targetTokenId) ?? null : null,
    isCritical: snap.isCritical,
    die: snap.die,
    rarity: snap.rarity,
    combo: snap.combo,
    runes: snap.runes
  };
}

let _resumeAfterSave = null;
export function registerSaveResume(fn) {
  _resumeAfterSave = fn;
}

export async function gateSaveCard(def, item, ctx, meta, opts) {
  const flavor = i18n("saveFlavor", { rune: def.name, dc: def.save.dc });
  const bodyText = i18n("bodySave", { ability: abilityLabel(def.save.ability), dc: def.save.dc });
  const content = cardWrapper(
    `${cardHeader(meta)}<p class="runic-manual-body">${bodyText}</p>`,
    `<button type="button" data-action="runic-roll-save">
      <i class="fa-solid fa-shield-heart" inert></i> ${i18n("rollSave", { ability: abilityLabel(def.save.ability), dc: def.save.dc })}
    </button>`
  );

  await ChatMessage.create({
    flavor,
    content,
    flags: {
      [MODULE_ID]: {
        manualAction: {
          kind: "save",
          resolved: {
            def,
            ctxSnapshot: serializeCtx(ctx),
            opts: opts ?? {},
            who: def.save.who,
            ability: def.save.ability,
            dc: def.save.dc,
            critAutoFails: !!def.save.critAutoFails
          },
          meta,
          state: "pending"
        }
      }
    }
  });
}

function saverTokenFromRole(who, ctx) {
  if (who === "target") return ctx.targetToken ?? null;
  if (who === "attacker") return ctx.attackerToken ?? null;
  return ctx.ownerToken ?? null;
}

async function rollSaveFromCard(message, data) {
  const { resolved } = data;
  const ctx = await deserializeCtx(resolved.ctxSnapshot);
  const saverToken = saverTokenFromRole(resolved.who, ctx);
  const saverActor = saverToken?.actor ?? null;
  if (!canActOnActor(saverActor)) return;

  const { rollSave } = await import("./utils.js");
  const flavor = i18n("saveFlavor", { rune: resolved.def.name, dc: resolved.dc });
  let saved = false;
  if (resolved.critAutoFails && ctx.isCritical) {
    saved = false;
  } else if (saverActor) {
    const total = await rollSave(saverActor, resolved.ability, resolved.dc, flavor);
    saved = total >= resolved.dc;
  }

  await markCardApplied(message);

  if (_resumeAfterSave) {
    await _resumeAfterSave(resolved.def, ctx, saved, saverActor?.name ?? null, resolved.opts);
  }
}

async function resolveSaveCard(message, data, viaSocket = false) {
  if (viaSocket) return rollSaveFromCard(message, data);
  const { resolved } = data;
  const ctx = await deserializeCtx(resolved.ctxSnapshot);
  const saverToken = saverTokenFromRole(resolved.who, ctx);
  const saverActor = saverToken?.actor ?? null;
  if (game.user.isGM || saverActor?.isOwner) {
    await rollSaveFromCard(message, data);
  } else {
    game.socket.emit(`module.${MODULE_ID}`, { type: "manualAction", messageId: message.id });
  }
}
