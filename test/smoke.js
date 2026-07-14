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

  if (errors.length) {
    console.error('SMOKE FAIL — captured console errors/asserts:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('SMOKE OK');
}

run();
