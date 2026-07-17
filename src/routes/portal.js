(function initPortal(globalScope) {
  'use strict';

  function resolveMotionMode({ hasGsap, reduceMotion, desktop }) {
    if (!hasGsap || reduceMotion) return 'static';
    return desktop ? 'immersive' : 'light';
  }

  function getPortalItemState(item = {}) {
    return {
      interactive: Boolean(item.href),
      status: item.status || (item.href ? '查看' : '内容整理中'),
    };
  }

  function shouldCloseMenuOnOutsideClick({ open, target, menu, menuButton }) {
    return Boolean(open && !menu.contains(target) && !menuButton.contains(target));
  }

  let motionMedia = null;
  let pointerCleanup = null;

  function renderPortalList(container, items, section) {
    if (!container) return;
    const fragment = document.createDocumentFragment();

    items.forEach((item, index) => {
      const state = getPortalItemState(item);
      const element = document.createElement(state.interactive ? 'a' : 'article');
      element.className = `portal-entry portal-entry-${section}`;
      if (state.interactive) {
        element.href = item.href;
        if (item.href === '?view=games') element.dataset.openGameHub = '';
      } else {
        element.classList.add('is-pending');
      }

      const count = document.createElement('span');
      count.className = 'portal-entry-count';
      count.textContent = String(index + 1).padStart(2, '0');

      const copy = document.createElement('span');
      copy.className = 'portal-entry-copy';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const summary = document.createElement('small');
      summary.textContent = item.summary;
      copy.append(title, summary);

      const meta = document.createElement('span');
      meta.className = 'portal-entry-meta';
      if (item.date) {
        const time = document.createElement('time');
        time.dateTime = item.date;
        time.textContent = item.date.replaceAll('-', '.');
        meta.append(time);
      }
      const status = document.createElement('span');
      status.textContent = state.status;
      meta.append(status);

      element.append(count, copy, meta);
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
  }

  function deactivate() {
    motionMedia?.revert();
    motionMedia = null;
    pointerCleanup?.();
    pointerCleanup = null;
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

      const intro = gsap.timeline({ defaults: { duration: 0.82, ease: 'power4.out' } });
      intro
        .from('.portal-signature', { y: 16, autoAlpha: 0 }, 0)
        .from('#portal-main-title', { y: 42, autoAlpha: 0 }, 0.08)
        .from('.portal-intro', { y: 24, autoAlpha: 0 }, 0.22)
        .from('.portal-hero-actions', { y: 20, autoAlpha: 0 }, 0.32)
        .from('.obsidian-stage', { scale: 0.84, rotation: -5, autoAlpha: 0 }, 0.1);

      if (currentMode === 'light') return undefined;

      const hero = document.querySelector('.portal-hero');
      const stage = document.querySelector('.obsidian-stage');
      const object = document.querySelector('.obsidian-object');
      const heroCopy = document.querySelector('.portal-hero-copy');
      const scrollTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: hero,
          start: 'top top',
          end: '+=115%',
          pin: hero,
          scrub: 0.8,
          anticipatePin: 1,
        },
      });
      scrollTimeline
        .to(stage, { xPercent: -18, scale: 0.84, ease: 'none' }, 0)
        .to(object, { rotation: 8, yPercent: 5, ease: 'none' }, 0)
        .to(heroCopy, { yPercent: -10, ease: 'none' }, 0);

      gsap.utils.toArray('.portal-section-heading').forEach((heading) => {
        gsap.from(heading, {
          y: 44,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: heading,
            start: 'top 88%',
            once: true,
          },
        });
      });

      const xTo = gsap.quickTo(object, 'rotationY', { duration: 0.7, ease: 'power3.out' });
      const yTo = gsap.quickTo(object, 'rotationX', { duration: 0.7, ease: 'power3.out' });
      const onPointerMove = (event) => {
        const x = (event.clientX / globalScope.innerWidth - 0.5) * 10;
        const y = (event.clientY / globalScope.innerHeight - 0.5) * -8;
        xTo(x);
        yTo(y);
      };
      globalScope.addEventListener('pointermove', onPointerMove, { passive: true });
      pointerCleanup = () => globalScope.removeEventListener('pointermove', onPointerMove);

      return () => {
        intro.kill();
        pointerCleanup?.();
        pointerCleanup = null;
      };
    });
  }

  function mountPortal() {
    const root = document.querySelector('#portal-home');
    const menuButton = document.querySelector('#site-menu-button');
    const menu = document.querySelector('#site-menu');
    const nav = document.querySelector('.site-nav');
    if (!root || !menuButton || !menu || !nav) return;

    renderPortalContent();

    const closeMenu = () => {
      menuButton.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
    };

    menuButton.addEventListener('click', () => {
      const open = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('is-open', !open);
    });

    document.addEventListener('click', (event) => {
      if (shouldCloseMenuOnOutsideClick({
        open: menu.classList.contains('is-open'),
        target: event.target,
        menu,
        menuButton,
      })) closeMenu();

      const portalLink = event.target.closest('[data-open-portal]');
      const gameHubLink = event.target.closest('[data-open-game-hub]');
      const sectionLink = event.target.closest('[data-portal-section]');

      if (portalLink) {
        event.preventDefault();
        closeMenu();
        void Promise.resolve(globalScope.GameApp?.openPortal?.()).then(() => {
          globalScope.scrollTo({ top: 0, behavior: 'smooth' });
        });
        return;
      }

      if (gameHubLink) {
        event.preventDefault();
        closeMenu();
        void globalScope.GameApp?.openGameHome?.();
        return;
      }

      if (sectionLink) {
        closeMenu();
        if (!root.hidden) return;
        event.preventDefault();
        const sectionId = sectionLink.dataset.portalSection;
        void Promise.resolve(globalScope.GameApp?.openPortal?.()).then(() => {
          document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
        });
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    globalScope.addEventListener('scroll', () => {
      nav.classList.toggle('is-scrolled', globalScope.scrollY > 18 || document.body.dataset.view !== 'portal');
    }, { passive: true });

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
    getPortalItemState,
    resolveMotionMode,
    shouldCloseMenuOnOutsideClick,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  globalScope.HYLPortal = exported;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountPortal, { once: true });
    } else {
      mountPortal();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
