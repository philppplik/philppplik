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
