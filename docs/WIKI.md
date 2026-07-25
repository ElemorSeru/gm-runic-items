# GM Tools: Upgradable Runic Items

## Table of Contents

1. [The Solvarian Runecraft Panel](#the-solvarian-runecraft-panel)
2. [Runic Power](#runic-power)
3. [Runic Empowerment](#runic-empowerment)
4. [Runic Legacy](#runic-legacy)
5. [Combo Runes](#combo-runes)
6. [Rarity System](#rarity-system)
7. [Rune Presets](#rune-presets)
8. [Visual Indicators](#visual-indicators)
9. [Settings and Access Control](#settings-and-access-control)
10. [Runeforge - Custom Runes](#runeforge---custom-runes)
11. [Tips and Common Questions](#tips-and-common-questions)
12. [Requirements and Compatibility](#requirements-and-compatibility)

---

## The Solvarian Runecraft Panel

The Solvarian Runecraft panel appears in the **Details** tab of any weapon or armor item sheet. It has three sections:

- **Runic Power** - sockets for active combat runes (up to 3)
- **Runic Empowerment** - sockets for ability score boosts (up to 5)
- **Runic Legacy** - sockets for a feat and a spell

Click any empty socket to open the picker for that slot. Click a filled socket to change it. The panel is read-only when the sheet is not in edit mode, or when the user's role is below the configured minimum in settings.

The **rarity badge** in the panel header updates automatically and shows the item's current runic tier based on how many slots are filled.

Items must be **equipped** to activate rune effects. Items requiring attunement must also be attuned.

---

## Runic Power

Each item can hold up to **3 power runes**. The available runes depend on the item type: melee weapons, ranged weapons, and armor each have their own pool. No rune can appear twice on the same item.

Effects fire through Foundry's hook system. No macros or manual steps are needed.

A few effects impose disadvantage on attack rolls (Burntrace, Vanguard's Guardian's Rush, and the Crystal Anchor combo). Core dnd5e cannot automate attack-roll disadvantage, so these are applied through a midi-qol flag. With midi-qol installed the disadvantage is enforced automatically; without it, the effect still appears on the target as a reminder for you to apply by hand. Mirageward and Wardpulse/Ironwall use the same pattern for opportunity-attack and bonus-action denial. See [Requirements and Compatibility](#requirements-and-compatibility).

All rune and combo damage is applied as typed damage, so target resistance, vulnerability, and immunity apply normally.

### Melee Runes

**Stonecleft** - On a hit, the target makes a DC 13 Strength save or is pushed `{die}`x5 ft away and has their movement halved for 1 round. On a critical hit, they automatically fail the save.

**Mirageward** - On a hit, the target loses the ability to make opportunity attacks until the start of your next turn.

**Emberbrand** - On a critical hit, the target is branded with ember fire. Until the start of your next turn, allies who hit the target deal an extra `{die}` radiant damage.

**Sandgrasp** - On a hit, the target makes a DC 15 Strength save or their speed is reduced by `{die}`x5 ft until the end of their next turn.

**Ruinmark** - On a hit, the target's AC is reduced by 2 for `{die}` rounds.

**Forgebell** - On a hit, one ally within 30 ft may use their reaction to move up to `{die}`x5 ft toward the target.

### Ranged Runes

**Burntrace** - On a hit, the target suffers disadvantage on attack rolls for 1 round.

**Sandhold** - On a hit, the target's movement speed is reduced by `{die}`x5 ft for 1 round.

**Ashcloud** - On a hit, a cloud of ash erupts at the impact point. Creatures in the cloud make a DC 14 Constitution save or are poisoned and take `{die}` poison damage. Only hostile NPC tokens are checked automatically; allied and player tokens in the cloud are left for you to resolve.

**Undertow** - On a hit, the target is pulled `{die}`x5 ft toward the impact point.

**Scorcheye** - On a hit, the target cannot benefit from cover or invisibility until the start of your next turn.

**Wasteblight** - On a hit, rift corruption spreads through the target. While the target is poisoned, hostile creatures ending their turn adjacent to them make a DC 13 Constitution save or become poisoned and take `{die}` poison damage. Only hostile NPC tokens are checked automatically; allied and player tokens adjacent to the target are left for you to resolve.

### Armor Runes

**Emberveil** - Grants a passive AC bonus based on runic rarity (see Rarity System). When struck by a melee attack, the attacker is pushed `{die}`x5 ft directly away and cannot re-enter your space until the start of their next turn.

**Stonewarden** - When the wearer drops below half HP, the rune flares and restores `{die}` HP. It also flares if the wearer falls prone while already below half HP. Once per combat.

**Vanguard** - When an ally is struck by a melee attack, the wearer may use their reaction to move adjacent to that ally. The attacker suffers disadvantage on all attacks until the end of the round.

**Wardpulse** - When struck by a melee attack, the attacker makes a DC 14 Constitution save or loses their bonus action until the end of their next turn. Once per round.

**Forgeshield** - When struck by a melee attack, allies within 10 ft of the wearer gain +2 AC for 2 rounds.

**Ashen Mantle** - When the wearer drops to or below half HP for the first time, they gain resistance to all damage types for 1 round and cannot be moved or knocked prone while the resistance is active. Once per rest.

### The Effect Die (`{die}`)

Many rune descriptions reference `{die}`. This die is determined by the item's runic rarity:

| Rarity | Die |
|--------|-----|
| Common | 1d4 |
| Uncommon | 1d4 |
| Rare | 1d6 |
| Very Rare | 1d8 |
| Legendary | 1d10 |

---

## Runic Empowerment

Up to **5 empowerment slots** can be filled. Each slot boosts one ability score by +1. The same stat can be chosen multiple times:

| Inscriptions of same stat | Total Bonus |
|--------------------------|-------------|
| 1 | +1 |
| 2 | +2 |
| 3 | +3 |
| 4 | +4 |
| 5 | +5 |

**Stat cap:** No stat can be pushed above 30. The picker hides any option that would exceed this limit for the actor currently holding the item. This check runs at selection time. Items moved between actors or configured via presets may still produce situations that go over the cap, which the crack indicator flags for user with sufficient right to resolve manually.

Available stats: STR, DEX, CON, INT, WIS, CHA

The empowerment boost is applied as an ActiveEffect on the actor and updates automatically as slots change.

---

## Runic Legacy

Two legacy slots allow inscribing a **feat** and a **spell** from any compendium loaded in the world. On equip (and attunement if required), the feat or spell is granted as an item directly on the actor's sheet, labeled with the source item's name in parentheses for convenience.

### Using the Legacy Picker

The legacy picker searches across all loaded Item compendiums. On first use per session, you may see a brief "Loading compendium data..." message while it **lazy-loads** the list; subsequent opens are instant.

Type to filter. Results show the item's icon, name, and level (for spells). Click to inscribe that option into the slot.

### Removing a Legacy Grant

Clearing the legacy slot from the picker removes the granted feat or spell from the actor.

### Conflicts

If another equipped runic item on the same actor has already granted the same feat or spell, a crack indicator appears on the legacy section of both items explaining which item already holds the grant. The grant still applies but the conflict is flagged for the user of sufficient rights to resolve.

---

## Combo Runes

When all three power slots are filled with a specific trio of runes, a **combo** activates. A fourth slot appears in the power section with a cool animation. The socket etches itself into existence, then the glyph draws in. The combo slot is non-clickable, display-only, and does not contribute to rarity but it does grant combo abilities/features.

Hover the combo slot to see its name and effect description.

Removing any of the three paired runes dissolves the combo slot and you lose that boon.

### Melee Combos

**Ember Surge** - Emberbrand + Ruinmark + Forgebell
On an Emberbrand crit, Ruinmark's AC crack applies to all attacks while the target burns and Forgebell calls all nearby allies forward at once.

**Rift Break** - Stonecleft + Sandgrasp + Mirageward
When Stonecleft lands, Sandgrasp triggers with no save and Mirageward shields the entire party from opportunity attacks for the round.

### Ranged Combos

**Crystal Anchor** - Undertow + Sandhold + Burntrace
Undertow's pull triggers Sandhold automatically, dropping speed to zero. Burntrace's disorientation extends to all ability checks.

**Blight Field** - Wasteblight + Ashcloud + Scorcheye
The Ashcloud follows the blighted target as they move. Anyone in the cloud loses cover and invisibility.

### Armor Combos

**Ironwall** - Emberveil + Wardpulse + Forgeshield
Emberveil's push triggers Wardpulse with no save, and Forgeshield's AC bonus extends to all allies within 20 ft.

**Morrain's Resolve** - Vanguard + Stonewarden + Ashen Mantle
Guardian's Rush becomes a free action - the defender rushes to protect allies without spending their reaction.

---

## Rarity System

Rarity is calculated from the total number of inscribed rune slots:

- Power rune slots count **3 points** each (max 9 from 3 slots)
- Empowerment and legacy slots count **1 point** each (max 7 from 7 slots)
- Total maximum score: 16

| Rarity | Score Range |
|--------|------------|
| Common | 0 |
| Uncommon | 1-3 |
| Rare | 4-7 |
| Very Rare | 8-11 |
| Legendary | 12+ |

Armor with **Emberveil** also gains a passive AC bonus based on rarity: +1 (Uncommon/Rare), +2 (Very Rare), +3 (Legendary).

---

## Rune Presets

Presets save and restore complete rune configurations (all power, empowerment, and legacy slots as their respective entries).

### Saving a Preset

Click the **bookmark icon** in the Solvarian Runecraft panel header. A dialog asks for a name. After confirming, the bookmark icon briefly flashes with a checkmark to confirm the save.

### Loading a Preset

Click the **folder icon** in the Solvarian Runecraft panel header. The picker shows only presets compatible with the current item's type (melee, ranged, or armor). Each entry in the list displays miniature power sockets with the actual rune glyphs and a rarity badge. Click an entry to apply it to the item.

### Managing Presets

Open **Module Settings -> Rune Presets** and click the management button. The preset manager dialog lists all saved presets grouped by Melee, Ranged, and Armor, each with a delete button and a confirmation prompt. Once deleted and confirmed, it's gone.

---

## Visual Indicators

### Rarity Badge

Updates automatically in the panel header as slots are filled.

### Combo Slot

Appears with a cool animation when all three power runes form a recognized trio. Dissolves when any of the three runes is removed.

### Crack Indicator

A colored crack appears over the relevant section's slot row when something requires the user's attention:

- **Empowerment crack** - appears in the color(s) of the offending stat(s) when the current empowerment configuration would push any stat on the attached actor above 30. The message lists which stats are over cap.
- **Legacy crack** - appears in feat (gold) and/or spell (blue) when a legacy UUID can no longer be found in any loaded compendium, or when another equipped runic item has already granted the same feat or spell.

The crack disappears automatically when the issue is resolved. No page reload needed.

---

## Settings and Access Control

**Minimum Role to Edit Runes** - Controls which users can open rune pickers and change inscriptions. Setting it to Trusted grants access to Trusted Player, Assistant GM, and Game Master. Players below the threshold see the Solvarian Runecraft panel in read-only mode.

**Compendium Cache** - The legacy picker loads feat and spell compendiums on first use each session. Use Clear Cache to empty it or Refresh Cache to rebuild from currently loaded compendiums without reloading the world.

---

## Runeforge - Custom Runes

The Runeforge lets GMs and Assistant GMs build their own power runes and combos. Custom runes appear in the same pickers as built-in runes, count toward rarity the same way, and run on the same automation engine.

### Opening the Runeforge

- Click the **hammer icon** in the Solvarian Runecraft panel header
- Press the keybinding (**Ctrl+Shift+R** by default, remappable under Configure Controls)

Both entry points are visible to GMs and Assistant GMs only.

### The Rune Library

The library lists your custom runes first, then the core runes grouped by category. Core runes are locked. They ship with the module and cannot be edited or deleted. Opening a core rune shows its full configuration read-only (trigger, save, use limit, and action list) plus a banner with **Duplicate** and **Craft New Instead** buttons. Duplicate copies the rune into the editor as a working 1:1 replica (the same trigger, saving throw, use limit, and actions) ready to tweak. The one deliberate difference is that core combos never follow/link a duplicate. Combos key on the original rune ids. Custom runes can be opened for editing or deleted from their own card.

### Building a Rune

The editor walks through five steps. The live preview on the right shows the rune's socket, generated description, and rarity scaled effect die as you build.

**1. Identity** - name, category (melee, ranged, or armor), color, and glyph. Pick a glyph from the palette, or click **Browse SVG File** to import one from any SVG in your data folders. Imports offer two modes: *Path Extraction* (a recolorable stroke that keeps the draw-in inscription animation, best for line-art icons) and *Silhouette Tint* (the shape filled with the rune color, works for complex art). The **Cursed** checkbox conceals the rune's true name and description from players until the item is identified. Armor runes also offer **Passive AC**, which grants the item's rarity-based AC bonus while equipped, the way Emberveil does.

**2. Trigger** - when the rune fires. Triggers are filtered by category:

| Trigger | Category | Fires |
|---------|----------|-------|
| On Hit | Weapons | Whenever the weapon's attack hits (including crits) |
| On Critical Hit | Weapons | Only on a critical hit |
| On Miss | Weapons | When the weapon's attack misses (fumbles count as misses) |
| On Kill | Weapons | When the weapon reduces a target to 0 HP |
| On Spell Cast | Weapons | When the wielder casts a spell |
| When Struck | Armor | When the wearer is hit by a melee attack |
| When Missed | Armor | When a melee attack misses the wearer |
| Below Half HP | Armor | When damage drops the wearer below half HP |
| Concentration Ends | Armor | When the wearer's concentration ends |
| Enemy Approach | Armor | When an enemy first moves within 10 ft of the wearer |
| Ally Struck | Armor | When an ally in combat is struck by a melee attack |
| When Prone | Armor | When the wearer is knocked prone |
| Combat Start | All | Once for the owner when combat begins |
| Turn Start Aura | All | At the start of the owner's turn |
| Turn End Aura | All | At the end of the owner's turn |

**3. Saving Throw Gate** - optionally let a saving throw resist the rune. Choose who saves (the options depend on the trigger (the struck target, the attacker, or the wielder/wearer which is how cursed self-harming items are built), the ability, and the DC (5-30). "Critical hits automatically fail the save" mirrors how Stonecleft works.

**4. Use Limit** - unlimited, once per round, once per combat, or once per rest. Round and combat limits reset when the combat ends; all limits reset on a rest.

**5. Actions** - what the rune does, executed top to bottom (reorder with the arrows). Each action picks its target from the roles the trigger provides. Allies, enemies, and area targets choose a radius around the owner (10, 15, or 30 ft). Stat and reminder effects choose a duration: a fixed number of rounds or the rarity die, the way Ruinmark's armor crack lasts {die} rounds.

| Action | Effect |
|--------|--------|
| Push / Pull Token | Moves the target die x5 ft directly away from or toward the reference point, blocked by walls and occupied squares |
| Modify Stat | Applies an ActiveEffect: AC +2 or -2, speed penalty/halved/zero, attack disadvantage, check disadvantage, temporary HP, resistance to all damage, or initiative advantage |
| Damage / Heal | Rolls the rarity die and applies damage of a chosen type, or restores HP |
| Apply Status | Applies a condition (poisoned, blinded, deafened, frightened, prone, restrained) |
| Reminder Effect | A visible effect with custom text and no mechanical change |
| Brand | Marks the target; while the brand lasts, every later hit against them deals an extra rarity die of damage (how Emberbrand works) |
| Contagion | The target spreads a chosen status to adjacent creatures at the start of each combat turn, with a configurable save DC and ability. The spread follows the action's own target (enemies-only or allies-only); if the action targets the wielder instead, a separate allies/enemies/all choice controls who it can spread to (how Wasteblight works, restricted to enemies) |
| Lingering Cloud | A 7.5 ft template at the impact point that repeats a save and damage each round, with configurable DC, ability, status on a failed save, targets (all creatures or enemies only), duration, and an option to erupt immediately on placement |
| Ally Dash | One ally within the chosen radius may immediately move up to die x5 ft toward the target, with a picker dialog when several allies qualify (how Forgebell works) |
| Guardian Rush | On Ally Struck: the wearer may use their reaction to move adjacent to the struck ally; reaching them imposes attack disadvantage on the attacker (how Vanguard works) |
| Token Light | The target sheds bright light in a 20 ft radius; the previous lighting is restored when the effect is removed |
| Teleport | Shifts the target up to 15 ft toward the reference point |

When the save gate is on, each action also chooses its save interaction: **Negated** (skipped on a successful save), **Halved** (damage only), or **Always applies**.

The **{die}** in descriptions and damage rolls is the item's rarity die, exactly like built-in runes: the same custom rune rolls 1d4 on an Uncommon item and 1d10 on a Legendary one.

### Custom Combos

The Combo Editor works like the trio system for core combos. Pick three runes of one category (core and custom runes can be mixed), name the combo, and describe it. A trio that already forms a core or custom combo is rejected. The one mechanical override in this version: checking a member rune under "always lands" removes its saving throw while the trio is socketed, the same way Rift Break makes Sandgrasp automatic.

On the item sheet, a complete custom trio forges its combo slot with the same animation and tooltip as core combos, and dissolves when a member rune is removed.

### Sharing Runes

**Export All** in the library downloads every custom rune and combo as one JSON file; **Export JSON** in the editor downloads just the current rune. **Import JSON** reads a file back in. Every entry is validated before anything is saved. Invalid entries are skipped with a warning, valid ones import, and colliding ids are regenerated automatically.

If an item references a custom rune whose definition is missing (deleted, or not yet imported into this world), the socket shows an **Unknown Rune** marker and the engine skips it. Re-import the rune or clear the slot.

### Automation Notes for Custom Runes

- Attack-roll disadvantage uses the midi-qol flag, like the built-in runes: enforced automatically with midi-qol installed, a visible reminder without it. Check disadvantage is automated in core dnd5e 4.1+ and also writes the midi-qol flag.
- The Damage action tags its roll with the chosen damage type, so target resistance, vulnerability, and immunity apply the same as any other damage source.
- On Kill attributes the kill to the last runic weapon that hit the target within the previous 60 seconds.
- On Spell Cast and Concentration Ends fire on the acting player's client and are relayed to the active GM for execution, so a GM must be connected.
- Enemy Approach fires once when an enemy enters the 10 ft radius and re-arms only after they leave it.
- Ally Struck fires only for melee attacks and requires an active combat encounter, the same as Guardian's Rush.
- The Guardian Rush action requires an active combat encounter and pathfinds around blocked squares and other tokens; if the wearer can't reach an adjacent cell it still moves them as close as possible and skips the attack disadvantage effect.
- The Ally Dash action pathfinds the same way; if no ally is within its radius it posts a chat line and does nothing further.
- The Brand action's payoff (the bonus damage on a later hit) checks for a matching effect on every weapon damage chat message, so it works whether the follow up hit comes from a runic weapon or a plain one.
- The Contagion action's spread check runs once per combat turn start, scanning every combatant for a matching effect and their adjacent tokens, filtered by the action's allies/enemies/all setting. It's the same sweep Wasteblight uses (restricted to enemies).

---

## Tips and Common Questions

**Do runes work on unequipped items?**
No. The item must be equipped. Attunement required items must also be attuned.

**Can players see the Solvarian Runecraft panel?**
Yes, but in read-only mode if their role is below the minimum set in settings. They can see what runes are inscribed but cannot change them.

**Can the same rune appear on multiple items?**
Yes. Each item has its own independent rune configuration. Two weapons can both have Stonecleft.

**What happens if I install a new compendium mid-session?**
Click Refresh Cache in module settings to rebuild the legacy picker index without reloading the world.

**Can empowerment boosts exceed 30?**
The picker blocks selections that would push a stat over 30. Each inscription adds +1, so the maximum boost to any single stat is +5 (all 5 slots). Items moved between actors or configured through presets may still produce situations that go over the cap. The crack indicator flags this for someone with sufficient rights to fix it.

**Do legacy grants stack if two items have the same feat?**
No. Only the first item's grant is actually applied to the actor; the second item's grant is held back to avoid creating a duplicate. The crack indicator still appears on both items to flag the conflict, and the GM or user with sufficient rights should resolve it by changing one of the legacy slots.

**Do combo slots count toward rarity?**
No. Combo slots are derived and display-only (in relation to rarity). Only the three power runes that form the combo count toward the score.

**What happens if I delete a custom rune that items are still using?**
The socket shows an Unknown Rune marker and the engine skips it in combat. Re-import the rune to restore it, or clear the slot.

**Can players see what a cursed rune does?**
Not until the item is identified. Players see an "Unidentified Rune" socket with no description; the GM always sees the real rune. The rune's effects still fire either way.

**Can I share runes between worlds?**
Yes. Export to JSON from the Runeforge library and import in the other world. Combos travel with their runes and are re-linked automatically.

**Can custom runes use the built-in runes' effects?**
Yes. Every core rune's behavior is expressed in the same action system the Runeforge uses, so Duplicate gives you a mechanically identical, fully editable copy. The specialized mechanics (Brand, Contagion, Ally Dash, Guardian Rush, Passive AC) are also available as building blocks for runes you make from scratch.

**Is a duplicated core rune really identical?**
Mechanically yes, with three caveats. Core combos never fire for duplicates (combo trios key on the original rune ids). Chat messages use the engine's generic wording instead of the core rune's custom flavor text. And two core habits are approximated: a duplicated Burntrace refreshes its mark on re-application where the core skips, and Stonewarden's undocumented bonus heal when knocked prone below half HP is not part of the duplicate. Build it as a second rune with the When Prone trigger if you want it.

---

## Requirements and Compatibility

| Requirement | Version |
|-------------|---------|
| Foundry VTT | 12 - 14 |
| D&D 5e System | 4.1.0 - 5.x |

Verified against Foundry v14 and dnd5e 5.3.3. dnd5e 4.1 is the practical minimum: it's the first release with `rollSavingThrow` and per-ability check-roll-mode, both of which the rune engine relies on.

**midi-qol (optional)** - midi-qol is never required; every effect below still applies its full mechanical result (the ActiveEffect, the HP change, the token move) without it; only the flag based enforcement is skipped. Attack-roll disadvantage from Burntrace, Vanguard's Guardian's Rush, the Crystal Anchor combo, and the custom-rune attack-disadvantage option is applied through a midi-qol flag. Mirageward's opportunity-attack denial and Wardpulse/Ironwall's bonus action denial write the matching midi-qol action economy flag. With midi-qol installed these are enforced automatically; without it the effect still appears on the target as a reminder to apply by hand. Ability check disadvantage (Crystal Anchor and the custom rune option) is automated in core dnd5e 4.1+.

**Automation scope** - Ashcloud (and the cloud spawned by the Blight Field combo) and Wasteblight's adjacent creature spread only roll saves and apply damage for hostile NPC tokens. Allied and player tokens are left for you to resolve.

**Token movement** - Effects that push, pull, or reposition tokens (Stonecleft, Undertow, Emberveil, Forgebell, Guardian's Rush) act on the scene grid and need tokens placed on the canvas. Guardian's Rush also requires an active combat encounter.
