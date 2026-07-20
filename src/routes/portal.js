(function initPortal(globalScope) {
  'use strict';

  function resolveMotionMode({ hasGsap, reduceMotion, desktop }) {
    if (!hasGsap || reduceMotion) return 'static';
    return desktop ? 'immersive' : 'light';
  }

  function getLegacyGameRedirect(urlLike) {
    const url = new URL(urlLike, 'https://hyl.space/');
    const isGameRoute = url.searchParams.get('view') === 'games'
      || url.searchParams.has('game')
      || url.searchParams.has('room');
    if (!isGameRoute) return null;

    const target = new URL('/game/', url.origin);
    url.searchParams.forEach((value, key) => {
      if (key !== 'view') target.searchParams.append(key, value);
    });
    return target.toString();
  }

  function getPortalItemState(item = {}) {
    return {
      interactive: Boolean(item.href),
      status: item.status || (item.href ? '打开' : '内容整理中'),
    };
  }

  function shouldCloseMenuOnOutsideClick({ open, target, menu, menuButton }) {
    return Boolean(open && !menu.contains(target) && !menuButton.contains(target));
  }

  let motionMedia = null;
  let pointerCleanup = null;
  let ambientCleanup = null;

  const PORTAL_THEMES = {
    tools: 'blue',
    works: 'purple',
    updates: 'blend',
  };

  function renderPortalList(container, items, section) {
    if (!container) return;
    const fragment = document.createDocumentFragment();

    items.forEach((item) => {
      const state = getPortalItemState(item);
      const element = document.createElement(state.interactive ? 'a' : 'article');
      element.className = `portal-entry portal-entry-${section}`;
      element.dataset.appleCard = '';
      element.dataset.appleReveal = '';
      element.dataset.appleListItem = '';
      element.dataset.appleTheme = PORTAL_THEMES[section] || 'blend';
      if (state.interactive) {
        element.href = item.href;
      } else {
        element.classList.add('is-pending');
      }

      const copy = document.createElement('span');
      copy.className = 'portal-entry-copy';
      const title = document.createElement('strong');
      title.textContent = item.title;
      copy.append(title);

      const meta = document.createElement('span');
      meta.className = 'portal-entry-meta';
      const dot = document.createElement('span');
      dot.className = 'tool-dot';
      dot.dataset.state = state.interactive ? 'ready' : 'pending';
      dot.setAttribute('aria-hidden', 'true');
      meta.append(dot);
      if (item.date) {
        const time = document.createElement('time');
        time.dateTime = item.date;
        time.textContent = item.date.replaceAll('-', '.');
        meta.append(time);
      }
      const status = document.createElement('span');
      status.textContent = state.status;
      meta.append(status);

      element.append(copy, meta);
      fragment.append(element);
    });

    container.replaceChildren(fragment);
  }

  function renderPortalContent() {
    const content = globalScope.HYLPortalContent;
    if (!content) return;
    renderPortalList(document.querySelector('#portal-tools-list'), content.tools, 'tools');
    renderPortalList(document.querySelector('#portal-works-list'), content.works, 'works');
    renderPortalList(document.querySelector('#portal-updates-list'), content.updates, 'updates');
    globalScope.HYLAppleUI?.refresh(document.querySelector('#portal-home'));
  }

  function deactivate() {
    motionMedia?.revert();
    motionMedia = null;
    pointerCleanup?.();
    pointerCleanup = null;
    ambientCleanup?.();
    ambientCleanup = null;
  }

  function activate() {
    const root = document.querySelector('#portal-home');
    if (!root || root.hidden) return;
    deactivate();

    const gsap = globalScope.gsap;
    const ScrollTrigger = globalScope.ScrollTrigger;
    const reduceMotion = globalScope.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const desktop = globalScope.matchMedia?.('(min-width: 900px)').matches ?? false;
    const mode = resolveMotionMode({
      hasGsap: Boolean(gsap && ScrollTrigger),
      reduceMotion,
      desktop,
    });
    root.dataset.motion = mode;
    if (mode === 'static') return;

    gsap.registerPlugin(ScrollTrigger);
    motionMedia = gsap.matchMedia();
    motionMedia.add({
      desktop: '(min-width: 900px)',
      mobile: '(max-width: 899px)',
      reduceMotion: '(prefers-reduced-motion: reduce)',
    }, (context) => {
      const currentMode = resolveMotionMode({
        hasGsap: true,
        reduceMotion: context.conditions.reduceMotion,
        desktop: context.conditions.desktop,
      });
      root.dataset.motion = currentMode;
      if (currentMode === 'static') return undefined;

      const stage = document.querySelector('.obsidian-stage');
      const object = document.querySelector('.obsidian-object');
      const orbitOne = document.querySelector('.orbit-one');
      const orbitTwo = document.querySelector('.orbit-two');
      const shardBack = document.querySelector('.shard-back');
      const shardMain = document.querySelector('.shard-main');
      const obsidianGlow = document.querySelector('.obsidian-glow');
      const intro = gsap.timeline({ defaults: { duration: 0.82, ease: 'power3.out' } });
      intro
        .fromTo('[data-apple-nav]', { y: -22, autoAlpha: 0 }, {
          y: 0, autoAlpha: 1, duration: 0.62, clearProps: 'opacity,visibility',
        }, 0)
        .fromTo('#portal-main-title', { y: 42, autoAlpha: 0 }, {
          y: 0, autoAlpha: 1, clearProps: 'opacity,visibility',
        }, 0.08)
        .fromTo('.portal-hero-actions > *', { y: 24, autoAlpha: 0 }, {
          y: 0, autoAlpha: 1, stagger: 0.1, clearProps: 'opacity,visibility',
        }, 0.24)
        .fromTo('.obsidian-stage', { y: 50, scale: 0.9, rotation: -4, autoAlpha: 0 }, {
          y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 1, clearProps: 'opacity,visibility',
        }, 0.12)
        .fromTo('.apple-aurora', { autoAlpha: 0.48 }, {
          autoAlpha: 1, duration: 1.05, clearProps: 'opacity,visibility',
        }, 0.62);

      const ambientTweens = [
        gsap.to(stage, { y: 14, rotation: 1.2, scale: 1, duration: 5.5, ease: 'sine.inOut', repeat: -1, yoyo: true, paused: true }),
        gsap.to(orbitOne, { rotation: '+=360', duration: 24, ease: 'none', repeat: -1, paused: true }),
        gsap.to(orbitTwo, { rotation: '-=360', duration: 36, ease: 'none', repeat: -1, paused: true }),
        gsap.to(shardBack, { y: -7, duration: 6.8, ease: 'sine.inOut', repeat: -1, yoyo: true, paused: true }),
        gsap.to(shardMain, { y: 5, duration: 5.9, ease: 'sine.inOut', repeat: -1, yoyo: true, paused: true }),
        gsap.to(obsidianGlow, { scale: 1.08, autoAlpha: 0.72, svgOrigin: '315 382', duration: 4.8, ease: 'sine.inOut', repeat: -1, yoyo: true, paused: true }),
      ].filter(Boolean);
      const syncAmbient = () => ambientTweens.forEach((tween) => (document.hidden ? tween.pause() : tween.play()));
      document.addEventListener('visibilitychange', syncAmbient);
      intro.eventCallback('onComplete', syncAmbient);
      ambientCleanup = () => {
        document.removeEventListener('visibilitychange', syncAmbient);
        ambientTweens.forEach((tween) => tween.kill());
      };

      if (currentMode === 'light') {
        return () => {
          intro.kill();
          ambientCleanup?.();
          ambientCleanup = null;
        };
      }

      const hero = document.querySelector('.portal-hero');
      const heroCopy = document.querySelector('.portal-hero-copy');
      const scrollTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: hero,
          start: 'top top',
          end: '+=115%',
          pin: hero,
          refreshPriority: 100,
          scrub: 0.8,
          anticipatePin: 1,
        },
      });
      scrollTimeline
        .to(stage, { xPercent: -18, scale: 0.84, ease: 'none' }, 0)
        .to(object, { rotation: 8, yPercent: 5, ease: 'none' }, 0)
        .to(heroCopy, { yPercent: -10, ease: 'none' }, 0);
      globalScope.requestAnimationFrame(() => ScrollTrigger.refresh());

      const xTo = gsap.quickTo(object, 'rotationY', { duration: 0.7, ease: 'power3.out' });
      const yTo = gsap.quickTo(object, 'rotationX', { duration: 0.7, ease: 'power3.out' });
      const onPointerMove = (event) => {
        const x = (event.clientX / globalScope.innerWidth - 0.5) * 10;
        const y = (event.clientY / globalScope.innerHeight - 0.5) * -8;
        xTo(x);
        yTo(y);
      };
      const resetPointer = () => {
        xTo(0);
        yTo(0);
      };
      globalScope.addEventListener('pointermove', onPointerMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', resetPointer, { passive: true });
      pointerCleanup = () => {
        globalScope.removeEventListener('pointermove', onPointerMove);
        document.documentElement.removeEventListener('pointerleave', resetPointer, { passive: true });
      };

      return () => {
        intro.kill();
        pointerCleanup?.();
        pointerCleanup = null;
        ambientCleanup?.();
        ambientCleanup = null;
      };
    });
  }

  function mountPortal() {
    const root = document.querySelector('#portal-home');
    if (!root) return;

    renderPortalContent();

    if (!root.hidden) activate();
    if (globalScope.location.hash && !root.hidden) {
      globalScope.requestAnimationFrame(() => {
        document.querySelector(globalScope.location.hash)?.scrollIntoView();
      });
    }
  }

  const exported = {
    activate,
    deactivate,
    getLegacyGameRedirect,
    getPortalItemState,
    resolveMotionMode,
    shouldCloseMenuOnOutsideClick,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  globalScope.HYLPortal = exported;
  if (typeof document !== 'undefined') {
    const redirect = getLegacyGameRedirect(globalScope.location.href);
    if (redirect) {
      globalScope.location.replace(redirect);
    } else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountPortal, { once: true });
    } else {
      mountPortal();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
