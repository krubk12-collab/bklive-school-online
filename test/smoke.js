// test/smoke.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'index.html');

function extractScript(html) {
  const m = html.match(/<script>[\r\n]+([\s\S]*?)[\r\n]*<\/script>/);
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
    querySelectorAll() { return []; },
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
    addEventListener() {}, // global event listeners (mousemove, resize, etc)
    setInterval() { return 0; }, // timer stubs
    clearInterval() {},
    requestAnimationFrame(fn) { rafCount++; if (rafCount < 2) fn(16); }, // run frame() once, don't recurse forever
    Math, Date, // Date constructor is available for new Date().toLocaleString(...) calls
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

  // regression: บูตตอนเช้ามืด (tm ถูกบังคับให้ตรงกับ "เวลาจริง" ก่อน assign()+สร้าง Char ตัวแรก
  // — จำลองเงื่อนไขที่บั๊กเดิมพัง คือ assign() ตัวแรกรันด้วย tm ผิด(ค่า default 510)ทำให้ Char.prev
  // ถูกตั้งจากห้องที่ไม่ควรมีตัวจริงๆ) ต้องไม่มีใครที่ยังไม่ถึงเวลามาโผล่ให้ update/วาดบนแผนที่
  try {
    vm.runInContext(`
      day=0; tm=375; // 06:15 — ก่อนเวลามาของนักเรียนส่วนใหญ่ (arriveT อยู่ 06:00-07:29)
      assign();
      const testChars=[...TEACHERS,...STUDENTS].map(a=>new Char(a));
      const savedChars=chars; chars=testChars; setTime(); chars=savedChars;
      const notYetArrived=testChars.filter(c=>c.a.arriveT>375);
      if(notYetArrived.length===0) console.error('regression test ตั้งค่าไม่ได้ผล: ไม่มีใครที่ arriveT>375');
      notYetArrived.forEach(c=>{
        const visible=c.hasArrived&&!c.gone; // เงื่อนไขเดียวกับที่ frame() ใช้ตัดสินใจ update/วาด
        if(visible) console.error('บั๊กเดิม: ตัวละครที่ยังไม่ถึงเวลามาถูกตั้งให้ปรากฏบนแผนที่',c.a.id,c.a.arriveT);
        // this.leaving มีอยู่ทั้งก่อน/หลังแก้ — บั๊กเดิมคือคนที่ยังไม่มาโดนตั้ง prev จากห้องผิดๆ (tm=510 ตอนบูต)
        // แล้ว setTime() เห็น room===null&&prev!==null เข้าใจผิดว่า "เพิ่งออก" สั่งเดินไปประตู (leaving=true) ทั้งที่ไม่เคยมา
        if(c.leaving) console.error('บั๊กเดิม: คนที่ยังไม่มาถูกสั่งให้ "เดินออกจากห้อง" (leaving=true) ทั้งที่ไม่เคยปรากฏตัวจริง',c.a.id,c.a.arriveT);
      });
      const alreadyArrived=testChars.filter(c=>c.a.arriveT<=375);
      if(alreadyArrived.length&&!alreadyArrived.some(c=>c.hasArrived&&!c.gone))
        console.error('regression test overcorrect: คนที่มาแล้วกลับไม่ถูกวาดเลยสักคน');
    `, sandbox, { filename: 'arrival-regression.js', timeout: 10000 });
  } catch (e) { errors.push('arrival-regression threw: ' + (e.stack || e)); }

  if (errors.length) {
    console.error('SMOKE FAIL — captured console errors/asserts:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('SMOKE OK');
}

run();
