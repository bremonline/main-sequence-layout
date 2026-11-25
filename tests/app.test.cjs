const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

async function app(hash = "") {
  const root = join(__dirname, "..");
  const elements = new Map();
  const saved = new Map();
  function element() {
    return {
      style: {}, dataset: {}, children: [], listeners: {}, attributes: {},
      classList: { toggle() {} },
      clientWidth: 800, clientHeight: 600, scrollLeft: 0, scrollTop: 0,
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      getContext() {
        return new Proxy({}, {
          get(target, key) {
            if (key === "measureText") return text => ({ width: text.length * 6 });
            return target[key] ?? (() => {});
          }
        });
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 2048, height: 1536 }; },
      setPointerCapture() {},
      hasPointerCapture() { return false; }
    };
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: get,
      querySelector: get,
      querySelectorAll: () => [],
      createElement: element,
      createElementNS(namespace, tag) { return { ...element(), namespaceURI: namespace, tagName: tag }; }
    },
    window: element(),
    location: { hash },
    TextEncoder, TextDecoder, btoa, atob, Blob,
    localStorage: {
      setItem: (key, value) => saved.set(key, value),
      getItem: key => saved.get(key) ?? null
    },
    fetch: async path => ({
      ok: true,
      json: async () => JSON.parse(readFileSync(join(root, path), "utf8"))
    })
  });
  vm.runInContext(readFileSync(join(root, "app.js"), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext("machines.length", context), 10);
  return {
    run: code => vm.runInContext(code, context),
    pointerAt(name, x, y) {
      get("layout-canvas").listeners[name]({ button: 0, pointerId: 1, clientX: x, clientY: y });
    },
    pointer(name, x, y) {
      get("layout-canvas").listeners[name]({
        button: 0, pointerId: 1, clientX: x * 16 + 8, clientY: y * 16 + 8
      });
    }
  };
}

test("belt machines are grouped beside belts with confirmed footprints and port roles", async () => {
  const { run } = await app();
  assert.equal(run('document.getElementById("machine-list").children.length'), 7);
  assert.equal(run('document.getElementById("belt-machine-list").children.length'), 3);
  assert.equal(run('machineFootprint(getMachine("splitter-mk-1")).join("x")'), "1x1");
  assert.equal(run('machineFootprint(getMachine("belt-balancer-mk-1")).join("x")'), "2x1");
  assert.equal(run('machinePorts(getMachine("splitter-mk-1")).filter(p=>p.role==="input").length'), 1);
  assert.equal(run('machinePorts(getMachine("splitter-mk-1")).filter(p=>p.role==="output").length'), 3);
  assert.equal(run('machinePorts(getMachine("belt-balancer-mk-1")).filter(p=>p.role==="input").length'), 2);
  assert.equal(run('machinePorts(getMachine("belt-balancer-mk-1")).filter(p=>p.role==="output").length'), 2);
  assert.equal(run('machinePorts(getMachine("splitter-mk-1"),1).find(p=>p.role==="input").side'), "east");
});

test("export asks for a filename, adds the JSON extension, and respects cancellation", async () => {
  const { run } = await app();
  const layout = run("JSON.stringify(serialize())");
  run(`globalThis.downloads=[];
    Object.assign(document.getElementById("export-dialog"),{
      showModal(){this.open=true;},
      close(value){this.open=false;if(value!==undefined)this.returnValue=value;this.listeners.close();}
    });
    Object.assign(document.getElementById("export-filename"),{
      select(){},
      setCustomValidity(message){this.validationMessage=message;},
      reportValidity(){return !this.validationMessage;}
    });
    globalThis.URL={
      createObjectURL(blob){globalThis.exportedBlob=blob;return "blob:layout";},
      revokeObjectURL(url){globalThis.revokedURL=url;}
    };
    globalThis.setTimeout=callback=>callback();
    document.createElement=()=>({click(){downloads.push({name:this.download,href:this.href});}});`);
  for (const [filename, expected] of [
    ["My factory", "My factory.json"],
    ["  Titanium setup.json  ", "Titanium setup.json"],
    ["Station.JSON", "Station.JSON"]
  ]) {
    run('document.getElementById("export").listeners.click()');
    assert.equal(run('document.getElementById("export-dialog").open'), true);
    assert.equal(run('document.getElementById("export-filename").value'), "main-sequence-layout.json");
    run(`document.getElementById("export-filename").value=${JSON.stringify(filename)};
      document.getElementById("export-form").listeners.submit({preventDefault(){}})`);
    assert.equal(run('document.getElementById("export-dialog").open'), false);
    assert.equal(run("downloads.at(-1).name"), expected);
    assert.equal(run("downloads.at(-1).href"), "blob:layout");
    assert.equal(run("exportedBlob.type"), "application/json");
    assert.equal(JSON.stringify(JSON.parse(await run("exportedBlob.text()"))), layout);
    assert.equal(run("revokedURL"), "blob:layout");
  }
  run(`document.getElementById("export").listeners.click();
    selected={type:"room",id:1};
    window.listeners.keydown({key:"Escape",target:{tagName:"INPUT"}})`);
  assert.equal(run("selected.id"), 1);
  run('document.getElementById("export-cancel").listeners.click()');
  assert.equal(run("downloads.length"), 3);
  assert.equal(run('document.getElementById("export-dialog").open'), false);
  assert.match(run('document.getElementById("status").textContent'), /cancelled/i);
  run(`document.getElementById("export").listeners.click();
    document.getElementById("export-dialog").listeners.keydown({
      key:"Escape",preventDefault(){},stopPropagation(){}
    })`);
  assert.equal(run('document.getElementById("export-dialog").open'), false);
  assert.equal(run("selected.id"), 1);
  assert.equal(run("downloads.length"), 3);
  for (const filename of ["", "   "]) {
    run(`document.getElementById("export").listeners.click();
      document.getElementById("export-filename").value=${JSON.stringify(filename)};
      document.getElementById("export-form").listeners.submit({preventDefault(){}})`);
    assert.equal(run("downloads.length"), 3);
    assert.equal(run('document.getElementById("export-dialog").open'), true);
    assert.match(run('document.getElementById("export-filename").validationMessage'), /filename/i);
    run('document.getElementById("export-filename").listeners.input()');
    assert.equal(run('document.getElementById("export-filename").validationMessage'), "");
  }
});

test("belt machine ports connect on their role-specific sides and render role triangles", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"splitter-mk-1",x:52,y:40,rotation:0},
      {id:3,slug:"belt-balancer-mk-1",x:55,y:40,rotation:0}],belts:[]});
    globalThis.flattenSVG=node=>[node,...node.children.flatMap(flattenSVG)];draw()`);
  assert.equal(run('portConnection({x:52,y:39},{x:52,y:38}).role'), "input");
  assert.equal(run('portConnection({x:53,y:40},{x:54,y:40}).role'), "output");
  assert.equal(run('portConnection({x:55,y:39},{x:55,y:38}).role'), "input");
  assert.equal(run('portConnection({x:55,y:41},{x:55,y:42}).role'), "output");
  assert.equal(run('flattenSVG(symbols).filter(n=>n.attributes["data-port-role"]==="input").length'), 3);
  assert.equal(run('flattenSVG(symbols).filter(n=>n.attributes["data-port-role"]==="output").length'), 5);
  assert.equal(run(`new Set(flattenSVG(symbols).find(n=>n.attributes["data-machine-id"]==="2").children
    .filter(n=>n.attributes["data-port-role"]==="output")
    .map(n=>n.attributes.d)).size`), 3);
  assert.equal(run('flattenSVG(symbols).filter(n=>n.attributes["data-symbol"]==="machine-port").every(n=>n.attributes.fill==="#51c889")'), true);
  assert.equal(run('flattenSVG(symbols).some(n=>n.attributes["data-symbol"]==="orientation")'), false);
});

test("parallel balancer belts stay separate when drawn to or from adjacent ports", async () => {
  const { run, pointer } = await app();
  const directions = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] };
  for (let rotation = 0; rotation < 4; rotation++) {
    for (const role of ["input", "output"]) for (const fromPort of [true, false]) {
      for (const clickMode of [false, true]) {
        run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
          placements:[{id:2,slug:"belt-balancer-mk-1",x:55,y:39,rotation:${rotation}}],belts:[]});
          setTool({type:"belt"})`);
        const ports = JSON.parse(run(`JSON.stringify(machinePorts(getMachine("belt-balancer-mk-1"),${rotation})
          .filter(port=>port.role==="${role}"))`));
        const ends = ports.map(port => {
          const [dx, dy] = directions[port.side];
          return { near: {x:55 + port.x + dx, y:39 + port.y + dy},
            far: {x:55 + port.x + 4 * dx, y:39 + port.y + 4 * dy} };
        });
        for (const { near, far } of ends) {
          const [start, end] = fromPort ? [near, far] : [far, near];
          pointer("pointermove", start.x, start.y);
          pointer("pointerdown", start.x, start.y);
          if (clickMode) pointer("pointerup", start.x, start.y);
          pointer("pointermove", end.x, end.y);
          if (clickMode) pointer("pointerdown", end.x, end.y);
          pointer("pointerup", end.x, end.y);
        }
        const scenario = `rotation ${rotation}, ${role}, fromPort ${fromPort}, click ${clickMode}`;
        assert.equal(run("belts.length"), 2, scenario);
        assert.equal(run("belts.every(belt=>belt.cells.length===4)"), true, scenario);
        for (const { near } of ends) {
          assert.equal(run(`beltConnections(beltAt(${near.x},${near.y}).cells)
            .some(port=>port.placement?.id===2 && port.role==="${role}" &&
              port.cell.x===${near.x} && port.cell.y===${near.y})`), true, scenario);
        }
        const [a, b] = ends.map(({ near }) => `${near.x},${near.y}`);
        assert.equal(run(`beltFlow.get("${a}").neighbors.has("${b}")`), false, scenario);
        run("restore(serialize())");
        assert.equal(run("belts.length"), 2, scenario);
      }
    }
  }
});

test("port-connected endpoints resist incidental joins but allow explicit extension", async () => {
  const { run, pointer } = await app();
  const reset = () => run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"belt-balancer-mk-1",x:56,y:38,rotation:1}],
    belts:[{id:3,cells:[{x:52,y:38},{x:53,y:38},{x:54,y:38},{x:55,y:38}]}]});
    setTool({type:"belt"})`);
  reset();
  pointer("pointerdown",55,37);
  assert.equal(run("beltDraft.sourceId"), null);
  pointer("pointerup",55,35);
  assert.equal(run("belts.length"), 2);
  assert.equal(run("belts[0].cells.length"), 4);
  reset();
  pointer("pointerdown",55,38);
  pointer("pointerup",55,37);
  assert.equal(run("belts.length"), 1);
  assert.equal(run("belts[0].cells.length"), 5);
  reset();
  pointer("pointerdown",55,35);
  pointer("pointerup",55,38);
  assert.equal(run("belts.length"), 1);
  assert.equal(run("belts[0].cells.length"), 7);
});

test("underground belts place in two clicks across six intervening tiles, save, and cancel safely", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[{id:2,slug:"container",x:39,y:39,rotation:0}],
    belts:[{id:3,cells:[{x:42,y:38},{x:42,y:39},{x:42,y:40}]}]});
    setTool({type:"underground",slug:"underground-belt"})`);
  pointer("pointerdown",37,40);
  pointer("pointerup",37,40);
  assert.equal(run("belts.length"),1);
  assert.equal(run("undergroundStart.x"),37);
  assert.equal(run("serialize().belts.length"),1);
  for (const [x,y] of [[45,40],[44,41],[37,40],[42,40]]) {
    pointer("pointerdown",x,y);
    assert.equal(run("belts.length"),1);
    assert.notEqual(run("undergroundStart"),null);
  }
  pointer("pointerdown",44,40);
  assert.equal(run("belts.length"),2);
  assert.equal(run("belts[1].kind"),"underground");
  assert.equal(run("undergroundStart"),null);
  run("globalThis.savedUnderground=JSON.stringify(serialize());restore(JSON.parse(savedUnderground))");
  assert.equal(run("JSON.stringify(serialize())"),run("savedUnderground"));
  run('globalThis.nodes=node=>[node,...node.children.flatMap(nodes)]');
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="underground-link").length'),1);
  run('selected={type:"room",id:1};deleteSelected()');
  assert.equal(run("rooms.length"),1);
  run('setTool({type:"underground",slug:"underground-belt"})');
  pointer("pointerdown",36,45);
  run('window.listeners.keydown({key:"Escape"})');
  assert.equal(run("undergroundStart"),null);
  assert.equal(run("belts.length"),2);
  pointer("pointermove",44,40);
  run('window.listeners.keydown({key:"x",target:{tagName:"BODY"},preventDefault(){}})');
  assert.equal(run("belts.length"),1);
});

test("underground flow connects machines, surface belts, and splitters in every direction with a 60/min limit", async () => {
  const { run } = await app();
  run(`recipes.push({name:"Tunnel source",machine:"refinery",inputs:[],
    outputs:[{item:"ore",per_min:"90/min"}]})`);
  for (const [dx,dy,rotation] of [[1,0,3],[0,1,0],[-1,0,1],[0,-1,2]]) {
    const first={x:45,y:45},second={x:45+5*dx,y:45+5*dy};
    const source={x:first.x-4*dx-1,y:first.y-4*dy-1};
    const splitter={x:second.x+2*dx,y:second.y+2*dy};
    const fixture={version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",...source,rotation:0,recipe:"Tunnel source"},
        {id:3,slug:"splitter-mk-1",...splitter,rotation}],
      belts:[{id:4,cells:[{x:first.x-2*dx,y:first.y-2*dy},{x:first.x-dx,y:first.y-dy}]},
        {id:5,kind:"underground",cells:[first,second]},
        {id:6,cells:[{x:second.x+dx,y:second.y+dy,direction:dx>0?0:dy>0?1:dx<0?2:3}]},
        {id:7,cells:[{x:splitter.x+dx,y:splitter.y+dy},{x:splitter.x+2*dx,y:splitter.y+2*dy}]}]};
    run(`restore(${JSON.stringify(fixture)})`);
    for (const cell of [first,second,fixture.belts[2].cells[0],fixture.belts[3].cells[1]]) {
      assert.equal(run(`beltFlow.get("${cell.x},${cell.y}").total`),60);
      assert.equal(run(`beltFlow.get("${cell.x},${cell.y}").unknown`),false);
    }
  }
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[{id:2,slug:"refinery",x:36,y:39,rotation:0,recipe:"Tunnel source"},
      {id:3,slug:"splitter-mk-1",x:46,y:40,rotation:3}],
    belts:[{id:4,kind:"underground",cells:[{x:39,y:40},{x:45,y:40}]},
      {id:5,cells:[{x:47,y:40},{x:48,y:40}]}]})`);
  assert.equal(run('beltFlow.get("48,40").total'),60);
  run(`recipes.find(r=>r.name==="Tunnel source").outputs=[
    {item:"ore",per_min:"60/min"},{item:"water",per_min:"30/min"}];draw()`);
  assert.equal(run('beltFlow.get("48,40").rates.get("ore")'),40);
  assert.equal(run('beltFlow.get("48,40").rates.get("water")'),20);
  run('delete placements[0].recipe;draw()');
  assert.equal(run('beltFlow.get("48,40").unknown'),true);
});

test("splitter output feeds linked underground pairs directly into machine demand", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[{id:2,slug:"splitter-mk-1",x:39,y:40,rotation:3},
      {id:3,slug:"assembler",x:51,y:39,rotation:0,recipe:"Hull Plate Titanium Crafting"}],
    belts:[{id:4,cells:[{x:37,y:40},{x:38,y:40}]},
      {id:5,kind:"underground",cells:[{x:40,y:40},{x:45,y:40}]},
      {id:6,kind:"underground",cells:[{x:46,y:40},{x:50,y:40}]}]})`);
  for (const cell of ["38,40","40,40","45,40","46,40","50,40"]) {
    assert.equal(run(`beltFlow.get("${cell}").total`),30);
    assert.equal(run(`beltFlow.get("${cell}").load`),"equal");
  }
});

test("underground restore rejects malformed pairs atomically and allows occupied hidden spans", async () => {
  const { run } = await app();
  run("globalThis.beforeTunnel=JSON.stringify(serialize())");
  for (const cells of [
    [{x:52,y:36}], [{x:52,y:36},{x:52,y:36}],
    [{x:52,y:36},{x:60,y:36}], [{x:52,y:36},{x:55,y:39}],
    [{x:52,y:36,direction:0},{x:55,y:36}]
  ]) {
    assert.throws(()=>run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
      placements:[],belts:[{id:2,kind:"underground",cells:${JSON.stringify(cells)}}]})`), /Invalid belt/);
    assert.equal(run("JSON.stringify(serialize())"),run("beforeTunnel"));
  }
});

test("underground inputs infer feasible demand but never infer flow exceeding tunnel capacity", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[{id:2,slug:"assembler",x:48,y:39,rotation:0,recipe:"Hull Plate Titanium Crafting"}],
    belts:[{id:3,kind:"underground",cells:[{x:40,y:40},{x:47,y:40}]}]})`);
  for (const cell of ["40,40","47,40"]) {
    assert.equal(run(`beltFlow.get("${cell}").total`),30);
    assert.equal(run(`beltFlow.get("${cell}").inferred`),true);
  }
  run('recipes.find(r=>r.name==="Hull Plate Titanium Crafting").inputs[0].per_min="90/min";draw()');
  for (const cell of ["40,40","47,40"]) {
    assert.equal(run(`beltFlow.get("${cell}").unknown`),true);
    assert.ok(run(`beltFlow.get("${cell}").total`)<=60);
  }
});

test("palette selections toggle off and Escape clears selection", async () => {
  const { run } = await app();
  for (const value of ['{type:"room",size:"dock"}', '{type:"machine",slug:"assembler"}']) {
    run(`toggleTool(${value})`);
    assert.notEqual(run("tool.type"), "select");
    run(`toggleTool(${value})`);
    assert.equal(run("tool.type"), "select");
  }
  run('toggleTool({type:"room",size:"dock"}); window.listeners.keydown({key:"Escape"})');
  assert.equal(run("tool.type"), "select");
  assert.equal(run("selected"), null);
});

test("Delete and Mac Backspace delete selections with existing safeguards", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"container",x:50,y:34,rotation:0}],
    belts:[{id:3,cells:[{x:55,y:36}]}]});
    globalThis.prevented=0;
    globalThis.pressDelete=(key="Delete",target={tagName:"BODY"},extra={})=>
      window.listeners.keydown({key,target,preventDefault(){prevented++},...extra});
    selected={type:"machine",id:2};`);
  for (const tag of ["INPUT","TEXTAREA","SELECT"]) run(`pressDelete("Delete",{tagName:"${tag}"})`);
  run('pressDelete("Delete",{tagName:"DIV",isContentEditable:true});pressDelete("Delete",{tagName:"BODY"},{metaKey:true})');
  assert.equal(run("placements.length"),1);
  assert.equal(run("prevented"),0);
  run('pressDelete()');
  assert.equal(run("placements.length"),0);
  assert.equal(run("selected"),null);
  run('selected={type:"room",id:1};pressDelete()');
  assert.equal(run("rooms.length"),1);
  assert.match(run("statusEl.textContent"),/Cannot remove room/);
  run('selected={type:"belt",id:3};beltDraft={cells:[{x:56,y:36}]};pressDelete()');
  assert.equal(run("belts.length"),1);
  assert.match(run("statusEl.textContent"),/Finish or cancel/);
  run('beltDraft=null;pressDelete("Backspace")');
  assert.equal(run("belts.length"),0);
  run('selected={type:"room",id:1};pressDelete()');
  assert.equal(run("rooms.length"),0);
  const count = run("prevented");
  run('pressDelete()');
  assert.equal(run("prevented"),count);
});

test("starter view fits all three rooms with padding and Reset refits", async () => {
  const { run } = await app();
  assert.equal(run("zoom"), 600 / (52 * 16));
  assert.equal(run("canvasWrap.scrollTop"), 40 * 16 * run("zoom") - 300);
  assert.equal(run('document.getElementById("zoom-level").textContent'), "72%");
  run('setZoom(2); document.getElementById("zoom-reset").listeners.click()');
  assert.equal(run("zoom"), 600 / (52 * 16));
  assert.equal(run("(64 * 16 * zoom - canvasWrap.scrollTop) <= canvasWrap.clientHeight"), true);
  assert.equal(run("(16 * 16 * zoom - canvasWrap.scrollTop) >= 0"), true);
});

test("buttons, keyboard, and wheel zoom preserve the center of the visible canvas", async () => {
  const { run } = await app();
  run(`setZoom(1);canvasWrap.scrollLeft=400;canvasWrap.scrollTop=300;
    globalThis.center=()=>[(canvasWrap.scrollLeft+canvasWrap.clientWidth/2)/zoom,
      (canvasWrap.scrollTop+canvasWrap.clientHeight/2)/zoom];`);
  const center = run("JSON.stringify(center())");
  for (const action of [
    'document.getElementById("zoom-in").listeners.click()',
    'document.getElementById("zoom-out").listeners.click()',
    'window.listeners.keydown({key:"+",target:{tagName:"BODY"}})',
    'canvasWrap.listeners.wheel({ctrlKey:true,deltaY:-1,clientX:0,clientY:0,preventDefault(){}})',
    'canvasWrap.listeners.wheel({metaKey:true,deltaY:1,clientX:799,clientY:599,preventDefault(){}})'
  ]) {
    const zoom = run("zoom");
    run(action);
    assert.notEqual(run("zoom"), zoom);
    assert.equal(run("JSON.stringify(center())"), center);
  }
});

test("labels fit their available space without horizontal compression", async () => {
  const { run } = await app();
  assert.equal(run('fitLabel("Assembler", 60)'), "Assembler");
  assert.equal(run('fitLabel("Assembler", 42)'), "Asse...");
  assert.equal(run('fitLabel("Assembler", 10)'), "");
  const lines = JSON.parse(run('JSON.stringify(productLines("Hydrogen Fuel", 48))'));
  assert.deepEqual(lines, ["Hydrogen", "Fuel"]);
  const shortened = JSON.parse(run('JSON.stringify(productLines("Long product name with extra words", 48))'));
  assert.equal(shortened.length, 2);
  assert.ok(shortened.every(line => line.length * 6 <= 48));
  assert.equal(run('productLines("Hydrogen Fuel", 30, 1).length'), 1);
});

test("labels and symbols use SVG without accumulating across redraws or changing the layout", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"refinery",x:50,y:34,rotation:0,recipe:"Hydrogen Fuel Fuel"}],
    belts:[{id:3,cells:[{x:55,y:36}]}]});
    globalThis.beforeSymbols=JSON.stringify(serialize());
    globalThis.flattenSVG=node=>[node,...node.children.flatMap(flattenSVG)];
    globalThis.initialNodes=flattenSVG(symbols).length; draw();`);
  assert.equal(run("flattenSVG(symbols).length"), run("initialNodes"));
  assert.equal(run('flattenSVG(symbols).filter(n=>n.tagName==="text").length'), 2);
  assert.equal(run('flattenSVG(symbols).filter(n=>n.attributes["data-symbol"]==="machine-port").length'), 4);
  assert.equal(run('flattenSVG(symbols).filter(n=>n.attributes["data-symbol"]==="belt-arrow").length'), 1);
  assert.equal(run('flattenSVG(symbols).slice(1).every(n=>n.namespaceURI==="http://www.w3.org/2000/svg")'), true);
  run("setZoom(2.5)");
  assert.equal(run("JSON.stringify(serialize())"), run("beforeSymbols"));
  assert.equal(run('flattenSVG(symbols).filter(n=>n.attributes["data-symbol"]==="machine-port").length'), 4);
});

test("labels counter-scale zoom to reveal more text and container corners show both edges", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"refinery",x:50,y:34,rotation:0,recipe:"Hydrogen Fuel Fuel"},
      {id:3,slug:"container",x:56,y:34,rotation:0}],belts:[]});
    globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];setZoom(1)`);
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-machine-id"]==="2").children[0].attributes.transform.endsWith("scale(1)")'), true);
  const short = run('nodes(symbols).filter(n=>n.tagName==="text").map(n=>n.textContent).join("|")');
  run("setZoom(2.5)");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-machine-id"]==="2").children[0].attributes.transform.endsWith("scale(0.4)")'), true);
  const full = run('nodes(symbols).filter(n=>n.tagName==="text").map(n=>n.textContent).join("|")');
  assert.ok(full.includes("Refinery"));
  assert.ok(full.includes("Hydrogen Fuel"));
  assert.notEqual(short, full);
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-machine-id"]==="3").children.filter(n=>n.attributes["data-symbol"]==="machine-port").length'), 8);
});

test("Fit layout frames wide factories below 50% without changing saved geometry", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:Array.from({length:8},(_,i)=>({
    id:i+1,size:"1x1",x:i*16,y:32,rotation:0
  })),placements:[],belts:[]}); globalThis.beforeFit=JSON.stringify(serialize());
  canvasWrap.clientWidth=360;fitLayout()`);
  assert.equal(run("zoom"), 360 / (132 * 16));
  assert.equal(run("JSON.stringify(serialize())"), run("beforeFit"));
  assert.equal(run("128*TILE*zoom <= canvasWrap.clientWidth"), true);
});

test("hover gives full machine and recipe information for compact labels", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"refinery",x:50,y:34,rotation:0,recipe:"Hydrogen Fuel Fuel"}],belts:[]})`);
  pointer("pointermove", 51, 35);
  assert.match(run("canvas.title"), /Refinery/);
  assert.match(run("canvas.title"), /Hydrogen Fuel/);
  assert.match(run("canvas.title"), /confirmed/);
  pointer("pointerleave", 51, 35);
  assert.equal(run("canvas.title"), "");
});

test("room rotation updates dimensions, openings, and saved orientation", async () => {
  const { run } = await app();
  run('restore({version:2,rooms:[{id:1,size:"2x1",x:48,y:32}],placements:[]}); selected={type:"room",id:1}; rotateSelected()');
  assert.equal(run("dimensions(rooms[0]).join(',')"), "16,32");
  assert.equal(run("openingOnEdge(rooms[0],53,32)"), true);
  assert.equal(run("openingOnEdge(rooms[0],48,37)"), false);
  run("restore(serialize())");
  assert.equal(run("rooms[0].rotation"), 1);
  assert.throws(() => run('restore({version:2,rooms:[{id:1,size:"dock",x:48,y:32,rotation:4}],placements:[]})'), /Invalid room/);
});

test("dock and control center previews rotate, including before hovering", async () => {
  const { run } = await app();
  for (const size of ["dock", "control-center"]) {
    run(`setTool({type:"room",size:"${size}"}); rotateSelected(); updatePreview({x:48,y:32})`);
    assert.equal(run("preview.room.rotation"), 1);
    assert.equal(run("openingOnEdge(preview.room,63,39)"), true);
    assert.equal(run("openingOnEdge(preview.room,55,32)"), false);
    run("rotateSelected()");
    assert.equal(run("preview.room.rotation"), 2);
  }
});

test("room rotation cannot disconnect rooms or invalidate machines", async () => {
  const { run } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32},{id:2,size:"dock",x:48,y:48}],placements:[]}); selected={type:"room",id:2}; rotateSelected()');
  assert.equal(run("rooms[1].rotation"), 0);
  assert.match(run('document.getElementById("status").textContent'), /Cannot rotate room/);
  run('restore({version:2,rooms:[{id:1,size:"2x1",x:48,y:32}],placements:[{id:2,slug:"assembler",x:70,y:34,rotation:0}]}); selected={type:"room",id:1}; rotateSelected()');
  assert.equal(run("rooms[0].rotation"), 0);
});

test("dock and control center are unbuildable in every orientation but still connect", async () => {
  const { run } = await app();
  assert.equal(run("allRoomsConnected(rooms)"), true);
  assert.equal(run('roomTypes.dock.body_width_tiles'), 11);
  for (const size of ["dock", "control-center"]) {
    for (let rotation = 0; rotation < 4; rotation++) {
      run(`restore({version:3,rooms:[{id:1,size:"${size}",x:48,y:32,rotation:${rotation}}],placements:[],belts:[]})`);
      assert.equal(run(`Array.from({length:256},(_,i)=>
        tileIsUsable(48+i%16,32+Math.floor(i/16))).some(Boolean)`), false);
      assert.equal(run('canPlace(getMachine("container"),54,38)'), false);
      assert.match(run("beltProblem([{x:55,y:39}])"), /usable/);
    }
    assert.throws(() => run(`restore({version:3,
      rooms:[{id:1,size:"${size}",x:48,y:32}],placements:[],
      belts:[{id:2,cells:[{x:55,y:32}]}]})`), /Invalid belt/);
    assert.throws(() => run(`restore({version:3,
      rooms:[{id:1,size:"${size}",x:48,y:32}],
      placements:[{id:2,slug:"container",x:54,y:38,rotation:0}],belts:[]})`), /Invalid machine placement/);
  }
});

test("selected machines toggle on click but remain draggable", async () => {
  const { run, pointer } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[{id:2,slug:"assembler",x:50,y:34,rotation:0}]})');
  pointer("pointerdown", 52, 36);
  pointer("pointerup", 52, 36);
  assert.equal(run("selected.id"), 2);
  run("rotateSelected()");
  assert.equal(run("placements[0].rotation"), 1);
  pointer("pointerdown", 52, 36);
  pointer("pointerup", 52, 36);
  assert.equal(run("selected"), null);
  pointer("pointerdown", 52, 36);
  pointer("pointerup", 52, 36);
  pointer("pointerdown", 52, 36);
  pointer("pointermove", 53, 37);
  pointer("pointerup", 53, 37);
  assert.equal(run("selected.id"), 2);
  assert.equal(run("placements[0].x"), 51);
  assert.equal(run("placements[0].y"), 35);
  pointer("pointerdown", 60, 44);
  assert.equal(run("selected.type"), "room");
  pointer("pointerdown", 60, 44);
  assert.equal(run("selected"), null);
});

test("recipes are per-machine, machine-compatible, clearable, and persistent", async () => {
  const { run } = await app();
  run(`restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[
    {id:2,slug:"assembler",x:50,y:34,rotation:0},
    {id:3,slug:"refinery",x:58,y:34,rotation:0},
    {id:4,slug:"assembler",x:50,y:41,rotation:0}
  ]}); selected={type:"machine",id:2}; updateDetails()`);
  assert.equal(run('document.getElementById("recipe-control").hidden'), false);
  assert.equal(run('document.getElementById("recipe-select").children.length'),
    run('recipes.filter(r=>r.machine==="assembler").length + 1'));
  run('document.getElementById("recipe-select").listeners.change({target:{value:"Hull Plate Titanium Crafting"}})');
  assert.equal(run("placements[0].recipe"), "Hull Plate Titanium Crafting");
  assert.equal(run("placements[2].recipe"), undefined);
  assert.equal(run('document.getElementById("recipe-list").children.length'), 1);
  run('assignRecipe("Cobalt Plates Ore Refining")');
  assert.equal(run("placements[0].recipe"), "Hull Plate Titanium Crafting");
  assert.match(run('document.getElementById("status").textContent'), /does not match/);
  run('selected={type:"machine",id:3}; updateDetails(); assignRecipe("Cobalt Plates Ore Refining")');
  assert.equal(run("placements[1].recipe"), "Cobalt Plates Ore Refining");
  assert.equal(run('document.getElementById("recipe-select").children.length'),
    run('recipes.filter(r=>r.machine==="refinery").length + 1'));
  run('document.getElementById("save").listeners.click(); assignRecipe(""); document.getElementById("load").listeners.click()');
  assert.equal(run("placements[0].recipe"), "Hull Plate Titanium Crafting");
  assert.equal(run("placements[1].recipe"), "Cobalt Plates Ore Refining");
  run('selected={type:"machine",id:2}; assignRecipe("")');
  assert.equal(run("placements[0].recipe"), undefined);
  run('selected={type:"room",id:1}; updateDetails()');
  assert.equal(run('document.getElementById("recipe-control").hidden'), true);
});

test("belts interpolate gaps and corners, retrace, and preserve drawing direction", async () => {
  const { run, pointer } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[]}); toggleTool({type:"belt"})');
  pointer("pointerdown", 50, 34);
  pointer("pointermove", 54, 36);
  assert.equal(run('beltDraft.cells.map(c=>`${c.x},${c.y}`).join(";")'),
    "50,34;51,34;52,34;53,34;54,34;54,35;54,36");
  pointer("pointermove", 54, 35);
  assert.equal(run("beltDraft.cells.length"), 6);
  pointer("pointerup", 54, 35);
  assert.equal(run("belts.length"), 1);
  assert.equal(run("selected.type"), "belt");
  assert.equal(run("belts[0].cells[0].x"), 50);
  assert.equal(run("belts[0].cells.at(-1).y"), 35);
  run('setTool({type:"select"})');
  pointer("pointerdown", 52, 34);
  assert.equal(run("selected.type"), "belt");
  pointer("pointerdown", 52, 34);
  assert.equal(run("selected"), null);
  pointer("pointerdown", 52, 34);
  run('document.getElementById("delete").listeners.click()');
  assert.equal(run("belts.length"), 0);
});

test("belts reject walls, space, machines, crossings, and gaps", async () => {
  const { run, pointer } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[{id:2,slug:"assembler",x:52,y:38,rotation:0}]})');
  assert.match(run("beltProblem([{x:48,y:33}])"), /usable/);
  assert.match(run("beltProblem([{x:47,y:35}])"), /usable/);
  assert.match(run("beltProblem([{x:52,y:38}])"), /machines/);
  assert.match(run("beltProblem([{x:50,y:34},{x:51,y:35}])"), /orthogonally/);
  assert.match(run("beltProblem([{x:50,y:34},{x:51,y:34},{x:50,y:34}])"), /overlap/);
  assert.equal(run("beltProblem([{x:53,y:32},{x:53,y:33}])"), null);
  run('setTool({type:"belt"})');
  pointer("pointerdown", 50, 34);
  pointer("pointerup", 50, 34);
  assert.equal(run("belts.length"), 0);
  assert.equal(run("beltDraft.clickMode"), true);
  run('setTool({type:"belt"})');
  pointer("pointerdown", 50, 34);
  pointer("pointerup", 54, 34);
  assert.equal(run("belts.length"), 1);
  pointer("pointerdown", 52, 33);
  pointer("pointerup", 52, 36);
  assert.equal(run("belts.length"), 1);
  assert.match(run('document.getElementById("status").textContent'), /overlap or cross/);
  pointer("pointerdown", 50, 36);
  pointer("pointerup", 54, 40);
  assert.equal(run("belts.length"), 1);
  assert.match(run('document.getElementById("status").textContent'), /machines/);
});

test("quick clicks start and finish a belt without holding a button", async () => {
  const { run, pointer } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[]}); setTool({type:"belt"})');
  pointer("pointerdown", 50, 34);
  pointer("pointerup", 50, 34);
  assert.equal(run("beltDraft.clickMode"), true);
  pointer("lostpointercapture", 50, 34);
  assert.equal(run("beltDraft.clickMode"), true);
  pointer("pointermove", 54, 36);
  assert.equal(run("belts.length"), 0);
  assert.equal(run("beltDraft.cells.length"), 7);
  pointer("pointerdown", 54, 36);
  pointer("pointerup", 54, 36);
  assert.equal(run("belts.length"), 1);
  assert.equal(run("belts[0].cells.length"), 7);
  assert.equal(run("beltDraft"), null);
});

test("single-tile belts can be placed, turned, saved, and restored", async () => {
  const { run, pointer } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[]}); setTool({type:"belt"})');
  pointer("pointermove", 50, 34);
  run("rotateSelected()");
  pointer("pointerdown", 50, 34);
  pointer("pointerup", 50, 34);
  assert.equal(run("belts.length"), 0);
  pointer("pointerdown", 50, 34);
  pointer("pointerup", 50, 34);
  assert.equal(run("belts.length"), 1);
  assert.equal(run("belts[0].cells.length"), 1);
  assert.equal(run("belts[0].cells[0].direction"), 1);
  run("rotateSelected(); restore(serialize())");
  assert.equal(run("belts[0].cells[0].direction"), 2);
  run('document.getElementById("save").listeners.click();document.getElementById("clear").listeners.click();document.getElementById("load").listeners.click()');
  assert.equal(run("belts[0].cells.length"), 1);
  assert.equal(run("belts[0].cells[0].direction"), 2);
});

test("new sessions load dock above station above control center, while shared layouts override it", async () => {
  const starter = await app();
  assert.equal(starter.run("rooms.length"), 3);
  assert.equal(starter.run("placements.length"), 0);
  assert.equal(starter.run("belts.length"), 0);
  assert.equal(starter.run("rooms.slice().sort((a,b)=>a.y-b.y).map(r=>r.size).join(',')"), "dock,1x1,control-center");
  assert.equal(starter.run("rooms.every(r=>r.x===48)"), true);
  assert.equal(starter.run("roomsConnect(rooms[0], rooms[1])"), true);
  assert.equal(starter.run("roomsConnect(rooms[0], rooms[2])"), true);
  assert.equal(starter.run("allRoomsConnected(rooms)"), true);
  starter.run('document.getElementById("clear").listeners.click()');
  assert.equal(starter.run("rooms.length"), 0);
  const empty = { version: 3, rooms: [], placements: [], belts: [] };
  const shared = await app(`#layout=${Buffer.from(JSON.stringify(empty)).toString("base64url")}`);
  assert.equal(shared.run("rooms.length"), 0);
  assert.equal(shared.run('document.getElementById("status").textContent'), "Shared layout loaded");
});

test("click-mode routes reject crossings and cancel cleanly", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[],
    belts:[{id:2,cells:[{x:52,y:34},{x:52,y:35}]}]}); setTool({type:"belt"})`);
  pointer("pointerdown", 50, 34);
  pointer("pointerup", 50, 34);
  pointer("pointermove", 54, 34);
  pointer("pointerdown", 54, 34);
  pointer("pointerup", 54, 34);
  assert.equal(run("belts.length"), 1);
  assert.match(run('document.getElementById("status").textContent'), /overlap or cross/);
  pointer("pointerdown", 50, 36);
  pointer("pointerup", 50, 36);
  run('window.listeners.keydown({key:"Escape"})');
  assert.equal(run("beltDraft"), null);
  assert.equal(run("belts.length"), 1);
});

test("R turns only the belt tile under the cursor and facings persist", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[],
    belts:[{id:2,cells:[{x:50,y:34},{x:51,y:34},{x:52,y:34}]}]})`);
  pointer("pointermove", 51, 34);
  run('window.listeners.keydown({key:"r",target:{tagName:"CANVAS"},preventDefault(){}})');
  assert.equal(run("belts[0].cells[0].direction"), undefined);
  assert.equal(run("belts[0].cells[1].direction"), 1);
  assert.equal(run("belts[0].cells[2].direction"), undefined);
  assert.equal(run("belts[0].cells.map((c,i)=>beltDirection(belts[0].cells,i)).join(',')"), "0,1,0");
  run("restore(serialize())");
  assert.equal(run("belts[0].cells[1].direction"), 1);
  run('document.getElementById("save").listeners.click(); belts[0].cells[1].direction=2; document.getElementById("load").listeners.click()');
  assert.equal(run("belts[0].cells[1].direction"), 1);
  run("rotateSelected(); rotateSelected(); rotateSelected()");
  assert.equal(run("belts[0].cells[1].direction"), 0);
  pointer("pointerleave", 51, 34);
  run("rotateSelected()");
  assert.equal(run("belts[0].cells[1].direction"), 0);
  run('globalThis.bad=serialize();bad.belts[0].cells[1].direction=4');
  assert.throws(() => run("restore(bad)"), /direction/);
});

test("X removes a hovered belt tile, preserves facing, and splits the route", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[],
    belts:[{id:2,cells:[{x:50,y:36},{x:51,y:36},{x:51,y:37},{x:51,y:38}]},
      {id:3,cells:[{x:58,y:36}]}]});
    selected={type:"belt",id:2};updateDetails();
    globalThis.pressX=()=>window.listeners.keydown({key:"x",target:{tagName:"BODY"},preventDefault(){}})`);
  pointer("pointermove",51,37);
  run("pressX()");
  assert.equal(run("belts.length"), 3);
  assert.equal(run("belts[0].id"), 2);
  assert.equal(run('belts[0].cells.map(c=>`${c.x},${c.y}`).join(";")'), "50,36;51,36");
  assert.equal(run('beltDirection(belts[0].cells,1)'), 1);
  assert.equal(run("belts[1].id"), 4);
  assert.equal(run('belts[1].cells.map(c=>`${c.x},${c.y}`).join(";")'), "51,38");
  assert.equal(run('beltDirection(belts[1].cells,0)'), 1);
  assert.equal(run("belts[2].id"), 3);
  assert.equal(run("selected.id"), 2);
  assert.match(run('document.getElementById("selection-details").textContent'), /2 tiles/);
  assert.equal(run("canvas.title"), "");
  const saved = run("JSON.stringify(serialize())");
  run("restore(serialize())");
  assert.equal(run("JSON.stringify(serialize())"), saved);
  assert.equal(run('beltDirection(belts[1].cells,0)'), 1);
  run('selected={type:"belt",id:2};updateDetails()');
  pointer("pointermove",50,36);
  run("pressX()");
  assert.equal(run("belts[0].cells.length"), 1);
  assert.equal(run("beltDirection(belts[0].cells,0)"), 1);
  pointer("pointermove",51,36);
  run("pressX()");
  assert.equal(run("belts.length"), 2);
  assert.equal(run("selected"), null);
});

test("X respects editable fields, modifiers, active edits, and belt previews", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[],
    belts:[{id:2,cells:[{x:52,y:36},{x:53,y:36},{x:54,y:36}]}]});
    globalThis.prevented=0;
    globalThis.pressX=(target={tagName:"BODY"},extra={})=>
      window.listeners.keydown({key:"x",target,preventDefault(){prevented++},...extra})`);
  pointer("pointermove",53,36);
  for (const tag of ["INPUT","TEXTAREA","SELECT"]) run(`pressX({tagName:"${tag}"})`);
  run('pressX({tagName:"DIV",isContentEditable:true})');
  for (const key of ["ctrlKey", "metaKey", "altKey"]) run(`pressX({tagName:"BODY"},{${key}:true})`);
  assert.equal(run("belts[0].cells.length"), 3);
  assert.equal(run("prevented"), 0);
  run('setTool({type:"belt"})');
  pointer("pointerdown",50,34);
  pointer("pointermove",53,36);
  run("pressX()");
  assert.equal(run("belts[0].cells.length"), 3);
  assert.match(run("statusEl.textContent"), /Finish or cancel/);
  run('window.listeners.keydown({key:"Escape"});setTool({type:"belt"})');
  pointer("pointermove",53,36);
  run('pressX({tagName:"BODY"},{key:"X",shiftKey:true})');
  assert.equal(run("belts.length"), 2);
  assert.equal(run("preview"), null);
  assert.equal(run('beltFlow.has("53,36")'), false);
});

test("R turns draft tiles in drag and click modes without changing the route", async () => {
  const { run, pointer } = await app();
  for (const clickMode of [false, true]) {
    run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[]}); setTool({type:"belt"})');
    pointer("pointerdown", 50, 34);
    if (clickMode) pointer("pointerup", 50, 34);
    pointer("pointermove", 52, 34);
    run("rotateSelected()");
    assert.equal(run("beltDraft.cells[2].direction"), 1);
    assert.equal(run("beltDraft.cells[0].direction"), undefined);
    if (clickMode) pointer("pointerdown", 52, 34);
    pointer("pointerup", 52, 34);
    assert.equal(run("belts[0].cells[2].direction"), 1);
    assert.equal(run("belts[0].cells.length"), 3);
  }
});

test("belt drafts cancel on Escape, tool changes, pointer cancellation, and capture loss", async () => {
  const { run, pointer } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[]})');
  for (const cancel of [
    () => run('window.listeners.keydown({key:"Escape"})'),
    () => run('setTool({type:"machine",slug:"assembler"})'),
    () => pointer("pointercancel", 52, 34),
    () => pointer("lostpointercapture", 52, 34)
  ]) {
    run('setTool({type:"belt"})');
    pointer("pointerdown", 50, 34);
    pointer("pointermove", 52, 34);
    cancel();
    assert.equal(run("beltDraft"), null);
    assert.equal(run("belts.length"), 0);
    pointer("pointerup", 52, 34);
    assert.equal(run("belts.length"), 0);
  }
});

test("belt collisions apply to machine placement, room deletion, and room rotation", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"2x1",x:48,y:32}],placements:[],
    belts:[{id:2,cells:[{x:70,y:34},{x:71,y:34}]}]})`);
  assert.equal(run('canPlace(getMachine("assembler"),68,33)'), false);
  run('selected={type:"room",id:1}; rotateSelected()');
  assert.equal(run("rooms[0].rotation"), 0);
  run('document.getElementById("delete").listeners.click()');
  assert.equal(run("rooms.length"), 1);
  run('selected={type:"belt",id:2}; document.getElementById("delete").listeners.click(); selected={type:"room",id:1}; rotateSelected()');
  assert.equal(run("rooms[0].rotation"), 1);
  run('document.getElementById("clear").listeners.click()');
  assert.equal(run("belts.length"), 0);
});

test("dragging a machine onto belts is rejected without losing its recipe", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"assembler",x:52,y:34,rotation:0,recipe:"Hull Plate Titanium Crafting"}],
    belts:[{id:3,cells:[{x:50,y:35},{x:51,y:35}]}]})`);
  pointer("pointerdown", 54, 36);
  pointer("pointermove", 52, 36);
  pointer("pointerup", 52, 36);
  assert.equal(run("placements[0].x"), 52);
  assert.equal(run("placements[0].recipe"), "Hull Plate Titanium Crafting");
  assert.match(run('document.getElementById("status").textContent'), /Move cancelled/);
});

test("belts can run through matching openings between adjacent rooms", async () => {
  const { run, pointer } = await app();
  run(`restore({version:2,rooms:[
    {id:1,size:"1x1",x:48,y:32},{id:2,size:"1x1",x:64,y:32}
  ],placements:[]}); setTool({type:"belt"})`);
  pointer("pointerdown", 62, 39);
  pointer("pointerup", 65, 39);
  assert.equal(run("belts.length"), 1);
  assert.equal(run("belts[0].cells.length"), 4);
  run("restore(serialize())");
  assert.equal(run("belts[0].cells.length"), 4);
});

test("belt endpoints connect only beside a port and along the route direction", async () => {
  const { run } = await app();
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[{id:2,slug:"assembler",x:52,y:34,rotation:0}]})');
  assert.equal(run("endpointPort({x:51,y:35},{x:50,y:35})"), true);
  assert.equal(run("endpointPort({x:51,y:36},{x:50,y:36})"), false);
  assert.equal(run("endpointPort({x:51,y:35},{x:51,y:36})"), false);
  run("placements[0].rotation=1");
  assert.equal(run("endpointPort({x:51,y:35},{x:50,y:35})"), true);
});

test("belts passing parallel beside a port connect, and clicking a port toggles it", async () => {
  const { run, pointerAt } = await app();
  run(`recipes.push({name:"Side source",machine:"refinery",inputs:[],outputs:[{item:"ore",per_min:"20/min"}]});
    restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"refinery",x:52,y:36,rotation:0,recipe:"Side source"}],
    belts:[{id:3,cells:[{x:51,y:35},{x:51,y:36},{x:51,y:37},{x:51,y:38},{x:51,y:39}]}]});
    globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
  assert.equal(run("beltConnections(belts[0].cells).length"),1);
  assert.equal(run("beltConnections(belts[0].cells)[0].cell.y"),37);
  assert.equal(run('beltFlow.get("51,39").total'),20);
  const marker = 'nodes(symbols).find(n=>n.attributes["data-symbol"]==="machine-port"&&n.attributes["data-port-key"]==="0,1,west")';
  assert.equal(run(`${marker}.attributes.fill`),"#51c889");
  pointerAt("pointerdown",52*16+2,37*16+8);
  pointerAt("pointerup",52*16+2,37*16+8);
  assert.deepEqual(JSON.parse(run("JSON.stringify(placements[0].disabledPorts)")),["0,1,west"]);
  assert.equal(run("drag"),null);
  assert.equal(run(`${marker}.attributes.fill`),"#e36b74");
  assert.equal(run("beltConnections(belts[0].cells).length"),0);
  assert.equal(run('beltFlow.get("51,39").unknown'),true);
  run("placements[0].rotation=2;draw()");
  assert.equal(run('portConnection({x:55,y:37},{x:56,y:37})'),null);
  run("placements[0].rotation=0;globalThis.savedPorts=JSON.stringify(serialize());restore(JSON.parse(savedPorts))");
  assert.deepEqual(JSON.parse(run("JSON.stringify(placements[0].disabledPorts)")),["0,1,west"]);
  pointerAt("pointerdown",52*16+2,37*16+8);
  assert.equal(run("placements[0].disabledPorts"),undefined);
  assert.equal(run('beltFlow.get("51,39").total'),20);
  pointerAt("pointerdown",53*16+8,37*16+8);
  assert.equal(run("placements[0].disabledPorts"),undefined);
  assert.equal(run("drag.id"),2);
});

test("dock ports toggle off by clicking and stop connecting", async () => {
  const { run, pointerAt } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32},{id:2,size:"dock",x:48,y:16,rotation:2}],
    placements:[],belts:[{id:3,cells:[{x:55,y:32},{x:55,y:33}]}]});
    globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
  assert.equal(run("beltConnections(belts[0].cells)[0].room.id"),2);
  const port = JSON.parse(run("JSON.stringify(dockPortTiles(rooms[1]).find(p=>p.x===55))"));
  pointerAt("pointerdown",port.x*16+8,port.y*16+8);
  assert.deepEqual(JSON.parse(run("JSON.stringify(rooms[1].disabledPorts)")),[String(port.key)]);
  assert.equal(run("beltConnections(belts[0].cells).length"),0);
  assert.equal(run(`nodes(symbols).find(n=>n.attributes["data-symbol"]==="dock-arrow"&&n.attributes["data-port-key"]==="${port.key}").attributes.stroke`),"#c8323f");
});

test("research has one rotating input port and persists", async () => {
  const { run, pointer } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[],belts:[]});
    setTool({type:"machine",slug:"research"})`);
  pointer("pointerdown", 52, 36);
  pointer("pointerup", 52, 36);
  assert.equal(run("placements[0].slug"), "research");
  assert.equal(run('machineFootprint(getMachine("research")).join(",")'), "3,3");
  run('globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];selected={type:"machine",id:placements[0].id}');
  const ports = [[1, 2], [0, 1], [1, 0], [2, 1]];
  const outward = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  for (let rotation = 0; rotation < 4; rotation++) {
    assert.equal(run("placements[0].rotation"), rotation);
    assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="machine-port").length'), 1);
    assert.equal(run('rotatedPort(footprintCells(getMachine("research"))[0],getMachine("research"),placements[0].rotation).join(",")'), ports[rotation].join(","));
    const [dx, dy] = outward[rotation], [px, py] = ports[rotation];
    const cell = { x: 52 + px + dx, y: 36 + py + dy };
    const neighbor = { x: cell.x + dx, y: cell.y + dy };
    assert.equal(run(`endpointPort(${JSON.stringify(cell)},${JSON.stringify(neighbor)})`), true);
    assert.equal(run(`endpointPort({x:${53 - dx * 2},y:${37 - dy * 2}},
      {x:${53 - dx * 3},y:${37 - dy * 3}})`), false);
    run("rotateSelected()");
  }
  run("globalThis.savedResearch=JSON.stringify(serialize());restore(JSON.parse(savedResearch))");
  assert.equal(run("JSON.stringify(serialize())"), run("savedResearch"));
});

test("both research machines consume their fixed item at 6 per minute without assigning a recipe", async () => {
  const { run, pointer } = await app();
  for (const [slug, item, name] of [
    ["research", "hull-plate", "Materials Research"],
    ["computational-research", "basic-circuits", "Computational Research"]
  ]) {
    run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"${slug}",x:44,y:40,rotation:0}],
      belts:[{id:3,cells:[{x:45,y:46},{x:45,y:45},{x:45,y:44},{x:45,y:43}]}]})`);
    for (const y of [43,44,45,46]) {
      assert.equal(run(`beltFlow.get("45,${y}").rates.get("${item}")`), 6);
      assert.equal(run(`beltFlow.get("45,${y}").load`), "equal");
    }
    assert.equal(run('getMachine(placements[0].slug).name'), name);
    assert.equal(run("placements[0].recipe"), undefined);
    assert.match(run(`document.getElementById("machine-list").children.find(b=>b.dataset.slug==="${slug}").title`), /Consumes .*6\/min/);
    pointer("pointermove",45,41);
    assert.match(run("canvas.title"), /Consumes .*6\/min/);
    run("restore(serialize())");
    assert.equal(run('beltFlow.get("45,43").total'), 6);
    run(`recipes.push({name:"Research feed ${slug}",machine:"refinery",inputs:[],
      outputs:[{item:"${item}",per_min:"20/min"}]});
      placements.push({id:4,slug:"refinery",x:44,y:47,rotation:0,recipe:"Research feed ${slug}"});draw()`);
    assert.equal(run('beltFlow.get("45,46").total'), 6);
    assert.equal(run('beltFlow.get("45,43").unknown'), false);
  }
});

test("large containers have 16 toggleable port faces and split incoming flow between connected outputs", async () => {
  const { run } = await app();
  run(`recipes.push({name:"Container feed",machine:"refinery",inputs:[],
    outputs:[{item:"ore",per_min:"30/min"}]});
    restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",x:36,y:39,rotation:0,recipe:"Container feed"},
        {id:3,slug:"large-container",x:42,y:40,rotation:0}],
      belts:[{id:4,cells:[{x:39,y:40},{x:40,y:40},{x:41,y:40}]},
        {id:5,cells:[{x:46,y:40},{x:47,y:40}]},
        {id:6,cells:[{x:43,y:44},{x:43,y:45}]}]})`);
  assert.equal(run('machineFootprint(getMachine("large-container")).join("x")'), "4x4");
  assert.equal(run('placementPorts(getMachine("large-container")).length'), 16);
  assert.equal(run('beltFlow.get("47,40").total'), 15);
  assert.equal(run('beltFlow.get("43,45").total'), 15);
  run('togglePort(placements[1],"3,0,east");restore(serialize())');
  assert.equal(run('portConnection({x:46,y:40},{x:47,y:40})'), null);
  assert.equal(run('beltFlow.get("43,45").total'), 30);
});

test("belt connectors meet port faces on every edge and unknown rates stay amber", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"container",x:50,y:34,rotation:0},
      {id:3,slug:"container",x:54,y:34,rotation:1}],
    belts:[{id:4,cells:[{x:52,y:34},{x:53,y:34}]}]});
    globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];
    globalThis.strokes=[];ctx.stroke=()=>strokes.push(ctx.strokeStyle);
    selected={type:"belt",id:4};draw();`);
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "true");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-symbol"]==="belt-track"&&n.attributes["stroke-width"]==="8").attributes.stroke'), "#d5a649");
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-track").length'), 4);
  for (const [cell, neighbor, point] of [
    [{ x: 49, y: 34 }, { x: 48, y: 34 }, { x: 803, y: 552 }],
    [{ x: 52, y: 34 }, { x: 53, y: 34 }, { x: 829, y: 552 }],
    [{ x: 50, y: 33 }, { x: 50, y: 32 }, { x: 808, y: 547 }],
    [{ x: 50, y: 36 }, { x: 50, y: 37 }, { x: 808, y: 573 }]
  ]) {
    const connection = JSON.parse(run(`JSON.stringify(portConnection(${JSON.stringify(cell)},${JSON.stringify(neighbor)}))`));
    assert.equal(connection.x, point.x);
    assert.equal(connection.y, point.y);
    assert.equal(connection.placement.id, 2);
  }
  run("placements[1].y+=3;draw()");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "false");
  run("placements[1].y-=3;placements[1].x=53;belts[0].cells.pop();draw()");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "true");
  run("belts[0].cells[0].direction=1;draw()");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "true");
  run(`placements.pop();belts[0].cells=[
    {x:50,y:33},{x:50,y:32},{x:51,y:32},{x:52,y:32},
    {x:53,y:32},{x:53,y:33},{x:53,y:34},{x:52,y:34}];draw()`);
  assert.equal(run('beltConnections(belts[0].cells).every(c=>c?.placement.id===2)'), true);
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "false");
});

test("belt ends turn sideways into adjacent ports with a continuous full-width outline", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"refinery",x:50,y:34,rotation:0},
      {id:3,slug:"container",x:53,y:37,rotation:0}],
    belts:[{id:4,cells:[{x:51,y:37},{x:52,y:37}]}]});
    globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
  assert.equal(run("beltConnections(belts[0].cells).length"), 2);
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "true");
  const tracks = JSON.parse(run('JSON.stringify(nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-track").map(n=>n.attributes))'));
  assert.equal(tracks[0].d, "M832 600 L824 600 L824 590");
  assert.equal(tracks[2].d, "M832 600 L824 600 L824 592");
  assert.equal(tracks[1].d, "M832 600 L840 600 L850 600");
  assert.equal(tracks[3].d, "M832 600 L840 600 L848 600");
  assert.equal(tracks[0]["stroke-width"], "12");
  assert.equal(tracks[2]["stroke-width"], "8");
  assert.equal(tracks[0]["stroke-linejoin"], "round");
});

test("recipe labels include exact source rates only when all text fits", async () => {
  const { run } = await app();
  run('globalThis.labelRecipe={outputs:[{name:"Hydrogen Fuel",per_min:"60/min"}]}');
  assert.equal(run('recipeLabelLines(labelRecipe,200,1).join(" ")'), "Hydrogen Fuel 60/min");
  assert.equal(run('recipeLabelLines(labelRecipe,80,2).join(" ")'), "Hydrogen Fuel 60/min");
  assert.equal(run('recipeLabelLines(labelRecipe,80,1).join(" ")'), "Hydrogen Fuel");
  run('labelRecipe.outputs[0].per_min=null');
  assert.equal(run('recipeLabelLines(labelRecipe,200,1).join(" ")'), "Hydrogen Fuel");
  run('labelRecipe.outputs[0].per_min="0/min"');
  assert.equal(run('recipeLabelLines(labelRecipe,200,1).join(" ")'), "Hydrogen Fuel 0/min");
  run('labelRecipe.outputs.push({name:"Water",per_min:"5/min"})');
  assert.equal(run('recipeLabelLines(labelRecipe,300,1).join(" ")'), "Hydrogen Fuel 0/min + Water 5/min");
});

test("belts extend from either endpoint, merge touching ends and cancel atomically", async () => {
  const { run, pointer } = await app();
  const reset = () => run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[],belts:[{id:2,cells:[{x:52,y:36,direction:1},{x:53,y:36},{x:54,y:36}]}]});
    setTool({type:"belt"})`);
  reset();
  pointer("pointerdown",54,36);
  pointer("pointerup",56,36);
  assert.equal(run("belts.length"),1);
  assert.equal(run("belts[0].id"),2);
  assert.equal(run("belts[0].cells.length"),5);
  assert.equal(run("belts[0].cells[0].direction"),1);
  reset();
  pointer("pointerdown",52,36);
  pointer("pointerup",52,36);
  assert.equal(run("beltDraft.clickMode"),true);
  pointer("pointermove",50,36);
  pointer("pointerdown",50,36);
  assert.equal(run("belts[0].cells[0].x"),50);
  assert.equal(run("belts[0].cells.at(-1).x"),54);
  assert.equal(run("belts[0].cells.find(c=>c.x===52).direction"),1);
  reset();
  const saved = run("JSON.stringify(serialize())");
  pointer("pointerdown",54,36);
  pointer("pointermove",57,36);
  run('window.listeners.keydown({key:"Escape"})');
  assert.equal(run("JSON.stringify(serialize())"),saved);
  reset();
  pointer("pointerdown",53,36);
  assert.equal(run("beltDraft"),null);
  reset();
  run("belts.push({id:3,cells:[{x:57,y:37},{x:57,y:38}]})");
  pointer("pointerdown",54,36);
  pointer("pointerup",57,36);
  assert.equal(run("belts.length"),1);
  assert.equal(run("belts[0].cells.at(-1).y"),38);
  run("restore(serialize())");
  assert.equal(run("belts.length"),1);
  reset();
  run("belts.push({id:3,cells:[{x:57,y:36},{x:58,y:36}]})");
  pointer("pointerdown",54,36);
  pointer("pointerup",57,36);
  assert.equal(run("belts.length"),1);
  assert.equal(run("belts[0].cells.at(-1).x"),58);
});

test("starting beside a unique belt endpoint attaches the draft immediately", async () => {
  const { run, pointer } = await app();
  for (const [startX, finishX] of [[55,57],[51,49]]) {
    run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
      placements:[],belts:[{id:2,cells:[{x:52,y:36},{x:53,y:36},{x:54,y:36}]}]});
      setTool({type:"belt"});globalThis.beforeAttach=JSON.stringify(serialize())`);
    pointer("pointerdown",startX,36);
    assert.equal(run("beltDraft.sourceId"),2);
    assert.equal(run("beltDraft.cells.length"),4);
    assert.equal(run("draftBeltProblem(beltDraft.cells)"),null);
    assert.equal(run("JSON.stringify(serialize())"),run("beforeAttach"));
    pointer("pointerup",startX,36);
    assert.equal(run("beltDraft.clickMode"),true);
    pointer("pointermove",finishX,36);
    pointer("pointerdown",finishX,36);
    assert.equal(run("belts.length"),1);
    assert.equal(run("belts[0].cells.length"),6);
    assert.equal(run("belts[0].id"),2);
  }
});

test("dock ports connect belts to machines in all four orientations", async () => {
  const { run } = await app();
  for (let rotation = 0; rotation < 4; rotation++) {
    run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
      placements:[{id:3,slug:"refinery",x:54,y:34,rotation:0}],
      belts:[{id:4,cells:[{x:55,y:32},{x:55,y:33}]}]});
      rooms.push({id:2,size:"dock",x:48,y:16,rotation:2});draw();
      globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
    assert.equal(run('nodes(symbols).find(n=>n.attributes["data-belt-id"]==="4").attributes["data-connected"]'), "true");
    run(`rooms[1].rotation=${rotation};
      globalThis.dockPort=rotatedPort([7,0],{footprint_tiles:roomTypes.dock.dimensions},${rotation});
      globalThis.inward=[[0,1],[-1,0],[0,-1],[1,0]][${rotation}];
      globalThis.cell={x:48+dockPort[0]-inward[0],y:16+dockPort[1]-inward[1]};
      globalThis.neighbor={x:cell.x-inward[0],y:cell.y-inward[1]};`);
    assert.equal(run("portConnection(cell,neighbor).room.id"),2);
    assert.equal(run("tileIsUsable(48+dockPort[0],16+dockPort[1])"),false);
    run("cell={x:cell.x-inward[0],y:cell.y-inward[1]};neighbor={x:neighbor.x-inward[0],y:neighbor.y-inward[1]}");
    assert.equal(run("portConnection(cell,neighbor)"),null);
  }
});

async function flowApp() {
  const instance = await app();
  instance.run(`recipes.push(
    {name:"Test source",machine:"refinery",inputs:[],outputs:[{item:"ore",name:"Ore",per_min:"30/min"}],confidence:"unverified"},
    {name:"Test sink",machine:"refinery",inputs:[{item:"ore",per_min:"60/min"}],outputs:[{item:"plate",per_min:"10/min"}],confidence:"unverified"});
    restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",x:36,y:34,rotation:0,recipe:"Test source"},
        {id:3,slug:"refinery",x:42,y:34,rotation:0,recipe:"Test source"},
        {id:4,slug:"refinery",x:48,y:39,rotation:0,recipe:"Test sink"}],
      belts:[{id:5,cells:[{x:37,y:37},{x:37,y:38},{x:37,y:39}]},
        {id:6,cells:Array.from({length:11},(_,i)=>({x:37+i,y:40}))}]});
    globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
  return instance;
}

test("ending into a belt interior creates a persistent junction and adds downstream quantities", async () => {
  const { run, pointer } = await flowApp();
  run('setTool({type:"belt"})');
  pointer("pointerdown",43,37);
  pointer("pointermove",43,40);
  assert.equal(run("draftBeltProblem(beltDraft.cells)"),null);
  pointer("pointerup",43,40);
  assert.equal(run("belts.length"),3);
  assert.equal(run('document.getElementById("status").textContent'),"Belt merged into downstream route");
  assert.equal(run('beltFlow.get("43,40").rates.get("ore")'),60);
  assert.equal(run('beltFlow.get("42,40").rates.get("ore")'),30);
  assert.equal(run('beltFlow.get("43,39").rates.get("ore")'),30);
  assert.equal(run('beltFlow.get("43,40").load'),"equal");
  assert.equal(run('beltFlow.get("42,40").load'),"below");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-cell"]==="43,40"&&n.attributes["stroke-width"]==="8").attributes.stroke'),"#51c889");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-cell"]==="42,40"&&n.attributes["stroke-width"]==="8").attributes.stroke'),"#a6afb8");
  run('globalThis.beforeFlow=JSON.stringify(serialize());restore(JSON.parse(beforeFlow))');
  assert.equal(run("JSON.stringify(serialize())"),run("beforeFlow"));
  assert.equal(run('beltFlow.get("43,40").total'),60);
});

test("belt flow is capped by the receiving recipe input demand", async () => {
  const { run } = await flowApp();
  run('recipes.find(r=>r.name==="Test sink").inputs[0].per_min="15/min";draw()');
  assert.equal(run('beltFlow.get("40,40").target'),15);
  assert.equal(run('beltFlow.get("40,40").total'),15);
  assert.equal(run('beltFlow.get("40,40").rates.get("ore")'),15);
  assert.equal(run('beltFlow.get("40,40").load'),"equal");
  run('recipes.find(r=>r.name==="Test source").outputs[0].per_min="15/min";draw()');
  assert.equal(run('beltFlow.get("40,40").load'),"equal");
  assert.equal(run('beltFlow.get("40,40").total'),15);
  run('recipes.find(r=>r.name==="Test source").outputs[0].per_min="10/min";draw()');
  assert.equal(run('beltFlow.get("40,40").load'),"below");
  run('recipes.find(r=>r.name==="Test sink").inputs[0].per_min="90/min";draw()');
  assert.equal(run('beltFlow.get("40,40").target'),60);
  run('recipes.find(r=>r.name==="Test source").outputs[0].per_min="61/min";draw()');
  assert.equal(run('beltFlow.get("40,40").load'),"above");
  run('delete placements[2].recipe;draw()');
  assert.equal(run('beltFlow.get("40,40").target'),60);
  run('recipes.find(r=>r.name==="Test source").outputs[0].per_min="60/min";draw()');
  assert.equal(run('beltFlow.get("40,40").load'),"equal");
  run('delete placements[0].recipe;draw()');
  assert.equal(run('beltFlow.get("40,40").load'),"unknown");
});

test("recipe demand limits all tiles along the belt feeding a machine", async () => {
  const { run, pointer } = await flowApp();
  run('recipes.find(r=>r.name==="Test sink").inputs[0].per_min="15/min";draw()');
  for (let x = 37; x <= 47; x++) {
    assert.equal(run(`beltFlow.get("${x},40").total`),15,`tile ${x},40`);
  }
  pointer("pointermove",44,40);
  assert.match(run("canvas.title"),/Belt flow: 15\/min/);
});

test("separate same-item feeds share a machine's total recipe demand", async () => {
  const { run } = await flowApp();
  run(`recipes.find(r=>r.name==="Test sink").inputs[0].per_min="15/min";
    belts.push({id:7,cells:[
      {x:43,y:37},{x:44,y:37},{x:45,y:37},{x:46,y:37},
      {x:47,y:37},{x:48,y:37},{x:49,y:37},{x:49,y:38}
    ]});draw()`);
  assert.equal(run('beltFlow.get("47,40").total'),7.5);
  assert.equal(run('beltFlow.get("49,38").total'),7.5);
  assert.equal(run('beltFlow.get("47,40").total + beltFlow.get("49,38").total'),15);
});

test("hovering belts shows per-tile flow, target and unknown contributions", async () => {
  const { run, pointer } = await flowApp();
  pointer("pointermove",40,40);
  assert.match(run("canvas.title"),/Belt flow: 30\/min/);
  assert.match(run("canvas.title"),/Ore: 30\/min/);
  assert.match(run("canvas.title"),/Target: 60\/min/);
  assert.match(run("canvas.title"),/provisional/);
  run('delete placements[0].recipe;delete placements[2].recipe;draw()');
  pointer("pointermove",40,40);
  assert.match(run("canvas.title"),/Belt flow: unknown/);
  pointer("pointermove",60,60);
  assert.equal(run("canvas.title"),"");
});

test("unknown supply is backtracked from downstream machine demand through splitters", async () => {
  const { run, pointer } = await app();
  const recipe = "Titanium Plates Ore Refining";
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[{id:2,slug:"splitter-mk-1",x:40,y:40,rotation:0},
      {id:3,slug:"splitter-mk-1",x:40,y:44,rotation:0},
      {id:4,slug:"refinery",x:42,y:39,rotation:0,recipe:"${recipe}"},
      {id:5,slug:"refinery",x:42,y:43,rotation:0,recipe:"${recipe}"},
      {id:6,slug:"refinery",x:42,y:46,rotation:0,recipe:"${recipe}"}],
    belts:[{id:7,cells:[{x:40,y:37},{x:40,y:38},{x:40,y:39}]},
      {id:8,cells:[{x:41,y:40}]},
      {id:9,cells:[{x:40,y:41},{x:40,y:42},{x:40,y:43}]},
      {id:10,cells:[{x:41,y:44}]},
      {id:11,cells:[{x:40,y:45},{x:40,y:46},{x:40,y:47},{x:41,y:47}]}]})`);
  for (const [cells, rate] of [[["40,37","40,39"],60],[["40,41","40,43"],40],
      [["40,45","41,47"],20],[["41,40","41,44"],20]]) {
    for (const cell of cells) {
      assert.equal(run(`beltFlow.get("${cell}").total`),rate,cell);
      assert.equal(run(`beltFlow.get("${cell}").inferred`),true,cell);
      assert.equal(run(`beltFlow.get("${cell}").load`),"equal",cell);
    }
  }
  pointer("pointermove",40,38);
  assert.match(run("canvas.title"),/Belt flow: 60\/min \(inferred/);
  run("delete placements[4].recipe;draw()");
  assert.equal(run('beltFlow.get("40,38").unknown'),true);
  assert.equal(run('beltFlow.get("41,40").total'),20);
});

test("belt arrows become per-tile rates at 200 percent zoom without changing layout", async () => {
  const { run } = await flowApp();
  const original = run("JSON.stringify(serialize())");
  run("setZoom(1.99)");
  const tileCount = run("belts.reduce((count,belt)=>count+belt.cells.length,0)");
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-arrow").length'),tileCount);
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-rate").length'),0);
  run("setZoom(2)");
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-rate").length'),tileCount);
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-arrow").length'),0);
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-symbol"]==="belt-rate"&&n.attributes["data-cell"]==="40,40").textContent'),"30");
  run("setZoom(2.5)");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-symbol"]==="belt-rate").attributes.transform.endsWith("scale(0.4)")'),true);
  assert.equal(run("JSON.stringify(serialize())"),original);
  run("delete placements[0].recipe;delete placements[2].recipe;draw()");
  assert.equal(run('nodes(symbols).find(n=>n.attributes["data-symbol"]==="belt-rate"&&n.attributes["data-cell"]==="40,40").textContent'),"?");
  run("setZoom(1.99)");
  assert.equal(run('nodes(symbols).filter(n=>n.attributes["data-symbol"]==="belt-arrow").length'),tileCount);
});

test("rate labels fit each tile without truncating large, small, fractional or zero rates", async () => {
  const { run } = await flowApp();
  run("setZoom(2)");
  run("delete placements[2].recipe;draw()");
  for (const [rate, label] of [["0/min","0"],["0.0001/min","1e-4"],["3.333333/min","3.33"],["123456/min","1.23e5"]]) {
    run(`recipes.find(r=>r.name==="Test source").outputs[0].per_min="${rate}";draw()`);
    const text = JSON.parse(run(`JSON.stringify(nodes(symbols).find(n=>
      n.attributes["data-symbol"]==="belt-rate"&&n.attributes["data-cell"]==="40,40"))`));
    assert.equal(text.textContent,label);
    assert.ok(text.textContent.length * 6 * Number(text.attributes["font-size"]) / 10 <= 28 + 1e-8);
  }
});

test("a splitter feeds an adjacent assembler and a sideways belt endpoint at 30 plates per minute each", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[...[34,38,42].map((x,i)=>({id:i+2,slug:"refinery",x,y:34,rotation:0,
      recipe:"Titanium Plates Ore Refining"})),
      {id:5,slug:"splitter-mk-1",x:46,y:37,rotation:3},
      {id:6,slug:"assembler",x:45,y:38,rotation:0,recipe:"Hull Plate Titanium Crafting",
        disabledPorts:["3,0,north"]},
      {id:7,slug:"assembler",x:50,y:38,rotation:0,recipe:"Hull Plate Titanium Crafting"}],
    belts:[{id:8,cells:Array.from({length:11},(_,i)=>({x:35+i,y:37}))},
      {id:9,cells:Array.from({length:5},(_,i)=>({x:47+i,y:37}))}]});
    setZoom(2);globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
  for (const [cell, rate] of [["35,37",20],["39,37",40],["43,37",60],["45,37",60],["47,37",30],["51,37",30]]) {
    assert.equal(run(`beltFlow.get("${cell}").total`), rate, cell);
    assert.equal(run(`beltFlow.get("${cell}").rates.get("titanium-plates")`), rate, cell);
    assert.equal(run(`beltFlow.get("${cell}").unknown`), false, cell);
  }
  for (const [cell, rate] of [["45,37",60],["47,37",30],["51,37",30]]) {
    assert.equal(run(`beltFlow.get("${cell}").target`), rate, cell);
    assert.equal(run(`beltFlow.get("${cell}").load`), "equal", cell);
    assert.equal(run(`nodes(symbols).find(n=>n.attributes["data-symbol"]==="belt-rate"&&
      n.attributes["data-cell"]==="${cell}").textContent`), String(rate));
  }
  run("globalThis.assemblerLayout=serialize()");
  for (const toggle of ['togglePort(placements[3],"0,0,south")', 'togglePort(placements[4],"1,0,north")']) {
    run(`${toggle};draw()`);
    assert.equal(run('beltFlow.get("45,37").total'), 30);
    assert.equal(run('beltFlow.get("51,37").total'), 30);
    run("restore(assemblerLayout)");
  }
  run('delete placements[0].recipe;draw()');
  assert.equal(run('beltFlow.get("45,37").total'), 60);
  assert.equal(run('beltFlow.get("51,37").total'), 30);
  assert.equal(run('beltFlow.get("45,37").inferred'), true);
});

test("serial output ports contribute production once across belt joins and splitters", async () => {
  const { run } = await app();
  run(`recipes.push({name:"Serial source",machine:"assembler",inputs:[],
    outputs:[{item:"plate",per_min:"15/min"}]});
    restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"assembler",x:36,y:38,rotation:0,recipe:"Serial source"},
        {id:3,slug:"splitter-mk-1",x:43,y:37,rotation:3}],
      belts:[{id:4,cells:[{x:37,y:37},{x:38,y:37}]},
        {id:5,cells:[{x:39,y:37},{x:40,y:37},{x:41,y:37},{x:42,y:37}]},
        {id:6,cells:[{x:44,y:37},{x:45,y:37}]},
        {id:7,cells:[{x:43,y:38},{x:43,y:39},{x:43,y:40}]}]});
    setZoom(2);globalThis.nodes=node=>[node,...node.children.flatMap(nodes)];`);
  for (let x = 37; x <= 42; x++) {
    assert.equal(run(`beltFlow.get("${x},37").total`), 15, `tile ${x},37`);
    assert.equal(run(`beltFlow.get("${x},37").unknown`), false);
  }
  for (const cell of ["44,37", "45,37", "43,38", "43,39", "43,40"]) {
    assert.equal(run(`beltFlow.get("${cell}").total`), 7.5, cell);
    assert.equal(run(`beltFlow.get("${cell}").load`), "below", cell);
    assert.equal(run(`nodes(symbols).find(n=>n.attributes["data-symbol"]==="belt-rate"&&
      n.attributes["data-cell"]==="${cell}").textContent`), "7.5");
  }
  run(`belts.push({id:8,cells:[{x:37,y:43},{x:37,y:44}]});draw()`);
  assert.equal(run('beltFlow.get("42,37").unknown'), true);
  assert.equal(run('beltFlow.get("37,44").unknown'), true);
});

test("merged refinery output stays known when the belt passes another port on the same refinery", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
    placements:[...[36,40,44].map((x,i)=>({id:i+2,slug:"refinery",x,y:38,rotation:0,
      recipe:"Titanium Plates Ore Refining"})),
      {id:5,slug:"splitter-mk-1",x:49,y:39,rotation:3}],
    belts:[{id:6,cells:[...Array.from({length:11},(_,i)=>({x:37+i,y:41})),
      {x:47,y:40},{x:47,y:39},{x:48,y:39}]},
      {id:7,cells:[{x:50,y:39},{x:51,y:39}]},
      {id:8,cells:[{x:49,y:40},{x:49,y:41}]}]})`);
  for (const [cell, rate] of [["37,41",20],["40,41",20],["41,41",40],
      ["44,41",40],["45,41",60],["47,39",60],["48,39",60],["51,39",30],["49,41",30]]) {
    assert.equal(run(`beltFlow.get("${cell}").total`), rate, cell);
    assert.equal(run(`beltFlow.get("${cell}").unknown`), false, cell);
  }
});

test("flow respects tile facing, retains item identities, and does not invent rates for cycles or split sources", async () => {
  const { run } = await flowApp();
  run(`recipes.find(r=>r.name==="Test source").outputs.push({item:"water",per_min:"5/min"});
    belts.push({id:7,cells:[{x:43,y:37},{x:43,y:38},{x:43,y:39}]});draw()`);
  assert.equal(run('beltFlow.get("44,40").rates.get("ore")'),60);
  assert.equal(run('beltFlow.get("44,40").rates.get("water")'),0);
  assert.equal(run('beltFlow.get("44,40").load'),"equal");
  run('belts[2].cells[1].direction=0;draw()');
  assert.equal(run('beltFlow.get("44,40").total'),60);
  assert.equal(run('beltFlow.get("42,40").inferred'),undefined);
  assert.equal(run('beltFlow.get("42,40").total'),30);
  assert.equal(run('beltFlow.get("43,39").inferred'),true);
  assert.equal(run('beltFlow.get("43,39").total'),30);
  run(`belts.push({id:8,cells:[{x:55,y:45,direction:0},{x:56,y:45,direction:1},
    {x:56,y:46,direction:2},{x:55,y:46,direction:3}]});draw()`);
  assert.equal(run('beltFlow.get("55,45").load'),"unknown");
  run('belts.push({id:9,cells:[{x:35,y:35},{x:34,y:35}]});draw()');
  assert.equal(run('beltFlow.get("35,35").load'),"unknown");
  assert.equal(run('beltFlow.get("37,37").inferred'),true);
  assert.equal(run('beltFlow.get("37,37").total'),30);
  assert.equal(run('beltFlow.get("44,40").total'),60);
});

test("containers sum inputs per item and divide equally between connected output belts", async () => {
  const { run, pointer } = await flowApp();
  run(`recipes.push({name:"Second source",machine:"refinery",inputs:[],
    outputs:[{item:"ore",name:"Ore",per_min:"60/min"},{item:"water",name:"Water",per_min:"10/min"}]});
    restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",x:36,y:39,rotation:0,recipe:"Test source"},
        {id:3,slug:"refinery",x:41,y:34,rotation:0,recipe:"Second source"},
        {id:4,slug:"container",x:42,y:40,rotation:0}],
      belts:[{id:5,cells:[{x:39,y:40},{x:40,y:40},{x:41,y:40}]},
        {id:6,cells:[{x:42,y:37},{x:42,y:38},{x:42,y:39}]},
        {id:7,cells:[{x:44,y:40},{x:45,y:40},{x:46,y:40}]},
        {id:8,cells:[{x:43,y:42},{x:43,y:43},{x:43,y:44}]}]});`);
  assert.equal(run('beltFlow.get("45,40").rates.get("ore")'),45);
  assert.equal(run('beltFlow.get("45,40").rates.get("water")'),5);
  assert.equal(run('beltFlow.get("43,43").total'),50);
  assert.equal(run('beltFlow.get("43,43").load'),"below");
  pointer("pointermove",45,40);
  assert.match(run("canvas.title"),/Belt flow: 50\/min/);
  run('globalThis.beforeContainer=JSON.stringify(serialize());restore(JSON.parse(beforeContainer))');
  assert.equal(run('beltFlow.get("45,40").total'),50);
  run('belts=belts.filter(b=>b.id!==8);draw()');
  assert.equal(run('beltFlow.get("45,40").total'),100);
  assert.equal(run('beltFlow.get("45,40").load'),"above");
  run('placements.push({id:9,slug:"container",x:47,y:40,rotation:0});belts.push({id:10,cells:[{x:49,y:40},{x:50,y:40}]});draw()');
  assert.equal(run('beltFlow.get("50,40").total'),100);
  run('delete placements[1].recipe;draw()');
  assert.equal(run('beltFlow.get("50,40").load'),"unknown");
  assert.equal(run('beltFlow.get("50,40").rates.get("ore")'),30);
  run('belts=belts.filter(b=>b.id!==5&&b.id!==6);draw()');
  assert.equal(run('beltFlow.get("50,40").load'),"unknown");
});

test("splitters divide 60/min evenly across one, two, or three connected outputs in every rotation", async () => {
  const { run, pointer } = await flowApp();
  run('recipes.find(r=>r.name==="Test source").outputs[0].per_min="60/min"');
  const directions = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] };
  for (let rotation = 0; rotation < 4; rotation++) {
    const ports = JSON.parse(run(`JSON.stringify(machinePorts(getMachine("splitter-mk-1"),${rotation}))`));
    const [dx, dy] = directions[ports.find(port => port.role === "input").side];
    const outputs = ports.filter(port => port.role === "output").map(port => {
      const [ox, oy] = directions[port.side];
      return [1,2].map(distance => ({x:45 + distance * ox, y:45 + distance * oy}));
    });
    const fixture = { version:3, rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",x:44 + 4 * dx,y:44 + 4 * dy,rotation:0,recipe:"Test source"},
        {id:3,slug:"splitter-mk-1",x:45,y:45,rotation}],
      belts:[{id:4,cells:[2,1].map(distance => ({x:45 + distance * dx,y:45 + distance * dy}))},
        {id:5,cells:outputs[0]},{id:6,cells:outputs[1]}] };
    run(`restore(${JSON.stringify(fixture)})`);
    for (const cells of outputs.slice(0,2)) for (const cell of cells) {
      assert.equal(run(`beltFlow.get("${cell.x},${cell.y}").total`),30);
      assert.equal(run(`beltFlow.get("${cell.x},${cell.y}").unknown`),false);
    }
    pointer("pointermove",outputs[0][1].x,outputs[0][1].y);
    assert.match(run("canvas.title"), /Belt flow: 30\/min/);
    fixture.belts.push({id:7,cells:outputs[2]});
    run(`restore(${JSON.stringify(fixture)})`);
    for (const cells of outputs) {
      assert.equal(run(`beltFlow.get("${cells[0].x},${cells[0].y}").total`),20);
    }
    run("belts=belts.filter(belt=>belt.id!==7);draw()");
    assert.equal(run(`beltFlow.get("${outputs[0][0].x},${outputs[0][0].y}").total`),30);
    pointer("pointermove",outputs[1][0].x,outputs[1][0].y);
    run('window.listeners.keydown({key:"x",target:{tagName:"BODY"},preventDefault(){}})');
    assert.equal(run(`beltFlow.get("${outputs[0][0].x},${outputs[0][0].y}").total`),60);
    run("restore(serialize())");
    assert.equal(run(`beltFlow.get("${outputs[0][0].x},${outputs[0][0].y}").total`),60);
  }
});

test("splitters cap recipe-bound outputs and redistribute overflow to outputs with demand", async () => {
  const { run } = await flowApp();
  run(`recipes.find(r=>r.name==="Test source").outputs[0].per_min="60/min";
    recipes.find(r=>r.name==="Test sink").inputs[0].per_min="15/min";
    recipes.push({...recipes.find(r=>r.name==="Test sink"),name:"Test sink 45",
      inputs:[{item:"ore",per_min:"45/min"}]});
    restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",x:44,y:40,rotation:0,recipe:"Test source"},
        {id:3,slug:"splitter-mk-1",x:45,y:45,rotation:0},
        {id:4,slug:"refinery",x:48,y:44,rotation:0,recipe:"Test sink"},
        {id:5,slug:"refinery",x:44,y:48,rotation:0,recipe:"Test sink 45"}],
      belts:[{id:6,cells:[{x:45,y:43},{x:45,y:44}]},
        {id:7,cells:[{x:46,y:45},{x:47,y:45}]},
        {id:8,cells:[{x:45,y:46},{x:45,y:47}]}]});`);
  assert.equal(run('beltFlow.get("45,43").total'),60);
  assert.equal(run('beltFlow.get("45,44").total'),60);
  for (const x of [46,47]) assert.equal(run(`beltFlow.get("${x},45").total`),15);
  for (const y of [46,47]) assert.equal(run(`beltFlow.get("45,${y}").total`),45);
  assert.equal(run('beltFlow.get("47,45").target'),15);
  assert.equal(run('beltFlow.get("45,47").target'),45);
  assert.equal(run('beltFlow.get("47,45").load'),"equal");
  assert.equal(run('beltFlow.get("45,47").load'),"equal");
  run('recipes.find(r=>r.name==="Test sink 45").inputs[0].per_min="15/min";draw()');
  for (const cell of ["45,43","45,44"]) assert.equal(run(`beltFlow.get("${cell}").total`),30);
  assert.equal(run('beltFlow.get("47,45").total'),15);
  assert.equal(run('beltFlow.get("45,47").total'),15);
});

test("splitters preserve per-item contributions and respect fixed port roles", async () => {
  const { run } = await flowApp();
  run(`recipes.find(r=>r.name==="Test source").outputs=[{item:"ore",per_min:"60/min"},{item:"water",per_min:"12/min"}];
    restore({version:3,rooms:[{id:1,size:"2x2",x:32,y:32}],
      placements:[{id:2,slug:"refinery",x:40,y:34,rotation:0,recipe:"Test source"},
        {id:3,slug:"splitter-mk-1",x:41,y:40,rotation:0}],
      belts:[{id:4,cells:[{x:41,y:37},{x:41,y:38},{x:41,y:39}]},
        {id:5,cells:[{x:42,y:40},{x:43,y:40},{x:44,y:40}]},
        {id:6,cells:[{x:40,y:40},{x:39,y:40},{x:38,y:40}]}]});`);
  assert.equal(run('beltFlow.get("43,40").rates.get("ore")'),30);
  assert.equal(run('beltFlow.get("43,40").rates.get("water")'),6);
  run("belts[2].cells.reverse();draw()");
  assert.equal(run('beltFlow.get("43,40").total'),72);
  assert.equal(run('beltFlow.get("39,40").unknown'),true);
  run("belts[0].cells.reverse();draw()");
  assert.equal(run('beltFlow.get("43,40").unknown'),true);
  assert.equal(run('beltFlow.get("41,38").unknown'),true);
  run("belts[0].cells.reverse();delete placements[0].recipe;draw()");
  assert.equal(run('beltFlow.get("43,40").unknown'),true);
  run("belts=belts.filter(belt=>belt.id!==4);draw()");
  assert.equal(run('beltFlow.get("43,40").unknown'),true);
});

test("splitter feedback and downstream belts remain unknown instead of amplifying rates", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"splitter-mk-1",x:53,y:37,rotation:0}],
    belts:[{id:3,cells:[{x:54,y:37},{x:55,y:37},{x:55,y:36},{x:55,y:35},
      {x:54,y:35},{x:53,y:35},{x:53,y:36}]},
      {id:4,cells:[{x:53,y:38},{x:53,y:39}]}]});`);
  assert.equal(run('[...beltFlow.values()].every(node=>node.unknown && node.total===0)'),true);
});

test("container feedback remains unknown instead of amplifying rates", async () => {
  const { run } = await app();
  run(`restore({version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"container",x:53,y:37,rotation:0}],
    belts:[{id:3,cells:[{x:55,y:37},{x:56,y:37},{x:56,y:38},{x:56,y:39},
      {x:55,y:39},{x:54,y:39,direction:3}]}]});`);
  assert.equal(run('[...beltFlow.values()].every(n=>n.load==="unknown")'),true);
});

test("v3 restore validates belts and recipes atomically, and older layouts still load", async () => {
  const { run } = await app();
  run(`globalThis.fixture={version:3,rooms:[{id:1,size:"1x1",x:48,y:32}],
    placements:[{id:2,slug:"assembler",x:52,y:38,rotation:0,recipe:"Hull Plate Titanium Crafting"}],
    belts:[{id:3,cells:[{x:50,y:34},{x:51,y:34}]}]}; restore(fixture)`);
  const original = run("JSON.stringify(serialize())");
  run('globalThis.shareState = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(projectHash().replaceAll("-","+").replaceAll("_","/")), c=>c.charCodeAt(0)))); restore(shareState)');
  assert.equal(run("JSON.stringify(serialize())"), original);
  for (const mutate of [
    "bad.belts[0].id=2",
    "bad.belts[0].cells=[]",
    "bad.belts[0].cells=[{x:50,y:34},{x:51,y:35}]",
    "bad.belts[0].cells=[{x:52,y:38},{x:53,y:38}]",
    "bad.belts.push({id:4,cells:[{x:51,y:33},{x:51,y:34}]})",
    "bad.placements[0].recipe='Cobalt Plates Ore Refining'",
    "bad.belts=null"
  ]) {
    run(`globalThis.bad=JSON.parse(JSON.stringify(fixture)); ${mutate}`);
    assert.throws(() => run("restore(bad)"), /Invalid|recipe/);
    assert.equal(run("JSON.stringify(serialize())"), original);
  }
  run('restore({version:2,rooms:[{id:1,size:"1x1",x:48,y:32}],placements:[{id:2,slug:"assembler",x:50,y:34,rotation:0}]})');
  assert.equal(run("belts.length"), 0);
  assert.equal(run("placements[0].recipe"), undefined);
  run('restore({version:1,station:"1x1",placements:[{slug:"refinery",x:2,y:2,rotation:0}]})');
  assert.equal(run("placements[0].x"), 50);
  assert.equal(run("belts.length"), 0);
});
