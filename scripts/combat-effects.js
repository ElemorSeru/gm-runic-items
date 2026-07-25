import { getItemCategory, meetsRequirements, computeRunicRarity, getRarityDie, rollSave } from "./utils.js";
import { getOrderedActiveDefs, getActiveComboMerged } from "./rune-store.js";
import {
  registerScripted, dispatchDefs, executeRune, tickRuneClouds,
  clearUseLimits, onEngineEffectDeleted, triggerMatches
} from "./rune-engine.js";
import { computeRayDestination, findReachableCells, findBestCellTowardTarget, findBestAdjacentCell, measureDist, angleBetween } from "./movement.js";
import { isFriendly } from "./rune-engine.js";

const MODULE_ID = "gm-runic-items";
const MESSAGE_MAX_AGE_MS = 120000;

function getEquippedRunicArmor(actor) {
  return actor.items.find(i =>
    i.type === "equipment" &&
    i.system?.equipped &&
    i.flags?.[MODULE_ID]
  ) ?? null;
}

function getActiveRuneSlots(item) {
  const flags = item.flags?.[MODULE_ID] ?? {};
  return [flags["power-0"], flags["power-1"], flags["power-2"]].filter(Boolean);
}

function resolveMessageTargets(msg) {
  // roller's targets take priority over live targets
  const stored = (msg.flags?.dnd5e?.targets ?? [])
    .map(t => {
      const doc = fromUuidSync(t.uuid ?? t);
      return doc?.getActiveTokens?.()[0] ?? doc?.object ?? null;
    })
    .filter(Boolean);
  if (stored.length) return stored;
  return Array.from(game.user?.targets ?? []);
}

async function moveTokenByAngle(token, angleRad, squares) {
  const dest = computeRayDestination(token, angleRad, squares);
  if (dest.squares === 0) return 0;
  await token.document.update({ x: dest.x, y: dest.y });
  return dest.squares;
}

export function registerCombatHooks() {
  Hooks.on("dnd5e.rollAttackV2", onRollAttackV2);

  // renderChatMessage is deprecated in v13+ to use renderChatMessageHTML
  const generation = game.release?.generation ?? 12;
  Hooks.on(generation >= 13 ? "renderChatMessageHTML" : "renderChatMessage", onRenderChatMessage);

  Hooks.on("dnd5e.preApplyDamage", onPreApplyDamage);
  Hooks.on("dnd5e.applyDamage", onApplyDamageAftermath);
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("dnd5e.endConcentration", onEndConcentration);
  Hooks.on("combatTurnChange", onCombatTurnStart);
  Hooks.on("combatStart", onCombatStart);
  Hooks.on("updateToken", onUpdateTokenProximity);
  Hooks.on("canvasReady", () => _proximityWithin.clear());
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("dnd5e.restCompleted", onRestCompleted);
  Hooks.on("createActiveEffect", onCreateActiveEffect);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);

  registerCoreHandlers();

  // players lack the permission to apply armor reactions so now they emit and the GM executes
  game.socket.on(`module.${MODULE_ID}`, onSocketMessage);
}

async function onRollAttackV2(rolls, data) {
  const item = data?.subject?.item;
  const roll = rolls?.[0];
  if (!item || !roll) return;
  await handleAttackRoll(item, roll);
}

async function handleAttackRoll(item, roll) {
  const attacker = item.actor;
  if (!attacker) return;

  const targets = Array.from(game.user?.targets ?? []);
  if (targets.length === 0) return;

  const hitTargets = [];
  const missTargets = [];
  for (const targetToken of targets) {
    if (!targetToken.actor) continue;
    const ac = targetToken.actor.system?.attributes?.ac?.value;
    // compare total to each target's AC directly
    const hit = !roll.isFumble && (roll.isCritical === true
      || roll.isSuccess === true
      || (ac != null && typeof roll.total === "number" && roll.total >= ac));
    if (hit) hitTargets.push(targetToken);
    else missTargets.push(targetToken);
  }
  if (!hitTargets.length && !missTargets.length) return;

  const payload = {
    type: "attackHit",
    itemUuid: item.uuid,
    targetTokenIds: hitTargets.map(t => t.id),
    missTokenIds: missTargets.map(t => t.id)
  };
  if (game.users?.activeGM === game.user) await executeAttackHit(payload);
  else game.socket.emit(`module.${MODULE_ID}`, payload);
}

async function onSocketMessage(data) {
  if (game.users?.activeGM !== game.user) return;
  if (data?.type === "attackHit") return executeAttackHit(data);
  if (data?.type === "runeTrigger") return executeRuneTrigger(data);
}

async function executeAttackHit({ itemUuid, targetTokenIds, missTokenIds }) {
  const item = await fromUuid(itemUuid).catch(() => null);
  const attacker = item?.actor;
  if (!item || !attacker) return;

  const hitTargets = (targetTokenIds ?? []).map(id => canvas.tokens.get(id)).filter(t => t?.actor);
  const missTargets = (missTokenIds ?? []).map(id => canvas.tokens.get(id)).filter(t => t?.actor);

  for (const targetToken of hitTargets) {
    recordLastHit(targetToken.actor, item);
    await dispatchArmorReactions(attacker, targetToken, item);
  }
  if (hitTargets.length) {
    await processGuardiansRush(attacker, item, hitTargets);
    await dispatchAllyStruckDefs(attacker, item, hitTargets[0]);
  }

  for (const missToken of missTargets) {
    await dispatchWeaponMiss(attacker, missToken, item);
    await dispatchArmorMissed(attacker, missToken, item);
  }
}

async function dispatchArmorReactions(attacker, defenderToken, item) {
  const defenderActor = defenderToken.actor;
  const armor = getEquippedRunicArmor(defenderActor);
  if (!armor || !meetsRequirements(armor)) return;
  if (getItemCategory(item) !== "melee") return;

  const runes = getActiveRuneSlots(armor);
  if (!runes.length) return;

  const ctx = {
    trigger: "whenStruck",
    item: armor,
    actor: defenderActor,
    ownerToken: defenderToken,
    attackerActor: attacker,
    attackerToken: attacker.getActiveTokens()[0] ?? null,
    targetToken: attacker.getActiveTokens()[0] ?? null,
    isCritical: false,
    die: getRarityDie(computeRunicRarity(armor)),
    rarity: computeRunicRarity(armor),
    combo: getActiveComboMerged(runes),
    runes
  };
  const defs = getOrderedActiveDefs(armor, "armor", runes).filter(d => d.trigger === "whenStruck");
  await dispatchDefs(defs, armor, ctx);
}

async function dispatchWeaponMiss(attacker, missToken, item) {
  const category = getItemCategory(item);
  if (category !== "melee" && category !== "ranged") return;
  if (!item.flags?.[MODULE_ID] || !meetsRequirements(item)) return;
  const runes = getActiveRuneSlots(item);
  if (!runes.length) return;
  const defs = getOrderedActiveDefs(item, category, runes).filter(d => d.trigger === "onMiss");
  if (!defs.length) return;
  const ctx = {
    trigger: "onMiss",
    item,
    actor: attacker,
    ownerToken: attacker.getActiveTokens()[0] ?? null,
    targetToken: missToken,
    targetActor: missToken.actor,
    isCritical: false,
    die: getRarityDie(computeRunicRarity(item)),
    rarity: computeRunicRarity(item),
    combo: getActiveComboMerged(runes),
    runes
  };
  await dispatchDefs(defs, item, ctx);
}

async function dispatchArmorMissed(attacker, defenderToken, item) {
  if (getItemCategory(item) !== "melee") return;
  const defenderActor = defenderToken.actor;
  const armor = getEquippedRunicArmor(defenderActor);
  if (!armor || !meetsRequirements(armor)) return;
  const runes = getActiveRuneSlots(armor);
  if (!runes.length) return;
  const defs = getOrderedActiveDefs(armor, "armor", runes).filter(d => d.trigger === "whenMissed");
  if (!defs.length) return;
  const attackerToken = attacker.getActiveTokens()[0] ?? null;
  const ctx = {
    trigger: "whenMissed",
    item: armor,
    actor: defenderActor,
    ownerToken: defenderToken,
    attackerActor: attacker,
    attackerToken,
    targetToken: attackerToken,
    isCritical: false,
    die: getRarityDie(computeRunicRarity(armor)),
    rarity: computeRunicRarity(armor),
    combo: getActiveComboMerged(runes),
    runes
  };
  await dispatchDefs(defs, armor, ctx);
}

const _lastHitBy = new Map();
const LAST_HIT_MAX_AGE_MS = 60000;

function recordLastHit(targetActor, item) {
  if (!targetActor || !item) return;
  _lastHitBy.set(targetActor.id, { itemUuid: item.uuid, ts: Date.now() });
}

async function onApplyDamageAftermath(actor) {
  if (game.users?.activeGM !== game.user) return;
  if (!actor || (actor.system?.attributes?.hp?.value ?? 1) > 0) return;
  const entry = _lastHitBy.get(actor.id);
  if (!entry || Date.now() - entry.ts > LAST_HIT_MAX_AGE_MS) return;
  _lastHitBy.delete(actor.id);
  const item = await fromUuid(entry.itemUuid).catch(() => null);
  const killer = item?.actor;
  if (!item || !killer || !meetsRequirements(item)) return;
  const category = getItemCategory(item);
  if (category !== "melee" && category !== "ranged") return;
  const runes = getActiveRuneSlots(item);
  const defs = getOrderedActiveDefs(item, category, runes).filter(d => d.trigger === "onKill");
  if (!defs.length) return;
  const ctx = {
    trigger: "onKill",
    item,
    actor: killer,
    ownerToken: killer.getActiveTokens()[0] ?? null,
    targetToken: actor.getActiveTokens()[0] ?? null,
    targetActor: actor,
    isCritical: false,
    die: getRarityDie(computeRunicRarity(item)),
    rarity: computeRunicRarity(item),
    combo: getActiveComboMerged(runes),
    runes
  };
  await dispatchDefs(defs, item, ctx);
}

function registerCoreHandlers() {
  registerScripted("emberveil", scriptedEmberveil);
  registerScripted("forgeshield", scriptedForgeshield);
  registerScripted("wardpulse", scriptedWardpulse);
  registerScripted("stonewarden", scriptedStonewarden);
  registerScripted("ashenmantle", scriptedAshenmantle);
  registerScripted("stonecleft", scriptedStonecleft);
  registerScripted("mirageward", scriptedMirageward);
  registerScripted("sandgrasp", scriptedSandgrasp);
  registerScripted("ruinmark", scriptedRuinmark);
  registerScripted("emberbrand", scriptedEmberbrand);
  registerScripted("forgebell", scriptedForgebell);
  registerScripted("burntrace", scriptedBurntrace);
  registerScripted("sandhold", scriptedSandhold);
  registerScripted("ashcloud", scriptedAshcloud);
  registerScripted("undertow", scriptedUndertow);
  registerScripted("scorcheye", scriptedScorcheye);
  registerScripted("wasteblight", scriptedWasteblight);
}

async function scriptedEmberveil(ctx) {
  const { item: armor, actor: targetActor, attackerActor: attacker, die, combo } = ctx;
  const attackerToken = ctx.attackerToken;
  const defenderToken = ctx.ownerToken;
  if (attackerToken && defenderToken) {
    const roll = await new Roll(die).evaluate();
    const squares = roll.total;
    const angle = angleBetween(defenderToken.center, attackerToken.center);
    const movedSquares = await moveTokenByAngle(attackerToken, angle, squares);
    const distance = movedSquares * 5;

    const existingBlock = attacker.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "emberveilBlocked");
    if (existingBlock) await attacker.deleteEmbeddedDocuments("ActiveEffect", [existingBlock.id]);

    await attacker.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.emberveilBlocked`),
      img: "icons/magic/fire/barrier-shield-explosion-orange.webp",
      origin: armor.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      description: game.i18n.format(`${MODULE_ID}.effects.emberveilBlocked`, { target: targetActor.name }),
      flags: { [MODULE_ID]: { sourceItem: armor.id, effectKey: "emberveilBlocked" } }
    }]);

    ChatMessage.create({
      speaker: { actor: targetActor },
      content: game.i18n.format(`${MODULE_ID}.combat.emberveil.pushed`, { attacker: attacker.name, target: targetActor.name, distance })
    });
  }

  if (combo?.id === "ironwall") {
    await attacker.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.bonusActionBlocked`),
      img: "icons/magic/control/debuff-energy-hold-teal-blue.webp",
      origin: armor.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      // mark the bonus action as spent
      changes: [{ key: "flags.midi-qol.actions.bonus", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.wardpulseBlock`),
      flags: { [MODULE_ID]: { sourceItem: armor.id, effectKey: "wardpulseBlock" } }
    }]);
    ChatMessage.create({
      speaker: { actor: targetActor },
      content: game.i18n.format(`${MODULE_ID}.combat.wardpulse.blocked`, { attacker: attacker.name })
    });
  }
}

async function scriptedForgeshield(ctx) {
  const { item: armor, actor: targetActor, combo } = ctx;
  const radius = combo?.id === "ironwall" ? 20 : 10;
  const defenderToken = ctx.ownerToken;
  if (!defenderToken) return;
  const nearbyAllies = canvas.tokens.placeables.filter(t =>
    t.actor?.id !== targetActor.id &&
    t.actor?.type === "character" &&
    measureDist(defenderToken, t) <= radius
  );
  for (const allyToken of nearbyAllies) {
    const allyActor = allyToken.actor;
    const existing = allyActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "forgeshieldAura" && e.origin === armor.uuid);
    if (existing) await allyActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
    await allyActor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.forgeshield`),
      img: "icons/magic/defensive/shield-barrier-glowing-blue.webp",
      origin: armor.uuid,
      duration: { rounds: 2, startRound: game.combat?.round ?? 0 },
      changes: [{ key: "system.attributes.ac.bonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "2", priority: 20 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.forgeshield`),
      flags: { [MODULE_ID]: { sourceItem: armor.id, effectKey: "forgeshieldAura" } }
    }]);
  }
  ChatMessage.create({
    speaker: { actor: targetActor },
    content: game.i18n.format(`${MODULE_ID}.combat.forgeshield.allies`, { target: targetActor.name })
  });
}

async function scriptedWardpulse(ctx) {
  const { item: armor, actor: targetActor, attackerActor: attacker, combo } = ctx;
  if (combo?.id === "ironwall") return;

  const currentRound = game.combat?.round ?? 0;
  const lastRound = targetActor.getFlag(MODULE_ID, "wardpulseRound") ?? -1;
  if (lastRound === currentRound) return;

  const saveTotal = await rollSave(attacker, "con", 14, game.i18n.format(`${MODULE_ID}.saves.wardpulse`, { dc: 14 }));
  if (saveTotal < 14) {
    await targetActor.setFlag(MODULE_ID, "wardpulseRound", currentRound);
    await attacker.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.bonusActionBlocked`),
      img: "icons/magic/control/debuff-energy-hold-teal-blue.webp",
      origin: armor.uuid,
      duration: { rounds: 1, startRound: currentRound },
      // mark the bonus action as spent
      changes: [{ key: "flags.midi-qol.actions.bonus", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.wardpulseBlock`),
      flags: { [MODULE_ID]: { sourceItem: armor.id, effectKey: "wardpulseBlock" } }
    }]);
    ChatMessage.create({
      speaker: { actor: targetActor },
      content: game.i18n.format(`${MODULE_ID}.combat.wardpulse.blocked`, { attacker: attacker.name })
    });
  } else {
    ChatMessage.create({
      speaker: { actor: targetActor },
      content: game.i18n.format(`${MODULE_ID}.combat.wardpulse.resisted`, { attacker: attacker.name })
    });
  }
}

async function processGuardiansRush(attacker, item, targets) {
  if (!game.combat) return;
  if (getItemCategory(item) !== "melee") return;

  const allyToken = targets[0];
  const allyActor = allyToken?.actor;
  if (!allyActor) return;

  for (const combatant of game.combat.combatants) {
    const actor = combatant.actor;
    if (!actor || actor.id === allyActor.id) continue;

    const armor = getEquippedRunicArmor(actor);
    if (!armor || !meetsRequirements(armor)) continue;

    const armorRunes = getActiveRuneSlots(armor);
    if (!armorRunes.includes("vanguard")) continue;

    const combo = getActiveComboMerged(armorRunes);
    const isFreeAction = combo?.id === "morrains-resolve";

    if (!isFreeAction && actor.getFlag(MODULE_ID, "guardianRushUsed")) continue;

    const defenderToken = actor.getActiveTokens()[0];
    if (!defenderToken) continue;

    const dist = measureDist(defenderToken, allyToken);
    if (dist > actor.system.attributes.movement.walk) continue;

    const dialogKey = isFreeAction ? "dialogFreeAction" : "dialogContent";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${MODULE_ID}.combat.vanguard.dialogTitle`) },
      content: game.i18n.format(`${MODULE_ID}.combat.vanguard.${dialogKey}`, { actor: actor.name, ally: allyActor.name }),
      rejectClose: false
    });

    if (!confirmed) continue;

    const attackerToken = attacker.getActiveTokens()[0];
    if (!attackerToken) continue;

    const reachable = findReachableCells(defenderToken, actor.system.attributes.movement.walk);
    const { cell, isAdjacent } = findBestAdjacentCell(reachable, allyToken, attackerToken);

    if (cell.cost === 0 && !isAdjacent) {
      ui.notifications.warn(game.i18n.format(`${MODULE_ID}.combat.vanguard.noPosition`, { actor: actor.name }));
      continue;
    }

    if (cell.cost > 0) await defenderToken.document.update({ x: cell.x, y: cell.y });
    if (!isFreeAction) await actor.setFlag(MODULE_ID, "guardianRushUsed", true);

    if (!isAdjacent) {
      ChatMessage.create({
        speaker: { actor },
        content: game.i18n.format(`${MODULE_ID}.combat.vanguard.partial`, { actor: actor.name, ally: allyActor.name, attacker: attacker.name })
      });
      continue;
    }

    const existingDisadv = attacker.effects.filter(e => e.flags?.[MODULE_ID]?.effectKey === "vanguardDisadvantage");
    for (const e of existingDisadv) await attacker.deleteEmbeddedDocuments("ActiveEffect", [e.id]);

    await attacker.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.vanguardDisadvantage`),
      img: "icons/magic/air/air-pressure-shield-blue.webp",
      origin: actor.uuid,
      duration: { rounds: 1, startRound: game.combat.round },
      // core dnd5e can't automate attack disadvantage so if midi-qol is active, midi-qol honors this flag
      changes: [{ key: "flags.midi-qol.disadvantage.attack.all", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.vanguardDisadvantage`),
      flags: { [MODULE_ID]: { effectKey: "vanguardDisadvantage", sourceItem: armor.id } }
    }]);

    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.vanguard.rushed`, { actor: actor.name, ally: allyActor.name, attacker: attacker.name })
    });
  }
}

async function dispatchAllyStruckDefs(attacker, item, allyToken) {
  if (!game.combat || getItemCategory(item) !== "melee") return;
  const allyActor = allyToken?.actor;
  if (!allyActor) return;

  for (const combatant of game.combat.combatants) {
    const actor = combatant.actor;
    if (!actor || actor.id === allyActor.id) continue;

    const armor = getEquippedRunicArmor(actor);
    if (!armor || !meetsRequirements(armor)) continue;
    const runes = getActiveRuneSlots(armor);
    if (!runes.length) continue;
    // skip already handled elsewhere
    const defs = getOrderedActiveDefs(armor, "armor", runes).filter(d =>
      d.trigger === "allyStruck" && !d.actions?.some(a => a.type === "scripted")
    );
    if (!defs.length) continue;

    const wearerToken = actor.getActiveTokens()[0];
    if (!wearerToken) continue;

    const ctx = {
      trigger: "allyStruck",
      item: armor,
      actor,
      ownerToken: wearerToken,
      attackerActor: attacker,
      attackerToken: attacker.getActiveTokens()[0] ?? null,
      targetToken: allyToken,
      targetActor: allyActor,
      isCritical: false,
      die: getRarityDie(computeRunicRarity(armor)),
      rarity: computeRunicRarity(armor),
      combo: getActiveComboMerged(runes),
      runes
    };
    await dispatchDefs(defs, armor, ctx);
  }
}

async function onRenderChatMessage(msg, html, data) {
  // Only the active GM executes effects
  if (game.users?.activeGM !== game.user) return;

  const dndFlags = msg.flags?.dnd5e ?? {};
  const rollType = dndFlags.roll?.type;
  if (rollType !== "damage") return;
  // pre-4.x stored itemUuid on the roll flag; 4.x+ stores it under item
  const itemUuid = dndFlags.roll?.itemUuid ?? dndFlags.item?.uuid;
  if (!itemUuid) return;

  if (msg.flags?.[MODULE_ID]?.processed) return;
  if (Date.now() - (msg.timestamp ?? 0) > MESSAGE_MAX_AGE_MS) return;

  const item = await fromUuid(itemUuid);
  const actor = item?.actor;
  if (!item || !actor || item.type !== "weapon") return;

  await msg.setFlag(MODULE_ID, "processed", true);

  const targets = resolveMessageTargets(msg);

  await handleEmberbranded(actor, targets);

  if (!item.flags?.[MODULE_ID]) return;

  const runes = getActiveRuneSlots(item);
  if (runes.length === 0) return;
  if (!meetsRequirements(item)) return;

  const targetToken = targets[0];
  const targetActor = targetToken?.actor;
  if (targetActor) recordLastHit(targetActor, item);
  const isCritical = msg.rolls?.[0]?.options?.isCritical === true;
  const category = getItemCategory(item);
  if (category !== "melee" && category !== "ranged") return;

  const ctx = {
    trigger: isCritical ? "onCrit" : "onHit",
    item,
    actor,
    ownerToken: canvas.tokens.get(msg.speaker.token) ?? actor.getActiveTokens()[0] ?? null,
    targetToken,
    targetActor,
    isCritical,
    msg,
    die: getRarityDie(computeRunicRarity(item)),
    rarity: computeRunicRarity(item),
    combo: getActiveComboMerged(runes),
    runes
  };

  const defs = getOrderedActiveDefs(item, category, runes);
  if (!targetToken) {
    const matched = defs.filter(d => triggerMatches(d.trigger, ctx));
    if (matched.length) {
      ChatMessage.create({
        speaker: { actor },
        content: game.i18n.format(`${MODULE_ID}.combat.noTargetFallback`, {
          item: item.name,
          runes: matched.map(d => d.name).join(", ")
        })
      });
    }
  }
  await dispatchDefs(defs, item, ctx);
}

async function handleEmberbranded(attacker, targets) {
  for (const targetToken of targets) {
    const brands = (targetToken.actor?.effects ?? []).filter(e =>
      e.flags?.[MODULE_ID]?.effectKey === "emberbranded" || e.flags?.[MODULE_ID]?.brandDie
    );
    for (const effect of brands) {
      const mFlags = effect.flags[MODULE_ID];
      const storedDie = mFlags.damageDie ?? mFlags.brandDie;
      if (!storedDie) continue;
      const roll = await new Roll(storedDie).evaluate();
      // let resistances and immunities apply
      const dtype = mFlags.effectKey === "emberbranded" ? "fire" : null;
      await targetToken.actor.applyDamage(dtype ? [{ value: roll.total, type: dtype }] : [{ value: roll.total }]);
      const key = mFlags.effectKey === "emberbranded" ? "combat.emberbrand.tick" : "engine.brandTick";
      ChatMessage.create({
        speaker: { actor: attacker },
        content: game.i18n.format(`${MODULE_ID}.${key}`, { name: targetToken.actor.name, total: roll.total, rune: effect.name })
      });
    }
  }
}

async function scriptedStonecleft(ctx) {
  const { item, actor, targetActor, targetToken, die, isCritical, msg, combo } = ctx;
  if (!targetActor || !targetToken) return;

  const roll = await new Roll(die).evaluate();
  const squares = roll.total;

  let failed = isCritical;
  if (!failed) {
    const saveTotal = await rollSave(targetActor, "str", 13, game.i18n.format(`${MODULE_ID}.saves.stonecleft`, { dc: 13 }));
    failed = saveTotal < 13;
  }

  if (failed) {
    let movedSquares = 0;
    const originToken = msg ? canvas.tokens.get(msg.speaker.token) : ctx.ownerToken;
    if (originToken) {
      const angle = angleBetween(originToken.center, targetToken.center);
      movedSquares = await moveTokenByAngle(targetToken, angle, squares);
    }
    const distance = movedSquares * 5;

    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "stonecleft");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.stonecleft`),
      img: "icons/magic/movement/chevrons-down-yellow.webp",
      origin: item.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      changes: [{ key: "system.attributes.movement.walk", mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY, value: "0.5", priority: 20 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.stonecleft`),
      flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "stonecleft" } }
    }]);

    const msgKey = isCritical ? "autofail" : "pushed";
    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.stonecleft.${msgKey}`, { target: targetActor.name, distance })
    });

    if (combo?.id === "rift-break") {
      await applySandgrasp(item, actor, targetActor, die, true);
      await applyMiragewardToAllies(item, actor);
    }
  } else {
    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.stonecleft.resisted`, { target: targetActor.name })
    });
  }
}

async function scriptedMirageward(ctx) {
  const { item, actor, targetActor, combo } = ctx;
  if (!targetActor || combo?.id === "rift-break") return;

  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "mirageward");
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.mirageward`),
    img: "icons/magic/defensive/illusion-evasion-echo-purple.webp",
    origin: item.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    // mark the reaction as spent
    changes: [{ key: "flags.midi-qol.actions.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 }],
    description: game.i18n.format(`${MODULE_ID}.effects.mirageward`, { attacker: actor.name }),
    flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "mirageward" } }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.mirageward.active`, { target: targetActor.name, attacker: actor.name })
  });
}

async function scriptedSandgrasp(ctx) {
  const { item, actor, targetActor, die, combo } = ctx;
  if (!targetActor || combo?.id === "rift-break") return;
  await applySandgrasp(item, actor, targetActor, die, false);
}

async function scriptedRuinmark(ctx) {
  const { item, actor, targetActor, die, combo } = ctx;
  if (!targetActor) return;

  const isEmberSurge = combo?.id === "ember-surge";
  const isIgnited = targetActor.effects.some(e => e.flags?.[MODULE_ID]?.effectKey === "emberbranded");

  let rounds;
  if (isEmberSurge && isIgnited) {
    rounds = 2;
  } else {
    const roll = await new Roll(die).evaluate();
    rounds = roll.total;
  }

  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "ruinmark");
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.ruinmark`),
    img: "icons/magic/symbols/rune-sigil-red-orange.webp",
    origin: item.uuid,
    duration: { rounds, startRound: game.combat?.round ?? 0 },
    changes: [{ key: "system.attributes.ac.bonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-2", priority: 20 }],
    description: game.i18n.format(`${MODULE_ID}.effects.ruinmark`, { rounds }),
    flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "ruinmark" } }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.ruinmark.cracked`, { target: targetActor.name, rounds })
  });
}

async function scriptedEmberbrand(ctx) {
  const { item, actor, targetActor, die, isCritical, combo } = ctx;
  if (!isCritical || !targetActor) return;

  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "emberbranded");
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.emberbranded`),
    img: "icons/magic/fire/flame-burning-campfire-yellow-blue.webp",
    origin: item.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    description: game.i18n.format(`${MODULE_ID}.effects.emberbranded`, { die }),
    flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "emberbranded", damageDie: die } }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.emberbrand.ignited`, { target: targetActor.name, die, actor: actor.name })
  });

  if (combo?.id === "ember-surge") {
    const originToken = actor.getActiveTokens()[0];
    if (originToken) {
      const roll = await new Roll(die).evaluate();
      const distance = roll.total * 5;
      const allAllies = canvas.tokens.placeables.filter(t =>
        t.actor?.id !== actor.id &&
        (t.actor?.type === "character" || t.document.disposition >= 0) &&
        measureDist(originToken, t) <= 30
      );
      const allyNames = allAllies.map(t => t.name).join(", ");
      ChatMessage.create({
        speaker: { actor },
        content: game.i18n.format(`${MODULE_ID}.combat.forgebell.rang`, { ally: allyNames || game.i18n.localize(`${MODULE_ID}.combat.forgebell.nearbyAllies`), distance })
      });
    }
  }
}

async function scriptedForgebell(ctx) {
  const { item, actor, targetToken, die, combo } = ctx;
  if (!actor || combo?.id === "ember-surge") return;

  const originToken = actor.getActiveTokens()[0];
  if (!originToken || !targetToken) return;

  const roll = await new Roll(die).evaluate();
  const maxFeet = roll.total * 5;

  const nearbyAllies = canvas.tokens.placeables.filter(t =>
    t.actor &&
    t.actor.id !== actor.id &&
    (t.actor.type === "character" || t.document.disposition >= 0) &&
    measureDist(originToken, t) <= 30
  );

  if (nearbyAllies.length === 0) {
    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.forgebell.rang`, { ally: game.i18n.localize(`${MODULE_ID}.combat.forgebell.noAllies`), distance: maxFeet })
    });
  } else if (nearbyAllies.length === 1) {
    await moveAllyTowardTarget(actor, nearbyAllies[0], targetToken, maxFeet);
  } else {
    const allyOptions = nearbyAllies.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    const selectedId = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize(`${MODULE_ID}.combat.forgebell.dialogTitle`) },
      content: `<p>${game.i18n.format(`${MODULE_ID}.combat.forgebell.rang`, { ally: game.i18n.localize(`${MODULE_ID}.combat.forgebell.anAlly`), distance: maxFeet })}</p><select name="ally" style="width:100%;margin-top:4px">${allyOptions}</select>`,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize(`${MODULE_ID}.common.confirm`),
          default: true,
          callback: (event, button) => button.form.elements.ally.value
        },
        { action: "cancel", label: game.i18n.localize(`${MODULE_ID}.common.cancel`), callback: () => null }
      ],
      rejectClose: false
    });

    if (selectedId) {
      const chosenToken = canvas.tokens.get(selectedId);
      if (chosenToken) await moveAllyTowardTarget(actor, chosenToken, targetToken, maxFeet);
    }
  }
}

async function moveAllyTowardTarget(actor, allyToken, targetToken, maxFeet) {
  const reachable = findReachableCells(allyToken, maxFeet);
  const best = findBestCellTowardTarget(reachable, targetToken.center);
  const moved = Math.round(best.cost * 10) / 10;
  const remaining = Math.round((maxFeet - moved) * 10) / 10;

  if (moved > 0) await allyToken.document.update({ x: best.x, y: best.y });

  const key = moved > 0 ? "moved" : "blocked";
  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.forgebell.${key}`, {
      ally: allyToken.name,
      target: targetToken.name,
      distance: moved > 0 ? moved : maxFeet,
      remaining
    })
  });
}

async function applySandgrasp(item, actor, targetActor, die, autoFail) {
  let failed = autoFail;
  if (!failed) {
    const saveTotal = await rollSave(targetActor, "str", 15, game.i18n.format(`${MODULE_ID}.saves.sandgrasp`, { dc: 15 }));
    failed = saveTotal < 15;
  }

  if (failed) {
    const roll = await new Roll(die).evaluate();
    const penalty = roll.total * 5;
    const currentSpeed = targetActor.system.attributes.movement.walk ?? 30;
    const actualPenalty = Math.min(penalty, currentSpeed - 5);

    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "sandgrasp");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.sandgrasp`),
      img: "icons/magic/earth/strike-fist-stone.webp",
      origin: item.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      changes: [{ key: "system.attributes.movement.walk", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: `-${actualPenalty}`, priority: 20 }],
      description: game.i18n.format(`${MODULE_ID}.effects.sandgrasp`, { penalty: actualPenalty }),
      flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "sandgrasp" } }
    }]);

    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.sandgrasp.seized`, { target: targetActor.name, penalty: actualPenalty })
    });
  } else {
    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.sandgrasp.resisted`, { target: targetActor.name })
    });
  }
}

async function applyMiragewardToAllies(item, actor) {
  const allAllies = canvas.tokens.placeables.filter(t =>
    t.actor &&
    (t.actor.type === "character" || t.document.disposition >= 0)
  );
  for (const allyToken of allAllies) {
    const allyActor = allyToken.actor;
    const existing = allyActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "mirageward" && e.origin === item.uuid);
    if (existing) await allyActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
    await allyActor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.miragewardParty`),
      img: "icons/magic/defensive/illusion-evasion-echo-purple.webp",
      origin: item.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      // mark the reaction as spent
      changes: [{ key: "flags.midi-qol.actions.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 }],
      description: game.i18n.format(`${MODULE_ID}.effects.mirageward`, { attacker: actor.name }),
      flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "mirageward" } }
    }]);
  }
}

async function scriptedBurntrace(ctx) {
  const { item, actor, targetActor } = ctx;
  if (!targetActor) return;
  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "burntrace");
  if (existing) return;
  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.burntrace`),
    img: "icons/magic/sonic/scream-wail-shout-teal.webp",
    origin: item.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    // Enforce through midi-qol if active
    changes: [{ key: "flags.midi-qol.disadvantage.attack.all", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 }],
    description: game.i18n.localize(`${MODULE_ID}.effects.burntrace`),
    flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "burntrace" } }
  }]);
  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.burntrace.marked`, { target: targetActor.name })
  });
}

async function scriptedSandhold(ctx) {
  const { item, actor, targetActor, die, combo } = ctx;
  if (!targetActor || combo?.id === "crystal-anchor") return;

  const roll = await new Roll(die).evaluate();
  const penalty = roll.total * 5;
  const currentSpeed = targetActor.system.attributes.movement.walk ?? 30;
  const actualPenalty = Math.min(penalty, currentSpeed - 5);

  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "sandhold");
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.sandhold`),
    img: "icons/magic/control/hypnosis-mesmerism-watch.webp",
    origin: item.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    changes: [{ key: "system.attributes.movement.walk", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: `-${actualPenalty}`, priority: 20 }],
    description: game.i18n.format(`${MODULE_ID}.effects.sandhold`, { penalty: actualPenalty }),
    flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "sandhold" } }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.sandhold.held`, { target: targetActor.name, penalty: actualPenalty })
  });
}

async function scriptedUndertow(ctx) {
  const { item, actor, targetActor, targetToken, die, msg, combo, runes } = ctx;
  if (!targetActor || !targetToken) return;

  const roll = await new Roll(die).evaluate();
  const squares = roll.total;

  let movedSquares = 0;
  const originToken = (msg ? canvas.tokens.get(msg.speaker.token) : null) ?? actor.getActiveTokens()[0];
  if (originToken) {
    const angle = angleBetween(targetToken.center, originToken.center);
    movedSquares = await moveTokenByAngle(targetToken, angle, squares);
  }
  const distance = movedSquares * 5;

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.undertow.pulled`, { target: targetActor.name, distance })
  });

  if (combo?.id === "crystal-anchor") {
    const currentSpeed = targetActor.system.attributes.movement.walk ?? 30;
    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "sandhold");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize(`${MODULE_ID}.effectNames.sandholdAnchored`),
      img: "icons/magic/control/hypnosis-mesmerism-watch.webp",
      origin: item.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      changes: [{ key: "system.attributes.movement.walk", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0", priority: 30 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.sandholdAnchored`),
      flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "sandhold" } }
    }]);

    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.sandhold.held`, { target: targetActor.name, penalty: currentSpeed })
    });

    if (runes.includes("burntrace")) {
      const existingBT = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "burntrace");
      if (!existingBT) {
        await targetActor.createEmbeddedDocuments("ActiveEffect", [{
          name: game.i18n.localize(`${MODULE_ID}.effectNames.burntraceAnchored`),
          img: "icons/magic/sonic/scream-wail-shout-teal.webp",
          origin: item.uuid,
          duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
          changes: [
            // for midi-qol flag
            { key: "flags.midi-qol.disadvantage.attack.all", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 },
            { key: "flags.midi-qol.disadvantage.ability.check.all", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1", priority: 20 },
            // handle per-ability in core
            ...["str", "dex", "con", "int", "wis", "cha"].map(a => ({
              key: `system.abilities.${a}.check.roll.mode`, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-1", priority: 20
            }))
          ],
          description: game.i18n.localize(`${MODULE_ID}.effects.burntraceAnchored`),
          flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "burntrace" } }
        }]);
        ChatMessage.create({
          speaker: { actor },
          content: game.i18n.format(`${MODULE_ID}.combat.burntrace.marked`, { target: targetActor.name })
        });
      }
    }
  }
}

async function scriptedScorcheye(ctx) {
  const { item, actor, targetActor } = ctx;
  if (!targetActor) return;

  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "scorcheye");
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.scorcheye`),
    img: "icons/magic/perception/eye-ringed-glow-angry-red.webp",
    origin: item.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    description: game.i18n.localize(`${MODULE_ID}.effects.scorcheye`),
    flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "scorcheye" } }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.scorcheye.stripped`, { target: targetActor.name })
  });
}

async function scriptedAshcloud(ctx) {
  const { item, actor, targetActor, targetToken, die, combo } = ctx;
  const isBlightField = combo?.id === "blight-field";
  const center = targetToken?.center ?? canvas.mousePosition;

  const [templateDoc] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
    t: "circle", user: game.user.id, x: center.x, y: center.y, distance: 7.5,
    fillColor: "#8B8000",
    flags: {
      [MODULE_ID]: {
        clusterEffect: "ashcloud",
        damageDie: die,
        roundsRemaining: 3,
        blightField: isBlightField,
        blightedActorId: isBlightField ? targetActor?.id : null
      }
    }
  }]);

  await triggerAshcloud(templateDoc, die);
  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.localize(`${MODULE_ID}.combat.ashcloud.erupted`)
  });
}

async function scriptedWasteblight(ctx) {
  const { item, actor, targetActor, targetToken, die, combo, runes } = ctx;
  if (!targetActor) return;

  const isBlightField = combo?.id === "blight-field";
  await targetActor.toggleStatusEffect("poisoned", { active: true });

  const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "wasteblight");
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.wasteblight`),
    img: "icons/magic/nature/plant-poison-mushroom-green.webp",
    origin: item.uuid,
    duration: { rounds: 10, startRound: game.combat?.round ?? 0 },
    description: game.i18n.localize(`${MODULE_ID}.effects.wasteblight`),
    flags: {
      [MODULE_ID]: {
        sourceItem: item.id,
        effectKey: "wasteblight",
        damageDie: die,
        blightField: isBlightField
      }
    }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.wasteblight.poisoned`, { target: targetActor.name })
  });

  if (isBlightField && !runes.includes("ashcloud")) {
    const center = targetToken?.center ?? canvas.mousePosition;
    const [templateDoc] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
      t: "circle", user: game.user.id, x: center.x, y: center.y, distance: 7.5,
      fillColor: "#8B8000",
      flags: {
        [MODULE_ID]: {
          clusterEffect: "ashcloud",
          damageDie: die,
          roundsRemaining: 3,
          blightField: true,
          blightedActorId: targetActor.id
        }
      }
    }]);
    await triggerAshcloud(templateDoc, die);
  }
}

async function triggerAshcloud(templateDoc, die) {
  const template = canvas.templates.get(templateDoc.id);
  if (!template) return;

  const affected = canvas.tokens.placeables.filter(t =>
    t.actor?.type === "npc" && t.document.disposition === -1 &&
    measureDist(template.center, t.center) <= template.document.distance
  );

  for (const token of affected) {
    const saveTotal = await rollSave(token.actor, "con", 14, game.i18n.format(`${MODULE_ID}.saves.ashcloud`, { dc: 14 }));
    if (saveTotal < 14) {
      const roll = await new Roll(die).evaluate();
      await token.actor.applyDamage([{ value: roll.total, type: "poison" }]);

      await token.actor.toggleStatusEffect("poisoned", { active: true });

      ChatMessage.create({
        speaker: { actor: token.actor },
        content: game.i18n.format(`${MODULE_ID}.combat.ashcloud.failed`, { name: token.name, total: roll.total })
      });
    }
  }
}

async function onPreApplyDamage(actor, damageData) {
  const armor = getEquippedRunicArmor(actor);
  if (!armor || !meetsRequirements(armor)) return;

  const runes = getActiveRuneSlots(armor);
  if (!runes.length) return;
  const rarity = computeRunicRarity(armor);
  const die = getRarityDie(rarity);
  const hp = actor.system.attributes.hp.value;
  const amount = typeof damageData === "number" ? damageData : 0;
  const predictedHP = hp - amount;

  const ctx = {
    trigger: "halfHp",
    item: armor,
    actor,
    ownerToken: actor.getActiveTokens()[0] ?? null,
    hp, maxHP, predictedHP,
    isCritical: false,
    die,
    rarity,
    combo: getActiveComboMerged(runes),
    runes
  };

  const crossed = hp >= maxHP / 2 && predictedHP < maxHP / 2;
  const defs = getOrderedActiveDefs(armor, "armor", runes).filter(d => {
    if (d.trigger !== "halfHp") return false;
    const scripted = d.actions?.some(a => a.type === "scripted");
    return scripted || crossed;
  });
  await dispatchDefs(defs, armor, ctx);
}

async function scriptedStonewarden(ctx) {
  const { actor, die, hp, maxHP, predictedHP } = ctx;
  const used = actor.getFlag(MODULE_ID, "stonewardenUsed");
  if (used || !(hp >= maxHP / 2 && predictedHP < maxHP / 2)) return;

  const roll = await new Roll(die).evaluate();
  await actor.setFlag(MODULE_ID, "stonewardenUsed", true);
  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.stonewarden.flared`, { name: actor.name, total: roll.total })
  });
  await actor.applyDamage(roll.total, { multiplier: -1 });
}

async function scriptedAshenmantle(ctx) {
  const { item: armor, actor, hp, maxHP, predictedHP } = ctx;
  const used = actor.getFlag(MODULE_ID, "ashenmantleUsed");
  if (used || !(hp > maxHP / 2 && predictedHP <= maxHP / 2)) return;

  await actor.setFlag(MODULE_ID, "ashenmantleUsed", true);

  const allDamageTypes = [
    "bludgeoning", "piercing", "slashing", "fire", "cold", "lightning",
    "acid", "poison", "necrotic", "radiant", "psychic", "thunder", "force"
  ];
  const current = Array.from(actor.system.traits.dr.value ?? []);
  const toAdd = allDamageTypes.filter(t => !current.includes(t));

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.ashenmantle`),
    img: "icons/magic/symbols/elements-air-earth-fire-water.webp",
    origin: armor.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    changes: toAdd.map(t => ({ key: "system.traits.dr.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: t, priority: 20 })),
    description: game.i18n.localize(`${MODULE_ID}.effects.ashenmantleResistance`),
    flags: { [MODULE_ID]: { effectKey: "ashenmantleResistance", sourceItem: armor.id } }
  }]);

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(`${MODULE_ID}.effectNames.ashenmantleImmovable`),
    img: "icons/magic/symbols/elements-air-earth-fire-water.webp",
    origin: armor.uuid,
    duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
    description: game.i18n.localize(`${MODULE_ID}.effects.ashenmantleImmovable`),
    flags: { [MODULE_ID]: { effectKey: "ashenmantleImmovable", sourceItem: armor.id } }
  }]);

  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.ashenmantle.erupted`, { name: actor.name })
  });
}

async function onCombatTurnStart(combat, prior) {
  // Active GM executes effects when occurs
  if (game.users?.activeGM !== game.user) return;

  const priorActor = prior?.combatantId ? combat.combatants.get(prior.combatantId)?.actor : null;
  if (priorActor) {
    const priorToken = priorActor.getActiveTokens()[0];
    if (priorToken) await dispatchActorItemRunes(priorActor, priorToken, "turnEnd");
  }

  const actor = combat.combatant?.actor;
  if (!actor) return;

  const ashcloudTemplates = canvas.templates.placeables.filter(t =>
    t.document.flags?.[MODULE_ID]?.clusterEffect === "ashcloud"
  );
  const token = actor.getActiveTokens()[0];
  if (token) {
    for (const template of ashcloudTemplates) {
      const tFlags = template.document.flags?.[MODULE_ID] ?? {};
      if (measureDist(token.center, template.center) <= template.document.distance) {
        await triggerAshcloud(template.document, tFlags.damageDie ?? "1d4");

        if (tFlags.blightField) {
          const blightedActorId = tFlags.blightedActorId;
          const blightedActor = game.actors.get(blightedActorId);
          const blightedToken = blightedActor?.getActiveTokens()[0];
          if (blightedToken) {
            await template.document.update({ x: blightedToken.center.x, y: blightedToken.center.y });
          }
        }

        if (tFlags.blightField) {
          const scorcheye = actor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "scorcheye");
          if (!scorcheye) {
            await actor.createEmbeddedDocuments("ActiveEffect", [{
              name: game.i18n.localize(`${MODULE_ID}.effectNames.scorcheyeBlightField`),
              img: "icons/magic/perception/eye-ringed-glow-angry-red.webp",
              origin: template.document.uuid,
              duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
              description: game.i18n.localize(`${MODULE_ID}.effects.scorcheyeBlightField`),
              flags: { [MODULE_ID]: { effectKey: "scorcheye" } }
            }]);
          }
        }
      }
    }

    await tickRuneClouds(token);
    await dispatchActorItemRunes(actor, token, "turnStart");
  }

  for (const combatant of combat.combatants) {
    const blightedActor = combatant.actor;
    if (!blightedActor) continue;

    const sources = blightedActor.effects.filter(e =>
      e.flags?.[MODULE_ID]?.effectKey === "wasteblight" || e.flags?.[MODULE_ID]?.contagionDie
    );
    if (!sources.length) continue;

    const blightedToken = blightedActor.getActiveTokens()[0];
    if (!blightedToken) continue;

    for (const source of sources) {
      const sFlags = source.flags[MODULE_ID];
      const isCore = sFlags.effectKey === "wasteblight";
      const damageDie = isCore ? sFlags.damageDie : sFlags.contagionDie;
      if (!damageDie) continue;
      const dc = isCore ? 13 : (sFlags.contagionDc ?? 13);
      const ability = isCore ? "con" : (sFlags.contagionAbility ?? "con");
      const status = isCore ? "poisoned" : (sFlags.contagionStatus ?? "poisoned");
      const spreadKey = isCore ? "combat.wasteblight.spread" : "engine.contagionSpread";
      const resistKey = isCore ? "combat.wasteblight.resisted" : "engine.contagionResisted";
      // Spread Wasteblight only to enemies
      const affects = isCore ? "enemies" : (sFlags.contagionAffects ?? "all");
      const matchesAffects = t => {
        if (affects === "enemies") return !isFriendly(t);
        if (affects === "allies") return isFriendly(t);
        return true;
      };
      const adjacentTokens = canvas.tokens.placeables.filter(t =>
        t.actor && t.id !== blightedToken.id &&
        matchesAffects(t) &&
        measureDist(blightedToken.center, t.center) <= 5
      );

      for (const adjToken of adjacentTokens) {
        const adjActor = adjToken.actor;
        if (adjActor.effects.some(e => e.statuses?.has(status))) continue;
        const saveTotal = await rollSave(adjActor, ability, dc, game.i18n.format(`${MODULE_ID}.saves.wasteblight`, { dc }));
        if (saveTotal < dc) {
          await adjActor.toggleStatusEffect(status, { active: true });

          const roll = await new Roll(damageDie).evaluate();
          await adjActor.applyDamage(isCore ? [{ value: roll.total, type: "poison" }] : [{ value: roll.total }]);
          ChatMessage.create({
            speaker: { actor: adjActor },
            content: game.i18n.format(`${MODULE_ID}.${spreadKey}`, { name: adjActor.name, total: roll.total, rune: source.name })
          });
        } else {
          ChatMessage.create({
            speaker: { actor: adjActor },
            content: game.i18n.format(`${MODULE_ID}.${resistKey}`, { name: adjActor.name, rune: source.name })
          });
        }
      }
    }
  }
}

async function dispatchActorItemRunes(actor, token, trigger) {
  for (const item of actor.items) {
    if (!item.flags?.[MODULE_ID]) continue;
    const category = getItemCategory(item);
    if (!category || !meetsRequirements(item)) continue;
    const runes = getActiveRuneSlots(item);
    if (!runes.length) continue;
    const defs = getOrderedActiveDefs(item, category, runes).filter(d => d.trigger === trigger);
    if (!defs.length) continue;
    const ctx = {
      trigger,
      item,
      actor,
      ownerToken: token,
      isCritical: false,
      die: getRarityDie(computeRunicRarity(item)),
      rarity: computeRunicRarity(item),
      combo: getActiveComboMerged(runes),
      runes
    };
    await dispatchDefs(defs, item, ctx);
  }
}

async function onCombatStart(combat) {
  if (game.users?.activeGM !== game.user) return;
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    const token = actor.getActiveTokens()[0];
    if (!token) continue;
    await dispatchActorItemRunes(actor, token, "combatStart");
  }
}

function emitOrExecuteRuneTrigger(payload) {
  if (game.users?.activeGM === game.user) return executeRuneTrigger(payload);
  game.socket.emit(`module.${MODULE_ID}`, payload);
}

async function executeRuneTrigger({ trigger, actorUuid }) {
  const actor = await fromUuid(actorUuid).catch(() => null);
  if (!actor) return;
  const token = actor.getActiveTokens()[0];
  if (!token) return;
  await dispatchActorItemRunes(actor, token, trigger);
}

function actorHasTriggerRunes(actor, trigger) {
  for (const item of actor.items) {
    if (!item.flags?.[MODULE_ID]) continue;
    const category = getItemCategory(item);
    if (!category || !meetsRequirements(item)) continue;
    const runes = getActiveRuneSlots(item);
    if (!runes.length) continue;
    if (getOrderedActiveDefs(item, category, runes).some(d => d.trigger === trigger)) return true;
  }
  return false;
}

async function onPostUseActivity(activity) {
  const actor = activity?.actor;
  if (!actor || activity?.item?.type !== "spell") return;
  if (!actorHasTriggerRunes(actor, "onSpellCast")) return;
  await emitOrExecuteRuneTrigger({ type: "runeTrigger", trigger: "onSpellCast", actorUuid: actor.uuid });
}

async function onEndConcentration(actor) {
  if (!actor || !actorHasTriggerRunes(actor, "concBreak")) return;
  await emitOrExecuteRuneTrigger({ type: "runeTrigger", trigger: "concBreak", actorUuid: actor.uuid });
}

const PROXIMITY_RADIUS = 10;
const _proximityWithin = new Map();

async function onUpdateTokenProximity(tokenDoc, change) {
  if (game.users?.activeGM !== game.user) return;
  if (change?.x === undefined && change?.y === undefined) return;
  const mover = tokenDoc.object;
  if (!mover?.actor || !canvas?.tokens) return;

  for (const wearerToken of canvas.tokens.placeables) {
    if (!wearerToken.actor || wearerToken.id === mover.id) continue;
    const wearerFriendly = wearerToken.actor.type === "character" || wearerToken.document.disposition >= 0;
    const moverFriendly = mover.actor.type === "character" || mover.document.disposition >= 0;
    if (wearerFriendly === moverFriendly) continue;

    const armor = getEquippedRunicArmor(wearerToken.actor);
    if (!armor || !meetsRequirements(armor)) continue;
    const runes = getActiveRuneSlots(armor);
    if (!runes.length) continue;
    const defs = getOrderedActiveDefs(armor, "armor", runes).filter(d => d.trigger === "proximity");
    if (!defs.length) continue;

    const key = `${wearerToken.id}:${mover.id}`;
    const within = measureDist(wearerToken, mover) <= PROXIMITY_RADIUS;
    const wasWithin = _proximityWithin.get(key) === true;
    _proximityWithin.set(key, within);
    if (!within || wasWithin) continue;

    const ctx = {
      trigger: "proximity",
      item: armor,
      actor: wearerToken.actor,
      ownerToken: wearerToken,
      attackerToken: mover,
      attackerActor: mover.actor,
      targetToken: mover,
      isCritical: false,
      die: getRarityDie(computeRunicRarity(armor)),
      rarity: computeRunicRarity(armor),
      combo: getActiveComboMerged(runes),
      runes
    };
    await dispatchDefs(defs, armor, ctx);
  }
}

async function onDeleteCombat(combat) {
  if (game.users?.activeGM !== game.user) return;

  // keyed by token pairs and not actor ids
  _proximityWithin.clear();

  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    await actor.unsetFlag(MODULE_ID, "guardianRushUsed");
    await actor.unsetFlag(MODULE_ID, "stonewardenUsed");
    await actor.unsetFlag(MODULE_ID, "wardpulseRound");
    await clearUseLimits(actor, "combat");
  }
}

async function onRestCompleted(actor) {
  await actor.unsetFlag(MODULE_ID, "ashenmantleUsed");
  await actor.unsetFlag(MODULE_ID, "stonewardenUsed");
  await actor.unsetFlag(MODULE_ID, "guardianRushUsed");
  await clearUseLimits(actor, "rest");
}

function onDeleteActiveEffect(effect) {
  if (game.users?.activeGM !== game.user) return;
  onEngineEffectDeleted(effect);
}

async function onCreateActiveEffect(effect) {
  if (game.users?.activeGM !== game.user) return;

  const actor = effect.parent;
  if (!actor) return;
  const isProne = effect.statuses?.has?.("prone") || effect.name === "Prone";
  if (!isProne) return;

  const armor = getEquippedRunicArmor(actor);
  if (!armor || !meetsRequirements(armor)) return;

  const runes = getActiveRuneSlots(armor);
  const proneDefs = getOrderedActiveDefs(armor, "armor", runes).filter(d =>
    d.trigger === "whenProne" && !d.actions?.some(a => a.type === "scripted")
  );
  if (proneDefs.length) {
    const token = actor.getActiveTokens()[0];
    if (token) {
      await dispatchDefs(proneDefs, armor, {
        trigger: "whenProne",
        item: armor,
        actor,
        ownerToken: token,
        isCritical: false,
        die: getRarityDie(computeRunicRarity(armor)),
        rarity: computeRunicRarity(armor),
        combo: getActiveComboMerged(runes),
        runes
      });
    }
  }

  if (!runes.includes("stonewarden")) return;
  if (actor.getFlag(MODULE_ID, "stonewardenUsed")) return;

  const hp = actor.system.attributes.hp.value;
  const maxHP = actor.system.attributes.hp.max;
  if (hp >= maxHP / 2) return;

  const die = getRarityDie(computeRunicRarity(armor));
  const roll = await new Roll(die).evaluate();
  await actor.setFlag(MODULE_ID, "stonewardenUsed", true);
  await actor.applyDamage(roll.total, { multiplier: -1 });
  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.stonewarden.prone`, { name: actor.name, total: roll.total })
  });
}
