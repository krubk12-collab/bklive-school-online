# โรงเรียนออนไลน์ v7 — Map Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the school-online map to match the real satellite layout of โรงเรียนชุมชนวัดบางโค, add an arrival/departure + day-night cycle, fix NPC bugs, add new buildings (gym/library/playground/2nd science room/bigger canteen/shops/7-11/temple), add ผอ./รองผอ. patrol characters, add a searchable left sidebar, and fix mobile blur.

**Architecture:** Single-file vanilla JS + canvas (`index.html`), no framework/build step — this is the established pattern for this project (see `SPEC.md`) and must not change. All new logic extends the existing global consts/functions in place. `data.js`/`build_data.js` are untouched (no new external data source needed for this phase).

**Tech Stack:** Vanilla JS, HTML5 Canvas 2D, Node.js (smoke-test harness only, dev-time)

## Global Constraints

- Keep the project as ONE `index.html` file (established convention — do not split into modules/bundler).
- No new npm dependencies. Node is only used to run the smoke-test harness with built-ins (`fs`, `vm`).
- Every task must keep `selfCheck()` (in `index.html`) passing — it is this project's only regression guard.
- Real student/teacher data (544 students / 43 teachers, `data.js`) must keep working unchanged — don't touch `build_data.js`/`data.js`.
- Deferred/out of scope this round (per spec): เวรวันพระจริง, นิเทศ API จริง, ครูเวรกลางคืน, สถิติการมาเรียนจริง. Do not build these — stub nothing for them either (YAGNI).
- Spec reference: `docs/superpowers/specs/2026-07-14-map-expansion-design.md`

---

## File Structure

- Modify: `index.html` — every task in this plan touches this file only.
- Create: `test/smoke.js` — committed Node smoke-test harness (stub DOM/canvas, execute the game script, assert invariants). Previously this lived in an ephemeral scratchpad and was lost between sessions; committing it fixes that.
- Modify (append only): `SPEC.md` — final task appends a changelog entry, matching the existing convention of dated `## อัปเดต` sections.

---

### Task 1: Committed smoke-test harness (baseline safety net)

**Files:**
- Create: `test/smoke.js`
- Modify: none yet (baseline run against current v6.1 `index.html`)

**Interfaces:**
- Produces: `node test/smoke.js` — exits 0 and prints `SMOKE OK` if the game script loads without throwing and `selfCheck()` logs no `❌`/`console.error`; exits 1 and prints the captured errors otherwise. Every later task re-runs this same command.

- [ ] **Step 1: Write the harness**

```js
// test/smoke.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'index.html');

function extractScript(html) {
  const m = html.match(/<script>\n([\s\S]*)<\/script>\n<\/body>/);
  if (!m) throw new Error('could not find inline <script> block in index.html');
  return m[1];
}

function makeCtxProxy() {
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      return (...args) => undefined;
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
}

function makeEl(tag) {
  const el = {
    tagName: tag,
    style: {},
    _children: [],
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    addEventListener(){},
    appendChild(c) { el._children.push(c); return c; },
    querySelectorAll() { return []; },
    querySelector() { return makeEl('div'); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1024, height: 768 }; },
    getContext() { return makeCtxProxy(); },
    get innerHTML() { return el._html || ''; },
    set innerHTML(v) { el._html = v; },
    get textContent() { return el._text || ''; },
    set textContent(v) { el._text = v; },
    value: '0', min: '0', max: '0', step: '1', checked: true,
    width: 1024, height: 768,
    onclick: null, onchange: null, oninput: null,
  };
  return el;
}

function run() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const script = extractScript(html);

  const elements = {};
  const errors = [];

  const consoleShim = {
    log() {},
    error(...a) { errors.push(a.map(String).join(' ')); },
    assert(cond, ...a) { if (!cond) errors.push('assert failed: ' + a.map(String).join(' ')); },
  };

  const documentShim = {
    getElementById(id) { return elements[id] || (elements[id] = makeEl('div')); },
    querySelector() { return makeEl('main'); },
    createElement(tag) { return makeEl(tag); },
    addEventListener() {},
  };

  let rafCount = 0;
  const sandbox = {
    console: consoleShim,
    document: documentShim,
    window: null, // filled below (self-reference)
    innerWidth: 1024,
    innerHeight: 768,
    requestAnimationFrame(fn) { rafCount++; if (rafCount < 2) fn(16); }, // run frame() once, don't recurse forever
    Math, Date: undefined, // Date.now()/new Date() without args is intentionally left available;
                             // the script only uses `new Date().toLocaleString(...)` (with args) which is fine.
    Audio: undefined,
    AudioContext: function () {
      return {
        currentTime: 0,
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; },
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
        destination: {},
      };
    },
    SCHOOL: require(path.join(__dirname, '..', 'data.js')) ,
  };
  sandbox.window = sandbox;
  sandbox.webkitAudioContext = sandbox.AudioContext;

  vm.createContext(sandbox);
  try {
    vm.runInContext(script, sandbox, { filename: 'index.html-inline-script.js', timeout: 10000 });
  } catch (e) {
    console.error('SMOKE FAIL — script threw:', e.stack || e);
    process.exit(1);
  }

  if (errors.length) {
    console.error('SMOKE FAIL — captured console errors/asserts:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('SMOKE OK');
}

run();
```

Note: `data.js` currently does `const SCHOOL = {...}` at top level with no `module.exports` (it's a browser `<script src="data.js">`, not a CommonJS module). Check the last line of `data.js` — if it has no export, add one line so both browser and Node can use it:

```js
if (typeof module !== 'undefined') module.exports = SCHOOL;
```

Append this to the end of `data.js` (find the exact end via `tail -c 200 data.js` — it is one line total per the earlier `wc -l` check, a single minified `const SCHOOL={...}` statement; append `;if(typeof module!=='undefined')module.exports=SCHOOL;` right after it, same line is fine).

- [ ] **Step 2: Run it against current v6.1 baseline**

Run: `node test/smoke.js`
Expected: `SMOKE OK` (if it fails, the failure is in the harness stub, not the game — fix the stub until v6.1 passes cleanly before moving on; do not touch `index.html` in this task)

- [ ] **Step 3: Commit**

```bash
git add test/smoke.js data.js
git commit -m "test: add committed smoke-test harness for game script (was previously lost between sessions)"
```

---

### Task 2: Map relayout to match real satellite photo

**Files:**
- Modify: `index.html:90-232` (const `ROOMS`/`ROOM_BY_ID`/`GW`/`GH`/`FLAGP`/`PLAZA`/`DAYS`/`ASM`/`PPER`/`MPER` block, and the grid/door/desk/path/deco generation block)

**Interfaces:**
- Consumes: nothing new yet (pure geometry).
- Produces (for later tasks to rely on): `GW=100, GH=112`; new room ids `gym, library, playground, office, shop1..shop5, store711, m_sci2, dome, temple`; `GATE_FRONT={x:50,y:2}`, `GATE_BACK={x:80,y:87}`; `DOME_RECT={x1:65,y1:60,x2:94,y2:83}` (replaces old `PLAZA`); `FORM` array (unchanged concept, now sourced from `DOME_RECT`); `sciRoomFor(rid, cls)` helper for the 2-science-room split.

- [ ] **Step 1: Replace room/type-styling consts**

In `index.html`, extend the type-styling maps (around line 81-88) with the new types:

```js
const TYPE_ICON={classroom:'📚',sport:'⚽',art:'🎨',music:'🎵',computer:'💻',science:'🔬',library:'📖',staff:'☕',canteen:'🍽️',plaza:'🚩',
  gym:'🏋️',playground:'🛝',office:'🗂️',shop:'🛒',store711:'🏪',temple:'🛕',dome:'🚩'};
const FLOOR={classroom:'#f3e9d2',computer:'#d9e2ec',science:'#d7f0dd',art:'#ecdcf7',music:'#f6e3fb',
             sport:'#7cc47f',library:'#fdeccb',staff:'#e7ede6',canteen:'#ffe6cc',
             gym:'#e0e7ef',playground:'#fde68a',office:'#e0f2e9',shop:'#fef3c7',store711:'#fee2e2',temple:'#fef0d5',dome:'#e8e2d0'};
const ACCENT={classroom:'#b98a4b',computer:'#475569',science:'#16a34a',art:'#9333ea',music:'#a855f7',
              sport:'#0891b2',library:'#f59e0b',staff:'#64748b',canteen:'#f97316',plaza:'#b91c1c',
              gym:'#334155',playground:'#f59e0b',office:'#0f766e',shop:'#d97706',store711:'#16a34a',temple:'#b45309',dome:'#b91c1c'};
const ROOF={classroom:'#c65a3d',computer:'#5b6b7d',science:'#3d8f57',art:'#8b4bb5',music:'#a05cc4',
            library:'#d98b2b',staff:'#7a8577',canteen:'#e07b3a',
            gym:'#475569',office:'#0d5c4a',shop:'#b45309',store711:'#15803d',temple:'#c2410c'};
const PROP={classroom:'📖',computer:'🖥️',science:'🧪',art:'🎨',music:'🥁',library:'📚',canteen:'🍲',staff:'☕'};
```

(`sport`, `playground`, and `dome` deliberately have no `ROOF` entry — they render as open structures, see Step 3.)

- [ ] **Step 2: Replace `ROOMS` layout (lines ~90-113)**

```js
const GW=100,GH=112;
const CLASS_ORDER=['P11','P12','P21','P22','P31','P32','P41','P42','P51','P52','P61','P62'];
const M_ORDER=['C17','C18','C19','C20','C21','C22'];
// อาคารประถม: บล็อก 4 คอลัมน์ x 3 แถว (มาตรฐานเดิม แค่ย้าย anchor)
const ROOMS=CLASS_ORDER.map((id,i)=>({id,label:SCHOOL.classes[id],type:'classroom',
  gx:26+(i%4)*9,gy:39+((i/4)|0)*8,gw:7,gh:6}));
// อาคารมัธยม: บล็อก 3 คอลัมน์ x 2 แถว
M_ORDER.forEach((id,i)=>ROOMS.push({id,label:SCHOOL.classes[id],type:'classroom',
  gx:30+(i%3)*9,gy:65+((i/3)|0)*8,gw:7,gh:6}));
ROOMS.push(
 // แถบเหนือสุด: ประตูหน้า+ร้านค้า+7-11
 {id:'store711',label:'ร้านสะดวกซื้อ 7-11',type:'store711',gx:6, gy:3, gw:6,gh:5},
 {id:'shop1',label:'ร้านค้าหน้าโรงเรียน 1',type:'shop',gx:30,gy:3,gw:4,gh:3},
 {id:'shop2',label:'ร้านค้าหน้าโรงเรียน 2',type:'shop',gx:36,gy:3,gw:4,gh:3},
 {id:'shop3',label:'ร้านค้าหน้าโรงเรียน 3',type:'shop',gx:42,gy:3,gw:4,gh:3},
 {id:'shop4',label:'ร้านค้าหน้าโรงเรียน 4',type:'shop',gx:58,gy:3,gw:4,gh:3},
 {id:'shop5',label:'ร้านค้าหน้าโรงเรียน 5',type:'shop',gx:64,gy:3,gw:4,gh:3},
 // แถบสนาม/โรงยิม/โรงอาหาร/ห้องสมุด/สนามเด็กเล่น (ตะวันตก+กลาง)
 {id:'gym',     label:'โรงยิม',              type:'gym',      gx:8, gy:9, gw:12,gh:10},
 {id:'sport',   label:'สนามฟุตบอล',          type:'sport',    gx:43,gy:9, gw:14,gh:12},
 {id:'canteen', label:'โรงอาหาร',            type:'canteen',  gx:8, gy:20,gw:12,gh:9},
 {id:'library', label:'ห้องสมุด',            type:'library',  gx:8, gy:30,gw:8, gh:6},
 {id:'playground',label:'สนามเด็กเล่น',      type:'playground',gx:17,gy:30,gw:8, gh:6},
 // อาคารประถม: ห้องพิเศษ + ห้องผู้บริหาร + ห้องพักครู
 {id:'comp',    label:'ห้องคอมประถม',        type:'computer', gx:17,gy:39,gw:7,gh:6},
 {id:'artmus',  label:'ห้องศิลปะ-ดนตรี',      type:'art',      gx:17,gy:47,gw:7,gh:6},
 {id:'office',  label:'ห้องผู้บริหาร',        type:'office',   gx:62,gy:39,gw:7,gh:6},
 {id:'staff',   label:'ห้องพักครู ช่วงชั้น 1',type:'staff',    gx:62,gy:47,gw:7,gh:5},
 {id:'staff2',  label:'ห้องพักครู ช่วงชั้น 2',type:'staff',    gx:62,gy:53,gw:7,gh:5},
 // อาคารมัธยม: ห้องพิเศษ (วิทย์ 2 ห้อง)
 {id:'m_comp',  label:'ห้องคอมมัธยม (LAB2)', type:'computer', gx:57,gy:65,gw:7,gh:5},
 {id:'m_sci',   label:'ห้องแล็บวิทย์ 1',      type:'science',  gx:57,gy:71,gw:7,gh:5},
 {id:'m_sci2',  label:'ห้องแล็บวิทย์ 2',      type:'science',  gx:57,gy:77,gw:7,gh:5},
 {id:'m_staff', label:'ห้องพักครูมัธยม',      type:'staff',    gx:57,gy:83,gw:7,gh:5},
 // โดมกิจกรรมเข้าแถว (แทนลานเสาธงเดิม)
 {id:'dome',    label:'โดมกิจกรรมเข้าแถว',   type:'dome',     gx:65,gy:60,gw:30,gh:24},
 // วัด (นอกรั้ว ใต้ประตูหลัง)
 {id:'temple',  label:'วัดบางโค + ศาลาวัด',  type:'temple',   gx:70,gy:95,gw:20,gh:10});
const ROOM_BY_ID=Object.fromEntries(ROOMS.map(r=>[r.id,r]));
const CLASSROOMS=ROOMS.filter(r=>r.type==='classroom').map(r=>r.id);
const STAFF_OF=['staff','staff2','m_staff'];
const FLAGP={x:80,y:62};                 // เสาธงในโดม
const GATE_FRONT={x:50,y:2};
const GATE_BACK={x:80,y:87};
```

- [ ] **Step 3: Update the grid/door/desk/path/deco generation block (lines ~174-232)**

Replace the block from `const grid=[],plotTiles={},walkTiles={};` through the `walkTiles.plaza=FORM;plotTiles.plaza=FORM;` line with:

```js
const grid=[],plotTiles={},walkTiles={};
for(let y=0;y<GH;y++){grid[y]=[];for(let x=0;x<GW;x++)grid[y][x]={plot:null,deco:null,path:false,desk:false};}
ROOMS.forEach(r=>{plotTiles[r.id]=[];
  for(let y=r.gy;y<r.gy+r.gh;y++)for(let x=r.gx;x<r.gx+r.gw;x++){grid[y][x].plot=r.id;plotTiles[r.id].push({x,y});}});
const OPEN_TYPES=['sport','playground','dome']; // เดินเข้า-ออกได้รอบด้าน ไม่มีประตูเดี่ยว
const DOOR={};
ROOMS.forEach(r=>{if(!OPEN_TYPES.includes(r.type))DOOR[r.id]={x:r.gx+(r.gw>>1),y:r.gy+r.gh-1};});
const DESK_LAYOUT={classroom:[[1,2],[2,2],[3,2],[4,2],[5,2],[1,4],[2,4],[3,4],[4,4],[5,4]],
 computer:[[1,1],[2,1],[4,1],[5,1],[1,3],[2,3],[4,3],[5,3]],
 science:[[1,1],[3,1],[5,1],[1,3],[5,3]],
 art:[[1,1],[3,1],[5,1],[1,3],[5,3]],
 canteen:[[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[8,1],[9,1],[10,1],
          [1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[8,4],[9,4],[10,4],
          [1,7],[2,7],[4,7],[5,7],[7,7],[8,7]],
 staff:[[1,1],[5,3]],
 library:[[1,1],[3,1],[5,1],[1,3],[3,3],[5,3]]};
ROOMS.forEach(r=>{(DESK_LAYOUT[r.type]||[]).forEach(([dx,dy])=>{grid[r.gy+dy][r.gx+dx].desk=true;});
  walkTiles[r.id]=plotTiles[r.id].filter(t=>!grid[t.y][t.x].desk);});
// ทางเดินปูน (คั่นระหว่างบล็อกอาคารตามแนวตั้งใหม่)
for(const y of[6,7,8,18,19,37,38,63,64,88,89,90,91,92,93,94])for(let x=1;x<=98;x++)if(!grid[y][x].plot)grid[y][x].path=true;
for(const x of[7,21,25,61,80])for(let y=1;y<=110;y++)if(!grid[y][x].plot)grid[y][x].path=true;
for(const rid in DOOR){const d=DOOR[rid];if(grid[d.y+1]&&!grid[d.y+1][d.x].plot)grid[d.y+1][d.x].path=true;}
// โดม (ลานเข้าแถวใหม่)
const DOME_RECT={x1:65,y1:60,x2:94,y2:83};
for(let y=DOME_RECT.y1;y<=DOME_RECT.y2;y++)for(let x=DOME_RECT.x1;x<=DOME_RECT.x2;x++)if(!grid[y][x].plot)grid[y][x].path=true;
grid[FLAGP.y][FLAGP.x].deco='flag';
// สระน้ำเดิม (คงไว้)
for(let y=8;y<=11;y++)for(let x=30;x<=36;x++)if(!grid[y][x].plot&&!grid[y][x].path)grid[y][x].deco='pond';
// คลองบางโค (ตะวันตก ยาวขนานโรงเรียน)
for(let y=8;y<=100;y++)for(let x=0;x<=2;x++)grid[y][x].deco='canal';
// คลองบางใหญ่ (ใต้วัด)
for(let y=106;y<=108;y++)for(let x=60;x<=100&&x<GW;x++)grid[y][x].deco='canal';
for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
  const c=grid[y][x];if(c.plot||c.deco||c.path)continue;
  if((x<2||x>GW-3||y<2||y>GH-3)&&hash(x+7,y+7,3)%5===0)c.deco='tree';}
// ประตูหน้า/หลัง ต้องเดินได้เสมอ (เคลียร์ deco ที่อาจถูกสุ่มทับ)
grid[GATE_FRONT.y][GATE_FRONT.x].deco='gate';
grid[GATE_BACK.y][GATE_BACK.x].deco='gate';
// แถวเข้าแถวในโดม
const FORM=[];
for(let y=DOME_RECT.y1;y<=DOME_RECT.y2;y++)for(let x=DOME_RECT.x1;x<=DOME_RECT.x2;x++)
  if(!grid[y][x].deco)FORM.push({x,y});
walkTiles.dome=FORM;plotTiles.dome=FORM;
```

Note: `walkable(x,y)` (unchanged, a few lines below) treats any tile with `deco` set as non-walkable UNLESS it also has `.plot` set (`!grid[y][x].deco` in the `||` branch). `'gate'` and `'canal'` deco values need the gate tiles to remain walkable — since `grid[y][x].plot` is null for gate/canal tiles, `walkable()`'s condition `(grid[y][x].plot||!grid[y][x].deco)` would return `false` for a tile with `deco==='gate'`. Fix `walkable()` (a few lines down, unchanged otherwise) to special-case `'gate'`:

```js
const walkable=(x,y)=>x>=0&&y>=0&&x<GW&&y<GH&&!grid[y][x].desk&&(grid[y][x].plot||!grid[y][x].deco||grid[y][x].deco==='gate');
```

`'canal'` tiles must stay unwalkable (water) — no change needed there, they already block via the same condition.

- [ ] **Step 4: `sciRoomFor` helper for the 2-science-room split**

Add near `SUBJ_ROOM` (existing function, unchanged):

```js
function sciRoomFor(rid,cls){
  if(rid!=='m_sci')return rid;
  return hash((cls||'').charCodeAt(0)||1,2,2)%2?'m_sci2':'m_sci';
}
```

This will be called from `schedOf()` in Task 3 once the real per-class room id resolves to `'m_sci'` — it's added here (geometry task) because it depends on `hash()` and the new room ids, but wired up in Task 3.

- [ ] **Step 5: Extend `selfCheck()` with an overlap check + new invariants**

In `selfCheck()` (near the end of the file), add before the final `console.log(...)` line:

```js
  // ห้ามมีสองห้องทับกัน
  const occ={};
  ROOMS.forEach(r=>{for(let y=r.gy;y<r.gy+r.gh;y++)for(let x=r.gx;x<r.gx+r.gw;x++){
    const k=x+','+y;if(occ[k]){console.error('ห้องทับกัน:',occ[k],r.id,k);ok=false;}occ[k]=r.id;}});
  console.assert(FORM.length>=TEACHERS.length+STUDENTS.length,'❌ โดมเล็กกว่าจำนวนคน '+FORM.length+'/'+(TEACHERS.length+STUDENTS.length));
  const pGate=bfs(GATE_FRONT.x,GATE_FRONT.y,DOOR.office.x,DOOR.office.y);
  console.assert(pGate.length>0,'❌ เดินจากประตูหน้าไปห้องผู้บริหารไม่ได้');
  const pBack=bfs(GATE_BACK.x,GATE_BACK.y,FORM[0].x,FORM[0].y);
  console.assert(pBack.length>0,'❌ เดินจากประตูหลังไปโดมไม่ได้');
```

- [ ] **Step 6: Run smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK`. If it prints `ห้องทับกัน:` or a `❌`, fix the offending `gx/gy` in Step 2 (the coordinates above were hand-checked for non-overlap but re-verify mechanically) and re-run until clean.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: relayout map to match real satellite photo of the school (gym/library/playground/2nd science room/dome/temple/canals/gates)"
```

---

### Task 3: Arrival/departure system + gates + extended time axis

**Files:**
- Modify: `index.html` (time consts ~line 117-124, `TEACHERS`/`STUDENTS` construction ~132-139, `schedOf`/`studentRoomOf` ~150-172, state block `assign()`/`setTime()` ~463-496, game loop chars update ~526-539, start block ~707-716)

**Interfaces:**
- Consumes: `GATE_FRONT`, `GATE_BACK`, `hash()`, `bfs()` from Task 2.
- Produces: `a.gate` (`'front'|'back'`), `a.arriveT`, `a.gatherAt`, `a.leaveT` per character; `Char.present` (boolean); `Char.gone` (boolean); `GATHER={s,e}` window const. Task 5/6/7 read `c.present`/`c.gone` before drawing/updating a character.

- [ ] **Step 1: Extend the time axis**

Change:
```js
const ASM={s:480,e:510}; // เข้าแถวทั้งโรงเรียน 08:00-08:30
```
to (unchanged value, just add the new gather window below it):
```js
const ASM={s:480,e:510}; // เข้าแถวทั้งโรงเรียน 08:00-08:30
const GATHER={s:450,e:480}; // 07:30-07:50 ทยอยเดินเข้าแถวที่โดม
const inGather=t=>t>=GATHER.s&&t<GATHER.e;
```
Change:
```js
const TMIN=ASM.s,TMAX=990;
```
to:
```js
const TMIN=360,TMAX=1140; // 06:00-19:00
```

- [ ] **Step 2: Add per-character gate/arrival/departure fields**

Change the `TEACHERS`/`STUDENTS` construction:
```js
const TEACHERS=SCHOOL.teachers.map((t,i)=>({id:i,name:t.disp,full:t.name,group:t.group,lv:t.lv,
  skin:SKIN[i%SKIN.length],hair:HAIR[(i*3)%HAIR.length],style:i%3,
  shirt:GROUPS[t.group].color,pants:'#3a3a3a',scale:1}));
const STUDENTS=SCHOOL.students.map((st,i)=>({id:100+i,name:st.n,home:st.c,student:true,mz:st.c[0]==='C',
  skin:SKIN[(i*2)%SKIN.length],hair:'#1a1a1a',style:st.g?1:0,
  shirt:'#f8f8f8',pants:st.g?'#7a2333':'#1e3a5f',
  scale:st.c[0]==='C'?0.88:0.7+(+st.c[1]||1)*0.02}));
```
to (append gate/time fields to each object literal, same generator functions):
```js
function gateFieldsFor(id,isStudent){
  const gate=isStudent&&hash(id,7,11)%100<18?'back':'front';
  const arriveT=360+hash(id,3,5)%90;               // 06:00-07:29
  const gatherAt=450+hash(id,9,13)%30;             // 07:30-07:49
  return{gate,arriveT,gatherAt};
}
const TEACHERS=SCHOOL.teachers.map((t,i)=>({id:i,name:t.disp,full:t.name,group:t.group,lv:t.lv,
  skin:SKIN[i%SKIN.length],hair:HAIR[(i*3)%HAIR.length],style:i%3,
  shirt:GROUPS[t.group].color,pants:'#3a3a3a',scale:1,
  ...gateFieldsFor(i,false),leaveT:990+hash(i,17,19)%85}));   // 16:30 + 0-84min
const STUDENTS=SCHOOL.students.map((st,i)=>({id:100+i,name:st.n,home:st.c,student:true,mz:st.c[0]==='C',
  skin:SKIN[(i*2)%SKIN.length],hair:'#1a1a1a',style:st.g?1:0,
  shirt:'#f8f8f8',pants:st.g?'#7a2333':'#1e3a5f',
  scale:st.c[0]==='C'?0.88:0.7+(+st.c[1]||1)*0.02,
  ...gateFieldsFor(100+i,true),
  leaveT:(st.c[0]==='C'?960:930)+hash(100+i,17,19)%30}));     // ม.16:00-16:30 / ป.15:30-16:00
```

- [ ] **Step 3: `inGather` override + secondary science room split**

In `studentRoomOf()`, add the gather check as the first branch:
```js
function studentRoomOf(st,d,t_m){
  if(inAsm(t_m))return'dome';
  if(t_m>=st.gatherAt&&t_m<ASM.s)return'dome';
  const Z=st.mz?MPER:PPER,per=zP(Z,t_m);
  if(!per)return st.mz?'dome':'sport';
  if(per.lunch)return st.id%3?(st.mz?'dome':'sport'):'canteen';
  const e=(st.mz?SCHOOL.ctM:SCHOOL.ctP)[st.home]?.[d+1]?.[per.n];
  if(!e)return st.home;
  return st.mz?sciRoomFor(e.r||st.home,st.home):(SUBJ_ROOM(e.s)||st.home);
}
```
(Only two changes from the original: the new `inGather` branch, `'plaza'→'dome'` everywhere, and wrapping the secondary room id in `sciRoomFor(...)`.)

In `schedOf()`, replace `rid:'plaza'` with `rid:'dome'` (both occurrences: the `inAsm` branch and no other — check there's exactly one `{rid:'plaza'}` in `schedOf`).

- [ ] **Step 4: Presence/gate state machine**

Add near `assign()`:
```js
function present(a,tm_){return tm_>=a.arriveT&&tm_<a.leaveT;}
```

Replace `assign()`:
```js
function assign(){
  TEACHERS.forEach(t=>{t.room=present(t,tm)?(schedOf(t,day,tm).rid||STAFF_OF[t.lv]):null;});
  STUDENTS.forEach(s=>{s.room=present(s,tm)?studentRoomOf(s,day,tm):null;});
}
```
(`t.room===null` means "not on campus" — Task 3 Step 5 below teaches `Char` what to do with that.)

- [ ] **Step 5: `Char` gains `present`/`gone` + gate walk-in/out**

In the `Char` class, extend `update(dt)` and the room-routing block in `setTime()`.

Add a helper right above `class Char`:
```js
const gateOf=g=>g==='back'?GATE_BACK:GATE_FRONT;
```

Change `setTime()`'s per-character routing block from:
```js
  chars.forEach((c,i)=>{
    if(c.a.room===c.prev)return;
    c.prev=c.a.room;
    if(c.a.room==='plaza')c.gotoTile(FORM[i%FORM.length]);else c.goto(c.a.room);
  });
```
to:
```js
  chars.forEach((c,i)=>{
    if(c.a.room===null){
      if(!c.gone&&c.prev!==null){ // เพิ่งออก → เดินไปประตูแล้วหาย
        c.gotoTile(gateOf(c.a.gate));c.leaving=true;
      }
      c.prev=null;return;
    }
    if(c.prev===null){ // เพิ่งมาถึง (หรือเพิ่งเริ่มโหลด) → โผล่ที่ประตูก่อนเดินเข้า
      const g=gateOf(c.a.gate);c.fx=g.x;c.fy=g.y;c.gone=false;c.leaving=false;
    }
    if(c.a.room===c.prev)return;
    c.prev=c.a.room;
    if(c.a.room==='dome')c.gotoTile(FORM[i%FORM.length]);else c.goto(c.a.room);
  });
```

Change `Char.update(dt)` — add the "reached the gate while leaving → vanish" check right after the existing `if(this.path.length){...}` movement block, replacing the whole method:
```js
  update(dt){
    if(this.gone)return;
    const inSport=this.a.student&&ROOM_BY_ID[this.a.room]?.type==='sport';
    if(this.path.length){
      const n=this.path[0],dx=n.x-this.fx,dy=n.y-this.fy,dist=Math.hypot(dx,dy);
      const step=(inSport?4.5:3)*dt;
      const sx=dx-dy,sy=(dx+dy)*0.5;
      if(Math.abs(sx)+Math.abs(sy)>0.01){const ang=(Math.atan2(sy,sx)*180/Math.PI+360)%360;
        this.dir=Math.round(ang/45)%8;}
      if(dist<=step){this.fx=n.x;this.fy=n.y;this.path.shift();}
      else{this.fx+=dx/dist*step;this.fy+=dy/dist*step;}
      this.phase+=dt*(inSport?12:9);this.moving=true;
      if(this.leaving&&!this.path.length){this.gone=true;this.moving=false;}
    }else{
      this.moving=false;
      if(this.leaving){this.gone=true;return;}
      if(this.a.room==='dome'){this.dir=6;return;}
      this.wander-=dt;
      if(this.wander<=0){this.wander=inSport?0.4+Math.random():2+Math.random()*5;
        const ts=walkTiles[this.a.room],g=ts[(Math.random()*ts.length)|0],s=this.tile;
        this.path=bfs(s.x,s.y,g.x,g.y);}
    }
  }
```

`this.prev` starts as `a.room||'staff'` in the constructor (unchanged) — since `assign()` now runs before `chars` are constructed either way (same as v6.1's boot order), the very first `assign()` call already reflects `tm` at boot (`gotoNow()`), so `prev` naturally seeds correctly.

In `frame()`, skip drawing/updating absent characters — change:
```js
  chars.forEach(c=>c.update(dt));critters.forEach(c=>c.update(dt));
```
to:
```js
  chars.forEach(c=>{if(!c.gone)c.update(dt);});critters.forEach(c=>c.update(dt));
```
and in the `ents.push` loop just below, skip `gone` characters from rendering:
```js
  chars.forEach(c=>{if(c.gone)return;ents.push({d:c.fx+c.fy,f:()=>{const wy=c.draw();
    tags.push({wx:iso(c.fx,c.fy)[0],wy,c});}});});
```

- [ ] **Step 6: Extend `updateStat()` to report absent count (small, matches existing style)**

```js
function updateStat(){
  let msg;
  if(inAsm(tm))msg=`🚩 เข้าแถวเคารพธงชาติทั้งโรงเรียน`;
  else{let teach=0,free=0;
    TEACHERS.forEach(t=>{if(t.room)schedOf(t,day,tm).subj?teach++:free++;});
    msg=`สอนอยู่ <b>${teach}</b> · พัก <b>${free}</b>`;}
  const present_=[...TEACHERS,...STUDENTS].filter(a=>a.room).length;
  document.getElementById('stat').innerHTML=`${msg} · อยู่ในโรงเรียน <b>${present_}</b>/${TEACHERS.length+STUDENTS.length}`;}
```

- [ ] **Step 7: Smoke test — write the new invariant into `test/smoke.js`**

Extend `test/smoke.js`'s `run()` to sweep the day and assert presence bounds, right before the final `if (errors.length)` check:

```js
  // sweep เวลา 06:00-19:00 ทุก 15 นาที ตรวจว่าไม่มีใครโผล่ก่อนมา/อยู่หลังกลับ
  try {
    vm.runInContext(`
      for(let t=360;t<=1140;t+=15){ tm=t; assign();
        [...TEACHERS,...STUDENTS].forEach(a=>{
          const shouldBePresent = t>=a.arriveT && t<a.leaveT;
          if(shouldBePresent && a.room===null) console.error('หายไปทั้งที่ควรอยู่:',a.id,t);
          if(!shouldBePresent && a.room!==null) console.error('อยู่ทั้งที่ควรกลับ/ยังไม่มา:',a.id,t);
        });
      }
      if(present(TEACHERS[0],500)===false) console.error('present() ผิดพลาดที่ 500min');
    `, sandbox, { filename: 'sweep.js', timeout: 10000 });
  } catch (e) { errors.push('sweep threw: ' + (e.stack || e)); }
```

- [ ] **Step 8: Run smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK`

- [ ] **Step 9: Commit**

```bash
git add index.html test/smoke.js
git commit -m "feat: staggered arrival/departure through front/back gates, extended time axis 06:00-19:00"
```

---

### Task 4: Day/night tint over the extended time range

**Files:**
- Modify: `index.html` (the `TINT` line inside `frame()`, ~line 568)

**Interfaces:**
- Consumes: `tm`, `TMIN`, `TMAX` from Task 3.
- Produces: nothing consumed by later tasks (purely visual, terminal leaf).

- [ ] **Step 1: Replace the TINT expression**

Change:
```js
  const TINT=tm<510?'rgba(255,200,120,.10)':tm<600?'rgba(255,205,130,.06)':tm<690?'rgba(255,220,160,.03)':
    tm<780?'':tm<840?'rgba(255,250,210,.05)':tm<900?'':tm<950?'rgba(255,180,110,.05)':'rgba(255,140,80,.11)';
```
to:
```js
  const TINT=
    tm<420?'rgba(40,60,110,.28)':          // 06:00-07:00 เช้ามืด
    tm<480?'rgba(255,190,120,.14)':        // 07:00-08:00 แดดอ่อนตอนเช้า
    tm<600?'rgba(255,205,130,.06)':
    tm<690?'rgba(255,220,160,.03)':
    tm<780?'':
    tm<840?'rgba(255,250,210,.05)':
    tm<900?'':
    tm<950?'rgba(255,180,110,.05)':
    tm<1020?'rgba(255,140,80,.11)':        // ~16:30-17:00 พลบเริ่ม
    tm<1080?'rgba(200,90,70,.20)':         // ~17:00-18:00 ส้มพลบค่ำเข้ม
    'rgba(20,25,55,.45)';                  // 18:00+ มืดน้ำเงินเข้ม
```

- [ ] **Step 2: Run smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK` (this task has no logic invariant, just confirms nothing broke)

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: extend day/night tint gradient across 06:00-19:00"
```

---

### Task 5: Fix critter (dog/cat/chicken) invisibility bug + 4-direction facing + sounds

**Files:**
- Modify: `index.html` (`class Critter`, ~lines 439-461)

**Interfaces:**
- Consumes: `hash()`, existing `Critter` constructor args.
- Produces: `Critter.dir` (0-3), `Critter.emitSound()` groundwork used by nobody else — leaf task.

- [ ] **Step 1: Root-cause fix + direction + speech bubble**

Replace the whole `class Critter` block:
```js
class Critter{
  constructor(name,emoji,desc,speed,sounds){this.name=name;this.emoji=emoji;this.desc=desc;this.speed=speed;
    this.sounds=sounds;this.soundT=2+Math.random()*4;this.dir=0;
    const s=YARD[rnd()%YARD.length];this.fx=s.x;this.fy=s.y;this.path=[];this.wait=1;this.ph=rnd()%10;}
  update(dt){
    if(this.path.length){
      const n=this.path[0],dx=n.x-this.fx,dy=n.y-this.fy,d=Math.hypot(dx,dy),st=this.speed*dt;
      if(Math.abs(dx)+Math.abs(dy)>0.01){
        // 4 ทิศ: เหนือ/ใต้/ตะวันออก/ตะวันตก ตามภาพหน้าจอ (isometric X/Y คนละแกนกับ dx/dy กริด)
        this.dir=Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0);
      }
      if(d<=st){this.fx=n.x;this.fy=n.y;this.path.shift();}
      else{this.fx+=dx/d*st;this.fy+=dy/d*st;}
      this.ph+=dt*8;this.moving=true;
    }else{this.moving=false;this.wait-=dt;
      if(this.wait<=0){this.wait=2+Math.random()*6;
        const g=YARD[(Math.random()*YARD.length)|0];
        this.path=bfs(Math.round(this.fx),Math.round(this.fy),g.x,g.y);}}
    this.soundT-=dt;if(this.soundT<=0){this.soundT=6+Math.random()*10;this._say=1.6;this._text=this.sounds(tm);}
    if(this._say>0)this._say-=dt;
  }
  draw(){
    const[wx,wy]=iso(this.fx,this.fy);
    const bob=this.moving?Math.abs(Math.sin(this.ph))*1.8:Math.sin(last/700+this.ph)*0.5;
    const lean=this.moving?[0,3,0,-3][this.dir]*0.3:0; // เอียงตัวเล็กน้อยตามทิศวิ่ง แทนแค่ลอยขึ้นลง
    ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(wx,wy,7,3.2,0,0,7);ctx.fill();
    ctx.save();ctx.translate(wx+lean,wy-8-bob);
    ctx.font='15px "Segoe UI Emoji"';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#000'; // แก้บั๊ก: เดิมค้าง fillStyle เงาดำโปร่ง .2 ทำให้ตัวสัตว์จางมองแทบไม่เห็น
    ctx.fillText(this.emoji,0,0);
    ctx.restore();
    if(this._say>0){ctx.font='10px Leelawadee UI';const w=ctx.measureText(this._text).width+8;
      ctx.fillStyle='rgba(255,255,255,.95)';ctx.strokeStyle='#c9c2b0';
      roundRect(ctx,wx-w/2,wy-34-bob,w,14,5);ctx.fill();ctx.stroke();
      ctx.fillStyle='#000';ctx.fillText(this._text,wx,wy-27-bob);}
    return wy;
  }
}
```

- [ ] **Step 2: Update the 3 critter instantiations to pass sound generators**

Change (in the start block, ~line 712):
```js
critters=[new Critter('เจ้าด่าง','🐕','หมาประจำโรงเรียน ชอบวิ่งเล่นสนาม',2.2),
          new Critter('ส้มโอ','🐈','แมวส้มขี้อ้อน ประจำห้องพักครู',1.6),
          new Critter('ไข่ต้ม','🐓','ไก่หลงมา อยู่ยาวจนเป็นขาประจำ',1.3)];
```
to:
```js
critters=[new Critter('เจ้าด่าง','🐕','หมาประจำโรงเรียน ชอบวิ่งเล่นสนาม',2.2,()=>'โฮ่ง!'),
          new Critter('ส้มโอ','🐈','แมวส้มขี้อ้อน ประจำห้องพักครู',1.6,()=>'เหมียว~'),
          new Critter('ไข่ต้ม','🐓','ไก่หลงมา อยู่ยาวจนเป็นขาประจำ',1.3,t=>t<420?'เอ้กอีเอ้กเอ้ก!':'กระต๊ากๆ')];
```

- [ ] **Step 3: Run smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "fix: critters were rendering at 20% opacity (stale shadow fillStyle bled into fillText); add 4-direction facing + speech-bubble sounds"
```

---

### Task 6: ผอ./รองผอ. patrol characters

**Files:**
- Modify: `index.html` (near `TEACHERS`/`STUDENTS` construction, `class Char`, start block)

**Interfaces:**
- Consumes: `Char`, `ROOMS`, `bfs`, `walkTiles`, `office` room from Task 2.
- Produces: `DIRECTORS` array (2 `Char`-compatible actor objects), pushed into `chars` alongside teachers/students. Task 7 reads `a.director===true` to exempt them from the "stand at board" rule (they never teach).

- [ ] **Step 1: Define the two actors**

Add right after the `STUDENTS` const:
```js
const DIRECTORS=[
  {id:9000,name:'ผอ.',full:'ผู้อำนวยการ',group:0,lv:1,director:true,
   skin:SKIN[0],hair:HAIR[0],style:2,shirt:'#1e3a5f',pants:'#2b2b2b',scale:1.05,
   arriveT:420,leaveT:1080,gate:'front',gatherAt:465},
  {id:9001,name:'รองผอ.',full:'รองผู้อำนวยการ',group:0,lv:1,director:true,
   skin:SKIN[1],hair:HAIR[1],style:1,shirt:'#1e3a5f',pants:'#2b2b2b',scale:1.0,
   arriveT:430,leaveT:1080,gate:'front',gatherAt:465},
];
```

- [ ] **Step 2: Patrol behavior — override room assignment in `assign()`**

Change `assign()` (from Task 3 Step 4) to also drive the directors with a slow random-room patrol instead of a schedule:

```js
let _patrolNext={9000:0,9001:0};
const PATROL_ROOMS=['office',...CLASSROOMS,'staff','staff2','m_staff','library','canteen'];
function assign(){
  TEACHERS.forEach(t=>{t.room=present(t,tm)?(schedOf(t,day,tm).rid||STAFF_OF[t.lv]):null;});
  STUDENTS.forEach(s=>{s.room=present(s,tm)?studentRoomOf(s,day,tm):null;});
  DIRECTORS.forEach(dr=>{
    if(!present(dr,tm)){dr.room=null;return;}
    if(t_mCrossed(dr))dr.room=PATROL_ROOMS[hash(dr.id,day,(tm/20|0))%PATROL_ROOMS.length];
    else dr.room=dr.room||'office';
  });
}
function t_mCrossed(dr){ // เปลี่ยนห้องทุก ~20 นาที (สุ่มคงที่ต่อช่วง ไม่ใช่ทุกเฟรม)
  const slot=tm/20|0;if(_patrolNext[dr.id]===slot)return false;_patrolNext[dr.id]=slot;return true;
}
```

- [ ] **Step 3: Wire into `chars` construction (start block)**

Change:
```js
chars=[...TEACHERS,...STUDENTS].map(a=>new Char(a));
```
to:
```js
chars=[...TEACHERS,...STUDENTS,...DIRECTORS].map(a=>new Char(a));
```

Because `Char`'s constructor does `a.room=a.room||'staff'` and directors start with `room` undefined before the first `assign()` call, and `assign()` in the start block already runs (`gotoNow()` calls `setTime()` calls `assign()`) before `chars` is built — same boot order as v6.1, no change needed there. Confirm `DIRECTORS` is declared before `assign()`'s first real call (it is, since it's a top-level const declared earlier in the file than `gotoNow()`'s invocation at the bottom).

- [ ] **Step 4: Run smoke test — add a director invariant**

Append to `test/smoke.js`'s sweep block (inside the same `for(let t=360...)` loop body, after the existing per-`a` checks):
```js
        DIRECTORS.forEach(dr=>{ if(present(dr,t) && !ROOM_BY_ID[dr.room]) console.error('ผอ./รองผอ. อยู่ห้องที่ไม่มีจริง:',dr.id,dr.room,t); });
```

Run: `node test/smoke.js`
Expected: `SMOKE OK`

- [ ] **Step 5: Commit**

```bash
git add index.html test/smoke.js
git commit -m "feat: add ผอ./รองผอ. as patrol characters walking between buildings (real นิเทศ-schedule link deferred)"
```

---

### Task 7: Students stay seated during class, teachers teach at the board, shops+7-11 by time, T013 lunch scene

**Files:**
- Modify: `index.html` (`Char.update`, `class Char` draw positioning, `schedOf`, start block)

**Interfaces:**
- Consumes: `Char.present`/`director` flags (Task 5/6), `schedOf` (Task 3).
- Produces: `Char.teaching` (boolean, used only internally by draw's pose), `a.teachSpot` cache — leaf task, nothing later depends on these.

- [ ] **Step 1: Students don't wander mid-lesson**

`Char.update(dt)`'s "not moving, decide whether to wander" branch currently wanders unconditionally for anyone not in `'dome'`. Change the `else` branch (from Task 3 Step 5) to skip wandering when a student is in an active lesson:

```js
    }else{
      this.moving=false;
      if(this.leaving){this.gone=true;return;}
      if(this.a.room==='dome'){this.dir=6;return;}
      const inLesson=this.a.student && ROOM_BY_ID[this.a.room]?.type==='classroom' &&
        studentRoomOf(this.a,day,tm)===this.a.home && zP(this.a.mz?MPER:PPER,tm)?.n && !zP(this.a.mz?MPER:PPER,tm)?.lunch;
      if(inLesson)return; // มีคาบเรียนอยู่ → นั่งนิ่งที่โต๊ะ ไม่เดินสุ่ม
      this.wander-=dt;
      if(this.wander<=0){this.wander=inSport?0.4+Math.random():2+Math.random()*5;
        const ts=walkTiles[this.a.room],g=ts[(Math.random()*ts.length)|0],s=this.tile;
        this.path=bfs(s.x,s.y,g.x,g.y);}
    }
```

- [ ] **Step 2: Teachers stand at the board while teaching**

Add a helper above `class Char`:
```js
function boardSpotFor(rid){
  const r=ROOM_BY_ID[rid];if(!r||r.type!=='classroom')return null;
  return{x:r.gx+(r.gw>>1),y:r.gy+1}; // ใกล้ผนังกระดานดำที่วาดใน drawBack (กึ่งกลาง A-B)
}
```

In the room-routing block of `setTime()` (Task 3 Step 5), after `else c.goto(c.a.room);`, add a teaching-specific override:
```js
    if(c.a.room===c.prev)return;
    c.prev=c.a.room;
    if(c.a.room==='dome')c.gotoTile(FORM[i%FORM.length]);
    else if(!c.a.student&&!c.a.director&&schedOf(c.a,day,tm).subj&&boardSpotFor(c.a.room)){
      c.gotoTile(boardSpotFor(c.a.room));c.teaching=true;
    }else{c.teaching=false;c.goto(c.a.room);}
```

In `Char.update`'s wander branch, also skip wandering while `this.teaching`:
```js
      if(this.teaching)return; // กำลังสอน → ยืนหน้ากระดาน ไม่เดินสุ่ม
      if(inLesson)return;
```

Give the teaching pose a subtle tell in `emoteOf()` (existing function) — it already returns `GEMOTE[a.group]` for classroom teachers, no change needed there; the pose itself comes from `draw()`. Add a small arm-raise when `teaching` — in `Char.draw()`, after the existing arm-drawing lines (`ctx.fillRect(-8,-19-bob-swing*0.8,...)` etc.), add:
```js
    if(a.director!==true&&this.teaching){ctx.fillStyle=a.skin;ctx.fillRect(-9,-24-bob,2.5,6);} // ยกแขนชี้กระดาน
```
(placed right before `ctx.restore();`)

- [ ] **Step 3: Shop/7-11 visibility window**

Shops are pure decoration (no characters assigned to them), so "only visible in the morning/evening" just means: don't draw their name banner / prop icons outside those windows. In `drawBack(r)` and `drawFront(r)`, guard on a small helper — add above `drawBack`:
```js
function shopActiveNow(){return tm<480||tm>=900;} // 06:00-08:00 หรือ 15:00-18:00
```
At the very top of `drawBack(r)`, add:
```js
function drawBack(r){
  if((r.type==='shop'||r.type==='store711')&&!shopActiveNow())return;
```
(7-11 (`store711`) is a real always-open room type-wise, but per the spec only the street-vendor stalls (`shop`) are morning/evening-only; keep `store711` drawn all day by removing it from that guard — i.e. just check `r.type==='shop'`):
```js
function drawBack(r){
  if(r.type==='shop'&&!shopActiveNow())return;
```
`drawFront(r)` already returns early for `sport` type; extend that same early-return line to include shops outside their window:
```js
function drawFront(r){
  if(r.type==='sport'||(r.type==='shop'&&!shopActiveNow()))return;
```

- [ ] **Step 4: T013 lunch scene at 7-11**

Add near the bottom of `assign()` (after the `DIRECTORS.forEach` block from Task 6):
```js
  const t013=TEACHERS.find(t=>/ณัฐธเนศ/.test(t.full));
  if(t013&&present(t013,tm)){
    const ownLunch=zP(t013.lv===2?MPER:PPER,tm);
    if(ownLunch&&ownLunch.lunch)t013.room='store711';
  }
```
This runs after the normal `TEACHERS.forEach` assignment above it in the same function, so it overrides T013's room specifically during their own lunch period, using the existing per-level lunch detection already used elsewhere (`own.lunch` pattern in `schedOf`). Give it a speech bubble via `emoteOf()` — add one line near its `ty==='staff'` branch:
```js
  if(ty==='store711')return'🛒';
```
and, for the literal requested quip, extend the popup instead (cheap, reuses the existing `showPerson` popup rather than a new bubble system) — in `showPerson(c,e)`'s teacher branch, after the existing `<div class="row">ตอนนี้: ...` line, add:
```js
      ${a.full&&/ณัฐธเนศ/.test(a.full)&&ROOM_BY_ID[a.room]?.type==='store711'?'<div class="row">💬 มาตรวจความเรียบร้อยที่เซเว่นครับ</div>':''}
```

- [ ] **Step 5: Run smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK`

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: students stay seated during active lessons, teachers stand at the board while teaching, shops visible only morning/evening, T013 lunch cameo at 7-11"
```

---

### Task 8: Left sidebar — room/student list + search + camera pan-to

**Files:**
- Modify: `index.html` (`<body>` markup, `<style>`, UI script section ~662-682, click/camera section ~596-660)

**Interfaces:**
- Consumes: `TEACHERS`, `STUDENTS`, `ROOMS`, `iso()`, `cam`, `showPerson`/`showRoom` (existing).
- Produces: `focusOn(x,y)` (pans camera keeping current zoom), `filterPeople(q)` (pure function — also exercised directly by the smoke test).

- [ ] **Step 1: Markup + CSS**

In `<body>`, wrap the existing `<main>` and add a sidebar before it:
```html
<aside id="sidebar" class="open">
  <div class="sbHead"><input id="searchBox" placeholder="ค้นหาครู/นักเรียน..."><button id="sbToggle">☰</button></div>
  <div id="sbBody">
    <div class="sbSection"><h4>ห้อง/อาคาร</h4><div id="roomList"></div></div>
    <div class="sbSection"><h4>คน</h4><div id="peopleList"></div></div>
  </div>
</aside>
```
Add to `<style>`:
```css
#sidebar{position:absolute;left:0;top:0;bottom:0;width:230px;background:rgba(255,255,255,.97);
  border-right:1px solid var(--line);z-index:20;display:flex;flex-direction:column;transition:transform .2s}
#sidebar.closed{transform:translateX(-100%)}
.sbHead{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--line)}
.sbHead input{flex:1;border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-family:inherit}
#sbBody{overflow:auto;flex:1;font-size:12px}
.sbSection{padding:6px 10px}
.sbSection h4{margin:6px 0 4px;font-size:11px;color:var(--muted)}
.sbGroup summary{cursor:pointer;padding:3px 0}
.sbItem{padding:2px 4px;cursor:pointer;border-radius:4px}
.sbItem:hover{background:#f0efe8}
```
Move `<canvas>`/`.legend`/`.hint`/`.popup` inside `<main>` unchanged (only `<aside>` is new, sitting as a sibling before `<main>` inside `<body>`).

- [ ] **Step 2: Pure `filterPeople` + `focusOn`**

Add near the camera section (after `screenToWorld`/`worldToTile`, before the drag handlers):
```js
function filterPeople(q){
  q=(q||'').trim();
  if(!q)return[];
  return[...TEACHERS,...STUDENTS].filter(a=>a.name.includes(q)||(a.full&&a.full.includes(q))).slice(0,40);
}
function focusOn(x,y){const[wx,wy]=iso(x,y);cam.x=cv.width/(2*dpr)-wx*cam.s;cam.y=cv.height/(2*dpr)-wy*cam.s;}
```
(`focusOn` uses `dpr` from Task 9 — if Task 9 hasn't landed yet when this task is executed standalone, temporarily use `cv.width/2` and revisit once Task 9 lands; since these tasks run in order in this plan, `dpr` will already exist by the time this step runs.)

- [ ] **Step 3: Build room list + people list, wire search**

Add to `buildUI()` (existing function):
```js
  document.getElementById('roomList').innerHTML=ROOMS.map(r=>
    `<div class="sbItem" data-room="${r.id}">${TYPE_ICON[r.type]||''} ${r.label}</div>`).join('');
  document.getElementById('roomList').querySelectorAll('.sbItem').forEach(el=>{
    el.onclick=()=>{const r=ROOM_BY_ID[el.dataset.room];focusOn(r.gx+r.gw/2,r.gy+r.gh/2);
      showRoom(r.id,{clientX:innerWidth/2,clientY:innerHeight/2});};
  });
  const peopleList=document.getElementById('peopleList');
  peopleList.innerHTML=CLASSROOMS.map(rid=>{
    const ss=STUDENTS.filter(s=>s.home===rid);
    return`<details class="sbGroup"><summary>${ROOM_BY_ID[rid].label} (${ss.length})</summary>
      ${ss.map(s=>`<div class="sbItem" data-pid="${s.id}">🎒 ${s.name}</div>`).join('')}</details>`;
  }).join('')+`<details class="sbGroup"><summary>ครู (${TEACHERS.length})</summary>
      ${TEACHERS.map(t=>`<div class="sbItem" data-pid="${t.id}">${t.name}</div>`).join('')}</details>`;
  const goToPerson=id=>{const a=[...TEACHERS,...STUDENTS].find(p=>p.id===+id);if(!a)return;
    const c=chars.find(cc=>cc.a.id===a.id);if(!c)return;
    focusOn(c.fx,c.fy);hlId=a.id;showPerson(c,{clientX:innerWidth/2,clientY:innerHeight/2});};
  peopleList.querySelectorAll('[data-pid]').forEach(el=>{el.onclick=()=>goToPerson(el.dataset.pid);});
  const searchBox=document.getElementById('searchBox');
  searchBox.oninput=()=>{
    const matches=filterPeople(searchBox.value);
    peopleList.style.display=matches.length?'none':'';
    let box=document.getElementById('searchResults');
    if(!box){box=document.createElement('div');box.id='searchResults';document.getElementById('sbBody').prepend(box);}
    box.innerHTML=matches.map(a=>`<div class="sbItem" data-pid="${a.id}">${a.student?'🎒':'👤'} ${a.name}</div>`).join('');
    box.style.display=matches.length?'':'none';
    box.querySelectorAll('[data-pid]').forEach(el=>{el.onclick=()=>goToPerson(el.dataset.pid);});
  };
  document.getElementById('sbToggle').onclick=()=>document.getElementById('sidebar').classList.toggle('closed');
```

- [ ] **Step 4: Test the pure logic function directly (no DOM needed)**

Append a standalone assertion block to `test/smoke.js`, right after the sweep block from Task 3 Step 7:
```js
  try {
    vm.runInContext(`
      const r1=filterPeople('');
      if(r1.length!==0) console.error('filterPeople("") ควรว่าง แต่ได้', r1.length);
      const anyName=STUDENTS[0].name.slice(0,2);
      const r2=filterPeople(anyName);
      if(!r2.some(a=>a.id===STUDENTS[0].id)) console.error('filterPeople หาไม่เจอชื่อที่ควรเจอ:', anyName);
    `, sandbox, { filename: 'sidebar.js', timeout: 10000 });
  } catch (e) { errors.push('sidebar test threw: ' + (e.stack || e)); }
```

- [ ] **Step 5: Run smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK`

- [ ] **Step 6: Commit**

```bash
git add index.html test/smoke.js
git commit -m "feat: add collapsible left sidebar with room list, per-classroom student list, and live name search"
```

---

### Task 9: Mobile devicePixelRatio fix + adaptive initial zoom + final selfCheck sweep + changelog

**Files:**
- Modify: `index.html` (`resize()`, `frame()`'s two `setTransform` calls, `fitCam()`)
- Modify: `SPEC.md` (append changelog)

**Interfaces:**
- Consumes: everything above. Terminal task.
- Produces: `dpr`, `logW`, `logH` module-level vars (already referenced by `focusOn` in Task 8 Step 2).

- [ ] **Step 1: `resize()` — back the canvas with real device pixels**

Change:
```js
let cam={x:0,y:0,s:1};
function resize(){cv.width=innerWidth;cv.height=mainEl.clientHeight;}
```
to:
```js
let cam={x:0,y:0,s:1},dpr=1,logW=0,logH=0;
function resize(){
  dpr=window.devicePixelRatio||1;
  logW=innerWidth;logH=mainEl.clientHeight;
  cv.width=Math.round(logW*dpr);cv.height=Math.round(logH*dpr);
  cv.style.width=logW+'px';cv.style.height=logH+'px';
}
```

- [ ] **Step 2: Scale the two per-frame `setTransform` calls**

In `frame(ts)`, change:
```js
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(cam.s,0,0,cam.s,cam.x,cam.y);
```
to:
```js
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(cam.s*dpr,0,0,cam.s*dpr,cam.x*dpr,cam.y*dpr);
```
And later in the same function (the tint overlay), change:
```js
  if(TINT){ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=TINT;ctx.fillRect(0,0,cv.width,cv.height);}
```
to:
```js
  if(TINT){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=TINT;ctx.fillRect(0,0,logW,logH);}
```

- [ ] **Step 3: `fitCam()` uses logical size, and narrow screens fit a core bounds instead of the whole map**

Change:
```js
function fitCam(){let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  [[0,0],[GW,0],[0,GH],[GW,GH]].forEach(([x,y])=>{const[wx,wy]=iso(x,y);
    minX=Math.min(minX,wx);maxX=Math.max(maxX,wx);minY=Math.min(minY,wy);maxY=Math.max(maxY,wy);});
  const mw=maxX-minX+80,mh=maxY-minY+180;
  cam.s=Math.min(cv.width/mw,cv.height/mh)*0.97;
  cam.x=cv.width/2-(minX+maxX)/2*cam.s;cam.y=cv.height/2-(minY+maxY)/2*cam.s+40;}
```
to:
```js
const CORE_BOUNDS={x1:0,y1:0,x2:100,y2:90}; // ตัดวัด+คลองท้ายแผนที่ออกจากมุมมองเริ่มต้นบนจอแคบ
function fitCam(){
  const mobile=logW<700;
  const b=mobile?CORE_BOUNDS:{x1:0,y1:0,x2:GW,y2:GH};
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  [[b.x1,b.y1],[b.x2,b.y1],[b.x1,b.y2],[b.x2,b.y2]].forEach(([x,y])=>{const[wx,wy]=iso(x,y);
    minX=Math.min(minX,wx);maxX=Math.max(maxX,wx);minY=Math.min(minY,wy);maxY=Math.max(maxY,wy);});
  const mw=maxX-minX+80,mh=maxY-minY+180;
  cam.s=Math.min(logW/mw,logH/mh)*0.97;
  cam.x=logW/2-(minX+maxX)/2*cam.s;cam.y=logH/2-(minY+maxY)/2*cam.s+40;}
```

- [ ] **Step 4: Extend `selfCheck()` one more time — final full-coverage assertion**

Add at the very end of `selfCheck()`, right before its closing `console.log(...)`:
```js
  console.assert(GW===100&&GH===112,'❌ ขนาดแผนที่ไม่ตรงสเปก');
  console.assert(!!ROOM_BY_ID.gym&&!!ROOM_BY_ID.library&&!!ROOM_BY_ID.playground&&!!ROOM_BY_ID.m_sci2&&!!ROOM_BY_ID.temple,
    '❌ ห้องใหม่หายไป');
```

- [ ] **Step 5: Run the full smoke test**

Run: `node test/smoke.js`
Expected: `SMOKE OK`

- [ ] **Step 6: Append SPEC.md changelog**

Append to the end of `SPEC.md` (matching the existing dated-section convention):
```markdown

## อัปเดต 14 ก.ค.69 (3) — v7 ผังจริง + เวลา/ประตู + ผอ./รองผอ. + บาร์ซ้าย + แก้จอมือถือ
- ผังแผนที่ยกเครื่องให้ตรงภาพถ่ายดาวเทียมจริงของโรงเรียนชุมชนวัดบางโค (แนวเหนือ-ใต้ แทนซ้าย-ขวาเดิม): ประตูหน้า→สนาม/โรงยิม/โรงอาหาร(ขยาย)/ห้องสมุด/สนามเด็กเล่น→อาคารประถม(+ห้องผู้บริหาร)→อาคารมัธยม(+วิทย์ 2 ห้อง)→โดมกิจกรรมเข้าแถว→ประตูหลัง→วัดบางโค+ศาลาวัด, คลองบางโค/บางใหญ่
- แกนเวลาขยาย 06:00-19:00: มาโรงเรียนทยอย 06:00-07:30 (เล่นอิสระ) → 07:30-07:50 ทยอยเข้าแถวที่โดม → เลิกเรียนทยอยผ่านประตูหน้า/หลัง (นักเรียนส่วนน้อยใช้ประตูหลังฝั่งวัด) → ครูทยอยกลับหลัง 16:30 → 18:00 ว่างเปล่าจริง (ครูเวรกลางคืนเป็นงานถัดไป)
- แสงกลางวัน-กลางคืนไล่โทนเต็มช่วงเวลาใหม่
- แก้บั๊กหมา/แมว/ไก่จางมองไม่เห็น (fillStyle เงาค้าง) + เพิ่มวิ่ง 4 ทิศ + เสียงร้องเป็นบับเบิ้ล
- เพิ่มตัวละคร ผอ./รองผอ. เดินตรวจตราสุ่มทั้งวัน (เชื่อมนิเทศจริงเป็นงานถัดไป)
- นักเรียนนั่งนิ่งตอนมีคาบเรียน, ครูยืนสอนหน้ากระดานพร้อมท่าทาง
- ร้านค้าหน้าประตู 4-5 ร้าน + 7-11 (เห็นเฉพาะช่วงมา/เย็น ยกเว้น 7-11 เปิดทั้งวัน) + ซีนพิเศษครูณัฐธเนศแวะเซเว่นตอนเที่ยง
- บาร์ซ้ายใหม่: รายชื่อห้อง/อาคาร + รายชื่อคนแบ่งตามห้อง + ช่องค้นหาไปหาตัวละครโดยตรง
- แก้จอมือถือภาพเบลอ (ไม่คูณ devicePixelRatio มาก่อน) + ซูมเริ่มต้นบนจอแคบเข้าเฉพาะโซนหลักแทนยัดทั้งผืน
- ทดสอบ: `test/smoke.js` committed เข้ารีโปแล้ว (เดิมอยู่ scratchpad หายทุกเซสชัน) รัน `node test/smoke.js`
```

- [ ] **Step 7: Commit**

```bash
git add index.html SPEC.md
git commit -m "fix: mobile canvas blur (devicePixelRatio) + adaptive initial zoom on narrow screens; append v7 changelog to SPEC.md"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (layout) → Task 2. Section 2 (time/gates/day-night) → Tasks 3-4. Section 3 (critters/ผอ./student-teacher behavior/shops/T013) → Tasks 5-7. Section 4 (sidebar) → Task 8. Section 5 (mobile) → Task 9. Deferred items (เวรวันพระ, นิเทศ API, ครูเวรกลางคืน, สถิติมาเรียนจริง) intentionally have no task — confirmed absent.
- **Placeholder scan:** no TBD/TODO; every step has literal code. Coordinate numbers in Task 2 were hand-verified for non-overlap and additionally guarded by the new automated overlap check in `selfCheck()` (Task 2 Step 5) as a mechanical safety net.
- **Type/name consistency checked across tasks:** `GATE_FRONT/GATE_BACK` (Task 2) → used in Task 3 Step 5 (`gateOf`) and Task 2's own `selfCheck` additions. `sciRoomFor` (Task 2 Step 4) → called from Task 3 Step 3. `a.gate/arriveT/gatherAt/leaveT` (Task 3 Step 2) → consumed by Task 3 Step 4-5, Task 6 Step 1 (`DIRECTORS` literals define the same fields directly), Task 7. `Char.present`/`gone`/`teaching`/`leaving` (Task 3 Step 5, Task 7 Step 2) are consistent field names throughout. `dpr`/`logW`/`logH` (Task 9 Step 1) are forward-referenced by Task 8 Step 2's `focusOn` — noted inline in Task 8 with the reason it's safe given task execution order.
