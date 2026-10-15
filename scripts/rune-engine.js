import { rollSave, gridSquaresForFeet, feetPerGridSquare, feetToSceneDistance, sceneDistanceToFeet, dnd5eDisplayDistance, withinFeet, feetToActorUnits, actorUnitsToFeet, actorSpeedInSceneUnits } from "./utils.js";
import { AURA_RADIUS, ACTION_TYPES, validateRuneDef, formatValidationError, teleportDir, teleportFeet, resolveDie, resolveRoundsDie } from "./rune-defs.js";
import { getActiveComboMerged, getCustomCombos } from "./rune-store.js";
import { measureDist, angleBetween, computeBlinkDestination, findReachableCells, findBestCellTowardTarget, findBestCellAwayFrom, findBestAdjacentCell } from "./movement.js";
import { dnd5eVersionAtLeast, midiDenyBonusChanges, midiDenyReactionChanges, midiDisadvCheckChanges, speedKey, movementSpeed } from "./compat.js";
import {
  gateMove, gateDocUpdate, gateDamage, gateStatus, gateEffect, gateTemplate,
  gateSaveCard, registerSaveResume, isManualMode
} from "./manual-actions.js";

const MODULE_ID = "gm-runic-items";

const _scripted = {};

export function registerScripted(key, fn) {
  _scripted[key] = fn;
}

function i18n(key, data) {
  if (!data) return game.i18n.localize(`${MODULE_ID}.engine.${key}`);
  const out = { ...data };
  for (const field of ["distance", "penalty", "remaining", "radius"]) {
    if (typeof out[field] !== "number") continue;
    const shown = dnd5eDisplayDistance(out[field]);
    out[field] = shown.value;
    out.unit = shown.unit;
  }
  return game.i18n.format(`${MODULE_ID}.engine.${key}`, out);
}

function safeFlagKey(id) {
  return String(id).replace(/[.\s]/g, "_");
}

export function checkUseLimit(def, actor) {
  if (!def.uses?.per) return true;
  const uses = actor.getFlag(MODULE_ID, "runeUses") ?? {};
  const entry = uses[safeFlagKey(def.id)];
  if (!entry) return true;
  if (def.uses.per === "round") {
    return entry.combatId !== (game.combat?.id ?? null) || entry.round !== (game.combat?.round ?? 0);
  }
  if (def.uses.per === "combat") {
    return entry.combatId !== (game.combat?.id ?? null);
  }
  return false;
}

async function markUse(def, actor) {
  if (!def.uses?.per) return;
  const uses = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "runeUses") ?? {});
  uses[safeFlagKey(def.id)] = {
    per: def.uses.per,
    combatId: game.combat?.id ?? null,
    round: game.combat?.round ?? 0
  };
  await actor.setFlag(MODULE_ID, "runeUses", uses);
}

export async function clearUseLimits(actor, scope) {
  const uses = actor.getFlag(MODULE_ID, "runeUses");
  if (!uses) return;
  const keep = {};
  if (scope === "combat") {
    for (const [key, entry] of Object.entries(uses)) {
      if (entry?.per === "rest") keep[key] = entry;
    }
  }
  await actor.unsetFlag(MODULE_ID, "runeUses");
  if (Object.keys(keep).length) await actor.setFlag(MODULE_ID, "runeUses", keep);
}

function ownerToken(ctx) {
  return ctx.ownerToken ?? ctx.actor?.getActiveTokens?.()[0] ?? null;
}

function tokensNear(centerToken, filter, radius = AURA_RADIUS) {
  if (!centerToken || !canvas?.tokens) return [];
  return canvas.tokens.placeables.filter(t =>
    t.actor && t.id !== centerToken.id && withinFeet(centerToken, t, radius) && filter(t)
  );
}

export function tokenSide(token) {
  const disp = token?.document?.disposition;
  if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "party";
  if (disp === CONST.TOKEN_DISPOSITIONS.HOSTILE) return "hostile";
  return null;
}

// "ally" and "enemy" are both relative to the rune bearer
export function areAllies(a, b) {
  const side = tokenSide(a);
  return side !== null && side === tokenSide(b);
}

export function areEnemies(a, b) {
  const sa = tokenSide(a);
  const sb = tokenSide(b);
  return sa !== null && sb !== null && sa !== sb;
}

export function resolveRole(role, ctx, radius) {
  const self = ownerToken(ctx);
  switch (role) {
    case "target": return ctx.targetToken ? [ctx.targetToken] : [];
    case "attacker": return ctx.attackerToken ? [ctx.attackerToken] : [];
    case "self": return self ? [self] : [];
    case "allies": return tokensNear(self, t => areAllies(self, t), radius);
    case "enemies": return tokensNear(self, t => areEnemies(self, t), radius);
    case "area": return ctx.areaTokens ?? tokensNear(self, () => true, radius);
    default: return [];
  }
}

function resolveSaver(who, ctx) {
  return resolveRole(who, ctx)[0] ?? null;
}

async function rollDie(die) {
  const roll = await new Roll(die).evaluate();
  return roll.total;
}

async function resolveRounds(action, ctx) {
  if (action.rounds === "die") return Math.max(1, await rollDie(resolveRoundsDie(action, ctx)));
  const n = Number(action.rounds);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function roundsSuffix(env, rounds, always = false) {
  if (!always && rounds === 1) return;
  env.lines.push(i18n(rounds === 1 ? "lastsRound" : "lastsRounds", { rounds }));
}

function effectData(def, item, name, description, changes, rounds, actionKey, extraFlags = {}) {
  return {
    name,
    img: item?.img ?? "icons/svg/aura.svg",
    origin: item?.uuid,
    duration: { rounds: rounds ?? 1, startRound: game.combat?.round ?? 0 },
    changes: changes ?? [],
    description,
    flags: { [MODULE_ID]: { effectKey: `engine.${def.id}.${actionKey}`, sourceItem: item?.id, ...extraFlags } }
  };
}

async function replaceEffect(targetActor, def, data) {
  const existing = targetActor.effects.find(e =>
    e.flags?.[MODULE_ID]?.effectKey === data.flags[MODULE_ID].effectKey && e.origin === data.origin
  );
  if (existing) await targetActor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
  await gateEffect(targetActor, data, { name: def.name, color: def.color });
}

const ALL_DAMAGE_TYPES = [
  "bludgeoning", "piercing", "slashing", "fire", "cold", "lightning",
  "acid", "poison", "necrotic", "radiant", "psychic", "thunder", "force"
];

const STAT_BUILDERS = {
  "ac-bonus": () => ({ changes: [{ key: "system.attributes.ac.bonus", type: "add", value: "2", priority: 20 }], descKey: "statAcBonus", data: {} }),
  "ac-penalty": () => ({ changes: [{ key: "system.attributes.ac.bonus", type: "add", value: "-2", priority: 20 }], descKey: "statAcPenalty", data: {} }),
  "speed-half": (targetActor) => ({ changes: [{ key: speedKey(targetActor), type: "multiply", value: "0.5", priority: 20 }], descKey: "statSpeedHalf", data: {} }),
  "speed-zero": (targetActor) => ({ changes: [{ key: speedKey(targetActor), type: "override", value: "0", priority: 30 }], descKey: "statSpeedZero", data: {} }),
  "disadv-attack": () => ({ changes: [{ key: "flags.midi-qol.disadvantage.attack.all", type: "override", value: "1", priority: 20 }], descKey: "statDisadvAttack", data: {} }),
  "disadv-check": () => ({ changes: [
    ...midiDisadvCheckChanges(),
    // handle per-ability in core
    ...["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1", priority: 20 }))
  ], descKey: "statDisadvCheck", data: {} }),
  // action economy has no core dnd5e equivalent; midi-qol honors these flags
  "deny-bonus": () => ({ changes: midiDenyBonusChanges(), descKey: "statDenyBonus", data: {} }),
  "deny-reaction": () => ({ changes: midiDenyReactionChanges(), descKey: "statDenyReaction", data: {} }),
  // writes to whichever initiative flag is live
  "init-adv": () => dnd5eVersionAtLeast(5, 1)
    ? { changes: [{ key: "system.attributes.init.roll.mode", type: "add", value: "1", priority: 20 }], descKey: "statInitAdv", data: {} }
    : { changes: [{ key: "flags.dnd5e.initiativeAdv", type: "override", value: "1", priority: 20 }], descKey: "statInitAdv", data: {} },
  "resist-all": (targetActor) => {
    const current = Array.from(targetActor.system.traits?.dr?.value ?? []);
    const toAdd = ALL_DAMAGE_TYPES.filter(t => !current.includes(t));
    return {
      changes: toAdd.map(t => ({ key: "system.traits.dr.value", type: "add", value: t, priority: 20 })),
      descKey: "statResistAll",
      data: {}
    };
  }
};

// the narration composer needs the label without an actor to build it from
export function statNarrationKey(stat) {
  return STAT_BUILDERS[stat]?.({ system: {} })?.descKey ?? null;
}

const PRIMITIVES = {
  async move(action, token, ctx, env) {
    const anchor = ctx.attackerToken && token.id !== ctx.attackerToken.id ? ctx.attackerToken : ownerToken(ctx);
    const reference = token.id === anchor?.id ? (ctx.targetToken ?? ctx.attackerToken) : anchor;
    if (!reference || reference.id === token.id) return;
    const rolled = await rollDie(resolveDie(action, ctx));
    const feet = rolled * 5;
    const reachable = findReachableCells(token, feetToSceneDistance(feet));
    const cell = action.dir === "toward"
      ? findBestCellTowardTarget(reachable, reference.center)
      : findBestCellAwayFrom(reachable, reference.center, token.center);
    const distance = cell ? Math.round(sceneDistanceToFeet(cell.cost) * 10) / 10 : 0;
    if (!cell || distance <= 0) {
      env.lines.push(i18n("moveBlocked", { name: token.name }));
      return;
    }
    const key = action.dir === "toward" ? "pulled" : "pushed";
    await gateMove(token, cell, { name: env.def.name, color: env.def.color, icon: env.item?.img, verb: key, distance });
    env.lines.push(i18n(key, { name: token.name, distance }));
  },

  async stat(action, token, ctx, env) {
    const targetActor = token.actor;
    const rounds = await resolveRounds(action, ctx);
    if (action.stat === "temp-hp") {
      const total = await rollDie(resolveDie(action, ctx));
      const current = targetActor.system.attributes?.hp?.temp ?? 0;
      if (total > current) await gateDocUpdate(targetActor, { "system.attributes.hp.temp": total }, { name: env.def.name, color: env.def.color, icon: env.item?.img });
      env.lines.push(i18n("tempHp", { name: token.name, total: Math.max(total, current) }));
      return;
    }
    if (action.stat === "speed-penalty") {
      const total = await rollDie(resolveDie(action, ctx));
      const penalty = feetToActorUnits(targetActor, total * 5);
      const floor = feetToActorUnits(targetActor, 5);
      const currentSpeed = movementSpeed(targetActor) ?? feetToActorUnits(targetActor, 30);
      const actual = Math.max(0, Math.min(penalty, currentSpeed - floor));
      await replaceEffect(targetActor, env.def, effectData(
        env.def, env.item,
        env.def.name,
        i18n("statSpeedPenaltyDesc", { penalty: actorUnitsToFeet(targetActor, actual), rune: env.def.name }),
        [{ key: speedKey(targetActor), type: "add", value: `-${actual}`, priority: 20 }],
        rounds,
        "stat.speed-penalty"
      ));
      env.lines.push(i18n("statSpeedPenalty", { name: token.name, penalty: actorUnitsToFeet(targetActor, actual) }));
      roundsSuffix(env, rounds, true);
      return;
    }
    const builder = STAT_BUILDERS[action.stat];
    if (!builder) return;
    const built = builder(targetActor);
    await replaceEffect(targetActor, env.def, effectData(
      env.def, env.item,
      env.def.name,
      i18n(`${built.descKey}Desc`, { rune: env.def.name }),
      built.changes,
      rounds,
      `stat.${action.stat}`
    ));
    env.lines.push(i18n(built.descKey, { name: token.name }));
    roundsSuffix(env, rounds, true);
  },

  async damage(action, token, ctx, env) {
    let total = await rollDie(resolveDie(action, ctx));
    const dmgMeta = { name: env.def.name, color: env.def.color, icon: env.item?.img };
    if (action.kind === "heal") {
      await gateDamage(token, total, { multiplier: -1 }, dmgMeta);
      env.lines.push(i18n("healed", { name: token.name, total }));
      return;
    }
    if (env.halved) total = Math.floor(total / 2);
    if (total <= 0) return;
    // let resistances and immunities apply to the damage
    await gateDamage(token, action.dtype ? [{ value: total, type: action.dtype }] : [{ value: total }], {}, dmgMeta);
    const typeCfg = CONFIG.DND5E?.damageTypes?.[action.dtype];
    const dtype = typeCfg ? game.i18n.localize(typeCfg.label ?? typeCfg) : action.dtype;
    env.lines.push(i18n(env.halved ? "damagedHalf" : "damaged", { name: token.name, total, type: dtype }));
  },

  async status(action, token, ctx, env) {
    await gateStatus(token.actor, action.status, { name: env.def.name, color: env.def.color, icon: env.item?.img });
    const label = CONFIG.statusEffects?.find(s => s.id === action.status)?.name;
    env.lines.push(i18n("status", { name: token.name, status: label ? game.i18n.localize(label) : action.status }));
  },

  async reminder(action, token, ctx, env) {
    const rounds = await resolveRounds(action, ctx);
    await replaceEffect(token.actor, env.def, effectData(
      env.def, env.item, env.def.name, action.text, [], rounds, `reminder.${env.actionIndex}`
    ));
    env.lines.push(i18n("reminder", { name: token.name, text: action.text }));
    roundsSuffix(env, rounds);
  },

  async brand(action, token, ctx, env) {
    const die = resolveDie(action, ctx);
    await replaceEffect(token.actor, env.def, effectData(
      env.def, env.item, env.def.name,
      i18n("brandDesc", { die, rune: env.def.name }),
      [], 1, `brand.${env.actionIndex}`, { brandDie: die }
    ));
    env.lines.push(i18n("brand", { name: token.name, die }));
  },

  async contagion(action, token, ctx, env) {
    const rounds = await resolveRounds(action, ctx);
    const spreadAffects = action.target === "enemies" ? "enemies"
      : action.target === "allies" ? "allies"
      : (action.affects ?? "all");
    await replaceEffect(token.actor, env.def, effectData(
      env.def, env.item, env.def.name,
      i18n("contagionDesc", { rune: env.def.name, die: resolveDie(action, ctx) }),
      [], rounds,
      `contagion.${env.actionIndex}`,
      {
        contagionDie: resolveDie(action, ctx),
        contagionDc: action.dc ?? 13,
        contagionAbility: action.ability ?? "con",
        contagionStatus: action.status ?? "poisoned",
        contagionAffects: spreadAffects
      }
    ));
    env.lines.push(i18n("contagion", { name: token.name }));
    roundsSuffix(env, rounds);
  },

  async allyDash(action, token, ctx, env) {
    const owner = ownerToken(ctx);
    const target = ctx.targetToken;
    if (!owner || !target || !canvas?.tokens) return false;
    const radius = Number(action.radius) || 30;
    const feet = (await rollDie(resolveDie(action, ctx))) * 5;
    const maxSceneDistance = feetToSceneDistance(feet);
    const allies = canvas.tokens.placeables.filter(t =>
      t.actor && t !== owner && areAllies(owner, t) && withinFeet(owner, t, radius)
    );
    if (!allies.length) {
      env.lines.push(i18n("allyDashNone", { distance: feet }));
      return;
    }
    let ally = allies[0];
    if (allies.length > 1) {
      const options = allies.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
      const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: env.def.name },
        content: `<p>${i18n("allyDashPick", { distance: feet })}</p><select name="ally" style="width:100%;margin-top:4px">${options}</select>`,
        buttons: [
          { action: "confirm", label: game.i18n.localize(`${MODULE_ID}.common.confirm`), default: true, callback: (event, button) => button.form.elements.ally.value },
          { action: "cancel", label: game.i18n.localize(`${MODULE_ID}.common.cancel`), callback: () => null }
        ],
        rejectClose: false
      });
      if (!picked) return false;
      ally = canvas.tokens.get(picked) ?? ally;
    }
    const reachable = findReachableCells(ally, maxSceneDistance);
    const best = findBestCellTowardTarget(reachable, target.center);
    const movedFeet = Math.round(sceneDistanceToFeet(best.cost) * 10) / 10;
    if (movedFeet > 0) await gateMove(ally, best, { name: env.def.name, color: env.def.color, icon: env.item?.img, verb: "moved", distance: movedFeet });
    env.lines.push(i18n(movedFeet > 0 ? "allyDashMoved" : "allyDashBlocked", {
      ally: ally.name, target: target.name, distance: movedFeet > 0 ? movedFeet : feet
    }));
  },

  async guardianRush(action, token, ctx, env) {
    const wearer = ownerToken(ctx);
    const ally = ctx.targetToken;
    const attacker = ctx.attackerToken;
    if (!wearer || !ally || !attacker?.actor || !game.combat) return false;
    const walk = actorSpeedInSceneUnits(ctx.actor);
    if (measureDist(wearer, ally) > walk) return false;
    // manual mode consents via the deferred cards instead
    const confirmed = isManualMode() ? true : await foundry.applications.api.DialogV2.confirm({
      window: { title: env.def.name },
      content: `<p>${i18n("guardianRushConfirm", { actor: wearer.name, ally: ally.name })}</p>`,
      rejectClose: false
    });
    if (!confirmed) return false;
    const reachable = findReachableCells(wearer, walk);
    const { cell, isAdjacent } = findBestAdjacentCell(reachable, ally, attacker);
    if (cell.cost === 0 && !isAdjacent) {
      ui.notifications.warn(i18n("guardianRushNoPath", { name: wearer.name }));
      return false;
    }
    if (cell.cost > 0) await gateMove(wearer, cell, { name: env.def.name, color: env.def.color, icon: env.item?.img, verb: "moved", distance: Math.round(sceneDistanceToFeet(cell.cost) * 10) / 10 });
    if (!isAdjacent) {
      env.lines.push(i18n("guardianRushPartial", { name: wearer.name, ally: ally.name }));
      return;
    }
    await replaceEffect(attacker.actor, env.def, effectData(
      env.def, env.item, env.def.name,
      i18n("statDisadvAttackDesc", { rune: env.def.name }),
      [{ key: "flags.midi-qol.disadvantage.attack.all", type: "override", value: "1", priority: 20 }],
      1,
      `guardianRush.${env.actionIndex}`
    ));
    env.lines.push(i18n("guardianRush", { name: wearer.name, ally: ally.name, attacker: attacker.name }));
  },

  async cloud(action, token, ctx, env) {
    const center = ctx.targetToken?.center ?? ownerToken(ctx)?.center;
    if (!center || !canvas?.scene) return;
    const templateData = {
      t: "circle", user: game.user.id, x: center.x, y: center.y, distance: feetToSceneDistance(7.5),
      fillColor: env.def.color ?? "#8B8000",
      flags: {
        [MODULE_ID]: {
          clusterEffect: "runeCloud",
          runeId: env.def.id,
          runeName: env.def.name,
          damageDie: resolveDie(action, ctx),
          dc: action.dc ?? env.def.save?.dc ?? 13,
          ability: action.ability ?? env.def.save?.ability ?? "con",
          status: action.status ?? null,
          affects: action.affects ?? "all",
          ownerActorId: ctx.actor?.id ?? null,
          roundsRemaining: action.rounds ?? 3,
          lastRound: game.combat?.round ?? 0
        }
      }
    };
    await gateTemplate(canvas.scene, templateData, { name: env.def.name, color: env.def.color, icon: env.item?.img }, !!action.immediate);
    env.lines.push(i18n("cloud", { rune: env.def.name }));
  },

  async light(action, token, ctx, env) {
    const prev = foundry.utils.deepClone(token.document.light?.toObject?.() ?? {});
    await gateDocUpdate(token.document, { light: { bright: feetToSceneDistance(20), dim: feetToSceneDistance(40) } }, { name: env.def.name, color: env.def.color, icon: env.item?.img });
    await replaceEffect(token.actor, env.def, effectData(
      env.def, env.item, env.def.name,
      i18n("lightDesc", { rune: env.def.name }),
      [], 1,
      `light.${env.actionIndex}`,
      { lightPrev: { bright: prev.bright ?? 0, dim: prev.dim ?? 0 }, lightTokenId: token.id }
    ));
    env.lines.push(i18n("light", { name: token.name, radius: 20 }));
  },

  async teleport(action, token, ctx, env) {
    const reference = ctx.targetToken?.id === token.id ? ownerToken(ctx) : (ctx.targetToken ?? ctx.attackerToken);
    if (!reference || reference.id === token.id) return;
    const dir = teleportDir(action.dir, action.target);
    const angle = dir === "toward"
      ? angleBetween(token.center, reference.center)
      : angleBetween(reference.center, token.center);
    const squares = gridSquaresForFeet(teleportFeet(action.distance));
    const dest = computeBlinkDestination(token, angle, squares);
    if (dest.squares === 0) {
      env.lines.push(i18n("teleportBlocked", { name: token.name }));
      return;
    }
    const teleportDistance = dest.squares * feetPerGridSquare();
    await gateMove(token, dest, { name: env.def.name, color: env.def.color, icon: env.item?.img, verb: "teleport", distance: teleportDistance });
    env.lines.push(i18n(dir === "toward" ? "teleportToward" : "teleportAway", { name: token.name, distance: teleportDistance }));
  }
};

export function onEngineEffectDeleted(effect) {
  const flags = effect.flags?.[MODULE_ID];
  if (!flags?.lightPrev || !flags.lightTokenId) return;
  const token = canvas?.tokens?.get(flags.lightTokenId);
  if (token) token.document.update({ light: flags.lightPrev }).catch(() => {});
}

async function rollSaveGate(def, ctx) {
  if (def.save.critAutoFails && ctx.isCritical) return { rolled: true, saved: false };
  const saver = resolveSaver(def.save.who, ctx);
  if (!saver?.actor) return { rolled: false, saved: false };
  const flavor = i18n("saveFlavor", { rune: def.name, dc: def.save.dc });
  const total = await rollSave(saver.actor, def.save.ability, def.save.dc, flavor);
  return { rolled: true, saved: total >= def.save.dc, saverName: saver.name };
}

async function runActionsAndFinish(def, item, ctx, actor, saved, saveRolled, saverName, skipMarkUse = false) {
  const env = { def, item, halved: false, lines: [] };
  let fired = false;
  let actionIndex = -1;

  for (const action of def.actions ?? []) {
    actionIndex++;
    if (action.type === "scripted") {
      const fn = _scripted[action.key];
      if (fn) {
        await fn(ctx);
        fired = true;
      } else {
        console.warn(`[${MODULE_ID}] no scripted handler registered for "${action.key}"; rune "${def.name}" did nothing`);
      }
      continue;
    }
    const gate = saveRolled ? (action.onSave ?? "negate") : "full";
    if (saved && gate === "negate") continue;
    env.halved = saved && gate === "half";
    env.actionIndex = actionIndex;
    const meta = ACTION_TYPES[action.type];
    const fn = PRIMITIVES[action.type];
    if (!meta || !fn) continue;
    const targets = meta.point ? [null] : resolveRole(action.target, ctx, action.radius);
    for (const token of targets) {
      if (!meta.point && !token?.actor) continue;
      if (await fn(action, token, ctx, env) !== false) fired = true;
    }
  }

  if (saveRolled && saved && env.lines.length === 0 && saverName) {
    env.lines.push(i18n("resisted", { name: saverName, rune: def.name }));
  }

  if (env.lines.length) {
    ChatMessage.create({
      speaker: { actor },
      content: `<strong>${def.name}</strong>: ${env.lines.join(" ")}`
    });
  }

  if (!skipMarkUse && (fired || env.lines.length)) await markUse(def, actor);
}

export async function resumeAfterSave(def, ctx, saved, saverName, opts) {
  const actor = ctx.item?.actor ?? ctx.actor;
  if (!actor) return;
  await runActionsAndFinish(def, ctx.item, ctx, actor, saved, true, saverName, true);
}

registerSaveResume(resumeAfterSave);

export async function executeRune(def, item, ctx, opts = {}) {
  // bail cleanly on invalid stored data
  const check = validateRuneDef(def);
  if (!check.ok) {
    console.warn(`[${MODULE_ID}] rune "${def?.name ?? def?.id ?? "?"}" failed validation and was skipped:`, check.errors.map(formatValidationError));
    ui.notifications.warn(i18n("misconfigured", { name: def?.name ?? def?.id ?? "?" }));
    return;
  }

  const actor = item?.actor ?? ctx.actor;
  if (!actor) return;
  if (!checkUseLimit(def, actor)) return;

  const combo = ctx.combo ?? null;
  const skipSave = opts.skipSave === true
    || (combo && Array.isArray(combo.skipSaveFor) && combo.skipSaveFor.includes(def.id));

  // manual mode defers every action behind a save card
  if (def.save && !skipSave && isManualMode()) {
    await markUse(def, actor);
    await gateSaveCard(def, item, ctx, { name: def.name, color: def.color, icon: item?.img }, opts);
    return;
  }

  let saved = false;
  let saveRolled = false;
  let saverName = null;
  if (def.save && !skipSave) {
    const outcome = await rollSaveGate(def, ctx);
    saved = outcome.saved;
    saveRolled = outcome.rolled;
    saverName = outcome.saverName ?? null;
  }

  await runActionsAndFinish(def, item, ctx, actor, saved, saveRolled, saverName);
}

export function triggerMatches(defTrigger, ctx) {
  if (defTrigger === ctx.trigger) return true;
  return defTrigger === "onHit" && ctx.trigger === "onCrit";
}

export async function dispatchDefs(defs, item, ctx) {
  const comboFired = new Set();
  // hit resolves before crit for combo timing
  const ordered = [...defs].sort((a, b) => Number(a.trigger === "onCrit") - Number(b.trigger === "onCrit"));
  for (const def of ordered) {
    if (!triggerMatches(def.trigger, ctx)) continue;
    await executeRune(def, item, ctx);
    const combo = ctx.combo;
    if (combo && !combo.id?.startsWith?.("custom-combo.")) continue;
    if (combo && combo.runes.includes(def.id) && !comboFired.has(combo.id) && Array.isArray(combo.extraActions) && combo.extraActions.length) {
      comboFired.add(combo.id);
      await executeRune({
        id: combo.id,
        name: combo.name,
        color: combo.color,
        trigger: def.trigger,
        save: null,
        uses: null,
        actions: combo.extraActions
      }, item, ctx);
    }
  }
}

export async function applyCloudTick(template) {
  if (!template) return;
  const flags = template.document.flags?.[MODULE_ID] ?? {};
  const ownerTok = flags.ownerActorId
    ? canvas.tokens.placeables.find(t => t.actor?.id === flags.ownerActorId) : null;
  const hostileToOwner = t => (ownerTok ? areEnemies(ownerTok, t) : tokenSide(t) === "hostile");
  const affected = canvas.tokens.placeables.filter(t =>
    t.actor && t.actor.id !== flags.ownerActorId &&
    (flags.affects !== "enemies" || hostileToOwner(t)) &&
    measureDist(template.center, t.center) <= template.document.distance
  );
  for (const token of affected) {
    const total = await rollSave(token.actor, flags.ability ?? "con", flags.dc ?? 13,
      i18n("saveFlavor", { rune: flags.runeName ?? "?", dc: flags.dc ?? 13 }));
    if (total < (flags.dc ?? 13)) {
      const dmg = await rollDie(flags.damageDie ?? "1d4");
      const tickMeta = { name: flags.runeName ?? "?" };
      await gateDamage(token, [{ value: dmg }], {}, tickMeta);
      if (flags.status) await gateStatus(token.actor, flags.status, tickMeta);
      ChatMessage.create({
        speaker: { actor: token.actor },
        content: i18n("cloudTick", { name: token.name, total: dmg, rune: flags.runeName ?? "?" })
      });
    }
  }
}

export async function tickRuneClouds(currentToken) {
  if (!canvas?.templates) return;
  const templates = canvas.templates.placeables.filter(t =>
    t.document.flags?.[MODULE_ID]?.clusterEffect === "runeCloud"
  );
  for (const template of templates) {
    const flags = template.document.flags[MODULE_ID];
    if (currentToken && measureDist(currentToken.center, template.center) <= template.document.distance) {
      await applyCloudTick(template);
    }
    const round = game.combat?.round ?? 0;
    if (round !== flags.lastRound) {
      const remaining = (flags.roundsRemaining ?? 3) - 1;
      if (remaining <= 0) {
        await template.document.delete().catch(() => {});
      } else {
        await template.document.update({
          [`flags.${MODULE_ID}.roundsRemaining`]: remaining,
          [`flags.${MODULE_ID}.lastRound`]: round
        });
      }
    }
  }
}

export { getActiveComboMerged, getCustomCombos };
