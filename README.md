# Main Sequence Layout Data
Community layout-builder data for Main Sequence (EA). Text-only, captured from in-game screenshots.
Files: data/{items,machines,modules,research,recipes,rooms}.json. Seeded from mainsequencewiki.com (DEMO build 26097974, Nov 2) - all records confidence=unverified; wiki has NO footprint/port/grid data, those come from screenshots.
Each record: game_version, source (screenshot name), confidence (confirmed|inferred).
Better Recipes mod must be OFF when capturing.

## Run locally

The app is static and needs a local HTTP server (opening `index.html` directly can block browser data loading).

```sh
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173/>. Keep the server running while editing and refresh the browser.

## Building a layout

New sessions start with the pattern in `data/default-layout.json`: a Dock above
a Station 1×1 above a Control Center, with matching entrances facing the station
and no machines or belts. Shared layout links override this default. Saved browser layouts
are unchanged and can still be opened with **Load**. **Clear** empties the field.
Usable floor and opening tiles are white; walls remain dark. The initial view
automatically fits the three-room pattern with padding. **Fit layout** fits the
current layout (up to 100%) and centers it, including wide factories. Manual zoom
ranges from 10% to 250%.

Choose a station room and click the star field to place it. Rooms snap to a 16-tile
grid; after the first room, each must touch another at matching openings without
overlapping. The field is scrollable and has a fixed 128×96-tile boundary.
The 2×1 room dimensions and short-edge opening layout are inferred.
The Dock and Control Center are also provisional 1×1 room layouts: both use a
six-tile entrance facing north by default. The Dock is drawn with a ship icon and two
white port tiles with arrows pointing out toward the station; its centered body
is 11 tiles wide, one tile narrower than before. The Control Center is drawn as a
rounded room with a flat entrance and a hollow black circle inside its curved body.
Both buildings and their entrances are grey and unbuildable: machines and belts
cannot be placed on them. Dock ports remain highlighted; the 16×16 placement
reservation and room connections are unchanged.

Choose a machine and click usable floor or opening tiles to place it. Drag a
placed machine to move it; the preview turns red where it cannot be dropped.
Use **Select / move** to select a room, or select a machine to rotate or delete
it. A room cannot be deleted if it supports a machine or disconnects the layout.
Use the **− / +** controls, **Ctrl/Cmd + mouse wheel**, or keyboard **− / +** to
zoom the field. Clicking the selected room or machine again clears the selection.
Click an active palette button again, or press **Escape**, to leave placement mode
and clear the selection. **R** (or **Rotate selected**) rotates rooms and machines
clockwise, including placement previews. Belt machine rotation turns its input
and output sides with it. Room rotations are rejected if they
overlap, disconnect rooms, or invalidate machine placements. Machine arrows show
orientation only, not input/output direction. Room orientation is saved with the
layout; older layouts default to zero rotation.
Machine corners are visual only: collision uses the full rectangular footprint.
Research is 3×3 with one port centered opposite its orientation triangle. Rotating
the machine rotates this port; power and input/output role remain unknown.
Machine names use high-contrast labels; compact footprints use **Ref.** (Refinery)
and **C** (Container). Product names wrap or truncate rather than being squeezed.
Hover a machine for its full name, assigned recipe, output rates and confidence,
or select it for full recipe details. Ports are subtle neutral edge slots (direction
unknown); belts use continuous rate-colored tracks with dark direction chevrons. Labels,
ports, arrows, the ship icon and Control Center circle use a non-interactive SVG
overlay so they remain sharp at any zoom. Canvas retains the room/machine bodies,
faint grid and sparse background stars. These
are visual changes only and do not rearrange layout objects or alter recipes.
Machine text stays at a fixed screen font size during zoom, revealing full names
and more product text as footprints grow. Machine ports sit just inside the body
edge; container corner tiles have one marker per exposed side (eight total).
White triangles indicate orientation only, not input/output direction.
Power is shown as known consumption, with missing values reported as unknown.

### Machine recipes

Click a placed **Assembler** or **Refinery**, then choose **Assigned recipe** in
the selection panel. Each machine has its own recipe; choose **No recipe assigned**
to clear it. The selected recipe's inputs, outputs, rates and confidence appear
below, and its products are labeled on the machine. Recipes come directly from
`data/recipes.json`; unverified records remain labeled as such. Recipe assignment
does not simulate production or change the machine's listed power consumption.
Output rates are included on machine labels when the complete product/rate text
fits; zooming in makes more space available. Missing rates are not inferred.

### Belt machines

The **Belt machines** palette group beside the belt tool contains **Splitter
Mk. 1** (1×1, one north-side input and three outputs) and **Belt Balancer Mk. 1**
(2×1, two inputs and two outputs on opposite long sides). Rotate either machine
to turn its port roles. The footprints and port counts/sides are user-confirmed;
port markers are blue for inputs and amber for outputs. The wiki data confidence
for other machine properties remains unchanged. Splitters divide incoming item
rates evenly among connected output belts: 60/min with two outputs gives 30/min
on each, or 20/min with three. Unused output ports receive no share. Belt Balancer
flow rates are not yet simulated, so its downstream rates stay unknown.

### Belts (provisional)

Choose **Draw belt**, then either drag across floor or opening tiles and release,
or click once to start, move the pointer, and click again to finish. Click the
same tile twice to place a single-tile belt. Follow the route with your pointer to create corners; skipped
tiles are filled horizontally then vertically. Retrace the route to shorten it.
Start on either endpoint of an existing belt to extend it using either drawing
mode. Starting directly beyond a unique endpoint attaches the preview immediately.
Finishing on or beside one other belt endpoint joins the routes when either
endpoint's open end points toward the other; side-by-side parallel lanes stay separate.
Ambiguous joins are not automatic. Machine and dock ports take priority over
automatic joins between adjacent endpoints, so neighboring port lanes stay
separate. To deliberately join or extend a port-connected belt, start or finish
directly on its endpoint. Existing arrow overrides are preserved,
crossings still reject overlap, and Escape leaves the original belt intact.
End onto any tile of another belt to feed into that route. The shared tile keeps
its existing arrow, and the incoming branch joins it without duplicating the tile.
Branches remain individually selectable/deletable, but form one flow network.
Arrows default to drawing order. Hover a belt tile and press **R** to turn only
that tile's facing clockwise (east, south, west, north); this works on placed
belts and on the drawing preview without rotating the route or other tiles.
Per-tile facings are saved with the layout; older belts keep drawing-order facing.
Invalid routes turn red and are rejected in full when finished.
**Escape**, switching tools, or a cancelled pointer action discards the draft.
Hover a placed belt tile and press **X** to remove just that tile. A cut in the
middle splits the route into separately selectable belts, preserving the facing
of each remaining tile. Finish or cancel an active drawing or move first.

These are user-approved planning rules, not confirmed game geometry: belts are
one tile wide, orthogonal, and cannot overlap themselves, other belts, or machines.
Loose ends are allowed. An endpoint directly beside and facing a machine's port
gets a full-width connection stopping just short of the port, with a dark end cap.
Endpoint tiles can also turn
sideways into an adjacent port, with the belt fill and outline continuing around
the bend without a pointed taper or broken elbow outline. Moving a machine away
can detach a belt. Dock ports also count as connections, following dock rotation and meeting the outward port face;
the dock body and port tiles themselves remain unbuildable.

Rates are tracked per tile and item using assigned recipe outputs and tile
arrows. Incoming rates add at a merge and carry on downstream. At **200% zoom
and above**, each arrow is replaced by the tile's total flow in **items/min**.
Labels use up to three significant digits, with scientific notation for long
values. **?** means unknown rather than zero. Zoom out to see arrows again.
Hover a belt tile for its total and per-item flow rates, target, and provisional
capacity. Unknown totals are explicitly marked, with any known contributions
listed separately. Rates entering a machine are capped per item at its assigned
recipe input demand, and that accepted rate is shown along the belt run. Supply
above demand is not counted as machine input. When the source rate is unknown (a dock
port or un-fed container), belt rates are inferred backward from known
downstream recipe demand, summing through splitters; these tiles are colored like known flow
and hover marks them as inferred.
Without a known receiving recipe (including containers, docks and loose ends),
capacity is the target. **Grey** means below target, **green** equal, **red** above.
All current belts use the **provisional Mk1 60/min** capacity in `data/belts.json`;
higher tiers are not yet modeled. This is a planning estimate, not a production
simulation: source recipes are not throttled by their own inputs. Splitters
divide flow evenly among connected outputs, then reallocate any output's unused
share to outputs with remaining recipe demand; input flow is limited to the
combined connected output demand. Containers sum incoming rates per item and divide each total equally among
connected output belts, with arrows determining input/output. Containers without
inputs remain unknown; unknown inputs and container feedback loops propagate
unknown totals. Stored inventory is not simulated.
Unknown source rates (including docks and un-fed containers or splitters), missing recipe
output rates, cycles and ambiguous multi-port output allocation stay **amber**,
including downstream of unknown inputs. Data confidence remains unchanged;
recipe-derived rates can be unverified. Selection uses a dashed highlight without
replacing the rate color. Changing recipes, arrows, machines or belts recalculates
the network. Splitter and Belt Balancer port roles come from the user; other machine
port roles remain unknown.

Use **Select / move** and click a belt to select it; **Delete selected** removes
the entire drawn route. **Delete** or **Backspace** (Mac delete) also removes the
selected room, machine or belt, with the same placement/connectivity safeguards.
These shortcuts, including **X**, do not apply inside text fields, recipe selectors
or editable text, or with Ctrl/Cmd/Alt held.
Click the selected belt again to deselect it. Machines
cannot be placed or dragged over belts. Rooms supporting belts cannot be deleted
or rotated into invalid layouts.

Save stores a layout in your browser. Export/import and the share link use JSON;
version 3 includes belts and assigned recipes, and versions 1 and 2 still load.
Older single-station layouts are converted when opened. Room-to-room wall rows
touch rather than overlap; exact inter-room behavior remains provisional.

## Validation

Run interaction, recipe, belt, and room-rotation regression tests with
`node --test tests/app.test.cjs` (Node.js 18 or newer). No packages are required.
