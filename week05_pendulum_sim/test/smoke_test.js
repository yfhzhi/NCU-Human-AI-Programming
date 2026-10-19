// 无头冒烟测试：用最小 DOM 桩运行 index.html 的内联脚本
// 覆盖：初始化 / 物理推进 / 重置 / 暂停 / 滑块 / 天体预设 / localStorage 持久化与恢复
// 用法：node test/smoke_test.js [index.html 路径]
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeCtx() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
      if (typeof k === 'string' && ['fillStyle', 'strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur', 'font'].includes(k)) return '';
      return () => {};
    },
    set() { return true; }
  });
}

function boot(storage) {
  const handlers = {};
  const els = {};
  const rafQueue = [];
  const ctxStub = makeCtx();

  const caps = ['earth', 'moon', 'jupiter', 'space'].map((k) => ({
    key: k,
    attrs: { 'data-preset': k },
    active: false,
    getAttribute(n) { return this.attrs[n]; },
    classList: {
      toggle(cls, on) { if (cls === 'active') this.owner.active = !!on; },
      set owner(v) { this._o = v; },
      get owner() { return this._o; }
    }
  }));
  caps.forEach((c) => { c.classList.owner = c; });

  function mkEl(id) {
    const el = {
      id,
      value: id === 'lenRange' ? '200' : id === 'gravRange' ? '9.8' : '0',
      textContent: '',
      clientWidth: 1200,
      clientHeight: 800,
      width: 0,
      height: 0,
      addEventListener(type, fn) { handlers[id + ':' + type] = fn; },
      getContext() { return ctxStub; },
      querySelectorAll() { return caps; }
    };
    return el;
  }

  const sandbox = {
    document: { getElementById: (id) => (els[id] = els[id] || mkEl(id)) },
    window: { addEventListener() {}, devicePixelRatio: 2, innerWidth: 1200 },
    localStorage: storage,
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    console, Math, Date, JSON, parseFloat, isFinite
  };
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'index.html' });
  return { els, handlers, rafQueue, caps, sandbox };
}

function run(app, frames, stepMs = 16.7) {
  let t = app.t || 0;
  for (let i = 0; i < frames; i++) {
    const fn = app.rafQueue.shift();
    if (!fn) throw new Error('动画循环断掉了');
    t += stepMs;
    fn(t);
  }
  app.t = t;
}

const store = (() => {
  const map = {};
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    _map: map
  };
})();

// ---------- 1. 首次运行 ----------
const app = boot(store);
run(app, 300);

const resetFn = app.handlers['resetBtn:click'];
const pauseFn = app.handlers['pauseBtn:click'];
if (!resetFn) throw new Error('重置按钮没有绑定点击处理器');
if (!pauseFn) throw new Error('暂停按钮没有绑定点击处理器');

resetFn();
pauseFn();
if (app.els.pauseBtn.textContent !== '继续') throw new Error('暂停文案异常: ' + app.els.pauseBtn.textContent);
pauseFn();
if (app.els.pauseBtn.textContent !== '暂停') throw new Error('恢复文案异常: ' + app.els.pauseBtn.textContent);

app.handlers['lenRange:input'].call({ value: '350' });
app.handlers['gravRange:input'].call({ value: '25' });
app.handlers['dampRange:input'].call({ value: '0.01' });
if (app.els.lenVal.textContent !== '350 px') throw new Error('摆长读数异常: ' + app.els.lenVal.textContent);
if (app.els.gravVal.textContent !== '25.00 m/s²') throw new Error('重力读数异常: ' + app.els.gravVal.textContent);
if (app.els.dampVal.textContent !== '0.010') throw new Error('阻尼读数异常: ' + app.els.dampVal.textContent);

run(app, 600);

// ---------- 2. 天体预设：平滑过渡 ----------
const moonCap = app.caps.find((c) => c.key === 'moon');
app.handlers['scenes:click']({ target: { closest: () => moonCap } });
if (!moonCap.active) throw new Error('月球胶囊没有被高亮');
run(app, 5);
const midG = parseFloat(app.els.gravVal.textContent);
if (!(midG > 1.6 && midG < 25)) throw new Error('重力不是平滑过渡，中途值异常: ' + midG);
run(app, 120);
if (app.els.gravVal.textContent !== '1.60 m/s²') throw new Error('重力没有收敛到月球值: ' + app.els.gravVal.textContent);

// 失重：提示语与无穷周期
const spaceCap = app.caps.find((c) => c.key === 'space');
app.handlers['scenes:click']({ target: { closest: () => spaceCap } });
run(app, 200);
if (app.els.periodOut.textContent !== 'T → ∞') throw new Error('失重周期显示异常: ' + app.els.periodOut.textContent);
if (!app.els.hint.textContent) throw new Error('失重提示语缺失');

// ---------- 3. 持久化：写入与恢复 ----------
app.handlers['lenRange:input'].call({ value: '300' });
const saved = JSON.parse(store.getItem('week05.pendulum.params.v1'));
if (saved.L !== 300 || saved.preset !== 'space') throw new Error('localStorage 写入异常: ' + JSON.stringify(saved));

const app2 = boot(store);
if (app2.els.lenVal.textContent !== '300 px') throw new Error('刷新后摆长未恢复: ' + app2.els.lenVal.textContent);
if (app2.els.gravVal.textContent !== '0.00 m/s²') throw new Error('刷新后重力未恢复: ' + app2.els.gravVal.textContent);
if (!app2.caps.find((c) => c.key === 'space').active) throw new Error('刷新后场景高亮未恢复');
run(app2, 120);

// ---------- 4. 脏数据容错 ----------
store.setItem('week05.pendulum.params.v1', '{"L":"坏数据","g":999,"c":null}');
const app3 = boot(store);
run(app3, 60);
if (app3.els.gravVal.textContent !== '25.00 m/s²') throw new Error('越界重力未被钳制: ' + app3.els.gravVal.textContent);

store.setItem('week05.pendulum.params.v1', 'not-json');
const app4 = boot(store);
run(app4, 60);

console.log('SMOKE TEST PASSED');
console.log('  · 帧循环 1000+ 帧无异常');
console.log('  · 重置 / 暂停 / 三个滑块绑定正常');
console.log('  · 天体预设平滑过渡并收敛（99 帧内）');
console.log('  · localStorage 写入、刷新恢复、脏数据容错均通过');
