# GM Tools: Upgradable Runic Items

## Table of Contents

1. [The Runic Panel](#the-runic-panel)
2. [Runic Power](#runic-power)
3. [Runic Empowerment](#runic-empowerment)
4. [Runic Legacy](#runic-legacy)
5. [Combo Runes](#combo-runes)
6. [Rarity System](#rarity-system)
7. [Rune Presets](#rune-presets)
8. [Visual Indicators](#visual-indicators)
9. [Settings and Access Control](#settings-and-access-control)
10. [Tips and Common Questions](#tips-and-common-questions)

---

## The Runic Panel

The Runic Panel appears in the **Details** tab of any weapon or armor item sheet. It has three sections:

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

**Ashcloud** - On a hit, a cloud of ash erupts at the impact point. Creatures in the cloud make a DC 14 Constitution save or are poisoned and take `{die}` poison damage.

**Undertow** - On a hit, the target is pulled `{die}`x5 ft toward the impact point.

**Scorcheye** - On a hit, the target cannot benefit from cover or invisibility until the start of your next turn.

**Wasteblight** - On a hit, rift corruption spreads through the target. While the target is poisoned, creatures ending their turn adjacent to them make a DC 13 Constitution save or become poisoned and take `{die}` poison damage.

### Armor Runes

**Emberveil** - Grants a passive AC bonus based on runic rarity (see Rarity System). When struck by a melee attack, the attacker is pushed `{die}`x5 ft directly away and cannot re-enter your space until the start of their next turn.

**Stonewarden** - When the wearer drops below half HP, the rune flares and restores `{die}` HP. Once per combat.

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

The legacy picker searches across all loaded Item compendiums. On first use per session, so if you see a brief "Loading compendium data..." message, it's ""lazy-loading"" the list. This happens once per session, so subsequent opens are instant.

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

Click the **bookmark icon** in the runic panel header. A dialog asks for a name. After confirming, the bookmark icon briefly flashes with a checkmark to confirm the save.

### Loading a Preset

Click the **folder icon** in the runic panel header. The picker shows only presets compatible with the current item's type (melee, ranged, or armor). Each entry in the list displays miniature power sockets with the actual rune glyphs and a rarity badge. Click an entry to apply it to the item.

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

**Minimum Role to Edit Runes** - Controls which users can open rune pickers and change inscriptions. Setting it to Trusted grants access to Trusted Player, Assistant GM, and Game Master. Players below the threshold see the runic panel in read-only mode.

**Compendium Cache** - The legacy picker loads feat and spell compendiums on first use each session. Use Clear Cache to empty it or Refresh Cache to rebuild from currently loaded compendiums without reloading the world.

---

## Tips and Common Questions

**Do runes work on unequipped items?**
No. The item must be equipped. Attunement required items must also be attuned.

**Can players see the runic panel?**
Yes, but in read-only mode if their role is below the minimum set in settings. They can see what runes are inscribed but cannot change them.

**Can the same rune appear on multiple items?**
Yes. Each item has its own independent rune configuration. Two weapons can both have Stonecleft.

**What happens if I install a new compendium mid-session?**
Click Refresh Cache in module settings to rebuild the legacy picker index without reloading the world.

**Can empowerment boosts exceed 30?**
The picker blocks selections that would push a stat over 30. Each inscription adds +1, so the maximum boost to any single stat is +5 (all 5 slots). Items moved between actors or configured through presets may still produce situations that go over the cap. The crack indicator flags this for someone with sufficient rights to fix it.

**Do legacy grants stack if two items have the same feat?**
Both grants exist on the actor, but the crack indicator appears on both items to flag the conflict. The GM or user with sufficient rights should resolve it by changing one of the legacy slots.

**Do combo slots count toward rarity?**
No. Combo slots are derived and display-only (in relation to rarity). Only the three power runes that form the combo count toward the score.
