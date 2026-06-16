import { getItemCategory, meetsRequirements, computeRunicRarity, getRarityDie } from "./utils.js";
import { getActiveCombo } from "./combo-registry.js";
import { computeRayDestination, findReachableCells, findBestCellTowardTarget, findBestAdjacentCell } from "./movement.js";

const MODULE_ID = "gm-runic-items";

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
  const live = Array.from(game.user?.targets ?? []);
  if (live.length) return live;

  const stored = msg.flags?.dnd5e?.targets ?? [];
  return stored
    .map(t => fromUuidSync(t.uuid ?? t)?.getActiveTokens?.()[0])
    .filter(Boolean);
}

async function moveTokenByAngle(token, angleRad, squares) {
  const dest = computeRayDestination(token, angleRad, squares);
  if (dest.squares === 0) return 0;
  await token.document.update({ x: dest.x, y: dest.y });
  return dest.squares;
}

export function registerCombatHooks() {
  Hooks.on("dnd5e.rollAttack", onRollAttack);
  Hooks.on("renderChatMessage", onRenderChatMessage);
  Hooks.on("dnd5e.preApplyDamage", onPreApplyDamage);
  Hooks.on("combatTurnStart", onCombatTurnStart);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("dnd5e.restCompleted", onRestCompleted);
  Hooks.on("createActiveEffect", onCreateActiveEffect);
}

async function onRollAttack(item, rollData) {
  const attacker = item.actor;
  if (!attacker) return;

  const isSuccess = rollData?.isSuccess ?? false;
  if (!isSuccess) return;

  const targets = Array.from(game.user?.targets ?? []);
  if (targets.length === 0) return;

  for (const targetToken of targets) {
    const targetActor = targetToken.actor;
    if (!targetActor) continue;
    await processArmorReactions(attacker, targetActor, item, rollData);
  }

  await processGuardiansRush(attacker, item, targets);
}

async function processArmorReactions(attacker, targetActor, item, rollData) {
  const armor = getEquippedRunicArmor(targetActor);
  if (!armor || !meetsRequirements(armor)) return;

  const runes = getActiveRuneSlots(armor);
  const category = getItemCategory(item);
  if (category !== "melee") return;

  const rarity = computeRunicRarity(armor);
  const die = getRarityDie(rarity);
  const combo = getActiveCombo(runes);

  if (runes.includes("emberveil")) {
    const attackerToken = attacker.getActiveTokens()[0];
    const defenderToken = targetActor.getActiveTokens()[0];
    if (attackerToken && defenderToken) {
      const roll = await new Roll(die).evaluate();
      const squares = roll.total;
      const ray = new Ray(defenderToken.center, attackerToken.center);
      const movedSquares = await moveTokenByAngle(attackerToken, ray.angle, squares);
      const distance = movedSquares * 5;

      const existingBlock = attacker.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "emberveilBlocked");
      if (existingBlock) await attacker.deleteEmbeddedDocuments("ActiveEffect", [existingBlock.id]);

      await attacker.createEmbeddedDocuments("ActiveEffect", [{
        name: "Emberveil Blocked",
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
        name: "Bonus Action Blocked",
        img: "icons/magic/control/debuff-energy-hold-teal-blue.webp",
        origin: armor.uuid,
        duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
        changes: [{ key: "system.actions.bonus", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0", priority: 20 }],
        description: game.i18n.localize(`${MODULE_ID}.effects.wardpulseBlock`),
        flags: { [MODULE_ID]: { sourceItem: armor.id, effectKey: "wardpulseBlock" } }
      }]);
      ChatMessage.create({
        speaker: { actor: targetActor },
        content: game.i18n.format(`${MODULE_ID}.combat.wardpulse.blocked`, { attacker: attacker.name })
      });
    }
  }

  if (runes.includes("forgeshield")) {
    const radius = combo?.id === "ironwall" ? 20 : 10;
    const defenderToken = targetActor.getActiveTokens()[0];
    if (defenderToken) {
      const nearbyAllies = canvas.tokens.placeables.filter(t =>
        t.actor?.id !== targetActor.id &&
        t.actor?.type === "character" &&
        canvas.grid.measureDistance(defenderToken, t) <= radius
      );
      for (const allyToken of nearbyAllies) {
        const allyActor = allyToken.actor;
        const existing = allyActor.effects.find(e => e.name === "Forgeshield" && e.origin === armor.uuid);
        if (existing) await allyActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
        await allyActor.createEmbeddedDocuments("ActiveEffect", [{
          name: "Forgeshield",
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
  }

  if (runes.includes("wardpulse") && combo?.id !== "ironwall") {
    const currentRound = game.combat?.round ?? 0;
    const lastRound = targetActor.getFlag(MODULE_ID, "wardpulseRound") ?? -1;
    if (lastRound === currentRound) return;

    const save = await attacker.rollAbilitySave("con", { flavor: "Wardpulse (DC 14)", dc: 14 });
    if (save.total < 14) {
      await targetActor.setFlag(MODULE_ID, "wardpulseRound", currentRound);
      await attacker.createEmbeddedDocuments("ActiveEffect", [{
        name: "Bonus Action Blocked",
        img: "icons/magic/control/debuff-energy-hold-teal-blue.webp",
        origin: armor.uuid,
        duration: { rounds: 1, startRound: currentRound },
        changes: [{ key: "system.actions.bonus", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0", priority: 20 }],
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

    const combo = getActiveCombo(armorRunes);
    const isFreeAction = combo?.id === "morrains-resolve";

    if (!isFreeAction && actor.getFlag(MODULE_ID, "guardianRushUsed")) continue;

    const defenderToken = actor.getActiveTokens()[0];
    if (!defenderToken) continue;

    const dist = canvas.grid.measureDistance(defenderToken, allyToken);
    if (dist > actor.system.attributes.movement.walk) continue;

    const dialogKey = isFreeAction ? "dialogFreeAction" : "dialogContent";
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize(`${MODULE_ID}.combat.vanguard.dialogTitle`),
      content: game.i18n.format(`${MODULE_ID}.combat.vanguard.${dialogKey}`, { actor: actor.name, ally: allyActor.name }),
      defaultYes: false
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
      name: "Guardian's Rush Disadvantage",
      img: "icons/magic/air/air-pressure-shield-blue.webp",
      origin: actor.uuid,
      duration: { rounds: 1, startRound: game.combat.round },
      changes: [{ key: "system.bonuses.attack.disadvantage", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true", priority: 20 }],
      description: game.i18n.localize(`${MODULE_ID}.effects.vanguardDisadvantage`),
      flags: { [MODULE_ID]: { effectKey: "vanguardDisadvantage", sourceItem: armor.id } }
    }]);

    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.vanguard.rushed`, { actor: actor.name, ally: allyActor.name, attacker: attacker.name })
    });
  }
}

async function onRenderChatMessage(msg, html, data) {
  const itemUuid = msg.flags?.dnd5e?.roll?.itemUuid;
  const rollType = msg.flags?.dnd5e?.roll?.type;
  if (!itemUuid || rollType !== "damage") return;

  const item = await fromUuid(itemUuid);
  const actor = item?.actor;
  if (!item || !actor || item.type !== "weapon") return;

  const targets = resolveMessageTargets(msg);

  await handleEmberbranded(actor, targets);

  if (!item.flags?.[MODULE_ID]) return;

  const runes = getActiveRuneSlots(item);
  if (runes.length === 0) return;
  if (!meetsRequirements(item)) return;

  const targetToken = targets[0];
  const targetActor = targetToken?.actor;
  const isCritical = msg.rolls?.[0]?.options?.isCritical === true;
  const category = getItemCategory(item);
  const rarity = computeRunicRarity(item);
  const die = getRarityDie(rarity);

  if (category === "melee") {
    await handleMeleeDamageEffects(item, actor, targetActor, targetToken, runes, die, isCritical, msg);
  } else if (category === "ranged") {
    await handleRangedDamageEffects(item, actor, targetActor, targetToken, runes, die, isCritical, msg);
  }
}

async function handleEmberbranded(attacker, targets) {
  for (const targetToken of targets) {
    const effect = targetToken.actor?.effects?.find(e =>
      e.flags?.[MODULE_ID]?.effectKey === "emberbranded"
    );
    if (!effect) continue;
    const storedDie = effect.flags[MODULE_ID].damageDie;
    if (!storedDie) continue;
    const roll = await new Roll(storedDie).evaluate();
    await targetToken.actor.applyDamage(roll.total);
    ChatMessage.create({
      speaker: { actor: attacker },
      content: game.i18n.format(`${MODULE_ID}.combat.emberbrand.tick`, { name: targetToken.actor.name, total: roll.total })
    });
  }
}

async function handleMeleeDamageEffects(item, actor, targetActor, targetToken, runes, die, isCritical, msg) {
  const combo = getActiveCombo(runes);

  if (runes.includes("stonecleft") && targetActor && targetToken) {
    const roll = await new Roll(die).evaluate();
    const squares = roll.total;

    let failed = isCritical;
    if (!failed) {
      const save = await targetActor.rollAbilitySave("str", { flavor: "Stonecleft (DC 13)", dc: 13 });
      failed = save.total < 13;
    }

    if (failed) {
      let movedSquares = 0;
      const originToken = canvas.tokens.get(msg.speaker.token);
      if (originToken) {
        const ray = new Ray(originToken.center, targetToken.center);
        movedSquares = await moveTokenByAngle(targetToken, ray.angle, squares);
      }
      const distance = movedSquares * 5;

      const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "stonecleft");
      if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

      await targetActor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Staggered (Stonecleft)",
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

  if (runes.includes("mirageward") && targetActor && combo?.id !== "rift-break") {
    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "mirageward");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Mirageward",
      img: "icons/magic/defensive/illusion-evasion-echo-purple.webp",
      origin: item.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      description: game.i18n.format(`${MODULE_ID}.effects.mirageward`, { attacker: actor.name }),
      flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "mirageward" } }
    }]);

    ChatMessage.create({
      speaker: { actor },
      content: game.i18n.format(`${MODULE_ID}.combat.mirageward.active`, { target: targetActor.name, attacker: actor.name })
    });
  }

  if (runes.includes("sandgrasp") && targetActor && combo?.id !== "rift-break") {
    await applySandgrasp(item, actor, targetActor, die, false);
  }

  if (runes.includes("ruinmark") && targetActor) {
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
      name: "Ruinmark (AC Cracked)",
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

  if (isCritical && runes.includes("emberbrand") && targetActor) {
    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "emberbranded");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Emberbranded",
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
          canvas.grid.measureDistance(originToken, t) <= 30
        );
        const allyNames = allAllies.map(t => t.name).join(", ");
        ChatMessage.create({
          speaker: { actor },
          content: game.i18n.format(`${MODULE_ID}.combat.forgebell.rang`, { ally: allyNames || "nearby allies", distance })
        });
      }
    }
  }

  if (runes.includes("forgebell") && actor && combo?.id !== "ember-surge") {
    const originToken = actor.getActiveTokens()[0];
    if (originToken && targetToken) {
      const roll = await new Roll(die).evaluate();
      const maxFeet = roll.total * 5;

      const nearbyAllies = canvas.tokens.placeables.filter(t =>
        t.actor &&
        t.actor.id !== actor.id &&
        (t.actor.type === "character" || t.document.disposition >= 0) &&
        canvas.grid.measureDistance(originToken, t) <= 30
      );

      if (nearbyAllies.length === 0) {
        ChatMessage.create({
          speaker: { actor },
          content: game.i18n.format(`${MODULE_ID}.combat.forgebell.rang`, { ally: "no allies in range", distance: maxFeet })
        });
      } else if (nearbyAllies.length === 1) {
        await moveAllyTowardTarget(actor, nearbyAllies[0], targetToken, maxFeet);
      } else {
        const allyOptions = nearbyAllies.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
        const selectedId = await new Promise(resolve => {
          new Dialog({
            title: "Forgebell - Reaction",
            content: `<p>${game.i18n.format(`${MODULE_ID}.combat.forgebell.rang`, { ally: "an ally", distance: maxFeet })}</p><select name="ally" style="width:100%;margin-top:4px">${allyOptions}</select>`,
            buttons: {
              confirm: {
                label: "Confirm",
                callback: html => resolve(html.find('[name="ally"]').val())
              },
              cancel: { label: "Cancel", callback: () => resolve(null) }
            },
            default: "confirm"
          }).render(true);
        });

        if (selectedId) {
          const chosenToken = canvas.tokens.get(selectedId);
          if (chosenToken) await moveAllyTowardTarget(actor, chosenToken, targetToken, maxFeet);
        }
      }
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
    const save = await targetActor.rollAbilitySave("str", { flavor: "Sandgrasp (DC 15)", dc: 15 });
    failed = save.total < 15;
  }

  if (failed) {
    const roll = await new Roll(die).evaluate();
    const penalty = roll.total * 5;
    const currentSpeed = targetActor.system.attributes.movement.walk ?? 30;
    const actualPenalty = Math.min(penalty, currentSpeed - 5);

    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "sandgrasp");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Sandgrasp",
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
      name: "Mirageward (Party)",
      img: "icons/magic/defensive/illusion-evasion-echo-purple.webp",
      origin: item.uuid,
      duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
      description: game.i18n.format(`${MODULE_ID}.effects.mirageward`, { attacker: actor.name }),
      flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "mirageward" } }
    }]);
  }
}

async function handleRangedDamageEffects(item, actor, targetActor, targetToken, runes, die, isCritical, msg) {
  const combo = getActiveCombo(runes);

  if (runes.includes("burntrace") && targetActor) {
    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "burntrace");
    if (!existing) {
      await targetActor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Burntrace",
        img: "icons/magic/sonic/scream-wail-shout-teal.webp",
        origin: item.uuid,
        duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
        changes: [{ key: "system.bonuses.attack.disadvantage", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "1", priority: 20 }],
        description: game.i18n.localize(`${MODULE_ID}.effects.burntrace`),
        flags: { [MODULE_ID]: { sourceItem: item.id, effectKey: "burntrace" } }
      }]);
      ChatMessage.create({
        speaker: { actor },
        content: game.i18n.format(`${MODULE_ID}.combat.burntrace.marked`, { target: targetActor.name })
      });
    }
  }

  if (runes.includes("sandhold") && targetActor && combo?.id !== "crystal-anchor") {
    const roll = await new Roll(die).evaluate();
    const penalty = roll.total * 5;
    const currentSpeed = targetActor.system.attributes.movement.walk ?? 30;
    const actualPenalty = Math.min(penalty, currentSpeed - 5);

    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "sandhold");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Sandhold",
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

  if (runes.includes("undertow") && targetActor && targetToken) {
    const roll = await new Roll(die).evaluate();
    const squares = roll.total;

    let movedSquares = 0;
    const originToken = canvas.tokens.get(msg.speaker.token) ?? actor.getActiveTokens()[0];
    if (originToken) {
      const ray = new Ray(targetToken.center, originToken.center);
      movedSquares = await moveTokenByAngle(targetToken, ray.angle, squares);
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
        name: "Sandhold (Anchored)",
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

      if (runes.includes("burntrace") && targetActor) {
        const existingBT = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "burntrace");
        if (!existingBT) {
          await targetActor.createEmbeddedDocuments("ActiveEffect", [{
            name: "Burntrace (Anchored)",
            img: "icons/magic/sonic/scream-wail-shout-teal.webp",
            origin: item.uuid,
            duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
            changes: [
              { key: "system.bonuses.attack.disadvantage", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "1", priority: 20 },
              { key: "system.bonuses.abilities.check", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "-1d20", priority: 20 }
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

  if (runes.includes("scorcheye") && targetActor) {
    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "scorcheye");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Scorcheye",
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

  if (runes.includes("ashcloud")) {
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

  if (runes.includes("wasteblight") && targetActor) {
    const isBlightField = combo?.id === "blight-field";
    const poisonedStatus = CONFIG.statusEffects.find(e => e.id === "poisoned");
    if (poisonedStatus && targetToken?.toggleEffect) {
      await targetToken.toggleEffect(poisonedStatus, { active: true });
    }

    const existing = targetActor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "wasteblight");
    if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);

    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Wasteblight",
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
}

async function triggerAshcloud(templateDoc, die) {
  const template = canvas.templates.get(templateDoc.id);
  if (!template) return;

  const affected = canvas.tokens.placeables.filter(t =>
    t.actor?.type === "npc" && t.document.disposition === -1 &&
    canvas.grid.measureDistance(template.center, t.center) <= template.document.distance
  );

  for (const token of affected) {
    const save = await token.actor.rollAbilitySave("con", { flavor: "Ashcloud (DC 14)", dc: 14 });
    if (save.total < 14) {
      const roll = await new Roll(die).evaluate();
      await token.actor.applyDamage(roll.total);

      const poisonedStatus = CONFIG.statusEffects.find(e => e.id === "poisoned");
      if (poisonedStatus && token.toggleEffect) await token.toggleEffect(poisonedStatus, { active: true });

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
  const rarity = computeRunicRarity(armor);
  const die = getRarityDie(rarity);
  const hp = actor.system.attributes.hp.value;
  const maxHP = actor.system.attributes.hp.max;
  const predictedHP = hp - (damageData ?? 0);

  if (runes.includes("stonewarden")) {
    const used = actor.getFlag(MODULE_ID, "stonewardenUsed");
    if (!used && hp >= maxHP / 2 && predictedHP < maxHP / 2) {
      const roll = await new Roll(die).evaluate();
      await actor.setFlag(MODULE_ID, "stonewardenUsed", true);
      ChatMessage.create({
        speaker: { actor },
        content: game.i18n.format(`${MODULE_ID}.combat.stonewarden.flared`, { name: actor.name, total: roll.total })
      });
      await actor.applyDamage(-roll.total);
    }
  }

  if (runes.includes("ashenmantle")) {
    const used = actor.getFlag(MODULE_ID, "ashenmantleUsed");
    if (!used && hp > maxHP / 2 && predictedHP <= maxHP / 2) {
      await actor.setFlag(MODULE_ID, "ashenmantleUsed", true);

      const allDamageTypes = [
        "bludgeoning", "piercing", "slashing", "fire", "cold", "lightning",
        "acid", "poison", "necrotic", "radiant", "psychic", "thunder", "force"
      ];
      const current = Array.from(actor.system.traits.dr.value ?? []);
      const toAdd = allDamageTypes.filter(t => !current.includes(t));

      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Ashen Mantle",
        img: "icons/magic/symbols/elements-air-earth-fire-water.webp",
        origin: armor.uuid,
        duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
        changes: toAdd.map(t => ({ key: "system.traits.dr.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: t, priority: 20 })),
        description: game.i18n.localize(`${MODULE_ID}.effects.ashenmantleResistance`),
        flags: { [MODULE_ID]: { effectKey: "ashenmantleResistance", sourceItem: armor.id } }
      }]);

      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Ashen Mantle (Immovable)",
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
  }
}

async function onCombatTurnStart(combat) {
  const actor = combat.combatant?.actor;
  if (!actor) return;

  const ashcloudTemplates = canvas.templates.placeables.filter(t =>
    t.flags?.[MODULE_ID]?.clusterEffect === "ashcloud"
  );
  const token = actor.getActiveTokens()[0];
  if (token) {
    for (const template of ashcloudTemplates) {
      if (canvas.grid.measureDistance(token.center, template.center) <= template.document.distance) {
        await triggerAshcloud(template.document, template.flags?.[MODULE_ID]?.damageDie ?? "1d4");

        if (template.flags?.[MODULE_ID]?.blightField) {
          const blightedActorId = template.flags[MODULE_ID].blightedActorId;
          const blightedActor = game.actors.get(blightedActorId);
          const blightedToken = blightedActor?.getActiveTokens()[0];
          if (blightedToken) {
            await template.document.update({ x: blightedToken.center.x, y: blightedToken.center.y });
          }
        }

        if (template.flags?.[MODULE_ID]?.blightField) {
          const scorcheye = actor.effects.find(e => e.flags?.[MODULE_ID]?.effectKey === "scorcheye");
          if (!scorcheye) {
            await actor.createEmbeddedDocuments("ActiveEffect", [{
              name: "Scorcheye (Blight Field)",
              img: "icons/magic/perception/eye-ringed-glow-angry-red.webp",
              origin: template.uuid,
              duration: { rounds: 1, startRound: game.combat?.round ?? 0 },
              description: game.i18n.localize(`${MODULE_ID}.effects.scorcheyeBlightField`),
              flags: { [MODULE_ID]: { effectKey: "scorcheye" } }
            }]);
          }
        }
      }
    }
  }

  for (const combatant of combat.combatants) {
    const blightedActor = combatant.actor;
    if (!blightedActor) continue;

    const wasteblightEffect = blightedActor.effects.find(e =>
      e.flags?.[MODULE_ID]?.effectKey === "wasteblight"
    );
    if (!wasteblightEffect) continue;

    const blightedToken = blightedActor.getActiveTokens()[0];
    if (!blightedToken) continue;

    const { damageDie } = wasteblightEffect.flags[MODULE_ID];
    const adjacentTokens = canvas.tokens.placeables.filter(t =>
      t.actor && t.id !== blightedToken.id &&
      canvas.grid.measureDistance(blightedToken.center, t.center) <= 5
    );

    for (const adjToken of adjacentTokens) {
      const adjActor = adjToken.actor;
      if (adjActor.effects.some(e => e.statuses?.has("poisoned"))) continue;
      const save = await adjActor.rollAbilitySave("con", { flavor: "Wasteblight Spread (DC 13)", dc: 13 });
      if (save.total < 13) {
        const poisonedStatus = CONFIG.statusEffects.find(e => e.id === "poisoned");
        if (poisonedStatus && adjToken.toggleEffect) await adjToken.toggleEffect(poisonedStatus, { active: true });

        const roll = await new Roll(damageDie).evaluate();
        await adjActor.applyDamage(roll.total);
        ChatMessage.create({
          speaker: { actor: adjActor },
          content: game.i18n.format(`${MODULE_ID}.combat.wasteblight.spread`, { name: adjActor.name, total: roll.total })
        });
      } else {
        ChatMessage.create({
          speaker: { actor: adjActor },
          content: game.i18n.format(`${MODULE_ID}.combat.wasteblight.resisted`, { name: adjActor.name })
        });
      }
    }
  }
}

async function onUpdateCombat(combat) {
  // Per-turn tick effects for runes
}

async function onDeleteCombat(combat) {
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    await actor.unsetFlag(MODULE_ID, "guardianRushUsed");
    await actor.unsetFlag(MODULE_ID, "stonewardenUsed");
    await actor.unsetFlag(MODULE_ID, "wardpulseRound");
  }
}

async function onRestCompleted(actor) {
  await actor.unsetFlag(MODULE_ID, "ashenmantleUsed");
  await actor.unsetFlag(MODULE_ID, "stonewardenUsed");
  await actor.unsetFlag(MODULE_ID, "guardianRushUsed");
}

async function onCreateActiveEffect(effect) {
  const actor = effect.parent;
  if (!actor || effect.name !== "Prone") return;

  const armor = getEquippedRunicArmor(actor);
  if (!armor || !meetsRequirements(armor)) return;
  if (!getActiveRuneSlots(armor).includes("stonewarden")) return;

  const hp = actor.system.attributes.hp.value;
  const maxHP = actor.system.attributes.hp.max;
  if (hp >= maxHP / 2) return;

  const die = getRarityDie(computeRunicRarity(armor));
  const roll = await new Roll(die).evaluate();
  await actor.applyDamage(-roll.total);
  ChatMessage.create({
    speaker: { actor },
    content: game.i18n.format(`${MODULE_ID}.combat.stonewarden.prone`, { name: actor.name, total: roll.total })
  });
}
