(function () {
  'use strict';
  // ===== 定数 =====
  const XMIN = -25, XMAX = 25, YMIN = -15, YMAX = 15;
  const U = 20;                 // 1単位 = 20px (描画座標系。canvasは2倍解像度)
  const CW = (XMAX - XMIN) * U, CH = (YMAX - YMIN) * U;
  const SPEED = 55;             // 弾速 [単位/秒]
  const MAX_ARC = 500;          // 弾の最大軌道長
  const HIT_R = 0.8, BLAST_R = 1.5;
  const fmtTime = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const NAMES = ['Euler', 'Gauss', 'Riemann', 'Descartes', 'Neumann', 'Pythagoras', 'Fermat', 'Newton', 'Leibniz', 'Cauchy', 'Noether', 'Turing', 'Pascal', 'Laplace', 'Hilbert', 'Cantor'];
  const TCOL = ['#ff6b5b', '#4aa3ff'];
  const FM_INFO = {
    plain: { lab: 'f(x) =', name: 'y = f(x)', ph: 'sin(x/3)*4' },
    ode1: { lab: "y' =", name: "y' = f(x, y)", ph: 'cos(x)+0.2' },
    ode2: { lab: "y'' =", name: "y'' = f(x, y, y')", ph: '-y+0.1' },
  };

  const $ = (s) => document.querySelector(s);
  const canvas = $('#field');
  const ctx = canvas.getContext('2d');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wx = (x) => (x - XMIN) * U;
  const wy = (y) => (YMAX - y) * U;

  // ===== 地形 =====
  class Terrain {
    constructor() {
      this.c = document.createElement('canvas');
      this.c.width = CW; this.c.height = CH;
      this.ctx = this.c.getContext('2d', { willReadFrequently: true });
      this.data = null;
    }
    clear() { this.ctx.clearRect(0, 0, CW, CH); }
    add(x, y, r) { this.ctx.fillStyle = '#000'; this.ctx.beginPath(); this.ctx.arc(wx(x), wy(y), r * U, 0, 7); this.ctx.fill(); }
    erase(x, y, r) {
      this.ctx.save(); this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.beginPath(); this.ctx.arc(wx(x), wy(y), r * U, 0, 7); this.ctx.fill(); this.ctx.restore();
      this.refresh();
    }
    refresh() { this.data = this.ctx.getImageData(0, 0, CW, CH).data; }
    solid(x, y) {
      const px = Math.floor(wx(x)), py = Math.floor(wy(y));
      if (px < 0 || py < 0 || px >= CW || py >= CH) return false;
      return this.data[(py * CW + px) * 4 + 3] > 128;
    }
  }

  // 背景グリッド(1回だけ描画)
  const grid = document.createElement('canvas');
  grid.width = CW; grid.height = CH;
  (function () {
    const g = grid.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, CW, CH);
    for (let x = XMIN; x <= XMAX; x++) {
      g.strokeStyle = x % 5 === 0 ? '#bfc9c3' : '#e6ebe8'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(wx(x) + .5, 0); g.lineTo(wx(x) + .5, CH); g.stroke();
    }
    for (let y = YMIN; y <= YMAX; y++) {
      g.strokeStyle = y % 5 === 0 ? '#bfc9c3' : '#e6ebe8';
      g.beginPath(); g.moveTo(0, wy(y) + .5); g.lineTo(CW, wy(y) + .5); g.stroke();
    }
    g.strokeStyle = '#33443c'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(wx(0), 0); g.lineTo(wx(0), CH); g.moveTo(0, wy(0)); g.lineTo(CW, wy(0)); g.stroke();
    g.fillStyle = '#6b7c73'; g.font = '10px JetBrains Mono, monospace';
    for (let x = XMIN + 5; x < XMAX; x += 5) if (x) g.fillText(x, wx(x) + 3, wy(0) + 12);
    for (let y = YMIN + 5; y < YMAX; y += 5) if (y) g.fillText(y, wx(0) + 4, wy(y) - 3);
  })();

  // ===== 弾 =====
  class Shot {
    constructor(G, s, fm, f, angleDeg) {
      this.G = G; this.s = s; this.team = s.team; this.fm = fm; this.f = f;
      this.dir = s.team === 1 ? -1 : 1;
      this.X = this.dir * s.x; this.y = s.y; this.X0 = this.X; this.y0 = s.y;
      this.v = Math.tan((angleDeg * Math.PI) / 180);
      this.arc = 0; this.done = false; this.hit = null; this.fizzle = false;
      this.trail = [[s.x, s.y]];
      this.life = 0;
      if (fm === 'plain') {
        this.F0 = f(this.X0, 0, 0);
        if (!isFinite(this.F0)) { this.done = true; this.fizzle = true; }
      }
    }
    pos() { const t = this.trail[this.trail.length - 1]; return t; }
    advance(ds) {
      let budget = ds;
      let guard = 0;
      while (budget > 0 && !this.done && guard++ < 4000) {
        const px = this.dir * this.X, py = this.y;
        if (!this.step()) { this.done = true; this.fizzle = true; break; }
        const nx = this.dir * this.X, ny = this.y;
        const len = Math.hypot(nx - px, ny - py);
        budget -= len; this.arc += len;
        if (!this.moveTo(px, py, nx, ny, len)) break;
        if (this.arc > MAX_ARC) { this.done = true; this.fizzle = true; break; }
      }
    }
    // 1マイクロステップ進める。不正なら false
    step() {
      const f = this.f, fm = this.fm;
      const sx = this.X;
      if (fm === 'plain') {
        let dX = 0.02;
        for (let i = 0; i < 12; i++) {
          const ny = f(sx + dX, 0, 0) - this.F0 + this.y0;
          if (!isFinite(ny)) return false;
          if (Math.abs(ny - this.y) > 0.05 && dX > 1e-4) { dX /= 2; continue; }
          this.X = sx + dX; this.y = ny; return true;
        }
        const ny = f(sx + dX, 0, 0) - this.F0 + this.y0;
        if (!isFinite(ny)) return false;
        this.X = sx + dX; this.y = ny; return true;
      }
      if (fm === 'ode1') {
        const s0 = f(sx, this.y, 0);
        if (!isFinite(s0) || Math.abs(s0) > 1e6) return false;
        const h = Math.max(1e-4, Math.min(0.02, 0.05 / Math.sqrt(1 + s0 * s0)));
        const k1 = s0, k2 = f(sx + h / 2, this.y + h * k1 / 2, 0), k3 = f(sx + h / 2, this.y + h * k2 / 2, 0), k4 = f(sx + h, this.y + h * k3, 0);
        const ny = this.y + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
        if (!isFinite(ny)) return false;
        this.X = sx + h; this.y = ny; return true;
      }
      // ode2: y'' = f(x, y, y')
      const y = this.y, v = this.v;
      const a1 = f(sx, y, v);
      if (!isFinite(a1) || Math.abs(v) > 1e6) return false;
      const h = Math.max(1e-4, Math.min(0.02, 0.05 / Math.sqrt(1 + v * v)));
      const a2 = f(sx + h / 2, y + h * v / 2, v + h * a1 / 2);
      const a3 = f(sx + h / 2, y + h * (v + h * a1 / 2) / 2, v + h * a2 / 2);
      const a4 = f(sx + h, y + h * (v + h * a2 / 2), v + h * a3);
      const ny = y + h * (v + 2 * (v + h * a1 / 2) + 2 * (v + h * a2 / 2) + (v + h * a3)) / 6;
      const nv = v + h * (a1 + 2 * a2 + 2 * a3 + a4) / 6;
      if (![ny, nv].every(isFinite)) return false;
      this.X = sx + h; this.y = ny; this.v = nv; return true;
    }
    moveTo(px, py, nx, ny, len) {
      const n = Math.max(1, Math.min(400, Math.ceil(len / 0.1)));
      const pz = (this.G.cfg || {}).pierce, pierceT = pz === 'terrain' || pz === 'all', pierceS = pz === 'soldier' || pz === 'all';
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = px + (nx - px) * t, y = py + (ny - py) * t;
        if (x < XMIN - 0.5 || x > XMAX + 0.5 || y < YMIN - 0.5 || y > YMAX + 0.5) {
          this.trail.push([x, y]); this.done = true; return false;
        }
        if (!pierceT && this.G.terrain.solid(x, y)) { this.trail.push([x, y]); this.done = true; this.hit = [x, y]; return false; }
        for (const o of this.G.soldiers) {
          if (!o.alive || o === this.s) continue;
          if ((o.x - x) ** 2 + (o.y - y) ** 2 < HIT_R * HIT_R) {
            if (pierceS) { killSoldier(o); continue; }
            this.trail.push([x, y]); this.done = true; this.hit = [x, y]; return false;
          }
        }
      }
      this.trail.push([nx, ny]);
      return true;
    }
  }

  // ===== キャンペーンステージ =====
  const STAGES = [
    { name: 'はじめの一撃', fm: 'plain', shots: 3, hint: '関数 y=f(x) のグラフが弾道です。例: 0.2x のような傾きで右上の的を狙おう。', s: [[-20, 0]], t: [[18, 4]], b: [] },
    { name: '山越え', fm: 'plain', shots: 4, hint: '黒い円は弾を止めます。放物線 -0.05x^2 のように山なりに越えよう。', s: [[-20, -8]], t: [[15, 8]], b: [[0, -3, 6]] },
    { name: 'ふたつの的', fm: 'plain', shots: 4, hint: '的は2つ。兵士は発射のたびに交代します。', s: [[-20, 0], [-20, -10]], t: [[10, 10], [12, -10]], b: [[2, 0, 5]] },
    { name: '壁の上から', fm: 'plain', shots: 5, hint: '壁の隙間はありません。高く舞い上がって落とそう。', s: [[-20, -10]], t: [[20, -2]], b: [[8, -9, 5], [8, 0, 4], [8, 8, 4]] },
    { name: '微分方程式入門', fm: 'ode1', shots: 4, hint: "y' = f(x, y) 。解曲線が弾道です。y' = 0.3 は傾き0.3の直線。y'=-y なら減衰する曲線。", s: [[-20, 0]], t: [[20, 0]], b: [[0, 0, 5]] },
    { name: '波乗り', fm: 'ode1', shots: 5, hint: "y' = cos(x) のようにうねらせて障害物の間を縫おう。", s: [[-22, -5], [-22, 8]], t: [[18, 10], [20, -6], [10, 0]], b: [[-5, 3, 3], [4, -5, 4], [4, 8, 3], [12, 3, 2.5]] },
    { name: '角度が命', fm: 'ode2', shots: 5, hint: "y'' = f(x,y,y') 。↑↓キーで発射角を調整。y''=0 なら角度通りの直線。", s: [[-20, -10]], t: [[20, 10]], b: [[0, 0, 6], [8, -8, 3]] },
    { name: '最終試験', fm: 'ode2', shots: 7, hint: "y''=-y のような振動解も使えます。すべての的を撃て。", s: [[-22, -10], [-22, 10]], t: [[18, 12], [20, 0], [14, -12], [6, 4]], b: [[-8, 0, 4], [0, 9, 3], [0, -9, 3], [8, 0, 3.5], [14, 6, 2], [14, -6, 2]] },
  ];
  const getProg = () => +(localStorage.getItem('gw2_prog') || 0);
  const setProg = (n) => localStorage.setItem('gw2_prog', Math.max(getProg(), n));

  // ===== ゲーム状態 =====
  let G = null, lastCfg = null;
  const terrain = new Terrain();
  // 発射角・関数は兵士ごとに s.angle / s.expr に保存
  const selOf = (t) => G.teams[t][G.sel[t]];
  const angOf = (t) => { const s = selOf(t); return s ? s.angle : 0; };

  function mkSoldier(x, y, team, name, target) {
    return { x, y, team, name, alive: true, cd: 0, target: !!target, t: Math.random() * 6, expr: '', angle: 0 };
  }

  function genVersus(cfg) {
    const teams = [[], []], all = [];
    const names = NAMES.slice().sort(() => Math.random() - 0.5);
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < cfg.n; i++) {
        for (let k = 0; k < 200; k++) {
          const x = t ? rnd(8, 23) : rnd(-23, -8), y = rnd(-12.5, 12.5);
          if (teams[t].every((o) => Math.hypot(o.x - x, o.y - y) > 4)) {
            const s = mkSoldier(x, y, t, names.pop());
            teams[t].push(s); all.push(s); break;
          }
        }
      }
    }
    terrain.clear();
    let n = cfg.obs, guard = 0;
    while (n > 0 && guard++ < 500) {
      const r = rnd(1, 3.6), x = rnd(-22, 22), y = rnd(-13, 13);
      if (all.every((s) => Math.hypot(s.x - x, s.y - y) > r + 1.8)) { terrain.add(x, y, r); n--; }
    }
    terrain.refresh();
    return { teams, all };
  }

  function genStage(i) {
    const st = STAGES[i];
    const names = NAMES.slice().sort(() => Math.random() - 0.5);
    const t0 = st.s.map(([x, y]) => mkSoldier(x, y, 0, names.pop()));
    const t1 = st.t.map(([x, y]) => mkSoldier(x, y, 1, 'Target', true));
    terrain.clear();
    st.b.forEach(([x, y, r]) => terrain.add(x, y, r));
    terrain.refresh();
    return { teams: [t0, t1], all: t0.concat(t1) };
  }

  function startGame(cfg, snap, bg) {
    lastCfg = cfg;
    const gen = snap ? restoreTeams(snap) : cfg.kind === 'campaign' ? genStage(cfg.stage) : genVersus(cfg);
    G = {
      cfg, kind: cfg.kind, rt: cfg.kind === 'versus' && cfg.rt, fm: cfg.kind === 'campaign' ? STAGES[cfg.stage].fm : cfg.fm,
      teams: gen.teams, soldiers: gen.all, terrain,
      shots: [], trails: [], parts: [], sel: [0, 0], turnTeam: 0, phase: 'aim', timer: cfg.time || 0,
      turnTime: cfg.kind === 'versus' ? (cfg.time || 0) : 0, cooldown: cfg.cd || 6,
      over: false, winner: -1, shotsLeft: cfg.kind === 'campaign' ? STAGES[cfg.stage].shots : 0, time: 0,
      preview: !!cfg.preview && cfg.kind === 'versus', bg: !!bg,
    };
    if (snap) {
      G.sel = snap.sel.slice(); G.turnTeam = snap.turnTeam; G.phase = snap.phase; G.timer = snap.timer;
      G.shotsLeft = snap.shotsLeft; G.time = snap.time;
    }
    buildPanels();
    if (snap && G.phase === 'flight') nextTurn();
    $('#menu').classList.add('hidden');
    $('#result').classList.add('hidden');
    const hint = $('#hint');
    if (G.kind === 'campaign') { hint.textContent = '💡 ' + STAGES[cfg.stage].hint; hint.classList.remove('hidden'); } else hint.classList.add('hidden');
    $('#mode-label').textContent = G.kind === 'campaign' ? `Stage ${cfg.stage + 1}: ${STAGES[cfg.stage].name}` : (G.rt ? 'リアルタイム対戦' : 'ターン制対戦');
    $('#fm-label').textContent = FM_INFO[G.fm].name;
    const f0 = document.querySelector('.p-input'); if (f0) setTimeout(() => f0.focus(), 50);
  }

  // ===== パネルUI =====
  const panelsEl = $('#panels');
  let P = [];
  function buildPanels() {
    panelsEl.innerHTML = '';
    panelsEl.className = G.kind === 'campaign' ? 'single' : '';
    P = [];
    const nT = G.kind === 'campaign' ? 1 : 2;
    const chips = ['sin(', 'cos(', 'tan(', 'abs(', 'ln(', 'sqrt(', 'exp(', '^', 'π', 'x'].concat(G.fm !== 'plain' ? ['y'] : [], G.fm === 'ode2' ? ["y'"] : []);
    for (let t = 0; t < nT; t++) {
      const el = document.createElement('div');
      el.className = 'panel'; el.dataset.team = t;
      el.innerHTML = `
        <div class="p-head"><span class="nm">${G.kind === 'campaign' ? 'Player' : 'Player ' + (t + 1)}</span><span class="sol"></span><span class="cdwrap"><i class="cd"></i></span></div>
        <div class="p-row"><label class="p-lab">${FM_INFO[G.fm].lab}</label><input class="p-input" spellcheck="false" autocomplete="off" placeholder="${FM_INFO[G.fm].ph}"><span class="off" title="初期条件（兵士の位置から弾を出すための調整値）"></span></div>
        <div class="chips">${chips.map((c) => `<button type="button">${c}</button>`).join('')}</div>
        <div class="p-row p-ctrl">
          <div class="angle ${G.fm === 'ode2' ? '' : 'hidden'}">∠<button class="am" type="button">−</button><output>0°</output><button class="ap" type="button">+</button></div>
          <div class="p-row"><button class="sel prev ${G.rt || G.kind === 'campaign' ? '' : 'hidden'}" type="button" title="前の兵士">◀</button><button class="sel next ${G.rt || G.kind === 'campaign' ? '' : 'hidden'}" type="button" title="次の兵士">▶</button></div>
          <button class="fire" type="button">Fire!</button>
        </div>
        <div class="err"></div>`;
      panelsEl.appendChild(el);
      const o = { el, input: el.querySelector('.p-input'), err: el.querySelector('.err'), fire: el.querySelector('.fire'), cd: el.querySelector('.cd'), sol: el.querySelector('.sol'), off: el.querySelector('.off'), out: el.querySelector('output') };
      o.cur = null;
      o.input.addEventListener('input', () => { if (o.cur) o.cur.expr = o.input.value; o.err.textContent = ''; });
      o.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); tryFire(t); }
        else if (e.key === 'ArrowUp' && G.fm === 'ode2') { e.preventDefault(); adjAngle(t, 1); }
        else if (e.key === 'ArrowDown' && G.fm === 'ode2') { e.preventDefault(); adjAngle(t, -1); }
      });
      o.fire.onclick = () => tryFire(t);
      el.querySelectorAll('.chips button').forEach((b) => b.onclick = () => {
        const i = o.input, s = i.selectionStart ?? i.value.length, e = i.selectionEnd ?? s;
        i.value = i.value.slice(0, s) + b.textContent + i.value.slice(e);
        i.focus(); i.selectionStart = i.selectionEnd = s + b.textContent.length; if (o.cur) o.cur.expr = i.value;
      });
      el.querySelector('.am').onclick = () => adjAngle(t, -5);
      el.querySelector('.ap').onclick = () => adjAngle(t, 5);
      el.querySelector('.prev').onclick = () => cycle(t, -1);
      el.querySelector('.next').onclick = () => cycle(t, 1);
      P.push(o);
    }
  }
  function adjAngle(t, d) { const s = selOf(t); if (s) s.angle = Math.max(-85, Math.min(85, s.angle + d)); }
  function cycle(t, d) {
    const L = G.teams[t]; if (!L.length) return;
    for (let k = 1; k <= L.length; k++) {
      const i = (G.sel[t] + d * k + L.length * 4) % L.length;
      if (L[i].alive) { G.sel[t] = i; return; }
    }
  }
  const nextAlive = (t, from) => {
    const L = G.teams[t];
    for (let k = 1; k <= L.length; k++) { const i = (from + k) % L.length; if (L[i].alive) return i; }
    return from;
  };

  // 初期条件バッジと軌道プレビューを更新
  function computeInfo(o, s) {
    o.off.textContent = ''; o.prev = null;
    if (!s || !s.expr.trim()) return;
    let f;
    try { f = window.compileExpr(s.expr); } catch (e) { return; }
    const dir = s.team === 1 ? -1 : 1, X0 = dir * s.x;
    if (G.fm === 'plain') {
      const c = s.y - f(X0, 0, 0);
      if (!isFinite(c)) return;
      o.off.textContent = (c >= 0 ? '+ ' : '− ') + Math.abs(c).toFixed(3);
    } else if (G.fm === 'ode1') o.off.textContent = `y(${X0.toFixed(1)}) = ${s.y.toFixed(1)}`;
    else o.off.textContent = `y(${X0.toFixed(1)}) = ${s.y.toFixed(1)},  y′ = ${Math.tan((s.angle * Math.PI) / 180).toFixed(2)}`;
    if (G.preview) {
      try {
        const sh = new Shot({ terrain: { solid: () => false }, soldiers: [] }, s, G.fm, f, G.fm === 'ode2' ? s.angle : 0);
        for (let i = 0; i < 30 && !sh.done; i++) sh.advance(MAX_ARC);
        o.prev = sh.trail;
      } catch (e) { /* ignore */ }
    }
  }
  function restoreTeams(snap) {
    const teams = snap.teams.map((l) => l.map((d) => Object.assign(mkSoldier(d.x, d.y, d.team, d.name, d.target), d)));
    return { teams, all: teams[0].concat(teams[1]) };
  }

  function canAct(t) {
    if (!G || G.over) return false;
    if (G.kind === 'campaign') return t === 0 && G.shotsLeft > 0;
    return G.rt ? true : (G.turnTeam === t && G.phase === 'aim');
  }

  function refreshUI() {
    const alive = [0, 1].map((t) => G.teams[t].filter((s) => s.alive).length);
    if (G.kind === 'campaign') {
      $('#score0').textContent = '🎯' + G.shotsLeft; $('#score1').textContent = alive[1];
      $('#timer').textContent = '';
    } else {
      $('#score0').textContent = alive[0]; $('#score1').textContent = alive[1];
      const tm = $('#timer');
      if (G.rt) { tm.textContent = fmtTime(G.time); tm.classList.remove('low'); }
      else if (G.phase !== 'aim') { tm.textContent = '…'; tm.classList.remove('low'); }
      else if (!G.turnTime) { tm.textContent = '∞'; tm.classList.remove('low'); }
      else { tm.textContent = fmtTime(Math.ceil(G.timer)); tm.classList.toggle('low', G.timer < 10); }
    }
    P.forEach((o, t) => {
      const L = G.teams[t];
      if (L[G.sel[t]] && !L[G.sel[t]].alive) G.sel[t] = nextAlive(t, G.sel[t]);
      const s = L[G.sel[t]];
      const act = canAct(t);
      const ready = act && s && s.alive && (!G.rt || s.cd <= 0);
      o.el.classList.toggle('active', act && (G.rt || G.kind === 'campaign' || G.turnTeam === t));
      o.el.classList.toggle('idle', !act);
      o.input.disabled = !act;
      o.fire.disabled = !ready;
      o.sol.textContent = s ? '— ' + s.name : '';
      o.cd.style.width = G.rt && s ? (100 - Math.min(100, (s.cd / G.cooldown) * 100)) + '%' : '100%';
      o.out.textContent = (s ? s.angle : 0) + '°';
      if (s && o.cur !== s) { o.cur = s; o.input.value = s.expr; o.err.textContent = ''; }
      const key = s ? G.fm + '|' + s.expr + '|' + s.x + '|' + s.y + '|' + s.angle + '|' + G.preview : '';
      if (o.ckey !== key) { o.ckey = key; computeInfo(o, s); }
      o.el.querySelectorAll('.am,.ap,.sel,.chips button').forEach((b) => b.disabled = !act);
      if (!G.rt && G.kind === 'versus' && act && document.activeElement !== o.input && document.activeElement === document.body) o.input.focus();
    });
  }

  // ===== 発射 =====
  function tryFire(t) {
    if (!canAct(t)) return;
    const o = P[t], s = G.teams[t][G.sel[t]];
    if (!s || !s.alive) return;
    if (G.rt && s.cd > 0) return;
    let f;
    try { f = window.compileExpr(o.input.value); f(0, 0, 0); } catch (e) { o.err.textContent = '⚠ ' + e.message; return; }
    o.err.textContent = '';
    const shot = new Shot(G, s, G.fm, f, G.fm === 'ode2' ? s.angle : 0);
    G.shots.push(shot);
    if (G.kind === 'campaign') { G.shotsLeft--; G.sel[0] = nextAlive(0, G.sel[0]); }
    else if (G.rt) {
      s.cd = G.cooldown;
      const L = G.teams[t];
      const ready = L.map((_, i) => (G.sel[t] + 1 + i) % L.length).find((i) => L[i].alive && L[i].cd <= 0);
      if (ready !== undefined) G.sel[t] = ready;
    } else G.phase = 'flight';
  }

  function nextTurn() {
    G.turnTeam ^= 1; G.phase = 'aim'; G.timer = G.turnTime;
    G.sel[G.turnTeam] = nextAlive(G.turnTeam, G.sel[G.turnTeam]);
    const o = P[G.turnTeam]; if (o) setTimeout(() => o.input.focus(), 30);
  }

  function explode(x, y) {
    for (let i = 0; i < 36; i++) {
      const a = rnd(0, 6.283), sp = rnd(2, 9);
      G.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(.4, .9), max: .9, c: ['#ffcc33', '#ff7a1a', '#ff4d2e', '#555'][Math.floor(rnd(0, 4))] });
    }
    G.parts.push({ ring: true, x, y, life: .35, max: .35 });
    terrain.erase(x, y, BLAST_R);
    for (const s of G.soldiers) {
      if (s.alive && Math.hypot(s.x - x, s.y - y) < BLAST_R * 0.85) killSoldier(s);
    }
  }
  function killSoldier(s) {
    if (!s.alive) return;
    s.alive = false;
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, 6.283), sp = rnd(1, 6);
      G.parts.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(.5, 1), max: 1, c: TCOL[s.team] });
    }
  }

  function update(dt) {
    G.time += dt;
    if (!G.over) {
      if (G.kind === 'versus' && !G.rt && G.phase === 'aim' && G.turnTime) { G.timer -= dt; if (G.timer <= 0) nextTurn(); }
      if (G.rt) G.soldiers.forEach((s) => { s.cd = Math.max(0, s.cd - dt); });
    }
    for (const sh of G.shots) {
      sh.advance(SPEED * dt);
      if (sh.done && !sh.fin) {
        sh.fin = true;
        if (sh.hit) explode(sh.hit[0], sh.hit[1]);
        else if (sh.fizzle) { const p = sh.pos(); G.parts.push({ ring: true, x: p[0], y: p[1], life: .3, max: .3, small: true }); }
        G.trails.push({ pts: sh.trail, team: sh.team, life: 1.6 });
      }
    }
    G.shots = G.shots.filter((s) => !s.fin);
    G.trails.forEach((t) => (t.life -= dt)); G.trails = G.trails.filter((t) => t.life > 0);
    G.parts.forEach((p) => { p.life -= dt; if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 6 * dt; } });
    G.parts = G.parts.filter((p) => p.life > 0);

    if (!G.over) {
      const alive = [0, 1].map((t) => G.teams[t].filter((s) => s.alive).length);
      if (G.kind === 'campaign') {
        if (alive[1] === 0) finish(0);
        else if (alive[0] === 0 || (G.shotsLeft === 0 && G.shots.length === 0)) finish(1);
      } else if (alive[0] === 0 || alive[1] === 0) {
        if (G.shots.length === 0 || true) finish(alive[0] === 0 && alive[1] === 0 ? -1 : alive[0] === 0 ? 1 : 0);
      } else if (!G.rt && G.phase === 'flight' && G.shots.length === 0) nextTurn();
    }
  }

  function finish(w) {
    G.over = true; G.winner = w;
    const el = $('#result'), title = $('#result-title'), sub = $('#result-sub');
    $('#btn-next').classList.add('hidden');
    if (G.kind === 'campaign') {
      if (w === 0) {
        setProg(G.cfg.stage + 1);
        title.textContent = '🎉 ステージクリア!'; sub.textContent = `残り弾数 ${G.shotsLeft}`;
        if (G.cfg.stage + 1 < STAGES.length) $('#btn-next').classList.remove('hidden'); else sub.textContent += ' — 全ステージ制覇!';
      } else { title.textContent = '💥 失敗…'; sub.textContent = '弾切れ、または兵士が全滅しました。'; }
    } else {
      title.textContent = w < 0 ? '引き分け' : `Player ${w + 1} の勝利!`;
      title.style.color = w < 0 ? '' : TCOL[w];
      sub.textContent = '';
    }
    setTimeout(() => el.classList.remove('hidden'), 700);
    renderStages();
  }

  // ===== 描画 =====
  function drawSoldier(s, selected) {
    const x = wx(s.x), y = wy(s.y), c = TCOL[s.team];
    const dir = s.team === 1 ? -1 : 1;
    ctx.save();
    if (s.target) {
      ctx.globalAlpha = s.alive ? 1 : 0;
      if (s.alive) {
        const pul = 1 + Math.sin(G.time * 4 + s.t) * 0.06;
        [[15, c], [10.5, '#fff'], [6, c], [2.4, '#fff']].forEach(([r, col]) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r * pul, 0, 7); ctx.fill(); });
        ctx.strokeStyle = '#223'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 15 * pul, 0, 7); ctx.stroke();
      }
      ctx.restore(); return;
    }
    if (!s.alive) {
      ctx.globalAlpha = .55; ctx.strokeStyle = c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
      ctx.restore(); return;
    }
    if (selected) {
      ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -G.time * 20;
      ctx.beginPath(); ctx.arc(x, y, 19, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      const b = Math.sin(G.time * 6) * 2;
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - 28 + b); ctx.lineTo(x - 6, y - 38 + b); ctx.lineTo(x + 6, y - 38 + b); ctx.fill();
    }
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y + 4, 9, 10, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, y - 7, 7, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x + dir * 3, y - 8, 1.6, 0, 7); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - 8, y - 11); ctx.lineTo(x + dir * 2, y - 22); ctx.lineTo(x + 8, y - 11); ctx.fill();
    ctx.font = '700 11px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = c;
    ctx.fillText(s.name, x, y - 25);
    if (G.rt && s.cd > 0) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - 12, y + 18, 24, 3); ctx.fillStyle = c; ctx.fillRect(x - 12, y + 18, 24 * (1 - s.cd / G.cooldown), 3); }
    ctx.restore();
  }

  function drawTrail(pts, col, alpha) {
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(wx(pts[0][0]), wy(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(wx(pts[i][0]), wy(pts[i][1]));
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.drawImage(grid, 0, 0);
    if (!G) return;
    ctx.drawImage(terrain.c, 0, 0);
    // 角度インジケータ (ode2)
    if (G.fm === 'ode2' && !G.over) {
      P.forEach((o, t) => {
        if (!canAct(t)) return;
        const s = G.teams[t][G.sel[t]]; if (!s || !s.alive) return;
        const dir = t === 1 ? -1 : 1, a = (angOf(t) * Math.PI) / 180;
        ctx.strokeStyle = TCOL[t]; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(wx(s.x), wy(s.y)); ctx.lineTo(wx(s.x + dir * Math.cos(a) * 3), wy(s.y + Math.sin(a) * 3)); ctx.stroke(); ctx.setLineDash([]);
      });
    }
    G.trails.forEach((t) => drawTrail(t.pts, TCOL[t.team], Math.min(1, t.life / 1.2)));
    if (G.preview && !G.over) {
      P.forEach((o, t) => {
        if (!o.prev || !canAct(t)) return;
        ctx.save(); ctx.setLineDash([3, 5]); drawTrail(o.prev, TCOL[t], .45); ctx.restore();
      });
    }
    G.shots.forEach((sh) => {
      drawTrail(sh.trail, TCOL[sh.team], 1);
      const p = sh.pos(); const x = wx(p[0]), y = wy(p[1]);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 10); g.addColorStop(0, '#fff'); g.addColorStop(.4, TCOL[sh.team]); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fill();
    });
    G.soldiers.forEach((s) => drawSoldier(s, !G.over && s.alive && G.teams[s.team][G.sel[s.team]] === s && canAct(s.team) && (G.rt || G.kind === 'campaign' || G.turnTeam === s.team)));
    G.parts.forEach((p) => {
      const x = wx(p.x), y = wy(p.y), k = Math.max(0, p.life / p.max);
      if (p.ring) { ctx.strokeStyle = `rgba(255,140,40,${k})`; ctx.lineWidth = 4 * k; ctx.beginPath(); ctx.arc(x, y, (p.small ? 12 : 34) * (1 - k) + 4, 0, 7); ctx.stroke(); }
      else { ctx.globalAlpha = k; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(x, y, 2 + 3 * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    });
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (G && $('#menu').classList.contains('hidden')) update(dt);
    if (G) refreshUI();
    draw();
    requestAnimationFrame(loop);
  }

  // ===== 盤面クリックで兵士選択 =====
  canvas.addEventListener('pointerdown', (e) => {
    if (!G || G.over || !(G.rt || G.kind === 'campaign')) return;
    const r = canvas.getBoundingClientRect();
    const x = XMIN + ((e.clientX - r.left) / r.width) * (XMAX - XMIN), y = YMAX - ((e.clientY - r.top) / r.height) * (YMAX - YMIN);
    for (let t = 0; t < (G.kind === 'campaign' ? 1 : 2); t++) {
      const i = G.teams[t].findIndex((s) => s.alive && Math.hypot(s.x - x, s.y - y) < 1.4);
      if (i >= 0) { G.sel[t] = i; P[t].input.focus(); return; }
    }
  });

  // ===== メニュー =====
  const cfg = { rt: 'turn', fm: 'plain', n: 3, obs: 14, time: 60, cd: 6, unl: false, pierce: 'none' };
  function seg(id, key) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.onclick = () => {
      document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); cfg[key] = key === 'obs' ? +b.dataset.v : b.dataset.v;
    });
  }
  seg('opt-rt', 'rt'); seg('opt-fm', 'fm'); seg('opt-obs', 'obs'); seg('opt-pierce', 'pierce');
  $('#opt-n').oninput = (e) => { cfg.n = +e.target.value; $('#n-soldiers-v').textContent = cfg.n; };
  $('#opt-time').oninput = (e) => { cfg.time = +e.target.value; $('#time-v').textContent = cfg.unl ? '無制限' : cfg.time + '秒'; };
  $('#opt-unl').onchange = (e) => { cfg.unl = e.target.checked; $('#opt-time').disabled = cfg.unl; $('#time-v').textContent = cfg.unl ? '無制限' : cfg.time + '秒'; };
  $('#opt-cd').oninput = (e) => { cfg.cd = +e.target.value; $('#cd-v').textContent = cfg.cd + '秒'; };
  $('#opt-prev').onchange = (e) => { cfg.preview = e.target.checked; };
  $('#btn-start').onclick = () => startGame({ kind: 'versus', rt: cfg.rt === 'rt', fm: cfg.fm, n: cfg.n, obs: cfg.obs, time: cfg.unl ? 0 : cfg.time, cd: cfg.cd, preview: !!cfg.preview, pierce: cfg.pierce });
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.add('hidden'));
    $('#tab-' + t.dataset.tab).classList.remove('hidden');
    if (t.dataset.tab === 'campaign') renderStages();
    if (t.dataset.tab === 'saves') renderSaves();
  });
  function renderStages() {
    const el = $('#stage-grid'); el.innerHTML = ''; const pr = getProg();
    STAGES.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'stage-btn' + (i < pr ? ' done' : ''); b.disabled = i > pr;
      b.innerHTML = `${i + 1}<small>${FM_INFO[s.fm].name.split('=')[0].trim()}</small>`; b.title = s.name;
      b.onclick = () => startGame({ kind: 'campaign', stage: i });
      el.appendChild(b);
    });
  }
  // ===== 一時中断・再開・セーブ =====
  const SKEY = 'gw2_saves';
  const getSaves = () => { try { return JSON.parse(localStorage.getItem(SKEY) || '[]'); } catch (e) { return []; } };
  const putSaves = (a) => localStorage.setItem(SKEY, JSON.stringify(a));
  const canResume = () => G && !G.bg && !G.over;
  const stamp = (ts) => { const d = new Date(ts), p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const modeText = (c) => c.kind === 'campaign' ? `キャンペーン Stage ${c.stage + 1}` : `${c.rt ? 'リアルタイム' : 'ターン制'} / ${FM_INFO[c.fm].name}`;
  function openMenu() { updateResumeBar(); renderSaves(); $('#menu').classList.remove('hidden'); }
  function resume() { $('#menu').classList.add('hidden'); const o = P.find((p) => !p.input.disabled); if (o) setTimeout(() => o.input.focus(), 30); }
  function updateResumeBar() {
    const on = canResume();
    $('#resume-bar').classList.toggle('hidden', !on);
    if (on) { $('#save-name').value = ''; $('#save-name').placeholder = `${modeText(G.cfg)}  ${stamp(Date.now())}`; $('#save-msg').textContent = ''; }
  }
  function snapshot(name) {
    const teams = G.teams.map((l) => l.map((s) => ({ x: s.x, y: s.y, team: s.team, name: s.name, alive: s.alive, cd: s.cd, target: s.target, expr: s.expr, angle: s.angle })));
    return { name, ts: Date.now(), cfg: G.cfg, terrain: terrain.c.toDataURL(), snap: { teams, sel: G.sel.slice(), turnTeam: G.turnTeam, phase: G.phase, timer: G.timer, shotsLeft: G.shotsLeft, time: G.time } };
  }
  function loadSave(sv) {
    const img = new Image();
    img.onload = () => { terrain.clear(); terrain.ctx.drawImage(img, 0, 0); terrain.refresh(); startGame(sv.cfg, sv.snap); };
    img.src = sv.terrain;
  }
  function renderSaves() {
    const el = $('#save-list'), list = getSaves().sort((a, b) => b.ts - a.ts);
    el.innerHTML = list.length ? '' : '<p class="empty">セーブデータはありません。プレイ中に「← メニュー」からセーブできます。</p>';
    list.forEach((sv) => {
      const row = document.createElement('div'); row.className = 'save-row';
      const info = document.createElement('div'); info.className = 'save-info';
      const nm = document.createElement('b'); nm.textContent = sv.name;
      const meta = document.createElement('small'); meta.textContent = `${modeText(sv.cfg)} · ${stamp(sv.ts)}`;
      info.append(nm, meta);
      const ld = document.createElement('button'); ld.className = 'btn primary'; ld.textContent = 'ロード'; ld.onclick = () => loadSave(sv);
      const del = document.createElement('button'); del.className = 'btn'; del.textContent = '削除';
      del.onclick = () => { if (confirm(`「${sv.name}」を削除しますか？`)) { putSaves(getSaves().filter((x) => x.ts !== sv.ts)); renderSaves(); } };
      row.append(info, ld, del); el.appendChild(row);
    });
  }
  $('#btn-resume').onclick = resume;
  $('#btn-save').onclick = () => {
    if (!canResume()) return;
    const name = $('#save-name').value.trim() || $('#save-name').placeholder;
    try {
      const arr = getSaves().filter((x) => x.name !== name);
      arr.push(snapshot(name)); putSaves(arr);
      $('#save-msg').textContent = `「${name}」を保存しました`; renderSaves();
    } catch (e) { $('#save-msg').textContent = '保存に失敗しました（容量不足）'; }
  };
  $('#btn-menu').onclick = openMenu;
  $('#btn-tomenu').onclick = () => { $('#result').classList.add('hidden'); openMenu(); };
  $('#btn-again').onclick = () => startGame(lastCfg);
  $('#btn-next').onclick = () => startGame({ kind: 'campaign', stage: lastCfg.stage + 1 });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !G) return;
    if ($('#menu').classList.contains('hidden')) openMenu(); else if (canResume()) resume();
  });

  renderStages();
  // 背景に待機用の盤面を作る
  startGame({ kind: 'versus', rt: false, fm: 'plain', n: 3, obs: 14, time: 60, cd: 6 }, null, true);
  // ビューポートに合わせて盤面をフィット
  function fit() {
    const st = $('#stage'), w = st.clientWidth, h = st.clientHeight;
    const cw = Math.min(w, h * 5 / 3);
    canvas.style.width = cw + 'px'; canvas.style.height = cw * 3 / 5 + 'px';
  }
  window.addEventListener('resize', fit); new ResizeObserver(fit).observe($('#stage')); fit(); setTimeout(fit, 100);
  $('#menu').classList.remove('hidden');
  requestAnimationFrame(loop);
  window.__gw = { startGame, get G() { return G; }, tryFire };
})();
