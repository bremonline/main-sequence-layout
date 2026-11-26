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
- Machine footprints (tiles): Assembler 5x5, Reactor 6x6, Refinery 3x3, Container (small) 2x2, Large Container 4x4, Materials Research 3x3, Computational Research 3x3, Splitter Mk. 1 1x1, Belt Balancer Mk. 1 2x1. Others still null.
- Splitter Mk. 1 is 1x1 with one north-side input and three outputs; Belt Balancer Mk. 1 is 2x1 with two inputs and two outputs on opposite long sides. User-confirmed geometry/roles are in `data/machines.json`; rotation turns the ports.
- Underground Belt has two 1x1 ends aligned horizontally/vertically, with up to six intervening tiles and confirmed 60/min capacity. First click is inlet, second is outlet. Only endpoints reserve surface tiles; spans can cross under machines/belts. Data lives in `data/machines.json`; pairs save in version 3 `belts` as `kind: "underground"` and ordered `cells` (two coordinates, no direction overrides). Flow jumps between ends, with rear inlet/forward outlet connections to machines, belts and distributors. Surface routes remain separate; no endpoint merging into the underground pair. R cannot turn one end; deleting either end removes the pair. Escape/tool changes cancel an unfinished pair. Unknown supply is inferred only when downstream demand is within capacity.
- Materials Research retains the `research` slug for saved-layout compatibility. It and Computational Research have one centered input (south at zero rotation), confirmed by user. Power remains unknown. Their `fixed_recipe` data automatically consumes Hull Plate 6/min and Basic Circuits 6/min respectively, with no recipe assignment. Fixed recipes participate in flow, hover and recipe details.
- Ports are perimeter tiles INSIDE the footprint. Both container sizes have ports on every tile of every side (8/16 faces), sharing the same aggregation/distribution behavior. Refinery: middle tile of each side. Assembler: positions 2 and 4 of each side. Reactor: middle two tiles of each side (3 and 4).
- Machine corners are visually chamfered, but use the full square for collision. Container corners are barely cut because corner tiles are ports.
- UNKNOWN: input/output roles and rotation rules for other machines, belt width/crossing/corner rules, the belt hand-off tile from dock ports, other machine sizes and ports, Station variants 2x2 B/C.

## Suggested v1 scope
1. Draw a station (1x1 / 2x1 / 2x2) with wall, floor and opening tiles from data/modules.json.
2. Palette of machines from data/machines.json (only those with footprint_tiles), drag, rotate, collision, ports highlighted.
   Keep the left palette compact: descriptions and instructions are hover titles,
   while machine buttons show only names and footprints.
3. Per-recipe readout from data/recipes.json (rates/min, power in MW), and a power total.
4. Save/load JSON, URL-hash share link.
   Export prompts for a filename (default `main-sequence-layout.json`), adds `.json`
   when missing, and cancels without downloading if dismissed.
   The Examples selector discovers JSON layouts in `examples/` from a local
   directory listing or the GitHub API on Pages; selecting one validates, loads
   and fits it. Listing errors appear in status and focusing the selector retries.
   Delete/Backspace deletes the selected object via the same action as the button,
   retaining room connectivity and active-edit safeguards. Editable fields and
   modified key combinations are excluded.
5. Provisional belt drawing is implemented (user-approved 2026-11-24): one-tile
   orthogonal drag or click-start/click-end routes, no overlaps/crossings, arrows
   default to drawing order; R turns only the tile under the cursor clockwise
   and per-tile direction overrides persist in layouts,
   single-tile belts are supported (click the same start/end tile),
   starting on an existing endpoint extends that route in either drawing mode;
   starting directly beyond a unique endpoint attaches the draft immediately, too,
   unless either endpoint is beside a machine or dock port. Finishing beside an
   endpoint also requires either open end to point toward the other and follows
   the same port priority; directly targeting an endpoint still
   joins or extends it. This keeps adjacent balancer lanes separate. Cancelled or
   invalid extensions preserve the original. Ending onto another route's interior
   creates a merge, represented by adjacent directed cells without overlapping the
   target tile. No crossings; branches remain individually selectable/deletable.
   Hovering a placed belt tile and pressing X removes only that tile, splitting
   the route if necessary and preserving all remaining tile directions. Active
   draws/moves and editable fields block the shortcut.
   Any belt tile beside an enabled port connects, including belts running parallel
   past it. Clicking a machine or dock port toggles it (green on, red off); disabled
   ports are saved as `disabledPorts` on the placement/room and never connect.
   Visual connections appear beside aligned machine ports. These rules are NOT
   confirmed game geometry; throughput and other machines' port roles remain unknown.
6. Assemblers and Refineries support per-placement recipe selection from
   data/recipes.json. Layout version 3 saves recipes and belts; versions 1/2 load.
7. New sessions load data/default-layout.json: Dock above Station 1x1 above
   Control Center, connected vertically, with no machines or belts.
   Shared URL layouts take priority; browser
   saves are loaded only via Load. Clear empties the field. Usable tiles are white.
8. Dock and Control Center bodies/entrances are grey and unbuildable (including
   for belts). Dock ports stay highlighted. The dock's visible body is 11 tiles
   wide and centered in its unchanged 16x16 placement reservation.
   Dock ports are white tiles with outward arrows. The Control Center has an
   inset hollow black circle. The starter view and Fit layout button fit and center
   the layout with padding (capped at 100%, subject to the 10% minimum zoom).
   Buttons, keyboard shortcuts and Ctrl/Cmd-wheel zoom anchor the visible canvas
   center rather than its upper-left corner or the pointer.
9. Rendering uses high-contrast machine labels, compact Ref./C names, wrapped or
   truncated product names and full hover text, green/red (on/off) machine port markers, and continuous amber belts with dark direction chevrons.
   Layout geometry, recipes, and per-tile belt facings are unaffected.
   Labels, ports, arrows, ship and control circle are SVG over the canvas, with
   pointer events disabled so editing still reaches the canvas. Grid lines and
   background stars are deliberately faint.
   Belt endpoints connect full-width just short of adjacent machine port faces,
   including sideways turns at endpoint tiles. Fill and outline use continuous
   SVG track paths through elbows (not separate butt-ended connector segments).
   The outline stops 1 world pixel before the port; fill stops 3 pixels before it,
   leaving a dark end cap. SVG outlines are layered below all fills so junctions
   have no cap seam. Single-tile connections use the tile's facing axis.
   Machine text counter-scales zoom to keep a fixed screen font size; output
   rates from recipe data appear only when the complete product/rate text fits.
   Container corner ports have one marker for each exposed edge (eight total).
   Dock ports count as belt endpoints on their outward faces in all rotations.
   Belts remain outside the unbuildable dock tiles, with a dark end cap at its
   white port face.
10. Directed per-tile flow tracks assigned recipe output rates per item, adding
    rates downstream of merges. Serial output ports from the same recipe machine
    on one directed belt stream count production only once, at the upstream port,
    even across joined routes. Independent output streams remain ambiguous.
    Known machine inputs cap delivered flow per item
    to recipe demand, and accepted rates are shown along the supplying belt run.
    Splitters initially divide equally across connected outputs, then redistribute
    a branch's unused share to outputs with remaining demand; their input flow is
    capped at combined output demand. Balancers do not yet redistribute.
    Separate belts feeding the same machine item share that recipe demand.
    Explicit distributor outputs touching another enabled machine input connect
    directly, with terminal graph nodes for recipe inputs that have no belt tile.
    A terminal belt with incoming flow also feeds a unique perpendicular input;
    that port is not misclassified as a recipe output. Direct and belt inputs
    share demand accounting. Two Hull Plate assemblers require 30 Titanium Plates/min
    each: 60/min before their splitter and 30/min on its output belt.
    When supply is unknown (dock port, un-fed container), rates are backtracked
    from known downstream demand, summing through splitters (e.g. three 20/min
    refineries fed via two splitters: 20, 40, 60). Inferred tiles are colored
    like known flow (green when matching demand); hover marks them inferred.
    Colors compare accepted supply with demand, capped at Mk1 capacity; otherwise
    use capacity. Grey below / green equal / red above; amber unknown. Mk1 60/min is provisional
    per user, stored with unverified confidence in data/belts.json. Higher tiers
    are not modeled. At 200% zoom and above, each belt arrow becomes the tile's
    total items/min (up to three significant digits; scientific notation for
    long values). Unknown totals show ?, never a misleading zero. Below 200%,
    arrows return. Hover details retain full per-item information.
    Unknown source rates, cycles and
    ambiguous output allocation propagate amber. Recipe confidence is unchanged.
    This is planning flow, not a production simulation: source recipes are not
    throttled by their own inputs. Junctions
    derive from adjacent endpoint arrows, so layout version 3 needs no new fields.
    Selection adds dashed highlighting rather than replacing rate colors.
    Hovering a belt tile shows total/per-item flow, target and provisional capacity.
    Unknown totals explicitly separate any known contributions.
    Splitter and Belt Balancer ports are directional (triangles point in for input, out for output).
    Splitters divide incoming per-item rates evenly among connected outputs,
    capped per branch at assigned input demand, then redistribute overflow to
    other outputs with remaining demand. If demand is 15/min and a belt supplies
    30/min, only 15/min is accepted. Unused outputs receive no share. The rule
    is user-confirmed in machine data. Balancer rate distribution is still unknown.
    Containers aggregate all incoming per-item rates, then divide equally among
    connected output belts (roles determined by arrows). Unknown inputs propagate;
    no-input containers and feedback cycles remain unknown. No inventory simulation.

## Workflow
The player sends in-game screenshots to a separate chat agent (Hermes) that updates data/*.json and pushes. Pull before working; never block on missing data: treat null as "unknown" and show it in the UI.
`index.html` versions the JavaScript and stylesheet URLs with query strings; bump
the corresponding token when changing either asset so browsers fetch the update.
