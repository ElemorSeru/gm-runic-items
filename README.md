# GM Tools: Upgradable Runic Items

[![Patreon](https://img.shields.io/badge/Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white)](https://patreon.com/Elemor)
[![Foundry Version](https://img.shields.io/badge/Foundry-v12--v14-informational?style=for-the-badge)](https://foundryvtt.com)
[![Module Version](https://img.shields.io/badge/Version-1.3.0-success?style=for-the-badge)](https://github.com/ElemorSeru/gm-runic-items/releases/latest)
<img alt="GitHub Downloads (all assets, latest release)" src="https://img.shields.io/github/downloads/ElemorSeru/gm-runic-items/latest/total">

A Foundry VTT module for D&D 5e that lets GMs inscribe named runes onto weapons and armor, granting combat effects, stat boosts, feats, and spells. Designed for fast, thematic item upgrades without the overhead of crafting systems.

---

## What It Does

Each weapon or armor item sheet gains a **Solvarian Runecraft** panel in the Details tab with three upgrade tracks:

- **Runic Power** - up to 3 active combat runes that trigger automatically in combat
- **Runic Empowerment** - up to 5 ability score boosts, each adding +1 to the chosen stat
- **Runic Legacy** - one feat and one spell granted directly from any loaded compendium

Runes activate when the item is equipped (and attuned if required). Effects fire through Foundry's hook system, so no macro setup or manual triggering is required. A few effects that impose attack-roll disadvantage rely on midi-qol to enforce automatically. See Compatibility Notes.

GMs and Assistant GMs can also build their own power runes and combos in the **Runeforge** window. Custom runes appear in the same pickers and run on the same automation engine as the built-in ones. See the Runeforge section below.

<p align="center">
  <img src="assets/screenshots/ArmorDetailsFull.png" alt="Solvarian Runecraft panel on an armor item sheet" width="420">
</p>

---

## Features

- **18 power runes** across melee weapons, ranged weapons, and armor; each with distinct combat effects that fire automatically on hits, crits, and turn events
- **6 combo runes** that appear when all 3 power slots form a matched trio. The combo slot animates into existence with a forge effect and its own unique glyph & tooltip 
- **Runeforge** - build custom power runes from 15 triggers, an optional saving throw gate, use limits, and an ordered action list; custom runes run on the same engine as the built-in ones, and duplicating a core rune yields a mechanically identical, fully editable copy
- **Custom combos** - define your own three rune trios and remove the saving throw from member runes while the trio is socketed
- **Import and export** - share custom runes and combos as JSON files; imports are validated entry by entry
- **Cursed runes** - optionally conceal a custom rune's name and effect from players until the item is identified
- **Rarity system** that upgrades automatically as slots are filled, from Common through Legendary, adjusting the effect die used by power runes
- **Rune presets** - save any item's rune configuration as a named preset and load it onto compatible items in one click
- **Visual crack indicator** - if an actor's stats would be pushed over 30 by empowerment, or if a legacy feat/spell conflicts with another runic item, a color-coded crack appears on the relevant section with an explanation
- **Compendium legacy picker** - loads feats and spells from all loaded compendiums on first use and includes search filtering
- **Role-based access** - configurable minimum role required to edit runes; players below the threshold see slots in read-only mode
- **Fully localized** - all user-visible strings in `lang/en.json` and more to come as I have time

<p align="center">
  <img src="assets/screenshots/SlotsCombo.png" alt="Combo rune slot materialized when all three power slots form a matched trio" width="460">
  <br>
  <em>The Combo slot animates into existence when all three power runes form a matched trio.</em>
</p>

<p align="center">
  <img src="assets/screenshots/RunesOverloaded.png" alt="Color-coded crack warnings for an over-cap stat and a conflicting legacy grant" width="460">
  <br>
  <em>Crack indicators flag an over-cap ability score and a legacy feat/spell already granted by another item.</em>
</p>

---

## Rune Categories

### Melee Weapons
Stonecleft, Mirageward, Emberbrand, Sandgrasp, Ruinmark, Forgebell

### Ranged Weapons
Burntrace, Sandhold, Ashcloud, Undertow, Scorcheye, Wasteblight

### Armor
Emberveil, Stonewarden, Vanguard, Wardpulse, Forgeshield, Ashen Mantle

### Combos (2 per category, requires all 3 power slots)
Ember Surge, Rift Break, Crystal Anchor, Blight Field, Ironwall, Morrain's Resolve

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Foundry VTT | 12+ |
| D&D 5e System | 4.1.0 - 5.x |

---

## Installation

**Via Foundry module browser:** search for `GM Tools: Upgradable Runic Items`

**Manual:**
1. Open Foundry's Add-on Modules tab
2. Click **Install Module**
3. Paste the manifest URL and install
4. Enable the module in your world's module settings

---

## Quick Start

1. Open any weapon or armor item sheet
2. Navigate to the **Details** tab
3. Click any empty socket in the Solvarian Runecraft panel to open the rune picker
4. Select a rune and effects activate automatically when the item is equipped and attuned (if required)
5. The rarity badge updates as you fill slots

---

## Runeforge

<p align="center">
  <img src="assets/screenshots/RC_RunesAndBuilder.png" alt="The builder for custom runes allows for a GM to build their own custom mechanics" width="660">
  <br>
  <em>The builder allows for custom runes to be built and managed by a GM so that they can build their own in-world custom mechanics and lore.</em>
</p>
The Runeforge is the custom rune builder, available to GMs and Assistant GMs. It opens from any of these:

- The hammer icon in the Solvarian Runecraft panel header
- The keybinding (Ctrl+Shift+R by default, remappable)

A custom rune is assembled from five parts: identity (name, category, color, glyph; picked from a palette or imported from an SVG file), a trigger (when it fires), an optional saving throw gate, a use limit, and an ordered list of actions (what it does, and to whom). The live preview shows the generated rune description as you build. Core runes appear in the Runeforge library as locked entries that can never be edited, but Duplicate produces a mechanically identical copy (same trigger, save, use limit, and actions) ready to tweak. The specialized core mechanics (Brand, Contagion, Ally Dash, Guardian Rush, Passive AC) are also available as building blocks for runes made from scratch.

Custom combos work the same way: pick any three runes of one category, name the combo, and optionally remove the saving throw from member runes while the trio is socketed.

Everything is stored in the world and can be exported to JSON and imported into another world. See the wiki for the full trigger and action reference.

---

## Settings

| Setting | Description |
|---------|-------------|
| Minimum Role to Edit Runes | Lowest user role that can assign runes. Defaults to Game Master. |
| Compendium Cache | Manage the feat/spell index used by the legacy picker. |
| Rune Presets | Open the preset manager to view and delete saved configurations. |

<p align="center">
  <img src="assets/screenshots/Settings.png" alt="The module settings page" width="600">
</p>

<p align="center">
  <img src="assets/screenshots/PresetManagementWindow.png" alt="The Rune Presets management window grouped by category" width="380">
</p>

---

## Compatibility Notes

- Vanguard's Guardian's Rush moves tokens and requires an active combat encounter.
- Legacy grants add items directly to the actor's item list tagged with the source item's name.
- Attack-roll disadvantage (Burntrace, Vanguard's Guardian's Rush, and the Crystal Anchor combo) is applied through a midi-qol flag. Without midi-qol installed, those effects still appear on the target as a reminder but do not enforce the disadvantage automatically. The ability-check disadvantage from Crystal Anchor is automated in core dnd5e 4.1+.
- Mirageward's opportunity-attack denial and Wardpulse/Ironwall's bonus-action denial also write a midi-qol action-economy flag (marking the reaction or bonus action as already spent). Without midi-qol, both still appear on the target as a reminder but rely on the table to self-enforce.
- Ashcloud (and the cloud spawned by the Blight Field combo) only rolls saves and applies poison damage for hostile NPC tokens. Allied and player tokens standing in the cloud are not affected by the automation.
- Custom rune attack-roll disadvantage uses the same midi-qol flag as the built-in runes. The check-disadvantage option is automated in core dnd5e 4.1+ and also writes the midi-qol flag.
- Rune and combo damage is applied as a typed damage instance, so target resistance, vulnerability, and immunity apply the same as any other damage source.
- The On Kill trigger attributes a kill to the last runic weapon that hit the target within the previous 60 seconds.
- The Enemy Approach trigger fires once when an enemy enters 10 ft of the wearer and re-arms after they leave that radius.
- The Ally Struck trigger and the Guardian Rush action (custom-rune equivalents of Vanguard's mechanic) require an active combat encounter, same as Vanguard itself.
- The Ally Dash and Guardian Rush actions pathfind around blocked squares and other tokens, moving as close as possible if the ideal destination isn't reachable.
- The in-sheet panel is titled **Solvarian Runecraft**.
- The Solvarian Runecraft panel works with both the core dnd5e item sheet and [Tidy 5e Sheets](https://foundryvtt.com/packages/tidy5e-sheet); no configuration needed.
- Distances in rune descriptions and effects (pushes, radii, teleports, light) respect your scene's grid distance and dnd5e's metric setting, converting automatically. A push described as "up to 15 ft" reads as its converted meter equivalent on a metric world, and movement math scales to the scene's actual grid distance.

---

## Screenshots

### Assigning runes

Click any empty socket to open its picker. Power runes show a tooltip describing their combat effect; empowerment runes each add +1 to the chosen ability.

<p align="center">
  <img src="assets/screenshots/RunicPowerMenu.png" alt="Power rune picker with a rune tooltip" width="400">
  <img src="assets/screenshots/RunicEmpowermentMenu.png" alt="Empowerment picker with per-ability options" width="400">
</p>

### Legacy feats and spells

The legacy sockets load feats and spells from every loaded compendium, with live search filtering.

<p align="center">
  <img src="assets/screenshots/RuneFeatMenu.png" alt="Legacy feat picker with search filtering" width="400">
  <img src="assets/screenshots/RuneSpellMenu.png" alt="Legacy spell picker with search filtering" width="400">
</p>

### Presets

Save an item's full rune configuration as a named preset, then load it onto any compatible item.

<p align="center">
  <img src="assets/screenshots/SaveRunePreset.png" alt="Save Rune Preset dialog" width="400">
  <img src="assets/screenshots/LoadRunePreset.png" alt="Loading a saved preset onto a compatible item" width="400">
</p>

---

## About

Built and maintained by [Elemor](https://patreon.com/Elemor).

If you find this useful and want to support continued development, the Patreon link above is the best way to do that.

Bug reports and feature requests are welcome via the Issues tab.
