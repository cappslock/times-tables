(() => {
  'use strict';

  // ---------- config ----------
  const N = 10;
  const MIN = 60e3, DAY = 864e5;
  // Spaced-repetition intervals: how long a square stays "fresh" at each level.
  const INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
  const LAPSE_DELAY = 45e3;       // a missed review comes back after ~45s
  const REVIEW_CHANCE = 0.3;      // share of cards that are due reviews while new ones remain
  const STEPS = ['×1, ×2, ×5, ×10', '×9', 'squares', '×3, ×4', '×6, ×7, ×8'];
  const FACTOR_STEP = { 1: 0, 2: 0, 5: 0, 10: 0, 9: 1, 3: 3, 4: 3, 6: 4, 7: 4, 8: 4 };
  const STORE = 'times-table-flash-cards-v1';

  const stepOf = (a, b) => {
    let s = Math.min(FACTOR_STEP[a], FACTOR_STEP[b]);
    if (a === b && s > 2) s = 2;
    return s;
  };
  const key = (a, b) => (a <= b ? `${a},${b}` : `${b},${a}`);
  const range = () => Array.from({ length: N }, (_, i) => i + 1);
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const now = () => Date.now();

  // ---------- state ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.facts) return s;
    } catch (e) { /* storage unavailable */ }
    return { facts: {}, muted: false, finaleShown: false };
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  let state = load();

  const fact = (a, b) => state.facts[key(a, b)];
  const isSolved = (a, b) => !!fact(a, b);
  const solvedCells = () => {
    let n = 0;
    for (const a of range()) for (const b of range()) if (isSolved(a, b)) n++;
    return n;
  };
  const lineDone = (n) => range().every((b) => isSolved(n, b));
  const doneLines = () => range().filter(lineDone);

  // 1 = just learned, 0 = due for review
  function freshness(f, t = now()) {
    if (f.lapsed) return 0;
    const span = f.due - f.last;
    return Math.max(0, Math.min(1, (f.due - t) / span));
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const gridEl = $('grid'), cardEl = $('card'), answerEl = $('answer'), msgEl = $('card-msg');
  const tagEl = $('card-tag'), focusExitEl = $('focus-exit');
  const cells = {}; // "r,c" -> element

  function buildGrid() {
    for (let r = 0; r <= N; r++) {
      for (let c = 0; c <= N; c++) {
        const el = document.createElement('button');
        el.className = 'cell';
        el.dataset.r = r; el.dataset.c = c;
        if (r === 0 && c === 0) { el.classList.add('header', 'corner'); el.textContent = '×'; el.tabIndex = -1; }
        else if (r === 0 || c === 0) { el.classList.add('header'); el.textContent = r || c; el.setAttribute('aria-label', `Practise the ${r || c}s`); }
        gridEl.appendChild(el);
        cells[`${r},${c}`] = el;
      }
    }
    gridEl.addEventListener('click', (e) => {
      const el = e.target.closest('.cell');
      if (!el || locked) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      if (r === 0 && c === 0) return;
      if (r === 0 || c === 0) return startFocus(r || c);
      if (card && card.a === r && card.b === c) return;
      focus = null;
      showCard(r, c, isSolved(r, c) ? 'review' : 'pick');
    });
  }

  // ---------- game flow ----------
  let card = null;      // {a, b, kind, misses, revealed}
  let focus = null;     // {n, list, i}
  let input = '';
  let locked = false;
  let hintCells = [];
  let pendingMsg = '';

  function currentStep() {
    for (let s = 0; s < STEPS.length; s++) {
      for (const a of range()) for (const b of range()) if (!isSolved(a, b) && stepOf(a, b) === s) return s;
    }
    return -1;
  }

  function pickNext() {
    if (focus) {
      focus.i++;
      if (focus.i < focus.list.length) {
        const b = focus.list[focus.i];
        return { a: focus.n, b, kind: isSolved(focus.n, b) ? 'review' : 'focus' };
      }
      pendingMsg = `You finished the ${focus.n}s!`;
      focus = null;
    }

    const t = now();
    const curKey = card ? key(card.a, card.b) : null;
    const facts = Object.entries(state.facts).filter(([k]) => k !== curKey);
    const due = facts.filter(([, f]) => f.due <= t).sort((x, y) => x[1].due - y[1].due);
    const step = currentStep();
    const unsolved = [];
    if (step >= 0) {
      for (const a of range()) for (const b of range()) {
        if (!isSolved(a, b) && stepOf(a, b) === step && key(a, b) !== curKey) unsolved.push([a, b]);
      }
    }

    const fromKey = (k, kind) => {
      let [a, b] = k.split(',').map(Number);
      if (Math.random() < 0.5) [a, b] = [b, a];
      return { a, b, kind };
    };

    const lapsed = due.filter(([, f]) => f.lapsed);
    if (lapsed.length) return fromKey(lapsed[0][0], 'review');
    if (due.length && (!unsolved.length || Math.random() < REVIEW_CHANCE)) return fromKey(due[0][0], 'review');
    if (unsolved.length) { const [a, b] = rand(unsolved); return { a, b, kind: 'new' }; }
    if (step >= 0 && card) return { a: card.a, b: card.b, kind: 'new' }; // only the current one is left
    // Everything solved and nothing due: practise the most-faded square.
    if (facts.length) {
      facts.sort((x, y) => freshness(x[1], t) - freshness(y[1], t));
      return fromKey(facts[0][0], 'practice');
    }
    return null;
  }

  function nextCard() {
    const n = pickNext();
    if (n) showCard(n.a, n.b, n.kind);
  }

  function showCard(a, b, kind) {
    card = { a, b, kind, misses: 0, revealed: false };
    input = '';
    clearHint();
    $('card-a').textContent = a;
    $('card-b').textContent = b;
    answerEl.textContent = '';
    say(pendingMsg, pendingMsg && 'good');
    pendingMsg = '';
    const tags = { new: '', pick: '', review: 'Remember this one?', practice: 'Practice', focus: '' };
    tagEl.textContent = focus ? `The ${focus.n}s, in order` : (tags[kind] || '');
    focusExitEl.hidden = !focus;
    render();
  }

  function startFocus(n) {
    const unsolved = range().filter((b) => !isSolved(n, b));
    focus = { n, list: unsolved.length ? unsolved : range(), i: 0 };
    const b = focus.list[0];
    showCard(n, b, isSolved(n, b) ? 'review' : 'focus');
    if (!unsolved.length) say(`The ${n}s are all filled. Let's run through them!`, 'good');
  }

  focusExitEl.addEventListener('click', () => { focus = null; nextCard(); });

  // ---------- answering ----------
  function press(k) {
    if (locked || !card) return;
    audio.unlock();
    if (card.revealed) { if (k === 'enter') nextCard(); return; }
    if (k === 'back') input = input.slice(0, -1);
    else if (k === 'enter') return check();
    else if (input.length < 3) input = (input === '0' ? '' : input) + k;
    answerEl.textContent = input;
  }

  function check() {
    if (!input) return;
    const { a, b } = card;
    const right = +input === a * b;
    const t = now();
    if (right) return onCorrect(t);

    card.misses++;
    audio.oops();
    cardEl.classList.remove('shake'); void cardEl.offsetWidth; cardEl.classList.add('shake');
    const f = fact(a, b);
    if (f && !f.lapsed) {
      // Forgot a solved square: it fades and comes back soon.
      f.lvl = 0; f.lapsed = true; f.last = t; f.due = t + LAPSE_DELAY;
      save(); render();
    }
    if (card.misses >= 2) {
      card.revealed = true;
      answerEl.textContent = a * b;
      say(`It's ${a * b}. We'll come back to it! Press Check for the next one.`, 'oops');
    } else {
      input = ''; answerEl.textContent = '';
      say(hintText(a, b) ? 'Not quite. Try again, or tap 💡 Hint.' : 'Not quite. Try again!', 'oops');
    }
  }

  function onCorrect(t) {
    const { a, b } = card;
    const before = doneLines();
    const f = fact(a, b);
    let msg;
    if (!f) {
      state.facts[key(a, b)] = { lvl: 0, last: t, due: t + INTERVALS[0] };
      msg = a === b ? `${a * b}!` : `${a * b}! And ${b} × ${a} too.`;
    } else {
      if (f.lapsed) { f.lapsed = false; f.lvl = 0; }
      else if (t >= f.due && card.misses === 0) f.lvl = Math.min(f.lvl + 1, INTERVALS.length - 1);
      f.last = t; f.due = t + INTERVALS[f.lvl];
      msg = card.misses ? `${a * b}! Got it.` : `${a * b}! You remembered.`;
    }
    save();

    locked = true;
    card.done = true;
    clearHint();
    say(msg, 'good');
    cardEl.classList.remove('correct'); void cardEl.offsetWidth; cardEl.classList.add('correct');
    render();

    const filled = [[a, b], [b, a]];
    filled.forEach(([r, c]) => restart(cells[`${r},${c}`], 'fresh'));
    sparkle(cells[`${a},${b}`]);
    audio.pop();

    const newLines = doneLines().filter((n) => !before.includes(n));
    let wait = 900;
    if (newLines.length) {
      wait = 1900;
      setTimeout(() => celebrateLines(newLines), 350);
    }
    if (solvedCells() === N * N && !state.finaleShown) {
      state.finaleShown = true; save();
      setTimeout(finale, wait);
      return;
    }
    setTimeout(() => { locked = false; nextCard(); }, wait);
  }

  // ---------- hints ----------
  function hintParts(a, b) {
    // Split one factor into two parts whose facts are already solved.
    const prefs = [5, 2, 10, 1, 3, 4, 6, 7, 8, 9];
    for (const [x, y] of [[a, b], [b, a]]) {
      for (const p of prefs) {
        const q = y - p;
        if (p < y && q >= 1 && isSolved(x, p) && isSolved(x, q)) return { x, p, q, op: '+' };
      }
      if (y > 5 && y < 10 && isSolved(x, 10) && isSolved(x, 10 - y)) return { x, p: 10, q: 10 - y, op: '-' };
    }
    return null;
  }
  function hintText(a, b) {
    if (a === 1 || b === 1) return `1 times a number is just that number.`;
    if (a === 10 || b === 10) return `Times 10: put a 0 on the end.`;
    const h = hintParts(a, b);
    if (h) {
      const { x, p, q, op } = h;
      return op === '+'
        ? `${x} × ${p} = ${x * p}, and ${x} × ${q} = ${x * q}. Add them!`
        : `${x} × 10 = ${x * 10}. Take away ${x} × ${q} = ${x * q}.`;
    }
    const by = Math.max(a, b), times = Math.min(a, b);
    return `Count by ${by}s, ${times} times: ${Array.from({ length: Math.min(times, 3) }, (_, i) => by * (i + 1)).join(', ')}…`;
  }
  function showHint() {
    if (!card || locked || card.revealed) return;
    audio.unlock();
    clearHint();
    const { a, b } = card;
    say('💡 ' + hintText(a, b));
    const h = hintParts(a, b);
    if (h && !(a === 1 || b === 1 || a === 10 || b === 10)) {
      const xIsRow = h.x === a;
      hintCells = [h.p, h.q].map((v) => (xIsRow ? cells[`${a},${v}`] : cells[`${v},${b}`]));
      hintCells.forEach((el) => el.classList.add('hint'));
    }
  }
  function clearHint() { hintCells.forEach((el) => el.classList.remove('hint')); hintCells = []; }

  // ---------- rendering ----------
  function render() {
    const t = now();
    for (let r = 1; r <= N; r++) {
      for (let c = 1; c <= N; c++) {
        const el = cells[`${r},${c}`];
        const f = fact(r, c);
        const isTarget = card && !card.done && card.a === r && card.b === c;
        const onPath = card && !card.done && ((r === card.a && c < card.b) || (c === card.b && r < card.a));
        el.classList.toggle('solved', !!f && !isTarget);
        el.classList.toggle('empty', !f && !isTarget);
        el.classList.toggle('target', !!isTarget);
        el.classList.toggle('path', !!onPath);
        el.classList.toggle('dim', !!f && f.lapsed && !isTarget);
        el.textContent = f && !isTarget ? r * c : '';
        el.style.opacity = f && !isTarget && !onPath && !f.lapsed ? (0.45 + 0.55 * freshness(f, t)).toFixed(2) : '';
        el.setAttribute('aria-label', f ? `${r} times ${c} is ${r * c}` : `${r} times ${c}, empty`);
      }
    }
    for (let n = 1; n <= N; n++) {
      cells[`0,${n}`].classList.toggle('path', !!card && !card.done && card.b === n);
      cells[`${n},0`].classList.toggle('path', !!card && !card.done && card.a === n);
      cells[`0,${n}`].classList.toggle('focus', !!focus && focus.n === n);
      cells[`${n},0`].classList.toggle('focus', !!focus && focus.n === n);
    }
    const count = solvedCells();
    $('progress-count').textContent = count;
    $('progress-fill').style.width = `${count}%`;
    const step = currentStep();
    $('step-label').textContent = step >= 0 ? `Now learning: ${STEPS[step]}` : 'Every square filled. Keep them bright!';
    $('mute-btn').textContent = state.muted ? '🔇' : '🔊';
  }

  function say(text, tone) {
    msgEl.textContent = text;
    msgEl.className = 'card-msg' + (tone ? ' ' + tone : '');
  }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  // ---------- celebrations ----------
  const canvas = $('fx');
  const ctx = canvas.getContext('2d');
  let parts = [], rockets = [], fxRunning = false;
  const COLORS = ['#ff5d73', '#ffd23f', '#3bb273', '#4d9de0', '#b07cff', '#ff9f43'];

  function resize() {
    const d = window.devicePixelRatio || 1;
    canvas.width = innerWidth * d; canvas.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  addEventListener('resize', resize);
  resize();

  function runFx() {
    if (fxRunning) return;
    fxRunning = true;
    let last = performance.now();
    const tick = (ts) => {
      const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      rockets = rockets.filter((r) => {
        r.y += r.vy * dt; r.vy += 260 * dt;
        ctx.fillStyle = '#fff'; ctx.fillRect(r.x - 1.5, r.y, 3, 8);
        if (r.vy >= -40) { burst(r.x, r.y, 70, 260, r.color); return false; }
        return true;
      });
      parts = parts.filter((p) => {
        p.life -= dt;
        if (p.life <= 0) return false;
        p.vy += p.g * dt; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life / p.fade);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else if (p.shape === 'star') star(p.size);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        return true;
      });
      if (parts.length || rockets.length) requestAnimationFrame(tick);
      else { fxRunning = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    };
    requestAnimationFrame(tick);
  }
  function star(s) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? s / 4 : s / 2, ang = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    ctx.closePath(); ctx.fill();
  }

  function sparkle(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2, sp = 90 + Math.random() * 90;
      parts.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0, drag: 0.94, life: 0.7, fade: 0.4,
        size: 7 + Math.random() * 5, rot: 0, vr: 4, shape: 'star', color: rand(['#ffd23f', '#ff9f43', '#fff1a8']) });
    }
    runFx();
  }

  function confetti() {
    for (let i = 0; i < 180; i++) {
      parts.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.4,
        vx: (Math.random() - 0.5) * 160, vy: 80 + Math.random() * 160, g: 220, drag: 0.99,
        life: 3 + Math.random(), fade: 0.8, size: 8 + Math.random() * 8, rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12, shape: 'rect', color: rand(COLORS) });
    }
    runFx();
  }

  function burst(x, y, n, speed, color) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6);
      parts.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 120, drag: 0.97, life: 1.4 + Math.random() * 0.6,
        fade: 0.8, size: 4 + Math.random() * 3, rot: 0, vr: 0, shape: 'dot', color: Math.random() < 0.7 ? color : '#fff' });
    }
  }

  function fireworks(seconds) {
    const end = performance.now() + seconds * 1000;
    const launch = () => {
      if (performance.now() > end) return;
      rockets.push({ x: innerWidth * (0.15 + Math.random() * 0.7), y: innerHeight, vy: -(innerHeight * 0.9 + Math.random() * 200), color: rand(COLORS) });
      if (Math.random() < 0.3) audio.boom();
      runFx();
      setTimeout(launch, 250 + Math.random() * 350);
    };
    launch();
  }

  function celebrateLines(lines) {
    const names = lines.map((n) => `${n}s`);
    const label = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    banner(`The ${label} are done! 🎉`);
    for (const n of lines) {
      for (let i = 1; i <= N; i++) {
        restart(cells[`${n},${i}`], 'glow');
        restart(cells[`${i},${n}`], 'glow');
      }
    }
    confetti();
    audio.chime();
  }

  let bannerTimer;
  function banner(text) {
    const el = $('banner');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function finale() {
    $('finale').hidden = false;
    fireworks(8);
    confetti();
    audio.fanfare();
  }

  // ---------- sound ----------
  const audio = (() => {
    let ac = null;
    const ok = () => !state.muted && ac;
    function unlock() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
    }
    function tone(freq, at, dur, type = 'sine', vol = 0.18, slideTo) {
      const t0 = ac.currentTime + at;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
    return {
      unlock,
      pop() { if (ok()) { tone(660, 0, 0.12, 'triangle', 0.2, 1320); tone(1320, 0.08, 0.15, 'sine', 0.08); } },
      oops() { if (ok()) tone(220, 0, 0.25, 'sine', 0.12, 160); },
      chime() { if (ok()) [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.4, 'triangle', 0.16)); },
      boom() { if (ok()) tone(120, 0, 0.5, 'sine', 0.2, 40); },
      fanfare() {
        if (!ok()) return;
        const seq = [[523, 0], [523, .15], [523, .3], [659, .45], [784, .75], [659, 1.0], [784, 1.15], [1047, 1.4]];
        seq.forEach(([f, t]) => { tone(f, t, 0.35, 'square', 0.07); tone(f / 2, t, 0.35, 'triangle', 0.1); });
      },
    };
  })();

  // ---------- wiring ----------
  $('keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) press(b.dataset.key);
  });
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') { e.preventDefault(); press('enter'); }
  });
  $('skip-btn').addEventListener('click', () => { if (!locked) { audio.unlock(); focus = null; nextCard(); } });
  $('hint-btn').addEventListener('click', showHint);
  $('mute-btn').addEventListener('click', () => { state.muted = !state.muted; save(); audio.unlock(); render(); });
  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Start over? This clears every filled square.')) return;
    state = { facts: {}, muted: state.muted, finaleShown: false };
    save(); focus = null; card = null; nextCard();
  });
  $('keep-btn').addEventListener('click', () => {
    $('finale').hidden = true;
    locked = false; nextCard();
  });
  $('again-btn').addEventListener('click', () => {
    $('finale').hidden = true;
    state = { facts: {}, muted: state.muted, finaleShown: false };
    save(); focus = null; card = null; locked = false; nextCard();
  });

  // Squares slowly fade as they come due; repaint every minute.
  setInterval(() => { if (!locked) render(); }, 60e3);

  buildGrid();
  nextCard();
})();
