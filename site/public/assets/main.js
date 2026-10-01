(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  if (!window.gsap || !window.ScrollTrigger) return; // content stays fully visible without JS
  gsap.registerPlugin(ScrollTrigger);

  // progress bar (works with or without smooth scroll)
  const bar = $('.progress i');
  const setBar = () => { const h = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`; };
  addEventListener('scroll', setBar, { passive: true }); setBar();
  if (reduce) return;

  // smooth scroll
  if (window.Lenis) {
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
      const t = $(a.getAttribute('href')); if (!t) return;
      e.preventDefault(); lenis.scrollTo(t, { offset: 0, duration: 1.4 });
    }));
  }

  // hero intro
  gsap.from('.hero .line-in', { yPercent: 115, rotate: 3, duration: 1.3, ease: 'power4.out', stagger: 0.12, delay: 0.1 });
  gsap.from('.hero .kicker,.hero-foot > *', { y: 24, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.1, delay: 0.7 });
  gsap.from('.hero-photo', { yPercent: 12, opacity: 0, scale: 0.94, duration: 1.4, ease: 'power4.out', delay: 0.35 });
  gsap.to('.hero-photo img', { yPercent: 8, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.from('.about-photo img', { scale: 1.25, ease: 'none', scrollTrigger: { trigger: '.about', start: 'top bottom', end: 'center center', scrub: true } });
  gsap.from('.top', { y: -30, opacity: 0, duration: 1, delay: 0.5, ease: 'power3.out' });
  gsap.to('.hero h1', { yPercent: -12, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.glow', { yPercent: 25, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });

  // ticker speeds up with scroll velocity
  const tk = $('.ticker-in');
  if (tk) ScrollTrigger.create({ trigger: '.ticker', start: 'top bottom', end: 'bottom top', onUpdate: (self) => { tk.style.animationDuration = Math.max(10, 40 - Math.abs(self.getVelocity()) / 120) + 's'; } });

  // manifest: words light up while scrolling
  const w = $$('.big .w');
  if (w.length) gsap.to(w, { opacity: 1, ease: 'none', stagger: 0.5, scrollTrigger: { trigger: '.manifest', start: 'top 70%', end: 'bottom 55%', scrub: 0.6 } });

  // projects: pinned horizontal guided scroll on desktop
  const mm = gsap.matchMedia();
  mm.add('(min-width: 901px)', () => {
    const track = $('.track'), pin = $('.work-pin');
    const dist = () => Math.max(0, track.scrollWidth - innerWidth + 0);
    const tween = gsap.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: pin, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1 } });
    $$('.card').forEach((c) => {
      gsap.from(c.querySelector('.card-art span'), { xPercent: -30, rotate: -10, ease: 'none', scrollTrigger: { trigger: c, containerAnimation: tween, start: 'left 95%', end: 'left 20%', scrub: true } });
    });
    gsap.from('.work-head > *', { y: 40, opacity: 0, stagger: 0.1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: pin, start: 'top 70%' } });
  });
  mm.add('(max-width: 900px)', () => {
    $$('.card').forEach((c) => gsap.from(c, { y: 60, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: c, start: 'top 88%' } }));
  });

  // generic reveals
  $$('.reveal').forEach((el) => gsap.from(el, { y: 50, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } }));
  $$('.disc').forEach((el, i) => gsap.from(el, { delay: i * 0.08 }));

  // contact line reveal
  gsap.from('.contact .line-in', { yPercent: 110, duration: 1.2, ease: 'power4.out', stagger: 0.12, scrollTrigger: { trigger: '.contact', start: 'top 65%' } });

  // custom cursor
  const cur = $('.cursor');
  if (cur && matchMedia('(hover:hover) and (pointer:fine)').matches) {
    const label = $('span', cur);
    const xTo = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'power3' }), yTo = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'power3' });
    addEventListener('pointermove', (e) => { xTo(e.clientX); yTo(e.clientY); });
    $$('[data-cursor]').forEach((el) => {
      el.addEventListener('pointerenter', () => { label.textContent = el.dataset.cursor; cur.classList.add('big'); });
      el.addEventListener('pointerleave', () => { label.textContent = ''; cur.classList.remove('big'); });
    });
    // hero glow follows pointer
    const g = $('.glow');
    addEventListener('pointermove', (e) => { gsap.to(g, { x: (e.clientX / innerWidth - 0.5) * 120, duration: 1.2, ease: 'power2.out' }); });
  }
  addEventListener('load', () => ScrollTrigger.refresh());
})();

// ASCII hero field: flowing density waves rendered as monospace characters. Cheap: one fillText per row, paused offscreen.
(() => {
  const cv = document.querySelector('.ascii'); if (!cv) return;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ramp = ' .·:-=+*#%@';
  let W = 0, H = 0, cols = 0, rows = 0, cw = 0, ch = 0, dpr = 1, running = false, raf = 0, last = 0;
  const mouse = { x: 0.7, y: 0.4, tx: 0.7, ty: 0.4 };
  function size() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
    const fs = W < 700 ? 11 : 14; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`; ctx.textBaseline = 'top';
    cw = ctx.measureText('M').width; ch = fs * 1.15; cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
  }
  function frame(t) {
    mouse.x += (mouse.tx - mouse.x) * 0.06; mouse.y += (mouse.ty - mouse.y) * 0.06;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#ff5b2e';
    const s = t * 0.00035;
    for (let y = 0; y < rows; y++) {
      let line = '';
      const ny = y / rows;
      for (let x = 0; x < cols; x++) {
        const nx = x / cols;
        let v = Math.sin(nx * 7 + s * 3 + Math.sin(ny * 5 - s * 2) * 1.6) + Math.sin(ny * 9 - s * 2.4 + nx * 3) + Math.sin((nx + ny) * 6 + s * 2);
        const dx = (nx - mouse.x) * (W / H), dy = ny - mouse.y;
        v += 2.2 * Math.exp(-(dx * dx + dy * dy) * 9) * Math.sin(Math.sqrt(dx * dx + dy * dy) * 30 - s * 22);
        const d = Math.max(0, Math.min(0.999, (v + 3) / 6.4));
        line += ramp[(d * ramp.length) | 0];
      }
      ctx.fillText(line, 0, y * ch);
    }
  }
  function loop(t) { if (!running) return; if (t - last > 42) { last = t; frame(t); } raf = requestAnimationFrame(loop); }
  function start() { if (running || reduce) return; running = true; raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  size(); frame(2000);
  addEventListener('resize', () => { size(); frame(2000); });
  if (!reduce) {
    new IntersectionObserver((e) => (e[0].isIntersecting ? start() : stop())).observe(cv);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); mouse.tx = (e.clientX - r.left) / r.width; mouse.ty = (e.clientY - r.top) / r.height; }, { passive: true });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { size(); frame(2000); });
})();

// Secret: type "tetris" or the Konami code (or tap the PP logo 7x). No hint in the UI, no tracking.
(() => {
  const seq = []; const KON = 'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,b,a';
  let word = '', open = false;
  const de = document.documentElement.lang === 'de';
  addEventListener('keydown', (e) => {
    if (open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    word = (word + (k.length === 1 ? k : '')).slice(-6);
    seq.push(k); if (seq.length > 10) seq.shift();
    if (word === 'tetris' || seq.join() === KON) { word = ''; seq.length = 0; launch(); }
  });
  const brand = document.querySelector('.brand'); let taps = 0, tt = 0;
  brand && brand.addEventListener('click', (e) => {
    const n = Date.now(); taps = n - tt < 700 ? taps + 1 : 1; tt = n;
    if (taps >= 7) { taps = 0; e.preventDefault(); launch(); }
  });

  function launch() {
    if (open) return; open = true;
    const W = 10, H = 20;
    const SH = [[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[0,1,1],[1,1,0]],[[1,1,0],[0,1,1]]];
    const root = document.createElement('div');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Secret: ASCII Tetris');
    root.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(8,8,9,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:"JetBrains Mono",ui-monospace,monospace;color:#efeae2;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);touch-action:none;overscroll-behavior:contain';
    root.innerHTML = '<pre id="tt" style="margin:0;font-size:min(3.4vh,22px,6vw);line-height:1.15;color:#ff5b2e;text-shadow:0 0 14px rgba(255,91,46,.45)"></pre>' +
      '<div id="tth" style="font-size:12px;letter-spacing:.08em;color:#8d8a84;text-align:center;text-transform:uppercase"></div>' +
      '<div id="ttc" style="display:flex;gap:10px"></div>' +
      '<a href="https://github.com/philppplik/claude-tetris" target="_blank" rel="noopener" style="font-size:12px;color:#c8ff3d;letter-spacing:.06em">github.com/philppplik/claude-tetris ↗</a>';
    document.body.appendChild(root);
    const prevOv = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
    const pre = root.querySelector('#tt');
    root.querySelector('#tth').textContent = de ? 'Pfeile / WASD · Leertaste = Drop · P Pause · Esc schliessen' : 'Arrows / WASD · Space = drop · P pause · Esc close';
    const ctl = root.querySelector('#ttc');
    const btn = (l, f) => { const b = document.createElement('button'); b.textContent = l; b.setAttribute('aria-label', l);
      b.style.cssText = 'font:inherit;font-size:20px;color:#efeae2;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);border-radius:12px;width:54px;height:54px'; b.addEventListener('pointerdown', (e) => { e.preventDefault(); f(); }); ctl.appendChild(b); };
    let grid, cur, x, y, score, lines, over, paused, acc, last, raf;
    const rot = (m) => m[0].map((_, i) => m.map((r) => r[i]).reverse());
    const hit = (m, px, py) => m.some((r, j) => r.some((v, i) => v && (px + i < 0 || px + i >= W || py + j >= H || (py + j >= 0 && grid[py + j][px + i]))));
    const spawn = () => { cur = SH[(Math.random() * 7) | 0]; x = ((W - cur[0].length) / 2) | 0; y = 0; if (hit(cur, x, y)) over = true; };
    const reset = () => { grid = Array.from({ length: H }, () => Array(W).fill(0)); score = 0; lines = 0; over = false; paused = false; acc = 0; spawn(); };
    const lock = () => {
      cur.forEach((r, j) => r.forEach((v, i) => { if (v && y + j >= 0) grid[y + j][x + i] = 1; }));
      let c = 0; for (let j = H - 1; j >= 0; j--) if (grid[j].every(Boolean)) { grid.splice(j, 1); grid.unshift(Array(W).fill(0)); c++; j++; }
      lines += c; score += [0, 100, 300, 500, 800][c]; spawn();
    };
    const move = (d) => { if (!over && !paused && !hit(cur, x + d, y)) x += d; draw(); };
    const down = () => { if (over || paused) return; if (!hit(cur, x, y + 1)) y++; else lock(); draw(); };
    const turn = () => { if (over || paused) return; const r = rot(cur); for (const k of [0, -1, 1, -2, 2]) if (!hit(r, x + k, y)) { cur = r; x += k; break; } draw(); };
    const drop = () => { if (over || paused) return; while (!hit(cur, x, y + 1)) y++; lock(); draw(); };
    function draw() {
      const g = grid.map((r) => r.slice());
      if (!over) cur.forEach((r, j) => r.forEach((v, i) => { if (v && y + j >= 0) g[y + j][x + i] = 2; }));
      const nar = innerWidth < 640; const side = (j, t) => (nar ? '' : '   ' + t);
      let s = '┌' + '──'.repeat(W) + '┐' + side(0, 'CLAUDE TETRIS') + '\n';
      g.forEach((r, j) => { s += '│' + r.map((v) => (v ? '[]' : ' .')).join('') + '│' + (j === 2 ? side(j, (de ? 'PUNKTE ' : 'SCORE ') + score) : j === 3 ? side(j, (de ? 'LINIEN ' : 'LINES ') + lines) : j === 6 && over ? side(j, 'GAME OVER') : j === 7 && over ? side(j, de ? 'Enter = nochmal' : 'Enter = again') : j === 6 && paused ? side(j, 'PAUSE') : '') + '\n'; });
      pre.textContent = s + '└' + '──'.repeat(W) + '┘' + (nar ? '\n' + (de ? 'PUNKTE ' : 'SCORE ') + score + ' · ' + (de ? 'LINIEN ' : 'LINES ') + lines + (over ? ' · GAME OVER' : paused ? ' · PAUSE' : '') : '');
    }
    function loop(t) { raf = requestAnimationFrame(loop); if (!last) last = t; const dt = t - last; last = t; if (over || paused) return; acc += dt; const sp = Math.max(90, 650 - lines * 30); if (acc > sp) { acc = 0; down(); } }
    btn('◀', () => move(-1)); btn('⟳', turn); btn('▶', () => move(1)); btn('▼', down); btn('⤓', drop);
    function key(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Escape') return close();
      if (['ArrowLeft', 'a'].includes(k)) move(-1); else if (['ArrowRight', 'd'].includes(k)) move(1);
      else if (['ArrowDown', 's'].includes(k)) down(); else if (['ArrowUp', 'w'].includes(k)) turn();
      else if (k === ' ') drop(); else if (k === 'p') { paused = !paused; draw(); } else if (k === 'Enter' && over) { reset(); draw(); } else return;
      e.preventDefault(); e.stopPropagation();
    }
    function close() { cancelAnimationFrame(raf); removeEventListener('keydown', key, true); root.remove(); document.documentElement.style.overflow = prevOv; open = false; }
    root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    let sx = 0, sy = 0; root.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    root.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return; if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1); else if (dy > 0) drop(); else turn(); }, { passive: true });
    const x1 = document.createElement('button'); x1.textContent = '✕'; x1.setAttribute('aria-label', 'Close'); x1.style.cssText = 'position:absolute;top:16px;right:16px;font:inherit;font-size:18px;color:#efeae2;background:none;border:1px solid rgba(255,255,255,.2);border-radius:99px;width:40px;height:40px'; x1.addEventListener('click', close); root.appendChild(x1);
    addEventListener('keydown', key, true);
    reset(); draw(); raf = requestAnimationFrame(loop);
  }
})();
