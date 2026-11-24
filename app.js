"use strict";

const canvas = document.getElementById("layout-canvas");
const ctx = canvas.getContext("2d");
const symbols = document.getElementById("layout-symbols");
const machineList = document.getElementById("machine-list");
const beltMachineList = document.getElementById("belt-machine-list");
const statusEl = document.getElementById("status");
const canvasWrap = document.querySelector(".canvas-wrap");
const zoomLevel = document.getElementById("zoom-level");
const TILE = 16;
const FIELD_WIDTH = 128;
const FIELD_HEIGHT = 96;
const ROOM_STEP = 16;
const INITIAL_X = 48;
const INITIAL_Y = 32;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
const BELT_RATE_ZOOM = 2;
let zoom = 1;

canvas.width = FIELD_WIDTH * TILE;
canvas.height = FIELD_HEIGHT * TILE;
canvas.style.width = `${FIELD_WIDTH * TILE * zoom}px`;
canvas.style.height = `${FIELD_HEIGHT * TILE * zoom}px`;

function updateZoomLabel() {
  zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
}

function setZoom(value, anchor = null) {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  if (nextZoom === zoom) return;
  const previousZoom = zoom;
  let worldPoint = null;
  if (anchor) {
    worldPoint = canvasPoint(anchor);
  }
  zoom = nextZoom;
  canvas.style.width = `${FIELD_WIDTH * TILE * zoom}px`;
  canvas.style.height = `${FIELD_HEIGHT * TILE * zoom}px`;
  updateZoomLabel();
  if (worldPoint) {
    canvasWrap.scrollLeft += worldPoint.x * TILE * (zoom - previousZoom);
    canvasWrap.scrollTop += worldPoint.y * TILE * (zoom - previousZoom);
  }
  draw();
}

let machines = [];
let recipes = [];
let roomTypes = {};
let rooms = [];
let placements = [];
let belts = [];
let beltCapacity = null;
let beltFlow = new Map();
let beltLayers = null;
let beltDraft = null;
let cursorPoint = null;
let nextId = 1;
let tool = { type: "select" };
let selected = null;
let preview = null;
let drag = null;
let previewRotation = 0;

function svgNode(tag, attributes, parent = symbols, text = null) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== null) node.textContent = text;
  parent.append(node);
  return node;
}

function getMachine(slug) { return machines.find(machine => machine.slug === slug); }
function dimensions(room) {
  const [w, h] = roomTypes[room.size].dimensions;
  return (room.rotation || 0) % 2 ? [h, w] : [w, h];
}

function openingOnEdge(room, x, y) {
  let [w, h] = dimensions(room);
  let lx = x - room.x, ly = y - room.y;
  for (let i = 0; i < (room.rotation || 0); i++) {
    [lx, ly] = [ly, w - 1 - lx];
    [w, h] = [h, w];
  }
  const inOpening = value => value % ROOM_STEP >= 5 && value % ROOM_STEP <= 10;
  const type = roomTypes[room.size];
  if (type.connection_side) {
    if (type.connection_side === "north" && ly === 0) return inOpening(lx);
    if (type.connection_side === "south" && ly === h - 1) return inOpening(lx);
    if (type.connection_side === "west" && lx === 0) return inOpening(ly);
    if (type.connection_side === "east" && lx === w - 1) return inOpening(ly);
    return false;
  }
  if ((lx === 0 || lx === w - 1) && ly > 0 && ly < h - 1) return inOpening(ly);
  if (room.size !== "2x1" && (ly === 0 || ly === h - 1) && lx > 0 && lx < w - 1) return inOpening(lx);
  return false;
}

function roomTile(room, x, y) {
  const [w, h] = dimensions(room);
  const lx = x - room.x, ly = y - room.y;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return null;
  if (openingOnEdge(room, x, y)) return "opening";
  if (lx === 0 || ly === 0 || lx === w - 1 || ly === h - 1) return "wall";
  return "floor";
}

function tileIsUsable(x, y, roomList = rooms) {
  return roomList.some(room => {
    if (roomTypes[room.size].buildable === false) return false;
    const tile = roomTile(room, x, y);
    return tile === "floor" || tile === "opening";
  });
}

function roomsOverlap(a, b) {
  const [aw, ah] = dimensions(a), [bw, bh] = dimensions(b);
  return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
}

function roomsConnect(a, b) {
  const [aw, ah] = dimensions(a), [bw, bh] = dimensions(b);
  if (a.x + aw === b.x || b.x + bw === a.x) {
    const left = a.x < b.x ? a : b, right = left === a ? b : a;
    const leftEdge = left.x + dimensions(left)[0] - 1;
    for (let y = Math.max(a.y, b.y); y < Math.min(a.y + ah, b.y + bh); y++) {
      if (openingOnEdge(left, leftEdge, y) && openingOnEdge(right, right.x, y)) return true;
    }
  }
  if (a.y + ah === b.y || b.y + bh === a.y) {
    const top = a.y < b.y ? a : b, bottom = top === a ? b : a;
    const topEdge = top.y + dimensions(top)[1] - 1;
    for (let x = Math.max(a.x, b.x); x < Math.min(a.x + aw, b.x + bw); x++) {
      if (openingOnEdge(top, x, topEdge) && openingOnEdge(bottom, x, bottom.y)) return true;
    }
  }
  return false;
}

function canAddRoom(room, roomList = rooms) {
  if (!roomTypes[room.size] || !Number.isInteger(room.x) || !Number.isInteger(room.y)) return false;
  const [w, h] = dimensions(room);
  if (room.x < 0 || room.y < 0 || room.x + w > FIELD_WIDTH || room.y + h > FIELD_HEIGHT) return false;
  if (roomList.some(other => roomsOverlap(room, other))) return false;
  return roomList.length === 0 || roomList.some(other => roomsConnect(room, other));
}

function allRoomsConnected(roomList) {
  if (!roomList.length) return true;
  const visited = new Set([roomList[0]]);
  const queue = [roomList[0]];
  for (const room of queue) {
    for (const other of roomList) {
      if (!visited.has(other) && roomsConnect(room, other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  return visited.size === roomList.length;
}

function machineFootprint(machine, rotation = 0) {
  const [width, height] = machine.footprint_tiles;
  return rotation % 2 === 0 ? [width, height] : [height, width];
}

function footprintCells(machine) {
  if (machine.port_layout?.cells) return machine.port_layout.cells;
  if (machine.port_layout?.ports) {
    return [...new Set(machine.port_layout.ports.map(port => port.cell.join(",")))]
      .map(cell => cell.split(",").map(Number));
  }
  const [w, h] = machine.footprint_tiles;
  const cells = [];
  if (machine.slug === "container") {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) cells.push([x, y]);
    }
  } else {
    const positions = machine.port_layout?.positions_1indexed_along_each_side;
    if (positions) {
      for (const position of positions) {
        const n = position - 1;
        cells.push([n, 0], [n, h - 1], [0, n], [w - 1, n]);
      }
    }
  }
  return cells;
}

function rotatedPort([x, y], machine, rotation) {
  let [w, h] = machine.footprint_tiles;
  for (let i = 0; i < rotation; i++) {
    [x, y] = [h - 1 - y, x];
    [w, h] = [h, w];
  }
  return [x, y];
}

function machinePorts(machine, rotation = 0) {
  const directions = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const sides = new Map(Object.entries(directions).map(([side, direction]) => [direction.join(","), side]));
  return (machine.port_layout?.ports || []).map(port => {
    const [x, y] = rotatedPort(port.cell, machine, rotation);
    let [dx, dy] = directions[port.side];
    for (let i = 0; i < rotation; i++) [dx, dy] = [-dy, dx];
    return { x, y, side: sides.get(`${dx},${dy}`), role: port.role };
  });
}

function canPlace(machine, x, y, rotation = 0, ignore = null, roomList = rooms, placementList = placements, beltList = belts) {
  const [w, h] = machineFootprint(machine, rotation);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    if (!tileIsUsable(x + px, y + py, roomList)) return false;
  }
  if (beltList.some(belt => belt.cells.some(cell =>
    cell.x >= x && cell.x < x + w && cell.y >= y && cell.y < y + h))) return false;
  for (const p of placementList) {
    if (p.id === ignore) continue;
    const [pw, ph] = machineFootprint(getMachine(p.slug), p.rotation);
    if (x < p.x + pw && x + w > p.x && y < p.y + ph && y + h > p.y) return false;
  }
  return true;
}

function beltProblem(cells, roomList = rooms, placementList = placements, beltList = belts) {
  const occupied = new Set(beltList.flatMap(belt => belt.cells.map(cell => `${cell.x},${cell.y}`)));
  const visited = new Set();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
        cell.x < 0 || cell.y < 0 || cell.x >= FIELD_WIDTH || cell.y >= FIELD_HEIGHT ||
        !tileIsUsable(cell.x, cell.y, roomList)) return "Belts need usable floor or opening tiles";
    if (cell.direction !== undefined && (!Number.isInteger(cell.direction) ||
        cell.direction < 0 || cell.direction > 3)) return "Invalid belt tile direction";
    if (i && Math.abs(cell.x - cells[i - 1].x) + Math.abs(cell.y - cells[i - 1].y) !== 1) {
      return "Belt tiles must connect orthogonally";
    }
    const key = `${cell.x},${cell.y}`;
    if (visited.has(key) || occupied.has(key)) return "Belts cannot overlap or cross";
    if (placementList.some(p => {
      const [w, h] = machineFootprint(getMachine(p.slug), p.rotation);
      return cell.x >= p.x && cell.x < p.x + w && cell.y >= p.y && cell.y < p.y + h;
    })) return "Belts cannot run through machines; end beside a port";
    visited.add(key);
  }
  return null;
}

function extendBeltDraft(point) {
  const cells = beltDraft.cells;
  const target = {
    x: Math.max(-1, Math.min(FIELD_WIDTH, point.x)),
    y: Math.max(-1, Math.min(FIELD_HEIGHT, point.y))
  };
  while (cells.at(-1).x !== target.x || cells.at(-1).y !== target.y) {
    const last = cells.at(-1);
    const next = last.x !== target.x
      ? { x: last.x + Math.sign(target.x - last.x), y: last.y }
      : { x: last.x, y: last.y + Math.sign(target.y - last.y) };
    const previous = cells.findIndex(cell => cell.x === next.x && cell.y === next.y);
    if (previous >= 0) {
      if (previous < (beltDraft.anchorLength || 1) - 1) break;
      cells.splice(previous + 1);
    }
    else cells.push(next);
  }
  statusEl.textContent = draftBeltProblem(cells) || (beltDraft.clickMode
    ? "Click to finish belt; R turns the tile under the cursor; Escape cancels"
    : "Release to place belt; retrace to shorten, Escape to cancel");
}

function draftBeltProblem(cells) {
  const others = belts.filter(belt => belt.id !== beltDraft?.sourceId);
  const end = cells.at(-1);
  const joins = cells.length > (beltDraft?.anchorLength || 1) &&
    others.some(belt => belt.cells.some(cell => cell.x === end.x && cell.y === end.y));
  return beltProblem(joins ? cells.slice(0, -1) : cells, rooms, placements, others);
}

function reversedBeltCells(cells) {
  return cells.map((cell, index) => ({ ...cell, direction: beltDirection(cells, index) })).reverse();
}

function beltDirection(cells, index) {
  if (cells[index].direction !== undefined) return cells[index].direction;
  const cell = cells[index], next = cells[index + 1], previous = cells[index - 1];
  const dx = next ? next.x - cell.x : previous ? cell.x - previous.x : 1;
  const dy = next ? next.y - cell.y : previous ? cell.y - previous.y : 0;
  return dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3;
}

function endpointExtendsTo(cells, index, point) {
  const cell = cells[index], neighbor = cells[index === 0 ? 1 : index - 1];
  if (neighbor) return point.x === 2 * cell.x - neighbor.x && point.y === 2 * cell.y - neighbor.y;
  const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(cells, index)];
  return Math.abs(point.x - cell.x) === Math.abs(dx) && Math.abs(point.y - cell.y) === Math.abs(dy);
}

function finishBelt() {
  let cells = beltDraft.cells;
  const source = belts.find(belt => belt.id === beltDraft.sourceId);
  const end = cells.at(-1);
  const junction = belts.find(belt => belt !== source &&
    belt.cells.slice(1, -1).some(cell => cell.x === end.x && cell.y === end.y));
  if (junction && cells.length > (beltDraft.anchorLength || 1)) {
    const previous = cells.at(-2);
    const direction = end.x > previous.x ? 0 : end.y > previous.y ? 1 : end.x < previous.x ? 2 : 3;
    cells = cells.slice(0, -1).map((cell, index, list) =>
      index === list.length - 1 ? { ...cell, direction } : cell);
  }
  const candidates = belts.filter(belt => belt !== source).flatMap(belt =>
    [0, belt.cells.length - 1].filter((index, i, indices) => indices.indexOf(index) === i)
      .filter(index => Math.abs(belt.cells[index].x - end.x) + Math.abs(belt.cells[index].y - end.y) <= 1)
      .map(index => ({ belt, index })));
  const exact = candidates.filter(({ belt, index }) => belt.cells[index].x === end.x && belt.cells[index].y === end.y);
  const targets = exact.length ? exact : candidates.filter(({ belt, index }) =>
    !hasAdjacentPort(end) && !hasAdjacentPort(belt.cells[index]) &&
    (endpointExtendsTo(cells, cells.length - 1, belt.cells[index]) || endpointExtendsTo(belt.cells, index, end)));
  const target = !junction && targets.length === 1 ? targets[0] : null;
  if (target) {
    const tail = target.index === 0 ? target.belt.cells : reversedBeltCells(target.belt.cells);
    const overlap = tail[0].x === end.x && tail[0].y === end.y;
    cells = [...cells, ...tail.slice(overlap ? 1 : 0)];
  }
  const problem = beltProblem(cells, rooms, placements,
    belts.filter(belt => belt !== source && belt !== target?.belt));
  if (problem) statusEl.textContent = `Belt not placed: ${problem}`;
  else {
    if (beltDraft.prepend) cells = cells.slice().reverse().map((cell, index, list) => {
      const original = source.cells.find(original => original.x === cell.x && original.y === cell.y);
      if (original) return original;
      const next = list[index + 1], previous = list[index - 1];
      const dx = next ? next.x - cell.x : cell.x - previous.x;
      const dy = next ? next.y - cell.y : cell.y - previous.y;
      return { ...cell, direction: dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3 };
    });
    if (source) cells = cells.map(cell =>
      junction && cell === cells.at(-1) ? cell :
        source.cells.find(original => original.x === cell.x && original.y === cell.y) || cell);
    const belt = source || { id: nextId++ };
    belt.cells = cells;
    if (!source) belts.push(belt);
    if (target) belts = belts.filter(item => item !== target.belt);
    selected = { type: "belt", id: belt.id };
    statusEl.textContent = junction ? "Belt merged into downstream route" :
      source || target ? "Belt extended" : "Belt placed; drag or click to start another";
  }
  beltDraft = null;
  preview = null;
  updateDetails();
  draw();
}

function portConnection(cell, neighbor) {
  const dx = cell.x - neighbor.x, dy = cell.y - neighbor.y;
  const x = cell.x + dx, y = cell.y + dy;
  const portSide = new Map([["0,-1", "north"], ["1,0", "east"], ["0,1", "south"], ["-1,0", "west"]])
    .get(`${-dx},${-dy}`);
  const placement = placements.find(p => {
    const machine = getMachine(p.slug);
    const port = machinePorts(machine, p.rotation).find(item =>
      p.x + item.x === x && p.y + item.y === y && item.side === portSide);
    if (machine.port_layout?.ports) return Boolean(port);
    return footprintCells(machine).some(cell => {
      const [px, py] = rotatedPort(cell, machine, p.rotation);
      return p.x + px === x && p.y + py === y;
    });
  });
  const dock = !placement && rooms.find(room => {
    const type = roomTypes[room.size];
    if (type.kind !== "dock") return false;
    let inwardX = 0, inwardY = 1;
    for (let i = 0; i < (room.rotation || 0); i++) [inwardX, inwardY] = [-inwardY, inwardX];
    if (dx !== inwardX || dy !== inwardY) return false;
    return type.ports.some(portX => {
      const [px, py] = rotatedPort([portX, 0], { footprint_tiles: type.dimensions }, room.rotation || 0);
      return room.x + px === x && room.y + py === y;
    });
  });
  if (dock) return {
    room: dock, cell, dx, dy,
    x: (cell.x + 0.5) * TILE + dx * (TILE / 2 + 1),
    y: (cell.y + 0.5) * TILE + dy * (TILE / 2 + 1)
  };
  return placement ? {
    placement, cell, dx, dy,
    role: machinePorts(getMachine(placement.slug), placement.rotation)
      .find(port => placement.x + port.x === x && placement.y + port.y === y && port.side === portSide)?.role,
    x: (cell.x + 0.5) * TILE + dx * (TILE / 2 + 3),
    y: (cell.y + 0.5) * TILE + dy * (TILE / 2 + 3)
  } : null;
}

function endpointPort(cell, neighbor) {
  return portConnection(cell, neighbor) !== null;
}

function hasAdjacentPort(cell) {
  return [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) =>
    endpointPort(cell, { x: cell.x - dx, y: cell.y - dy }));
}

function beltConnections(cells) {
  if (cells.length > 1) return [0, cells.length - 1].flatMap(index => {
    const cell = cells[index], neighbor = cells[index === 0 ? 1 : index - 1];
    return [[1, 0], [0, 1], [-1, 0], [0, -1]]
      .filter(([dx, dy]) => cell.x + dx !== neighbor.x || cell.y + dy !== neighbor.y)
      .map(([dx, dy]) => portConnection(cell, { x: cell.x - dx, y: cell.y - dy }))
      .filter(Boolean);
  });
  const cell = cells[0];
  const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(cells, 0)];
  return [
    portConnection(cell, { x: cell.x + dx, y: cell.y + dy }),
    portConnection(cell, { x: cell.x - dx, y: cell.y - dy })
  ].filter(Boolean);
}

function beltCellKey(cell) { return `${cell.x},${cell.y}`; }

function beltRateLabel(node, maxWidth) {
  if (node.unknown) return "?";
  const text = Number(node.total.toPrecision(3)).toString();
  if (ctx.measureText(text).width <= maxWidth) return text;
  const [mantissa, exponent] = node.total.toExponential(2).split("e");
  return `${Number(mantissa)}e${Number(exponent)}`;
}

function beltHoverText(node) {
  const format = rate => Number(rate.toFixed(3)).toString();
  const items = [...node.rates].map(([item, rate]) => {
    const output = recipes.flatMap(recipe => recipe.outputs || []).find(output => (output.item || output.name) === item);
    return `${output?.name || item}: ${format(rate)}/min`;
  });
  return [
    `Belt flow: ${node.unknown ? "unknown" : `${format(node.total)}/min`}${node.inferred ? " (inferred from downstream demand; source rate unknown)" : ""}`,
    ...items.map(item => node.unknown ? `Known contribution - ${item}` : item),
    `Target: ${node.target === null ? "unknown" : `${format(node.target)}/min`}`,
    `Mk1 capacity: ${beltCapacity}/min (provisional)`,
    "Planning estimate; recipe confidence applies"
  ].join("\n");
}

function recipeRate(value) {
  const match = typeof value === "string" && value.trim().match(/^(\d+(?:\.\d+)?)\s*\/min$/);
  return match && Number.isFinite(Number(match[1])) ? Number(match[1]) : null;
}

function beltNetwork(beltList = belts) {
  const nodes = new Map();
  for (const belt of beltList) belt.cells.forEach((cell, index) => {
    nodes.set(beltCellKey(cell), {
      cell, belt, index, incoming: [], next: null, neighbors: new Set(), ports: [],
      rates: new Map(), unknown: false, processed: false
    });
  });
  for (const node of nodes.values()) {
    const { cell, belt, index } = node;
    for (const neighbor of [belt.cells[index - 1], belt.cells[index + 1]].filter(Boolean)) {
      node.neighbors.add(beltCellKey(neighbor));
    }
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(belt.cells, index)];
    const next = nodes.get(`${cell.x + dx},${cell.y + dy}`);
    if (next && (next.belt === belt || index === 0 || index === belt.cells.length - 1)) {
      node.next = next;
      next.incoming.push(node);
      node.neighbors.add(beltCellKey(next.cell));
      next.neighbors.add(beltCellKey(cell));
    }
  }
  for (const belt of beltList) for (const connection of beltConnections(belt.cells)) {
    nodes.get(beltCellKey(connection.cell)).ports.push(connection);
  }
  const sources = new Map();
  for (const node of nodes.values()) {
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(node.belt.cells, node.index)];
    node.sources = node.ports.filter(port => port.role !== "input" && (port.dx !== dx || port.dy !== dy));
    for (const port of node.sources) {
      const key = port.room ? `room:${port.room.id}` : `machine:${port.placement.id}`;
      if (!sources.has(key)) sources.set(key, new Set());
      sources.get(key).add(node);
    }
  }
  const distributors = new Map(placements.filter(p => p.slug === "container" ||
    getMachine(p.slug).belt_flow?.distribution === "equal_connected_outputs").map(p => [p.id, {
    placement: p, incoming: [], outputs: new Set(), rates: new Map(), unknown: false, processed: false
  }]));
  for (const node of nodes.values()) {
    node.flowNext = node.next ? [node.next] : [];
    for (const port of node.sources) {
      const distributor = port.placement && distributors.get(port.placement.id);
      if (!distributor) continue;
      distributor.outputs.add(node);
      if (!node.incoming.includes(distributor)) node.incoming.push(distributor);
    }
    if (node.next) continue;
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(node.belt.cells, node.index)];
    const sink = node.ports.find(port => port.role !== "output" && port.dx === dx && port.dy === dy);
    const distributor = sink?.placement && distributors.get(sink.placement.id);
    if (distributor) {
      node.flowNext.push(distributor);
      distributor.incoming.push(node);
    }
  }
  for (const distributor of distributors.values()) {
    distributor.flowNext = [...distributor.outputs];
    distributor.divisor = distributor.outputs.size || 1;
    if (!distributor.incoming.length) distributor.unknown = true;
  }
  const queue = [];
  for (const node of [...nodes.values(), ...distributors.values()]) {
    node.pending = node.incoming.length;
    if (!node.incoming.length && !node.sources?.length) node.unknown = true;
    for (const port of node.sources || []) {
      if (port.placement && distributors.has(port.placement.id)) continue;
      const key = port.room ? `room:${port.room.id}` : `machine:${port.placement.id}`;
      const recipe = port.placement && recipes.find(recipe =>
        recipe.machine === port.placement.slug && recipe.name === port.placement.recipe);
      if (!recipe?.outputs.length || sources.get(key).size !== 1) {
        node.unknown = true;
        continue;
      }
      for (const output of recipe.outputs) {
        const rate = recipeRate(output.per_min);
        if (rate === null) { node.unknown = true; continue; }
        const item = output.item || output.name;
        node.rates.set(item, (node.rates.get(item) || 0) + rate);
      }
    }
    if (!node.pending) queue.push(node);
  }
  const order = [];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    order.push(node);
    for (const next of node.flowNext) if (--next.pending === 0) queue.push(next);
  }
  const inputDemandGroups = new Map();
  for (const node of nodes.values()) {
    if (node.next) continue;
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(node.belt.cells, node.index)];
    const sink = node.ports.find(port => port.role !== "output" && port.dx === dx && port.dy === dy);
    const recipe = sink?.placement && recipes.find(recipe =>
      recipe.machine === sink.placement.slug && recipe.name === sink.placement.recipe);
    if (!recipe?.inputs.length || !recipe.inputs.every(input => recipeRate(input.per_min) !== null)) continue;
    if (!inputDemandGroups.has(sink.placement.id)) inputDemandGroups.set(sink.placement.id, new Map());
    const itemGroups = inputDemandGroups.get(sink.placement.id);
    const recipeDemand = new Map();
    for (const input of recipe.inputs) {
      const item = input.item || input.name;
      recipeDemand.set(item, (recipeDemand.get(item) || 0) + recipeRate(input.per_min));
    }
    // Separate belts into one machine share its total demand instead of each claiming all of it.
    for (const [item, rate] of recipeDemand) {
      if (!itemGroups.has(item)) itemGroups.set(item, { rate, nodes: new Set() });
      itemGroups.get(item).nodes.add(node);
    }
  }
  const inputDemands = new Map();
  for (const itemGroups of inputDemandGroups.values()) for (const [item, group] of itemGroups) {
    for (const node of group.nodes) {
      if (!inputDemands.has(node)) inputDemands.set(node, new Map());
      const demand = inputDemands.get(node);
      demand.set(item, (demand.get(item) || 0) + group.rate / group.nodes.size);
    }
  }
  for (const node of order.slice().reverse()) {
    if (!node.cell) {
      if (node.placement.slug === "splitter-mk-1" && node.outputs.size &&
          [...node.outputs].every(output => output.demand instanceof Map)) {
        node.demand = new Map();
        for (const output of node.outputs) for (const [item, rate] of output.demand) {
          node.demand.set(item, (node.demand.get(item) || 0) + rate);
        }
      }
      continue;
    }
    if (node.next) {
      node.demand = node.next.demand;
      continue;
    }
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(node.belt.cells, node.index)];
    const sink = node.ports.find(port => port.role !== "output" && port.dx === dx && port.dy === dy);
    const distributor = sink?.placement && distributors.get(sink.placement.id);
    if (distributor) {
      node.demand = distributor.demand;
      continue;
    }
    node.demand = inputDemands.get(node);
  }
  for (const node of order) {
    node.processed = true;
    if (node.cell && node.demand) {
      for (const [item, rate] of node.rates) {
        node.rates.set(item, Math.min(rate, node.demand.get(item) || 0));
      }
    }
    if (!node.cell) {
      const splitter = node.placement.slug === "splitter-mk-1";
      const allocations = new Map([...node.rates.keys()].map(item => [item, new Map()]));
      for (const item of node.rates.keys()) {
        let remaining = node.rates.get(item);
        let active = [...node.outputs].filter(output => !output.demand || (output.demand.get(item) || 0) > 0);
        while (active.length && remaining > 1e-8) {
          const share = remaining / active.length;
          const saturated = splitter ? active.filter(output =>
            output.demand && (output.demand.get(item) || 0) - (allocations.get(item).get(output) || 0) <= share + 1e-8) : [];
          if (!saturated.length) {
            for (const output of active) allocations.get(item).set(output, (allocations.get(item).get(output) || 0) + share);
            remaining = 0;
          } else {
            for (const output of saturated) {
              const capacity = (output.demand.get(item) || 0) - (allocations.get(item).get(output) || 0);
              allocations.get(item).set(output, (allocations.get(item).get(output) || 0) + capacity);
              remaining -= capacity;
            }
            active = active.filter(output => !saturated.includes(output));
          }
        }
      }
      for (const output of node.outputs) {
        for (const [item, rate] of allocations) {
          output.rates.set(item, (output.rates.get(item) || 0) + (rate.get(output) || 0));
        }
        output.unknown ||= node.unknown;
      }
      continue;
    }
    for (const next of node.flowNext) {
      if (!next.cell) {
        for (const [item, rate] of node.rates) {
          next.rates.set(item, (next.rates.get(item) || 0) + rate);
        }
        next.unknown ||= node.unknown;
        continue;
      }
      for (const [item, rate] of node.rates) {
        next.rates.set(item, (next.rates.get(item) || 0) + rate);
      }
      next.unknown ||= node.unknown;
    }
  }
  // Unknown supply (dock ports, un-fed containers) is backtracked from downstream demand,
  // minus what other known feeds already deliver at merges.
  for (const node of order.slice().reverse()) {
    if (!node.cell) {
      if (node.placement.slug === "splitter-mk-1" && node.outputs.size &&
          [...node.outputs].every(output => output.need)) {
        node.need = new Map();
        for (const output of node.outputs) for (const [item, rate] of output.need) {
          node.need.set(item, (node.need.get(item) || 0) + rate);
        }
      }
      continue;
    }
    const target = node.flowNext[0];
    if (!target) {
      node.need = node.demand;
      continue;
    }
    if (!target.need) continue;
    const others = target.incoming.filter(other => other !== node);
    const unknownFeeds = 1 + others.filter(other => other.unknown).length;
    node.need = new Map();
    for (const [item, rate] of target.need) {
      const known = others.filter(other => !other.unknown)
        .reduce((sum, other) => sum + (other.rates.get(item) || 0), 0);
      node.need.set(item, Math.max(0, rate - known) / unknownFeeds);
    }
  }
  for (const node of nodes.values()) {
    // Cycles and their downstream tiles cannot be assigned a finite steady rate.
    if (!node.processed) node.unknown = true;
    if (node.unknown && node.processed && node.need?.size) {
      for (const [item, rate] of node.need) node.rates.set(item, Math.max(node.rates.get(item) || 0, rate));
      node.unknown = false;
      node.inferred = true;
    }
    node.total = [...node.rates.values()].reduce((sum, rate) => sum + rate, 0);
    node.target = node.demand ? Math.min(beltCapacity, node.rates.size
      ? [...node.rates.keys()].reduce((sum, item) => sum + (node.demand.get(item) || 0), 0)
      : [...node.demand.values()].reduce((sum, rate) => sum + rate, 0)) : beltCapacity;
    node.load = node.unknown || beltCapacity === null ? "unknown" :
      node.total > beltCapacity || node.demand &&
        [...node.rates].some(([item, rate]) => rate > (node.demand.get(item) || 0) + 1e-8) ? "above" :
      Math.abs(node.total - node.target) < 1e-8 ? "equal" : node.total < node.target ? "below" : "above";
  }
  return nodes;
}

function drawBelt(belt, ghost = false) {
  const cells = belt.cells;
  const invalid = ghost && (beltDraft ? draftBeltProblem(cells) : beltProblem(cells));
  ctx.save();
  ctx.globalAlpha = ghost ? 0.7 : 1;
  const active = selected?.type === "belt" && selected.id === belt.id;
  const connections = beltConnections(cells);
  const connected = new Set(connections.map(connection =>
    connection.room ? `room:${connection.room.id}` : `machine:${connection.placement.id}`)).size >= 2;
  const beltSymbols = svgNode("g", { "data-belt-id": belt.id ?? "preview",
    "data-connected": connected, opacity: ghost ? 0.7 : 1 });
  for (const cell of cells) {
    const node = beltFlow.get(beltCellKey(cell));
    if (!node || ghost && node.cell !== cell) continue;
    const colors = {
      unknown: ["#65502d", "#d5a649"], below: ["#515b65", "#a6afb8"],
      equal: ["#236044", "#51c889"], above: ["#833c43", "#e36b74"]
    };
    const palette = invalid ? ["#833c43", "#c95e68"] : colors[node.load];
    const x = (cell.x + 0.5) * TILE, y = (cell.y + 0.5) * TILE;
    for (const [layer, width] of [12, 8].entries()) {
      const points = [...node.neighbors].map(key => {
        const neighbor = beltFlow.get(key).cell;
        return { x: (cell.x + neighbor.x + 1) * TILE / 2,
          y: (cell.y + neighbor.y + 1) * TILE / 2 };
      });
      for (const port of node.ports) {
        const inset = layer === 0 ? 1 : 3;
        points.push({ x: port.x - port.dx * inset, y: port.y - port.dy * inset });
      }
      if (points.length < 2) {
        const [dx, dy] = points.length ? [Math.sign(x - points[0].x), Math.sign(y - points[0].y)]
          : [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(cells, cells.indexOf(cell))];
        points.push({ x: x + dx * width / 2, y: y + dy * width / 2 });
        if (points.length === 1) points.push({ x: x - dx * width / 2, y: y - dy * width / 2 });
      }
      const path = points.slice(1).map(point =>
        `M${points[0].x} ${points[0].y} L${x} ${y} L${point.x} ${point.y}`).join(" ");
      svgNode("path", {
        d: path, fill: "none", stroke: palette[layer], "stroke-width": width,
        "stroke-linecap": "butt", "stroke-linejoin": "round", "data-symbol": "belt-track",
        "data-cell": beltCellKey(cell), "data-load": node.load, opacity: ghost ? 0.7 : 1
      }, beltLayers[layer]);
    }
  }
  if (active) svgNode("path", {
    d: cells.map((cell, index) => `${index ? "L" : "M"}${(cell.x + 0.5) * TILE} ${(cell.y + 0.5) * TILE}`).join(" "),
    fill: "none", stroke: "#c5e5ff", "stroke-width": 1, "stroke-dasharray": "2 3",
    "data-symbol": "belt-selection"
  }, beltSymbols);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const node = beltFlow.get(beltCellKey(cell));
    if (!node || ghost && node.cell !== cell) continue;
    const x = (cell.x + 0.5) * TILE, y = (cell.y + 0.5) * TILE;
    if (zoom >= BELT_RATE_ZOOM) {
      ctx.font = "bold 10px system-ui";
      const maxWidth = (TILE - 2) * zoom;
      const text = beltRateLabel(node, maxWidth);
      svgNode("text", {
        x: 0, y: 0, transform: `translate(${x} ${y}) scale(${1 / zoom})`,
        fill: invalid ? "#fff0f0" : "#302411", "font-weight": 700,
        "font-size": Math.min(10, 10 * maxWidth / ctx.measureText(text).width),
        "text-anchor": "middle", "dominant-baseline": "central",
        "data-symbol": "belt-rate", "data-cell": beltCellKey(cell)
      }, beltSymbols, text);
      continue;
    }
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][beltDirection(cells, i)];
    svgNode("path", {
      d: `M${x - dx * 2 - dy * 3} ${y - dy * 2 + dx * 3} L${x + dx * 2} ${y + dy * 2} L${x - dx * 2 + dy * 3} ${y - dy * 2 - dx * 3}`,
      fill: "none", stroke: invalid ? "#fff0f0" : "#302411", "stroke-width": 1.5,
      opacity: ghost ? 0.7 : 1, "data-symbol": "belt-arrow"
    }, beltSymbols);
  }
  ctx.restore();
}

function drawStars() {
  ctx.fillStyle = "#080d19";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 220; i++) {
    const x = (i * 197 + i * i * 13) % canvas.width;
    const y = (i * 109 + i * i * 7) % canvas.height;
    ctx.fillStyle = "#1c2838";
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawRoom(room, ghost = false) {
  const [w, h] = dimensions(room);
  ctx.save();
  ctx.translate(room.x * TILE, room.y * TILE);
  const rotation = room.rotation || 0;
  if (rotation === 1) ctx.translate(w * TILE, 0);
  if (rotation === 2) ctx.translate(w * TILE, h * TILE);
  if (rotation === 3) ctx.translate(0, h * TILE);
  ctx.rotate(rotation * Math.PI / 2);
  ctx.translate(-room.x * TILE, -room.y * TILE);
  const offsetX = rotation === 1 || rotation === 2 ? w * TILE : 0;
  const offsetY = rotation === 2 || rotation === 3 ? h * TILE : 0;
  const group = svgNode("g", {
    transform: `translate(${room.x * TILE + offsetX} ${room.y * TILE + offsetY}) rotate(${rotation * 90}) translate(${-room.x * TILE} ${-room.y * TILE})`,
    opacity: ghost ? 0.65 : 1
  });
  drawRoomBody({ ...room, rotation: 0 }, ghost,
    ghost && !canAddRoom(room), selected?.type === "room" && selected.id === room.id, group);
  ctx.restore();
}

function drawRoomBody(room, ghost, invalid, isSelected, group) {
  const [w, h] = dimensions(room);
  const type = roomTypes[room.size];
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.65;
  const special = type.kind === "dock" || type.kind === "control-center";
  const dockWidth = type.body_width_tiles;
  const dockLeft = (w - dockWidth) / 2;
  if (!special) for (let y = room.y; y < room.y + h; y++) for (let x = room.x; x < room.x + w; x++) {
    const tile = roomTile(room, x, y);
    ctx.fillStyle = tile === "opening" || tile === "floor" ? "#ffffff" : "#0a0d12";
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    ctx.strokeStyle = tile === "wall" ? "#242d39" : "#f1f3f5";
    ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
  }
  if (special) {
    ctx.fillStyle = "#808080";
    ctx.fillRect((room.x + 5) * TILE, room.y * TILE, 6 * TILE, TILE);
  }
  if (type.kind === "dock") {
    ctx.fillStyle = "#808080";
    ctx.fillRect((room.x + dockLeft) * TILE, (room.y + 1) * TILE, dockWidth * TILE, 14 * TILE);
    ctx.strokeStyle = "#8da5c3";
    ctx.strokeRect((room.x + dockLeft) * TILE + 1, (room.y + 1) * TILE + 1, dockWidth * TILE - 2, 14 * TILE - 2);
    for (const portX of type.ports) {
      const x = (room.x + portX) * TILE, y = room.y * TILE;
      svgNode("rect", { x: x + 1, y: y + 1, width: 14, height: 14, fill: "#ffffff" }, group);
      svgNode("path", { d: `M${x + 8} ${y + 12} V${y + 4} M${x + 4} ${y + 8} L${x + 8} ${y + 4} L${x + 12} ${y + 8}`,
        fill: "none", stroke: "#10141b", "stroke-width": 1.5, "data-symbol": "dock-arrow" }, group);
    }
    const ship = svgNode("g", { transform: `translate(${(room.x + 8) * TILE} ${(room.y + 15.5) * TILE})`, "data-symbol": "ship" }, group);
    svgNode("path", { d: "M0 -10 L5 -3 L5 3 L9 8 L3 6 L0 9 L-3 6 L-9 8 L-5 3 L-5 -3 Z",
      fill: "#e5edf5", stroke: "#30445d", "stroke-width": 1 }, ship);
    svgNode("path", { d: "M-2 8 L0 13 L2 8", fill: "#d5a649" }, ship);
  } else if (type.kind === "control-center") {
    ctx.fillStyle = "#808080";
    ctx.beginPath();
    ctx.moveTo((room.x + 1) * TILE, (room.y + 1) * TILE);
    ctx.lineTo((room.x + 15) * TILE, (room.y + 1) * TILE);
    ctx.lineTo((room.x + 15) * TILE, (room.y + 8) * TILE);
    ctx.arc((room.x + 8) * TILE, (room.y + 8) * TILE, 7 * TILE, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#8da5c3";
    ctx.stroke();
    svgNode("circle", { cx: (room.x + 8) * TILE, cy: (room.y + 8) * TILE,
      r: 6 * TILE, fill: "none", stroke: "#000000", "stroke-width": 2 }, group);
  }
  if (ghost || isSelected) {
    ctx.strokeStyle = invalid ? "#ff7575" : "#8bc5ff";
    ctx.lineWidth = 3;
    if (type.kind === "dock") {
      ctx.strokeRect((room.x + dockLeft) * TILE + 1.5, (room.y + 1) * TILE + 1.5, dockWidth * TILE - 3, 14 * TILE - 3);
    } else if (type.kind === "control-center") {
      ctx.beginPath();
      ctx.moveTo((room.x + 1) * TILE, (room.y + 1) * TILE);
      ctx.lineTo((room.x + 15) * TILE, (room.y + 1) * TILE);
      ctx.lineTo((room.x + 15) * TILE, (room.y + 8) * TILE);
      ctx.arc((room.x + 8) * TILE, (room.y + 8) * TILE, 7 * TILE, 0, Math.PI);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(room.x * TILE + 1.5, room.y * TILE + 1.5, w * TILE - 3, h * TILE - 3);
    }
  }
  ctx.restore();
}

function machinePath(x, y, width, height, cut) {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + width - cut, y);
  ctx.lineTo(x + width, y + cut);
  ctx.lineTo(x + width, y + height - cut);
  ctx.lineTo(x + width - cut, y + height);
  ctx.lineTo(x + cut, y + height);
  ctx.lineTo(x, y + height - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function fitLabel(text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened && ctx.measureText(`${shortened}...`).width > maxWidth) shortened = shortened.slice(0, -1);
  return shortened ? `${shortened}...` : "";
}

function productLines(text, maxWidth, maxLines = 2) {
  if (maxLines === 1) return [fitLabel(text, maxWidth)];
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(fitLabel(line, maxWidth));
      line = words[i];
      if (lines.length === maxLines - 1) {
        lines.push(fitLabel(words.slice(i).join(" "), maxWidth));
        return lines;
      }
    } else line = candidate;
  }
  if (line) lines.push(fitLabel(line, maxWidth));
  return lines;
}

function recipeLabelLines(recipe, maxWidth, maxLines) {
  const names = recipe.outputs.map(item => item.name || item.item).join(" + ");
  const withRates = recipe.outputs.map(item =>
    `${item.name || item.item}${item.per_min == null ? "" : ` ${item.per_min}`}`).join(" + ");
  const lines = productLines(withRates, maxWidth, maxLines);
  return lines.join(" ") === withRates ? lines : productLines(names, maxWidth, maxLines);
}

function drawMachine(placement, ghost = false, valid = true) {
  const machine = getMachine(placement.slug);
  const [w, h] = machineFootprint(machine, placement.rotation);
  const x = placement.x * TILE + 2, y = placement.y * TILE + 2;
  const width = w * TILE - 4, height = h * TILE - 4;
  const cut = machine.slug === "container" ? 0 : Math.min(TILE * 0.7, width / 4, height / 4);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.8;
  machinePath(x, y, width, height, cut);
  const active = selected?.type === "machine" && selected.id === placement.id;
  const colors = { assembler: "#334e68", refinery: "#315b5b", reactor: "#4b4667", container: "#465568" };
  ctx.fillStyle = !valid ? "#a74747" : active ? "#285e96" : colors[machine.slug] || "#334e68";
  ctx.fill();
  ctx.strokeStyle = !valid ? "#ffaaaa" : ghost || active ? "#67b8ff" : "#203246";
  ctx.lineWidth = ghost || active ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const recipe = recipes.find(recipe => recipe.machine === placement.slug && recipe.name === placement.recipe);
  const labelWidth = Math.max(machine.compact_label ? 8 : 0, width - 12);
  const name = ctx.measureText(machine.name).width <= labelWidth * zoom ? machine.name
    : machine.compact_label || (machine.slug === "container" ? "C" : machine.slug === "refinery" ? "Ref." : machine.name);
  const centerX = (placement.x + w / 2) * TILE, centerY = (placement.y + h / 2) * TILE;
  const group = svgNode("g", { opacity: ghost ? 0.8 : 1, "data-machine-id": placement.id ?? "preview" });
  const labels = svgNode("g", { transform: `translate(${centerX} ${centerY}) scale(${1 / zoom})`,
    "data-symbol": "machine-label" }, group);
  ctx.font = "10px system-ui";
  const lines = recipe ? recipeLabelLines(recipe, labelWidth * zoom,
    Math.max(1, Math.min(3, Math.floor((height * zoom - 26) / 11)))) : [];
  const nameY = -lines.length * 11 / 2;
  ctx.font = "bold 11px system-ui";
  svgNode("text", { x: 0, y: nameY, fill: "#ffffff",
    "font-size": 11, "font-weight": 700, "text-anchor": "middle", "dominant-baseline": "central" },
  labels, fitLabel(name, labelWidth * zoom));
  if (recipe) {
    ctx.font = "10px system-ui";
    ctx.fillStyle = "#d5e5f2";
    lines.forEach((line, index) => svgNode("text", { x: 0, y: nameY + 12 + index * 11,
      fill: "#d5e5f2", "font-size": 10, "text-anchor": "middle", "dominant-baseline": "central" }, labels, line));
  }
  const portCells = machinePorts(machine, placement.rotation);
  const drawnPortCells = machine.port_layout?.ports ? portCells : footprintCells(machine).map(cell => {
    const [px, py] = rotatedPort(cell, machine, placement.rotation);
    return { x: px, y: py, role: null };
  });
  for (const { x: px, y: py, role, side } of drawnPortCells) {
    const portX = (placement.x + px + 0.5) * TILE, portY = (placement.y + py + 0.5) * TILE;
    const edges = [];
    if (machine.port_layout?.ports) {
      if (side === "north") edges.push({ x: portX - 2.5, y: y + 1, width: 5, height: 2 });
      if (side === "south") edges.push({ x: portX - 2.5, y: y + height - 3, width: 5, height: 2 });
      if (side === "west") edges.push({ x: x + 1, y: portY - 2.5, width: 2, height: 5 });
      if (side === "east") edges.push({ x: x + width - 3, y: portY - 2.5, width: 2, height: 5 });
    } else {
      if (py === 0) edges.push({ x: portX - 2.5, y: y + 1, width: 5, height: 2 });
      if (py === h - 1) edges.push({ x: portX - 2.5, y: y + height - 3, width: 5, height: 2 });
      if (px === 0) edges.push({ x: x + 1, y: portY - 2.5, width: 2, height: 5 });
      if (px === w - 1) edges.push({ x: x + width - 3, y: portY - 2.5, width: 2, height: 5 });
    }
    for (const edge of edges) {
      const fill = role === "input" ? "#77b9ee" : role === "output" ? "#e4b85c" : "#afbecb";
      svgNode("rect", { ...edge, rx: 1, fill, "data-symbol": "machine-port",
        ...(role ? { "data-port-role": role } : {}) }, group);
    }
  }
  svgNode("path", {
    d: `M0 ${-height / 2 + 5} L-3 ${-height / 2 + 9} L3 ${-height / 2 + 9} Z`,
    transform: `translate(${centerX} ${centerY}) rotate(${placement.rotation * 90})`,
    fill: "#dce9f7", "data-symbol": "orientation"
  }, group);
  ctx.restore();
}

function draw() {
  symbols.replaceChildren();
  drawStars();
  for (const room of rooms) drawRoom(room);
  if (preview?.type === "room") drawRoom(preview.room, true);
  const visibleBelts = belts.filter(belt => belt.id !== beltDraft?.sourceId);
  const draft = beltDraft || (preview?.type === "belt" ? preview : null);
  if (draft) {
    const cells = draft.cells.filter(cell => !visibleBelts.some(belt =>
      belt.cells.some(other => other.x === cell.x && other.y === cell.y)));
    if (cells.length) visibleBelts.push({ ...draft, cells });
  }
  beltFlow = beltNetwork(visibleBelts);
  beltLayers = [svgNode("g", { "data-layer": "belt-outlines" }), svgNode("g", { "data-layer": "belt-fills" })];
  for (const belt of belts) if (belt.id !== beltDraft?.sourceId) drawBelt(belt);
  if (beltDraft) drawBelt(beltDraft, true);
  else if (preview?.type === "belt") drawBelt(preview, true);
  for (const placement of placements) {
    if (!drag || drag.id !== placement.id) drawMachine(placement);
  }
  if (drag) {
    const placement = placements.find(p => p.id === drag.id);
    if (placement) {
      const ghost = { ...placement, x: drag.x, y: drag.y };
      drawMachine(ghost, true, canPlace(getMachine(ghost.slug), ghost.x, ghost.y, ghost.rotation, ghost.id));
    }
  } else if (preview?.type === "machine") {
    const p = preview.placement;
    drawMachine(p, true, canPlace(getMachine(p.slug), p.x, p.y, p.rotation));
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - rect.left) * canvas.width / rect.width / TILE),
    y: Math.floor((event.clientY - rect.top) * canvas.height / rect.height / TILE)
  };
}

function placementAt(x, y) {
  for (let i = placements.length - 1; i >= 0; i--) {
    const p = placements[i];
    const [w, h] = machineFootprint(getMachine(p.slug), p.rotation);
    if (x >= p.x && x < p.x + w && y >= p.y && y < p.y + h) return p;
  }
  return null;
}

function roomAt(x, y) { return rooms.find(room => roomTile(room, x, y) !== null); }
function beltAt(x, y) { return belts.find(belt => belt.cells.some(cell => cell.x === x && cell.y === y)); }

function updatePreview(point) {
  if (tool.type === "room") {
    const room = { size: tool.size, x: Math.floor(point.x / ROOM_STEP) * ROOM_STEP, y: Math.floor(point.y / ROOM_STEP) * ROOM_STEP, rotation: previewRotation };
    preview = { type: "room", room };
    statusEl.textContent = canAddRoom(room) ? "Click to place room" : "Rooms cannot overlap and must connect at matching openings";
  } else if (tool.type === "machine") {
    const placement = { slug: tool.slug, x: point.x, y: point.y, rotation: previewRotation };
    preview = { type: "machine", placement };
    statusEl.textContent = canPlace(getMachine(placement.slug), placement.x, placement.y, placement.rotation)
      ? "Click to place machine" : "Machine needs usable, unoccupied room tiles";
  } else if (tool.type === "belt") {
    preview = { type: "belt", cells: [point] };
    const belt = beltAt(point.x, point.y);
    const endpoint = belt && [belt.cells[0], belt.cells.at(-1)].some(cell => cell.x === point.x && cell.y === point.y);
    statusEl.textContent = endpoint ? "Start here to extend this belt" :
      beltProblem(preview.cells) || "Drag a belt, or click start then end; R turns the tile under the cursor";
  } else preview = null;
}

canvas.addEventListener("pointermove", event => {
  const point = canvasPoint(event);
  cursorPoint = point;
  const hovered = placementAt(point.x, point.y);
  const hoveredBelt = beltAt(point.x, point.y) && beltFlow.get(beltCellKey(point));
  const recipe = hovered && recipes.find(recipe => recipe.machine === hovered.slug && recipe.name === hovered.recipe);
  const hoveredMachine = hovered && getMachine(hovered.slug);
  const portSummary = hoveredMachine?.port_layout?.ports
    ? `\n${hoveredMachine.port_layout.ports.filter(port => port.role === "input").length} input, ${hoveredMachine.port_layout.ports.filter(port => port.role === "output").length} outputs`
    : "";
  canvas.title = hovered ? `${hoveredMachine.name}${portSummary}${recipe
    ? `\n${recipe.name}\n${recipe.outputs.map(item => `${item.name || item.item}: ${item.per_min || "rate unknown"}`).join("\n")}\n${recipe.confidence || "confidence unknown"}`
    : "\nNo recipe assigned"}` : hoveredBelt ? beltHoverText(hoveredBelt) : "";
  if (beltDraft && (beltDraft.clickMode || event.pointerId === beltDraft.pointerId)) {
    if (!beltDraft.clickMode &&
        Math.hypot(event.clientX - beltDraft.startX, event.clientY - beltDraft.startY) >= 4) beltDraft.moved = true;
    extendBeltDraft(point);
  } else if (drag && event.pointerId === drag.pointerId) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4) drag.moved = true;
    if (!drag.moved) return;
    drag.x = point.x - drag.offsetX;
    drag.y = point.y - drag.offsetY;
    const p = placements.find(item => item.id === drag.id);
    statusEl.textContent = canPlace(getMachine(p.slug), drag.x, drag.y, p.rotation, p.id)
      ? "Release to move machine" : "Cannot move here — footprint overlaps or leaves usable tiles";
  } else if (!drag) updatePreview(point);
  draw();
});

canvas.addEventListener("pointerleave", () => {
  cursorPoint = null;
  canvas.title = "";
  if (!drag && !beltDraft) { preview = null; draw(); }
});

canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || drag) return;
  const point = canvasPoint(event);
  cursorPoint = point;
  if (beltDraft) {
    if (beltDraft.clickMode) {
      extendBeltDraft(point);
      finishBelt();
    }
    return;
  }
  if (tool.type === "belt") {
    let source = beltAt(point.x, point.y);
    let attachment = point;
    if (!source && !hasAdjacentPort(point)) {
      const nearby = belts.flatMap(belt =>
        [0, belt.cells.length - 1].filter((index, i, indices) => indices.indexOf(index) === i)
          .filter(index => endpointExtendsTo(belt.cells, index, point))
          .map(index => ({ belt, cell: belt.cells[index] })));
      if (nearby.length === 1 && !hasAdjacentPort(nearby[0].cell)) {
        source = nearby[0].belt;
        attachment = nearby[0].cell;
      }
    }
    const first = source?.cells[0], last = source?.cells.at(-1);
    const prepend = first?.x === attachment.x && first?.y === attachment.y && source.cells.length > 1;
    const atEnd = source && (prepend || last.x === attachment.x && last.y === attachment.y);
    const problem = beltProblem([point], rooms, placements, belts.filter(belt => !atEnd || belt !== source));
    if (problem) { statusEl.textContent = problem; return; }
    const start = preview?.type === "belt" && preview.cells[0].x === point.x &&
      preview.cells[0].y === point.y ? { ...preview.cells[0] } : point;
    selected = null;
    preview = null;
    const cells = atEnd
      ? prepend ? reversedBeltCells(source.cells) : source.cells.map(cell => ({ ...cell }))
      : [];
    if (!atEnd || attachment.x !== point.x || attachment.y !== point.y) cells.push(start);
    beltDraft = { pointerId: event.pointerId,
      cells, sourceId: atEnd ? source.id : null, prepend, anchorLength: cells.length, moved: false,
      startX: event.clientX, startY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    updateDetails();
    draw();
    return;
  }
  const existing = tool.type !== "room" && placementAt(point.x, point.y);
  if (existing) {
    const wasSelected = selected?.type === "machine" && selected.id === existing.id;
    setTool({ type: "select" });
    selected = { type: "machine", id: existing.id };
    drag = { id: existing.id, pointerId: event.pointerId, offsetX: point.x - existing.x, offsetY: point.y - existing.y, x: existing.x, y: existing.y,
      wasSelected, moved: false, startX: event.clientX, startY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    updateDetails();
    draw();
    return;
  }
  if (tool.type === "select") {
    const belt = beltAt(point.x, point.y);
    const room = roomAt(point.x, point.y);
    const target = belt ? { type: "belt", id: belt.id } : room ? { type: "room", id: room.id } : null;
    selected = target && selected?.type === target.type && selected.id === target.id ? null : target;
    updateDetails();
    draw();
  } else {
    updatePreview(point);
    if (preview.type === "room") {
      if (canAddRoom(preview.room)) {
        rooms.push({ ...preview.room, id: nextId++ });
        statusEl.textContent = "Room placed";
      } else statusEl.textContent = "Cannot place room here";
    } else {
      const p = preview.placement;
      if (canPlace(getMachine(p.slug), p.x, p.y, p.rotation)) {
        const placement = { ...p, id: nextId++ };
        placements.push(placement);
        selected = { type: "machine", id: placement.id };
        statusEl.textContent = `${getMachine(p.slug).name} placed`;
      } else statusEl.textContent = "Cannot place machine here";
      updateDetails();
      updatePower();
    }
    preview = null;
    draw();
  }
});

canvas.addEventListener("pointerup", event => {
  if (beltDraft && beltDraft.pointerId === event.pointerId) {
    extendBeltDraft(canvasPoint(event));
    if (!beltDraft.moved && beltDraft.cells.length === beltDraft.anchorLength) {
      beltDraft.clickMode = true;
      beltDraft.pointerId = undefined;
      statusEl.textContent = "Belt start set; move the pointer and click to finish; Escape cancels";
      draw();
      return;
    }
    finishBelt();
    return;
  }
  if (!drag || drag.pointerId !== event.pointerId) return;
  const point = canvasPoint(event);
  const p = placements.find(item => item.id === drag.id);
  const x = point.x - drag.offsetX, y = point.y - drag.offsetY;
  if (!drag.moved) {
    if (drag.wasSelected) selected = null;
    statusEl.textContent = selected ? `${getMachine(p.slug).name} selected` : "Selection cleared";
  } else if (canPlace(getMachine(p.slug), x, y, p.rotation, p.id)) {
    p.x = x;
    p.y = y;
    statusEl.textContent = `${getMachine(p.slug).name} moved`;
  } else statusEl.textContent = "Move cancelled — footprint overlaps or leaves usable tiles";
  drag = null;
  updateDetails();
  draw();
});

function cancelPointerAction() {
  const pointerId = beltDraft?.pointerId ?? drag?.pointerId;
  const active = Boolean(beltDraft || drag);
  drag = null;
  beltDraft = null;
  if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  return active;
}

for (const name of ["pointercancel", "lostpointercapture"]) {
  canvas.addEventListener(name, () => {
    if (name === "lostpointercapture" && beltDraft?.clickMode) return;
    if (cancelPointerAction()) {
      statusEl.textContent = "Drawing or move cancelled";
      draw();
    }
  });
}

function updateDetails() {
  const details = document.getElementById("selection-details");
  const recipesEl = document.getElementById("recipe-list");
  document.getElementById("recipe-control").hidden = true;
  if (!selected) {
    details.textContent = "Nothing selected";
    recipesEl.textContent = "Select a machine to view recipes.";
    return;
  }
  if (selected.type === "belt") {
    const belt = belts.find(item => item.id === selected.id);
    details.textContent = `Belt: ${belt.cells.length} tiles; hover a tile and press R to turn or X to remove it (provisional rules)`;
    recipesEl.textContent = "Select an Assembler or Refinery to assign a recipe.";
    return;
  }
  if (selected.type === "room") {
    const room = rooms.find(item => item.id === selected.id);
    const roomType = roomTypes[room.size];
    const roomName = roomType.name || `Station ${room.size}`;
    details.textContent = `${roomName} at ${room.x}, ${room.y}; rotation ${(room.rotation || 0) * 90}°${roomType.confidence === "inferred" || room.size === "2x1" ? " (geometry inferred)" : ""}`;
    recipesEl.textContent = "Select a machine to view recipes.";
    return;
  }
  const p = placements.find(item => item.id === selected.id);
  const m = getMachine(p.slug);
  const portSummary = m.port_layout?.ports
    ? `; ports ${m.port_layout.ports.filter(port => port.role === "input").length} in / ${m.port_layout.ports.filter(port => port.role === "output").length} out`
    : "";
  details.textContent = `${m.name} — position ${p.x}, ${p.y}; rotation ${p.rotation * 90}°; footprint ${machineFootprint(m, p.rotation).join("×")}${portSummary}`;
  if (canAssignRecipe(m.slug)) {
    const control = document.getElementById("recipe-control");
    const select = document.getElementById("recipe-select");
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No recipe assigned";
    select.append(empty);
    for (const recipe of recipes.filter(recipe => recipe.machine === m.slug)) {
      const option = document.createElement("option");
      option.value = recipe.name;
      option.textContent = `${recipe.name} (${recipe.confidence || "confidence unknown"})`;
      select.append(option);
    }
    select.value = p.recipe || "";
    control.hidden = false;
  }
  showRecipes(m.slug, p.recipe);
}

function canAssignRecipe(slug) { return slug === "assembler" || slug === "refinery"; }

function assignRecipe(name) {
  const placement = selected?.type === "machine" && placements.find(p => p.id === selected.id);
  if (!placement || !canAssignRecipe(placement.slug)) {
    statusEl.textContent = "Select an Assembler or Refinery to assign a recipe";
    return;
  }
  if (name !== "" && !recipes.some(recipe => recipe.machine === placement.slug && recipe.name === name)) {
    statusEl.textContent = "Recipe does not match the selected machine";
    return;
  }
  if (name) placement.recipe = name;
  else delete placement.recipe;
  updateDetails();
  draw();
  statusEl.textContent = name ? `Recipe assigned: ${name}` : "Recipe cleared";
}

document.getElementById("recipe-select").addEventListener("change", event => assignRecipe(event.target.value));

function showRecipes(machineSlug, recipeName) {
  const el = document.getElementById("recipe-list");
  const matches = recipes.filter(recipe => recipe.machine === machineSlug && (!recipeName || recipe.name === recipeName));
  el.replaceChildren();
  if (!matches.length) {
    el.textContent = "No matching recipes in data.";
    return;
  }
  for (const recipe of matches) {
    const row = document.createElement("div");
    row.className = "recipe";
    const title = document.createElement("strong");
    title.textContent = recipe.name;
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = `${recipe.craft_time || "Time unknown"} · ${recipe.confidence || "confidence unknown"}`;
    const inputs = document.createElement("div");
    inputs.textContent = `In: ${(recipe.inputs || []).map(i => `${i.name || i.item} ${i.per_min || i.count || ""}`).join(" · ") || "—"}`;
    const outputs = document.createElement("div");
    outputs.textContent = `Out: ${(recipe.outputs || []).map(i => `${i.name || i.item} ${i.per_min || i.count || ""}`).join(" · ") || "—"}`;
    row.append(title, meta, inputs, outputs);
    el.append(row);
  }
}

function updatePower() {
  let consumption = 0, unknown = 0;
  for (const placement of placements) {
    const machine = getMachine(placement.slug);
    if (typeof machine.power_mw === "number") consumption += machine.power_mw;
    else unknown++;
  }
  document.getElementById("power-total").textContent =
    `Known consumption: ${consumption} MW${unknown ? ` · ${unknown} machine${unknown === 1 ? "" : "s"} with unknown power` : ""}`;
}

function setTool(value) {
  cancelPointerAction();
  tool = value;
  preview = null;
  selected = null;
  previewRotation = 0;
  document.querySelectorAll(".machine-button, .room-button, #select, #belt").forEach(button => {
    const active = value.type === "machine" ? button.dataset.slug === value.slug
      : value.type === "room" ? button.dataset.size === value.size : button.id === value.type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateDetails();
  draw();
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function toggleTool(value) {
  const active = tool.type === value.type &&
    (value.type === "room" ? tool.size === value.size : tool.slug === value.slug);
  setTool(active ? { type: "select" } : value);
  statusEl.textContent = active ? "Selection cleared" : value.type === "belt"
    ? "Drag a belt, or click start then end; Escape cancels (provisional rules)" : "Click to place; press R to rotate";
}

async function loadData() {
  const [machineJson, recipeJson, moduleJson, roomJson, beltJson] = await Promise.all([
    fetchJson("data/machines.json"), fetchJson("data/recipes.json"), fetchJson("data/modules.json"), fetchJson("data/rooms.json"),
    fetchJson("data/belts.json")
  ]);
  if (!Number.isFinite(beltJson.capacity_per_min) || beltJson.capacity_per_min <= 0) {
    throw new Error("Invalid Mk1 belt capacity");
  }
  beltCapacity = beltJson.capacity_per_min;
  const slugs = { "1x1": "station-1-1", "2x1": "station-2-1", "2x2": "station-2-2-a" };
  for (const [size, slug] of Object.entries(slugs)) {
    const module = moduleJson.modules.find(item => item.slug === slug);
    const dims = module?.grid_total || module?.grid_total_inferred;
    if (!Array.isArray(dims) || dims.length !== 2 || !dims.every(n => Number.isInteger(n) && n > 0)) {
      throw new Error(`Missing station dimensions: ${slug}`);
    }
    roomTypes[size] = { dimensions: dims };
  }
  for (const room of roomJson.rooms || []) {
    if (Array.isArray(room.dimensions) && room.dimensions.length === 2) {
      roomTypes[room.slug] = room;
    }
  }
  machines = machineJson.machines.filter(machine => Array.isArray(machine.footprint_tiles));
  recipes = recipeJson.recipes;
  machineList.replaceChildren();
  beltMachineList.replaceChildren();
  for (const machine of machines.filter(machine => !machine.port_layout?.ports)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "machine-button";
    button.dataset.slug = machine.slug;
    const name = document.createElement("span");
    name.textContent = machine.name;
    const footprint = document.createElement("small");
    footprint.textContent = machine.footprint_tiles.join("×");
    button.append(name, footprint);
    button.addEventListener("click", () => toggleTool({ type: "machine", slug: machine.slug }));
    machineList.append(button);
  }
  for (const machine of machines.filter(machine => machine.port_layout?.ports)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "machine-button";
    button.dataset.slug = machine.slug;
    const name = document.createElement("span");
    name.textContent = machine.name;
    const footprint = document.createElement("small");
    footprint.textContent = machine.footprint_tiles.join("×");
    button.append(name, footprint);
    button.addEventListener("click", () => toggleTool({ type: "machine", slug: machine.slug }));
    beltMachineList.append(button);
  }
  for (const button of document.querySelectorAll(".room-button")) {
    button.addEventListener("click", () => toggleTool({ type: "room", size: button.dataset.size }));
  }
  setTool({ type: "select" });
  updatePower();
  statusEl.textContent = "Choose a room and place it in the star field";
}

function serialize() {
  return {
    version: 3,
    rooms: rooms.map(room => ({ ...room })),
    placements: placements.map(p => ({ ...p })),
    belts: belts.map(belt => ({ id: belt.id, cells: belt.cells.map(cell => ({ ...cell })) }))
  };
}

function restore(state) {
  if (!state || !Array.isArray(state.placements)) throw new Error("Invalid layout");
  let restoredRooms, restoredPlacements;
  if (state.version === 1 && roomTypes[state.station]) {
    restoredRooms = [{ id: 1, size: state.station, x: INITIAL_X, y: INITIAL_Y }];
    restoredPlacements = state.placements.map((p, index) => ({ ...p, id: index + 2, x: p.x + INITIAL_X, y: p.y + INITIAL_Y }));
  } else if ((state.version === 2 || state.version === 3) && Array.isArray(state.rooms)) {
    restoredRooms = state.rooms.map(room => ({ ...room }));
    restoredPlacements = state.placements.map(p => ({ ...p }));
  } else throw new Error("Unsupported layout version");
  if (state.version === 3 && !Array.isArray(state.belts)) throw new Error("Invalid belts");
  const restoredBelts = state.version === 3 ? state.belts : [];

  const ids = new Set();
  function validId(id) {
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) return false;
    ids.add(id);
    return true;
  }
  const checkedRooms = [];
  for (const room of restoredRooms) {
    if (room.rotation === undefined) room.rotation = 0;
    if (!validId(room.id) || !roomTypes[room.size] || !Number.isInteger(room.x) || !Number.isInteger(room.y) ||
        !Number.isInteger(room.rotation) || room.rotation < 0 || room.rotation > 3) throw new Error("Invalid room");
    const [w, h] = dimensions(room);
    if (room.x < 0 || room.y < 0 || room.x + w > FIELD_WIDTH || room.y + h > FIELD_HEIGHT ||
        checkedRooms.some(other => roomsOverlap(room, other))) throw new Error("Room outside field or overlapping");
    checkedRooms.push(room);
  }
  if (!allRoomsConnected(checkedRooms)) throw new Error("Rooms are not connected");
  const checkedPlacements = [];
  for (const p of restoredPlacements) {
    const machine = getMachine(p.slug);
    if (!validId(p.id) || !machine || !Number.isInteger(p.x) || !Number.isInteger(p.y) ||
        !Number.isInteger(p.rotation) || p.rotation < 0 || p.rotation > 3 ||
        !canPlace(machine, p.x, p.y, p.rotation, null, checkedRooms, checkedPlacements, [])) {
      throw new Error("Invalid machine placement");
    }
    if (p.recipe !== undefined && (!canAssignRecipe(p.slug) ||
        !recipes.some(recipe => recipe.machine === p.slug && recipe.name === p.recipe))) {
      throw new Error(`Unknown or incompatible recipe for ${machine.name}`);
    }
    checkedPlacements.push(p);
  }
  const checkedBelts = [];
  for (const belt of restoredBelts) {
    if (!belt || !validId(belt.id) || !Array.isArray(belt.cells) || belt.cells.length < 1) throw new Error("Invalid belt");
    const problem = beltProblem(belt.cells, checkedRooms, checkedPlacements, checkedBelts);
    if (problem) throw new Error(`Invalid belt: ${problem}`);
    checkedBelts.push({ id: belt.id, cells: belt.cells.map(cell => ({
      x: cell.x, y: cell.y, ...(cell.direction === undefined ? {} : { direction: cell.direction })
    })) });
  }
  rooms = checkedRooms;
  placements = checkedPlacements;
  belts = checkedBelts;
  nextId = Math.max(0, ...ids) + 1;
  drag = null;
  setTool({ type: "select" });
  updatePower();
  centerField(rooms[0] || { x: INITIAL_X, y: INITIAL_Y });
}

function projectHash() {
  const bytes = new TextEncoder().encode(JSON.stringify(serialize()));
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function restoreHash() {
  if (!location.hash.startsWith("#layout=")) return;
  try {
    const encoded = location.hash.slice(8).replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    restore(JSON.parse(new TextDecoder().decode(bytes)));
    statusEl.textContent = "Shared layout loaded";
  } catch (error) { statusEl.textContent = `Could not read layout from URL: ${error.message}`; }
}

function centerField(point) {
  const wrap = document.querySelector(".canvas-wrap");
  wrap.scrollLeft = Math.max(0, (point.x + 8) * TILE * zoom - wrap.clientWidth / 2);
  wrap.scrollTop = Math.max(0, (point.y + 8) * TILE * zoom - wrap.clientHeight / 2);
}

function fitLayout() {
  if (!rooms.length) {
    setZoom(1);
    centerField({ x: INITIAL_X, y: INITIAL_Y });
    return;
  }
  const left = Math.min(...rooms.map(room => room.x));
  const top = Math.min(...rooms.map(room => room.y));
  const right = Math.max(...rooms.map(room => room.x + dimensions(room)[0]));
  const bottom = Math.max(...rooms.map(room => room.y + dimensions(room)[1]));
  const padding = 2 * TILE;
  setZoom(Math.min(1, canvasWrap.clientWidth / ((right - left) * TILE + 2 * padding),
    canvasWrap.clientHeight / ((bottom - top) * TILE + 2 * padding)));
  centerField({ x: (left + right) / 2 - 8, y: (top + bottom) / 2 - 8 });
}

function rotateSelected() {
  if (drag) return;
  if (cursorPoint) {
    const belt = beltDraft || beltAt(cursorPoint.x, cursorPoint.y) ||
      (tool.type === "belt" && preview?.type === "belt" ? preview : null);
    const index = belt ? belt.cells.findIndex(cell => cell.x === cursorPoint.x && cell.y === cursorPoint.y) : -1;
    if (index >= 0) {
      belt.cells[index].direction = (beltDirection(belt.cells, index) + 1) % 4;
      statusEl.textContent = "Belt tile turned clockwise";
      draw();
      return;
    }
  }
  if (beltDraft) return;
  if (selected?.type === "machine") {
    const p = placements.find(item => item.id === selected.id);
    const rotation = (p.rotation + 1) % 4;
    if (canPlace(getMachine(p.slug), p.x, p.y, rotation, p.id)) {
      p.rotation = rotation;
      statusEl.textContent = "Machine rotated";
    } else statusEl.textContent = "Cannot rotate here — footprint would collide";
  } else if (selected?.type === "room") {
    const room = rooms.find(item => item.id === selected.id);
    const rotated = { ...room, rotation: ((room.rotation || 0) + 1) % 4 };
    const remaining = rooms.filter(item => item.id !== room.id);
    const rotatedRooms = rooms.map(item => item.id === room.id ? rotated : item);
    if (canAddRoom(rotated, remaining) && allRoomsConnected(rotatedRooms) &&
        placements.every(p => canPlace(getMachine(p.slug), p.x, p.y, p.rotation, p.id, rotatedRooms)) &&
        belts.every(belt => !beltProblem(belt.cells, rotatedRooms, placements, []))) {
      room.rotation = rotated.rotation;
      statusEl.textContent = "Room rotated";
    } else statusEl.textContent = "Cannot rotate room: it would overlap, disconnect rooms, or block machines or belts";
  } else if (tool.type === "machine" || tool.type === "room") {
    previewRotation = (previewRotation + 1) % 4;
    if (preview?.type === "machine") preview.placement.rotation = previewRotation;
    if (preview?.type === "room") preview.room.rotation = previewRotation;
    statusEl.textContent = `Placement rotation: ${previewRotation * 90}°`;
  } else statusEl.textContent = "Select a room or machine to rotate";
  updateDetails();
  draw();
}

document.getElementById("zoom-out").addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
document.getElementById("zoom-in").addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
document.getElementById("zoom-reset").addEventListener("click", fitLayout);
canvasWrap.addEventListener("wheel", event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), event);
}, { passive: false });
document.getElementById("select").addEventListener("click", () => setTool({ type: "select" }));
document.getElementById("belt").addEventListener("click", () => toggleTool({ type: "belt" }));
document.getElementById("rotate").addEventListener("click", rotateSelected);
window.addEventListener("keydown", event => {
  if ((event.key === "Delete" || event.key === "Backspace") &&
      !event.ctrlKey && !event.metaKey && !event.altKey && selected &&
      !event.target?.isContentEditable &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (event.key.toLowerCase() === "x" && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.target?.isContentEditable && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName) &&
      cursorPoint && beltAt(cursorPoint.x, cursorPoint.y)) {
    event.preventDefault();
    deleteBeltTile();
    return;
  }
  if (event.key === "Escape") {
    setTool({ type: "select" });
    statusEl.textContent = "Selection cleared";
    return;
  }
  if ((event.key === "+" || event.key === "=") && !event.ctrlKey && !event.metaKey &&
      !event.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
    setZoom(zoom + ZOOM_STEP);
    return;
  }
  if (event.key === "-" && !event.ctrlKey && !event.metaKey &&
      !event.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
    setZoom(zoom - ZOOM_STEP);
    return;
  }
  if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
    event.preventDefault();
    rotateSelected();
  }
});

function deleteBeltTile() {
  if (drag || beltDraft) { statusEl.textContent = "Finish or cancel drawing or moving first"; return; }
  const belt = cursorPoint && beltAt(cursorPoint.x, cursorPoint.y);
  if (!belt) return;
  const index = belt.cells.findIndex(cell => cell.x === cursorPoint.x && cell.y === cursorPoint.y);
  const parts = [
    { cells: belt.cells.slice(0, index), start: 0 },
    { cells: belt.cells.slice(index + 1), start: index + 1 }
  ].filter(part => part.cells.length).map(part => ({
    id: belt.id,
    cells: part.cells.map((cell, i) => {
      const direction = beltDirection(belt.cells, part.start + i);
      return direction === beltDirection(part.cells, i) ? cell : { ...cell, direction };
    })
  }));
  if (parts.length === 2) parts[1].id = nextId++;
  belts.splice(belts.indexOf(belt), 1, ...parts);
  if (!parts.length && selected?.type === "belt" && selected.id === belt.id) selected = null;
  if (preview?.type === "belt") preview = null;
  canvas.title = "";
  updateDetails();
  draw();
  statusEl.textContent = "Belt tile removed";
}

function deleteSelected() {
  if (drag || beltDraft) { statusEl.textContent = "Finish or cancel drawing or moving first"; return; }
  if (!selected) { statusEl.textContent = "Select a room, machine, or belt first"; return; }
  if (selected.type === "machine") {
    placements = placements.filter(p => p.id !== selected.id);
  } else if (selected.type === "belt") {
    belts = belts.filter(belt => belt.id !== selected.id);
  } else {
    const remaining = rooms.filter(room => room.id !== selected.id);
    if (!allRoomsConnected(remaining) || placements.some(p =>
      !canPlace(getMachine(p.slug), p.x, p.y, p.rotation, p.id, remaining)) ||
        belts.some(belt => beltProblem(belt.cells, remaining, placements, []))) {
      statusEl.textContent = "Cannot remove room: it supports machines or belts, or connects other rooms";
      return;
    }
    rooms = remaining;
  }
  selected = null;
  updateDetails();
  updatePower();
  draw();
  statusEl.textContent = "Selection deleted";
}
document.getElementById("delete").addEventListener("click", deleteSelected);
document.getElementById("clear").addEventListener("click", () => {
  rooms = [];
  placements = [];
  belts = [];
  setTool({ type: "select" });
  updatePower();
  statusEl.textContent = "Layout cleared";
});
document.getElementById("save").addEventListener("click", () => {
  try {
    localStorage.setItem("main-sequence-layout", JSON.stringify(serialize()));
    statusEl.textContent = "Layout saved locally";
  } catch (error) { statusEl.textContent = `Save failed: ${error.message}`; }
});
document.getElementById("load").addEventListener("click", () => {
  try {
    restore(JSON.parse(localStorage.getItem("main-sequence-layout")));
    statusEl.textContent = "Local layout loaded";
  } catch (error) { statusEl.textContent = `Load failed: ${error.message}`; }
});
document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "main-sequence-layout.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.getElementById("import").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    restore(JSON.parse(await file.text()));
    statusEl.textContent = "Layout imported";
  } catch (error) { statusEl.textContent = `Import failed: ${error.message}`; }
  event.target.value = "";
});
document.getElementById("share").addEventListener("click", async () => {
  history.replaceState(null, "", `#layout=${projectHash()}`);
  try {
    await navigator.clipboard.writeText(location.href);
    statusEl.textContent = "Share link copied";
  } catch (_) { statusEl.textContent = "Share link added to address bar"; }
});

centerField({ x: INITIAL_X, y: INITIAL_Y });
loadData().then(async () => {
  if (location.hash.startsWith("#layout=")) restoreHash();
  else {
    restore(await fetchJson("data/default-layout.json"));
    fitLayout();
    statusEl.textContent = "Starter layout loaded: Dock above Station 1x1 above Control Center";
  }
}).catch(error => {
  statusEl.textContent = `Data failed to load: ${error.message}`;
});
