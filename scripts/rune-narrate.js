import { dnd5eDisplayDistance } from "./utils.js";
import { statNarrationKey, triggerMatches } from "./rune-engine.js";
import { ACTION_TYPES, teleportDir, teleportFeet } from "./rune-defs.js";

const MODULE_ID = "gm-runic-items";

// mirrors the engine helper so narrated lines match live ones
function engine(key, data) {
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

function narrate(key, data) {
  if (!data) return game.i18n.localize(`${MODULE_ID}.narrate.${key}`);
  const out = { ...data };
  if (typeof out.radius === "number") {
    const shown = dnd5eDisplayDistance(out.radius);
    out.radius = shown.value;
    out.unit = shown.unit;
  }
  return game.i18n.format(`${MODULE_ID}.narrate.${key}`, out);
}

async function rollTotal(die) {
  const roll = await new Roll(die).evaluate();
  return roll.total;
}

// singular phrasing so it agrees with the engine strings
function whoLabel(role, ctx, radius) {
  if (role === "self") return ctx.actor?.name ?? narrate("who.self");
  if (role === "allies" || role === "enemies" || role === "area") {
    return narrate(`who.${role}`, { radius: Number(radius) || 15 });
  }
  return narrate(`who.${role}`);
}

async function resolveRounds(action, die) {
  if (action.rounds === "die") return Math.max(1, await rollTotal(die));
  const n = Number(action.rounds);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function roundsLine(rounds, always = false) {
  if (!always && rounds === 1) return null;
  return engine(rounds === 1 ? "lastsRound" : "lastsRounds", { rounds });
}

async function describeAction(action, ctx, def) {
  const die = ctx.die;
  const name = whoLabel(action.target, ctx, action.radius);
  const lines = [];

  switch (action.type) {
    case "move": {
      const distance = (await rollTotal(die)) * 5;
      lines.push(engine(action.dir === "toward" ? "pulled" : "pushed", { name, distance }));
      break;
    }
    case "stat": {
      const rounds = await resolveRounds(action, die);
      if (action.stat === "temp-hp") {
        lines.push(engine("tempHp", { name, total: await rollTotal(die) }));
        break;
      }
      if (action.stat === "speed-penalty") {
        lines.push(engine("statSpeedPenalty", { name, penalty: (await rollTotal(die)) * 5 }));
        const r = roundsLine(rounds, true);
        if (r) lines.push(r);
        break;
      }
      const key = statNarrationKey(action.stat);
      if (!key) break;
      lines.push(engine(key, { name }));
      const r = roundsLine(rounds, true);
      if (r) lines.push(r);
      break;
    }
    case "damage": {
      const total = await rollTotal(die);
      if (action.kind === "heal") {
        lines.push(engine("healed", { name, total }));
        break;
      }
      const cfg = CONFIG.DND5E?.damageTypes?.[action.dtype];
      const type = cfg ? game.i18n.localize(cfg.label ?? cfg) : (action.dtype ?? "");
      lines.push(engine("damaged", { name, total, type }));
      break;
    }
    case "status": {
      const label = CONFIG.statusEffects?.find(s => s.id === action.status)?.name;
      lines.push(engine("status", { name, status: label ? game.i18n.localize(label) : action.status }));
      break;
    }
    case "reminder": {
      const rounds = await resolveRounds(action, die);
      lines.push(engine("reminder", { name, text: action.text ?? "" }));
      const r = roundsLine(rounds);
      if (r) lines.push(r);
      break;
    }
    case "brand":
      lines.push(engine("brand", { name, die }));
      break;
    case "contagion": {
      const rounds = await resolveRounds(action, die);
      lines.push(engine("contagion", { name }));
      lines.push(narrate("contagionSave", {
        dc: action.dc ?? 13,
        ability: String(action.ability ?? "con").toUpperCase()
      }));
      const r = roundsLine(rounds);
      if (r) lines.push(r);
      break;
    }
    case "cloud":
      lines.push(engine("cloud", { rune: def.name }));
      break;
    case "light":
      lines.push(engine("light", { name, radius: 20 }));
      break;
    case "teleport": {
      const dir = teleportDir(action.dir, action.target);
      lines.push(narrate(`teleport.${dir}`, { name, radius: teleportFeet(action.distance) }));
      break;
    }
    case "allyDash":
      lines.push(narrate("allyDash", {
        radius: Number(action.radius) || 30,
        distance: dnd5eDisplayDistance((await rollTotal(die)) * 5).value,
        unit: dnd5eDisplayDistance(5).unit
      }));
      break;
    case "guardianRush":
      lines.push(narrate("guardianRush"));
      break;
    default:
      break;
  }
  return lines;
}

// what this rune would have done with every die already rolled
export async function describeRuneOutcome(def, ctx) {
  const lines = [];
  if (def.save?.ability) {
    lines.push(narrate("saveGate", {
      who: whoLabel(def.save.who, ctx),
      dc: def.save.dc ?? 13,
      ability: String(def.save.ability).toUpperCase()
    }));
  }
  for (const action of def.actions ?? []) {
    if (action.type === "scripted") {
      const desc = def.description ? String(def.description).replace(/\{die\}/g, ctx.die ?? "") : null;
      lines.push(desc || narrate("scripted", { rune: def.name }));
      continue;
    }
    if (!ACTION_TYPES[action.type]) continue;
    lines.push(...await describeAction(action, ctx, def));
  }
  return lines;
}

// post one card describing every rune that would have fired for manual resolution
export async function narrateUntargeted(defs, item, ctx) {
  const matched = (defs ?? []).filter(d => triggerMatches(d.trigger, ctx));
  if (!matched.length) return;

  const blocks = [];
  for (const def of matched) {
    const lines = await describeRuneOutcome(def, ctx);
    if (!lines.length) continue;
    blocks.push(`<p class="runic-narrate-line"><strong>${def.name}</strong>: ${lines.join(" ")}</p>`);
  }
  if (!blocks.length) return;

  await ChatMessage.create({
    speaker: { actor: ctx.actor },
    content:
      `<div class="runic-narrate-card chat-card">` +
      `<p class="runic-narrate-head">${narrate("header", { item: item?.name ?? "" })}</p>` +
      blocks.join("") +
      `</div>`
  });
}
