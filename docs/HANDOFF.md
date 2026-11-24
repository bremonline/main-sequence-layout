# Main Sequence Layout Builder: project brief (for the coding agent)

Goal: a static, GitHub Pages layout builder for the game Main Sequence (Early Access). Vanilla HTML/JS/canvas, no backend, no build step required. Layouts save to localStorage, export/import as JSON, and share via URL hash.

## Source of truth: data/*.json
- Every record has `source`, `source_version`, `confidence` (unverified | confirmed | confirmed (corrected) | confirmed (NEW)).
- Seed came from mainsequencewiki.com (DEMO build, Nov 2). Records verified against the live game carry `verified_source` (screenshot in screenshots/). The wiki has been wrong on ~1 in 4 checked recipes, so respect `confidence`.
- Do NOT overwrite confirmed records from the wiki. Data edits go through the data pipeline, not by hand-editing inferred values.

## Layout geometry (all confirmed by the player unless noted)
- Grid unit = one tile. A Station 1x1 is 16x16 tiles including a 1-tile wall ring (14x14 floor). Station 2x2 is 32x32 (30x30 floor). Formula: 16n total, 16n-2 floor. Station 2x1 is probably 32x16 (inferred, unverified).
- Edge layout of a 1x1: W | 4 floor | 6 opening | 4 floor | W. 2x2 edge: W|4|6|10|6|4|W. A 2x1 has openings only on its short sides.
- Opening tiles are usable like floor: machines AND belts can sit on them. Only wall tiles are unbuildable.
- Docks and mining ports are separate 8x12 buildings that attach to an opening from outside, touching (not occupying) the opening tiles; they face into the station and are unbuildable.
- Machine footprints (tiles): Assembler 5x5, Reactor 6x6, Refinery 3x3, Container (small) 2x2. Others still null.
- Ports are perimeter tiles INSIDE the footprint. Container: every perimeter tile, all entries. Refinery: middle tile of each side. Assembler: positions 2 and 4 of each side. Reactor: middle two tiles of each side (3 and 4).
- Machine corners are visually chamfered, but use the full square for collision. Container corners are barely cut because corner tiles are ports.
- UNKNOWN: which ports are input vs output, rotation rules, belt width/crossing/corner rules, the belt hand-off tile from dock ports, other machine sizes and ports, Station variants 2x2 B/C.

## Suggested v1 scope
1. Draw a station (1x1 / 2x1 / 2x2) with wall, floor and opening tiles from data/modules.json.
2. Palette of machines from data/machines.json (only those with footprint_tiles), drag, rotate, collision, ports highlighted.
3. Per-recipe readout from data/recipes.json (rates/min, power in MW), and a power total.
4. Save/load JSON, URL-hash share link.
5. Belt drawing later, after belt rules are confirmed.

## Workflow
The player sends in-game screenshots to a separate chat agent (Hermes) that updates data/*.json and pushes. Pull before working; never block on missing data: treat null as "unknown" and show it in the UI.
