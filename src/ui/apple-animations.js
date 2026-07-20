(function initAppleAnimations(globalScope) {
  'use strict';

  const APPLE_CARD_EXCLUDE = '#board, .board, .cell, .gomoku-cell, .checkin-calendar, .checkin-day, [role="gridcell"]';

  /* ========== Aggressive 4-Layer Theme States ========== */
  const THEME_STATES = {
    blue: {
      '--apple-glow-blue-opacity': 0.52,
      '--apple-glow-indigo-opacity': 0.16,
      '--apple-glow-purple-opacity': 0.14,
      '--apple-glow-pink-opacity': 0.12,
      '--apple-glow-blue-scale': 1.28,
      '--apple-glow-indigo-scale': 0.86,
      '--apple-glow-purple-scale': 0.84,
      '--apple-glow-pink-scale': 0.82,
      '--apple-glow-blue-theme-x': '-42px',
      '--apple-glow-blue-theme-y': '48px',
      '--apple-glow-indigo-theme-x': '72px',
      '--apple-glow-indigo-theme-y': '-32px',
      '--apple-glow-purple-theme-x': '-36px',
      '--apple-glow-purple-theme-y': '-14px',
      '--apple-glow-pink-theme-x': '-28px',
      '--apple-glow-pink-theme-y': '-56px',
    },
    indigo: {
      '--apple-glow-blue-opacity': 0.14,
      '--apple-glow-indigo-opacity': 0.52,
      '--apple-glow-purple-opacity': 0.16,
      '--apple-glow-pink-opacity': 0.12,
      '--apple-glow-blue-scale': 0.86,
      '--apple-glow-indigo-scale': 1.3,
      '--apple-glow-purple-scale': 0.92,
      '--apple-glow-pink-scale': 0.84,
      '--apple-glow-blue-theme-x': '56px',
      '--apple-glow-blue-theme-y': '-28px',
      '--apple-glow-indigo-theme-x': '-48px',
      '--apple-glow-indigo-theme-y': '-52px',
      '--apple-glow-purple-theme-x': '84px',
      '--apple-glow-purple-theme-y': '32px',
      '--apple-glow-pink-theme-x': '-64px',
      '--apple-glow-pink-theme-y': '-40px',
    },
    purple: {
      '--apple-glow-blue-opacity': 0.12,
      '--apple-glow-indigo-opacity': 0.14,
      '--apple-glow-purple-opacity': 0.5,
      '--apple-glow-pink-opacity': 0.14,
      '--apple-glow-blue-scale': 0.84,
      '--apple-glow-indigo-scale': 0.88,
      '--apple-glow-purple-scale': 1.3,
      '--apple-glow-pink-scale': 0.9,
      '--apple-glow-blue-theme-x': '32px',
      '--apple-glow-blue-theme-y': '-48px',
      '--apple-glow-indigo-theme-x': '-62px',
      '--apple-glow-indigo-theme-y': '28px',
      '--apple-glow-purple-theme-x': '-56px',
      '--apple-glow-purple-theme-y': '44px',
      '--apple-glow-pink-theme-x': '42px',
      '--apple-glow-pink-theme-y': '-22px',
    },
    pink: {
      '--apple-glow-blue-opacity': 0.12,
      '--apple-glow-indigo-opacity': 0.12,
      '--apple-glow-purple-opacity': 0.14,
      '--apple-glow-pink-opacity': 0.5,
      '--apple-glow-blue-scale': 0.82,
      '--apple-glow-indigo-scale': 0.84,
      '--apple-glow-purple-scale': 0.88,
      '--apple-glow-pink-scale': 1.3,
      '--apple-glow-blue-theme-x': '-36px',
      '--apple-glow-blue-theme-y': '-34px',
      '--apple-glow-indigo-theme-x': '28px',
      '--apple-glow-indigo-theme-y': '-58px',
      '--apple-glow-purple-theme-x': '-42px',
      '--apple-glow-purple-theme-y': '-36px',
      '--apple-glow-pink-theme-x': '60px',
      '--apple-glow-pink-theme-y': '-52px',
    },
    blend: {
      '--apple-glow-blue-opacity': 0.32,
      '--apple-glow-indigo-opacity': 0.28,
      '--apple-glow-purple-opacity': 0.26,
      '--apple-glow-pink-opacity': 0.22,
      '--apple-glow-blue-scale': 1.08,
      '--apple-glow-indigo-scale': 1.06,
      '--apple-glow-purple-scale': 1.05,
      '--apple-glow-pink-scale': 1.04,
      '--apple-glow-blue-theme-x': '-18px',
      '--apple-glow-blue-theme-y': '20px',
      '--apple-glow-indigo-theme-x': '22px',
      '--apple-glow-indigo-theme-y': '-18px',
      '--apple-glow-purple-theme-x': '-22px',
      '--apple-glow-purple-theme-y': '-14px',
      '--apple-glow-pink-theme-x': '16px',
      '--apple-glow-pink-theme-y': '18px',
    },
  };

  let activeController = null;

  function resolveAppleMotionMode({ hasGsap, reduceMotion, width }) {
    if (!hasGsap || reduceMotion) return 'static';
    if (Number(width) < 720) return 'light';
    if (Number(width) <= 900) return 'compact';
    return 'full';
  }

  function getScrollProgress({ scrollY, scrollHeight, viewportHeight }) {
    const range = Math.max(0, Number(scrollHeight || 0) - Number(viewportHeight || 0));
    if (range === 0) return 0;
    return Math.min(1, Math.max(0, Number(scrollY || 0) / range));
  }

  function getCardEntrance() {
    return {
      autoAlpha: 0,
      y: 32,
      scale: 0.92,
    };
  }

  function getThemeState(theme) {
    return { ...(THEME_STATES[theme] || THEME_STATES.blue) };
  }

  /* ========== 3 Scroll Reveal Variants ========== */
  function getRevealVariant(index, total) {
    const bucket = (Number(index) || 0) % 3;
    if (bucket === 0) {
      // Variant A: Left-right stagger
      const direction = (Number(index) || 0) % 2 === 0 ? -1 : 1;
      return {
        autoAlpha: 0,
        x: direction * 120,
        y: 52,
        scale: 0.88,
        rotate: direction * 3,
        ease: 'back.out(1.55)',
      };
    }
    if (bucket === 1) {
      // Variant B: Bottom bounce entry
      return {
        autoAlpha: 0,
        x: 0,
        y: 100,
        scale: 0.92,
        rotate: 0,
        ease: 'back.out(1.65)',
      };
    }
    // Variant C: Scale + rotation spatial
    const direction = (Number(index) || 0) % 2 === 0 ? -1 : 1;
    return {
      autoAlpha: 0,
      x: 0,
      y: 64,
      scale: 0.82,
      rotate: direction * 5,
      ease: 'back.out(1.5)',
    };
  }

  function getRevealMotion({ interactive = false, index = 0, total = 1 } = {}) {
    if (!interactive) {
      return {
        autoAlpha: 0,
        x: 0,
        y: 90,
        scale: 0.94,
        ease: 'power4.out',
        delay: 0,
      };
    }
    const variant = getRevealVariant(index, total);
    return {
      ...variant,
      delay: Math.round(Math.min(0.4, Math.max(0, Number(index) || 0) * 0.1) * 10) / 10,
    };
  }

  function getTabHighlightGeometry(tablist, activeTab) {
    const listWidth = Number(tablist?.offsetWidth || 0);
    const listHeight = Number(tablist?.offsetHeight || 0);
    const width = Number(activeTab?.offsetWidth || 0);
    const height = Number(activeTab?.offsetHeight || 0);
    if (listWidth <= 0 || listHeight <= 0 || width <= 0 || height <= 0) return null;
    return {
      x: Number(activeTab?.offsetLeft || 0),
      y: Number(activeTab?.offsetTop || 0),
      width,
      height,
    };
  }

  function isInteractiveCardCandidate({ tagName = '', href = '', role = '', disabled = false, explicit = false } = {}) {
    if (disabled) return false;
    const tag = String(tagName).toUpperCase();
    return Boolean(explicit
      || tag === 'BUTTON'
      || (tag === 'A' && href)
      || role === 'link'
      || role === 'button');
  }

  function isThemeScopeCandidate({ tagName = '', explicit = false } = {}) {
    if (explicit) return true;
    return ['SECTION', 'HEADER', 'MAIN'].includes(String(tagName).toUpperCase());
  }

  function syncInfiniteAnimations(animations, paused) {
    Array.from(animations || []).forEach((animation) => {
      if (Number(animation?.repeat?.()) !== -1) return;
      if (paused) animation.pause?.();
      else animation.play?.();
    });
  }

  function isUnreadBadgeActive(badge) {
    if (!badge || badge.hidden) return false;
    return Number.parseInt(String(badge.textContent || '0'), 10) > 0;
  }

  function parseCounterText(value) {
    const text = String(value ?? '');
    const match = text.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (!match) return null;
    const numeric = Number(match[0].replaceAll(',', ''));
    if (!Number.isFinite(numeric)) return null;
    const decimal = match[0].match(/\.(\d+)$/);
    return {
      value: numeric,
      prefix: text.slice(0, match.index),
      suffix: text.slice(Number(match.index) + match[0].length),
      decimals: decimal ? decimal[1].length : 0,
    };
  }

  function transitionWithDocument(mutator, name = 'apple', documentRef = globalScope.document) {
    if (typeof mutator !== 'function') return null;
    if (typeof documentRef?.startViewTransition !== 'function') {
      mutator();
      return null;
    }

    const root = documentRef.documentElement;
    if (root?.dataset) root.dataset.appleTransition = String(name || 'apple');
    let mutated = false;
    const run = () => {
      if (mutated) return undefined;
      mutated = true;
      return mutator();
    };
    let transition;
    try {
      transition = documentRef.startViewTransition(run);
    } catch (error) {
      if (root?.dataset) delete root.dataset.appleTransition;
      if (!mutated) mutator();
      return null;
    }
    if (!mutated) run();

    Promise.resolve(transition?.finished)
      .finally(() => {
        if (root?.dataset) delete root.dataset.appleTransition;
      })
      .catch(() => {});
    return transition;
  }

  function collect(root, selector) {
    if (!root) return [];
    const nodes = [];
    if (typeof root.matches === 'function' && root.matches(selector)) nodes.push(root);
    if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll(selector));
    return nodes;
  }

  function shouldRefreshForMutations(mutations, renderedCounterText) {
    return Array.from(mutations || []).some((mutation) => {
      const target = mutation?.target;
      const element = typeof target?.matches === 'function'
        ? target
        : target?.parentElement || target?.parentNode;
      const counter = element?.matches?.('[data-apple-counter]')
        ? element
        : element?.closest?.('[data-apple-counter]');
      return !counter || renderedCounterText?.get?.(counter) !== counter.textContent;
    });
  }

  function cleanupDisconnectedResources(resources, registries = []) {
    resources?.forEach?.((group, element) => {
      if (element?.isConnected !== false) return;
      if (typeof group === 'function') group();
      else group?.forEach?.((cleanup) => cleanup?.());
      resources.delete(element);
      Array.from(registries || []).forEach((registry) => registry?.delete?.(element));
    });
  }

  function cleanupDisconnectedCards(resources, registeredCards) {
    cleanupDisconnectedResources(resources, [registeredCards]);
  }

  function registerAppleAnimations(options = {}) {
    if (activeController) return activeController;

    const documentRef = options.document === undefined ? globalScope.document : options.document;
    const windowRef = options.window === undefined ? globalScope : options.window;
    const gsap = options.gsap === undefined ? windowRef?.gsap : options.gsap;
    const ScrollTrigger = options.ScrollTrigger === undefined ? windowRef?.ScrollTrigger : options.ScrollTrigger;
    const body = documentRef?.body || null;
    const cleanups = [];
    let destroyed = false;
    let observer = null;
    let refreshFrame = 0;
    let scrollFrame = 0;
    let media = null;
    let currentMode = 'static';
    let pageEntrancePlayed = false;
    let pageEntranceComplete = body?.dataset?.applePage === 'portal';
    let motionCleanups = [];
    let ownedAnimations = [];
    let ownedInfiniteAnimations = [];
    let ownedScrollTriggers = [];
    let registeredCards = new Set();
    let registeredReveals = new WeakSet();
    let registeredThemes = new WeakSet();
    let registeredButtons = new WeakSet();
    let registeredBreathing = new WeakSet();
    let registeredBells = new WeakSet();
    let registeredHeroVisuals = new WeakSet();
    let registeredTablists = new WeakSet();
    let registeredToasts = new WeakSet();
    const counterValues = new WeakMap();
    const counterTweens = new WeakMap();
    const renderedCounterText = new WeakMap();
    const elementResources = new Map();
    const completedEntrances = new WeakSet();
    const dialogStates = new WeakMap();
    const dialogTweens = new WeakMap();
    const bellStates = new WeakMap();
    const tabHighlightStates = new WeakMap();
    const toastTweens = new WeakMap();
    const revealVariantCounters = new WeakMap();

    function listen(target, type, listener, optionsValue) {
      if (typeof target?.addEventListener !== 'function') return;
      target.addEventListener(type, listener, optionsValue);
      cleanups.push(() => target.removeEventListener(type, listener, optionsValue));
    }

    function listenForMotion(target, type, listener, optionsValue) {
      if (typeof target?.addEventListener !== 'function') return;
      target.addEventListener(type, listener, optionsValue);
      motionCleanups.push(() => target.removeEventListener(type, listener, optionsValue));
    }

    function requestFrame(callback) {
      if (typeof windowRef?.requestAnimationFrame === 'function') return windowRef.requestAnimationFrame(callback);
      callback();
      return 0;
    }

    function cancelFrame(frame) {
      if (frame && typeof windowRef?.cancelAnimationFrame === 'function') windowRef.cancelAnimationFrame(frame);
    }

    function setElementResource(element, key, cleanup) {
      if (!element || !key) return;
      let resources = elementResources.get(element);
      if (!resources) {
        resources = new Map();
        elementResources.set(element, resources);
      }
      resources.get(key)?.();
      if (typeof cleanup === 'function') resources.set(key, cleanup);
      else resources.delete(key);
      if (resources.size === 0) elementResources.delete(element);
    }

    function cleanupDisconnectedElements() {
      cleanupDisconnectedResources(elementResources, [
        registeredCards,
        registeredReveals,
        registeredThemes,
        registeredButtons,
        registeredBreathing,
        registeredBells,
        registeredHeroVisuals,
        registeredTablists,
        registeredToasts,
      ]);
    }

    function clearElementResources() {
      elementResources.forEach((resources) => resources.forEach((cleanup) => cleanup?.()));
      elementResources.clear();
    }

    function updateVisibility() {
      const paused = Boolean(documentRef?.hidden);
      body?.classList?.toggle('is-apple-paused', paused);
      syncInfiniteAnimations(ownedInfiniteAnimations, paused);
    }

    function setupVisibilityControl() {
      listen(documentRef, 'visibilitychange', updateVisibility);
      updateVisibility();
    }

    function updateNavigation() {
      scrollFrame = 0;
      const nav = documentRef?.querySelector?.('[data-apple-nav]');
      const progress = documentRef?.querySelector?.('.apple-scroll-progress');
      const scrollY = Number(windowRef?.scrollY || 0);
      nav?.classList?.toggle('is-scrolled', scrollY > 80);
      const value = getScrollProgress({
        scrollY,
        scrollHeight: documentRef?.documentElement?.scrollHeight || body?.scrollHeight || 0,
        viewportHeight: windowRef?.innerHeight || 0,
      });
      progress?.style?.setProperty('--apple-scroll-progress', String(value));
    }

    function scheduleNavigationUpdate() {
      if (scrollFrame) return;
      scrollFrame = requestFrame(updateNavigation);
    }

    function setupNavigation() {
      const menuButton = documentRef?.querySelector?.('#site-menu-button');
      const menu = documentRef?.querySelector?.('#site-menu');
      const closeMenu = ({ restoreFocus = false } = {}) => {
        if (!menuButton || !menu) return;
        const wasOpen = menuButton.getAttribute('aria-expanded') === 'true';
        menuButton.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        if (wasOpen && restoreFocus) menuButton.focus?.();
      };

      if (menuButton && menu) {
        listen(menuButton, 'click', () => {
          const open = menuButton.getAttribute('aria-expanded') === 'true';
          menuButton.setAttribute('aria-expanded', String(!open));
          menu.classList.toggle('is-open', !open);
          if (!open) requestFrame(() => menu.querySelector?.('a, button')?.focus?.());
        });
        listen(documentRef, 'click', (event) => {
          if (menuButton.getAttribute('aria-expanded') !== 'true') return;
          if (menu.contains?.(event.target) || menuButton.contains?.(event.target)) return;
          closeMenu();
        });
        listen(documentRef, 'keydown', (event) => {
          if (event.key === 'Escape') closeMenu({ restoreFocus: true });
        });
        listen(menu, 'click', (event) => {
          if (event.target?.closest?.('a')) closeMenu();
        });
        listen(windowRef, 'resize', () => {
          if (Number(windowRef?.innerWidth || 0) > 900) closeMenu();
          scheduleNavigationUpdate();
        }, { passive: true });
      }

      listen(windowRef, 'scroll', scheduleNavigationUpdate, { passive: true });
      updateNavigation();
    }

    /* ========== Aggressive Theme Transitions (1.5s, power2.inOut) ========== */
    function setTheme(theme) {
      if (!body) return;
      const values = getThemeState(theme);
      body.dataset.appleTheme = THEME_STATES[theme] ? theme : 'blue';
      if (currentMode !== 'static' && typeof gsap?.to === 'function') {
        ownedAnimations.push(gsap.to(body, {
          ...values,
          duration: 1.5,
          ease: 'power2.inOut',
          overwrite: 'auto',
        }));
      } else {
        Object.entries(values).forEach(([key, value]) => body.style?.setProperty(key, String(value)));
      }
    }

    function syncTabPanelTheme(panel) {
      const theme = panel?.dataset?.appleTheme;
      if (theme) setTheme(theme);
    }

    function isCardExcluded(element) {
      return Boolean(element?.matches?.(APPLE_CARD_EXCLUDE) || element?.closest?.(APPLE_CARD_EXCLUDE));
    }

    function isInteractiveCard(element) {
      return isInteractiveCardCandidate({
        tagName: element?.tagName,
        href: element?.getAttribute?.('href') || element?.href || '',
        role: element?.getAttribute?.('role') || '',
        disabled: Boolean(element?.disabled || element?.getAttribute?.('aria-disabled') === 'true'),
        explicit: element?.hasAttribute?.('data-apple-tilt'),
      });
    }

    function getRevealIndex(element) {
      const group = element?.closest?.('section, main, [data-apple-reveal-group]');
      if (!group?.querySelectorAll) return 0;
      const items = Array.from(group.querySelectorAll('[data-apple-card], [data-apple-list-item], [data-apple-reveal]'));
      const index = items.indexOf(element);
      if (index < 0) return 0;
      let counter = revealVariantCounters.get(group) || 0;
      revealVariantCounters.set(group, counter + 1);
      return index;
    }

    /* ========== Aggressive Scroll Reveal ========== */
    function createScrollReveal(element, { interactive = false, index = 0, total = 1 } = {}) {
      const motion = getRevealMotion({ interactive, index, total });
      const { ease, delay, ...fromVars } = motion;
      const tween = gsap.fromTo(element, fromVars, {
        autoAlpha: 1,
        x: 0,
        y: 0,
        scale: 1,
        rotate: 0,
        duration: interactive ? 0.9 : 1.05,
        delay,
        ease,
        clearProps: 'opacity,visibility,transform',
        paused: true,
        immediateRender: false,
      });
      const trigger = ScrollTrigger.create({
        trigger: element,
        start: 'top 88%',
        once: true,
        onEnter: () => {
          completedEntrances.add(element);
          tween.restart();
        },
      });
      return { tween, trigger };
    }

    /* ========== Aggressive Card 3D Tilt ========== */
    function setupCardTilt(card) {
      if (currentMode !== 'full' || isCardExcluded(card) || !isInteractiveCard(card)
        || typeof gsap?.quickTo !== 'function') return null;
      gsap.set?.(card, { transformPerspective: 800, transformStyle: 'preserve-3d' });
      const rotateX = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      const rotateY = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' });
      let frame = 0;
      let point = null;
      const update = () => {
        frame = 0;
        if (!point) return;
        const rect = card.getBoundingClientRect?.();
        if (!rect?.width || !rect?.height) return;
        const relX = (point.clientX - rect.left) / rect.width;
        const relY = (point.clientY - rect.top) / rect.height;
        rotateY((relX - 0.5) * 9);
        rotateX((relY - 0.5) * -9);
        card.style?.setProperty('--pointer-x', `${relX * 100}%`);
        card.style?.setProperty('--pointer-y', `${relY * 100}%`);
      };
      const onMove = (event) => {
        point = event;
        card.classList?.add('is-apple-tilting');
        if (!frame) frame = requestFrame(update);
      };
      const onLeave = () => {
        point = null;
        card.classList?.remove('is-apple-tilting');
        rotateX(0);
        rotateY(0);
      };
      const listenerOptions = { passive: true };
      card.addEventListener?.('pointermove', onMove, listenerOptions);
      card.addEventListener?.('pointerleave', onLeave, listenerOptions);
      return () => {
        card.removeEventListener?.('pointermove', onMove, listenerOptions);
        card.removeEventListener?.('pointerleave', onLeave, listenerOptions);
        card.classList?.remove('is-apple-tilting');
        cancelFrame(frame);
      };
    }

    function registerCards(root) {
      if (currentMode === 'static') return false;
      let changed = false;
      collect(root, '[data-apple-card]').forEach((card) => {
        if (registeredCards.has(card) || isCardExcluded(card) || card.closest?.('[hidden]')) return;
        registeredCards.add(card);
        changed = true;
        let tween = null;
        let trigger = null;
        if (!completedEntrances.has(card) && typeof gsap?.fromTo === 'function' && ScrollTrigger) {
          const index = getRevealIndex(card);
          ({ tween, trigger } = createScrollReveal(card, {
            interactive: true,
            index,
            total: 1,
          }));
        }
        const cleanupTilt = setupCardTilt(card);
        setElementResource(card, 'card', () => {
          cleanupTilt?.();
          trigger?.kill?.();
          tween?.kill?.();
        });
      });
      return changed;
    }

    function registerReveals(root) {
      if (currentMode === 'static' || typeof gsap?.fromTo !== 'function') return false;
      const reveals = collect(root, '[data-apple-reveal]').filter((element) => {
        if (element.matches?.('[role="tabpanel"]')) return false;
        if (element.matches?.('[data-apple-card]')) return false;
        if (completedEntrances.has(element)) return false;
        if (registeredReveals.has(element) || element.closest?.('[hidden]')) return false;
        registeredReveals.add(element);
        return true;
      });
      if (reveals.length === 0) return false;
      reveals.forEach((element) => {
        const index = getRevealIndex(element);
        const { tween, trigger } = createScrollReveal(element, {
          interactive: element.matches?.('[data-apple-list-item]'),
          index,
          total: reveals.length,
        });
        setElementResource(element, 'reveal', () => {
          trigger?.kill?.();
          tween?.kill?.();
        });
      });
      return true;
    }

    /* ========== Aggressive Page Entrance ========== */
    function setupPageEntrance() {
      if (pageEntrancePlayed || currentMode === 'static' || body?.dataset?.applePage === 'portal'
        || typeof gsap?.timeline !== 'function') return;
      const nav = documentRef?.querySelector?.('[data-apple-nav]');
      const hero = documentRef?.querySelector?.('main [data-apple-entrance]:not([hidden])')
        || documentRef?.querySelector?.('main[data-apple-entrance]')
        || documentRef?.querySelector?.('main [data-apple-reveal]:not([hidden])')
        || documentRef?.querySelector?.('main > :not([hidden])');
      const heading = hero?.querySelector?.('h1, h2');
      const visual = hero?.querySelector?.('[data-apple-hero-visual]:not([hidden])');
      const primaryContent = hero
        ? collect(hero, '[data-apple-entrance-item]:not([hidden])')
          .filter((element) => element !== heading && element !== visual)
        : [];
      const buttons = hero
        ? collect(hero, '.apple-button--primary, .apple-button--secondary').filter((element) => !primaryContent.includes(element))
        : [];
      const auraLayers = collect(documentRef, '.apple-glow');
      if (!nav && !hero) {
        pageEntranceComplete = true;
        return;
      }
      pageEntrancePlayed = true;
      [hero, ...primaryContent].filter(Boolean).forEach((element) => {
        registeredReveals.add(element);
        completedEntrances.add(element);
      });

      const timeline = gsap.timeline({
        defaults: { ease: 'power4.out' },
        onComplete: () => {
          pageEntranceComplete = true;
          registerHeroMotion(documentRef);
        },
      });

      if (nav) {
        timeline.fromTo(nav, { autoAlpha: 0, y: -60 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0);
      }

      if (heading) {
        timeline.fromTo(heading, { autoAlpha: 0, y: 90, scale: 0.88 }, {
          autoAlpha: 1, y: 0, scale: 1, duration: 1.15,
        }, 0.1);
      }

      if (primaryContent.length) {
        timeline.fromTo(primaryContent, { autoAlpha: 0, y: 54 }, {
          autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.13,
        }, 0.22);
      }

      if (buttons.length) {
        timeline.fromTo(buttons, { autoAlpha: 0, y: 40 }, {
          autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.1,
        }, 0.38);
      }

      if (visual && visual !== hero) {
        timeline.fromTo(visual, { autoAlpha: 0, y: 90, scale: 0.82, rotate: -4 }, {
          autoAlpha: 1, y: 0, scale: 1, rotate: 0, duration: 1.3, ease: 'back.out(1.45)',
        }, 0.14);
      }

      if (auraLayers.length) {
        timeline.fromTo(auraLayers, { autoAlpha: 0, scale: 0.72 }, {
          autoAlpha: 1, scale: 1, duration: 1.4, stagger: 0.12, ease: 'power3.out',
        }, 0.6);
      }

      ownedAnimations.push(timeline);
    }

    /* ========== Aggressive Hero Motion ========== */
    function registerHeroMotion(root) {
      if (currentMode === 'static' || typeof gsap?.to !== 'function') return;
      collect(root, '[data-apple-hero-visual]').forEach((visual) => {
        if (registeredHeroVisuals.has(visual) || visual.closest?.('[hidden]')) return;
        if (!pageEntranceComplete && visual.closest?.('[data-apple-entrance]')) return;
        registeredHeroVisuals.add(visual);
        const tween = gsap.to(visual, {
          y: 24,
          rotation: 2.5,
          scale: 1.03,
          duration: 5.5,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        });
        if (documentRef?.hidden) tween.pause?.();
        ownedInfiniteAnimations.push(tween);
        setElementResource(visual, 'hero-motion', () => {
          tween?.kill?.();
          const index = ownedInfiniteAnimations.indexOf(tween);
          if (index >= 0) ownedInfiniteAnimations.splice(index, 1);
        });
      });
    }

    function registerThemes(root) {
      const sections = collect(root, '[data-apple-theme]').filter((section) => {
        if (!isThemeScopeCandidate({
          tagName: section?.tagName,
          explicit: section?.hasAttribute?.('data-apple-theme-scope'),
        })) return false;
        if (registeredThemes.has(section) || section.closest?.('[hidden]')) return false;
        registeredThemes.add(section);
        return true;
      });
      if (sections.length === 0) return false;
      if (currentMode === 'static' || !ScrollTrigger) {
        setTheme(sections[0].dataset.appleTheme);
        return true;
      }
      sections.forEach((section) => {
        const trigger = ScrollTrigger.create({
          trigger: section,
          start: 'top 58%',
          end: 'bottom 42%',
          onEnter: () => setTheme(section.dataset.appleTheme),
          onEnterBack: () => setTheme(section.dataset.appleTheme),
        });
        setElementResource(section, 'theme', () => trigger?.kill?.());
      });
      return true;
    }

    function formatCounter(parsed, value) {
      const number = Number(value).toLocaleString('en-US', {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      });
      return `${parsed.prefix}${number}${parsed.suffix}`;
    }

    function registerCounters(root) {
      collect(root, '[data-apple-counter]').forEach((element) => {
        const parsed = parseCounterText(element.textContent);
        if (!parsed) return;
        const previous = counterValues.get(element);
        if (previous === parsed.value) return;
        counterValues.set(element, parsed.value);
        counterTweens.get(element)?.kill?.();
        if (currentMode === 'static' || typeof gsap?.to !== 'function') return;
        const state = { value: previous ?? 0 };
        const tween = gsap.to(state, {
          value: parsed.value,
          duration: 0.8,
          ease: 'power3.out',
          overwrite: true,
          onUpdate() {
            const text = formatCounter(parsed, state.value);
            renderedCounterText.set(element, text);
            element.textContent = text;
          },
          onComplete() {
            const text = formatCounter(parsed, parsed.value);
            renderedCounterText.set(element, text);
            element.textContent = text;
          },
        });
        counterTweens.set(element, tween);
        setElementResource(element, 'counter', () => {
          tween?.kill?.();
          if (counterTweens.get(element) === tween) counterTweens.delete(element);
        });
      });
    }

    function registerButtons(root) {
      collect(root, '.apple-button--primary, .apple-button--secondary').forEach((button) => {
        if (registeredButtons.has(button)) return;
        registeredButtons.add(button);
        const onClick = () => {
          button.classList.remove('is-apple-clicked');
          void button.offsetWidth;
          button.classList.add('is-apple-clicked');
        };
        const onAnimationEnd = () => button.classList.remove('is-apple-clicked');
        button.addEventListener?.('click', onClick);
        button.addEventListener?.('animationend', onAnimationEnd);
        setElementResource(button, 'button', () => {
          button.removeEventListener?.('click', onClick);
          button.removeEventListener?.('animationend', onAnimationEnd);
        });
      });
    }

    /* ========== Aggressive CTA Breathing ========== */
    function registerBreathingEffects(root) {
      if (currentMode === 'static' || typeof gsap?.to !== 'function') return;
      collect(root, '[data-apple-breathe]').forEach((element) => {
        if (registeredBreathing.has(element)
          || element.matches?.('.danger, .button.danger, .admin-danger-button')
          || element.closest?.('[hidden]')) return;
        registeredBreathing.add(element);
        const tween = gsap.to(element, {
          scale: 1.055,
          y: -3,
          boxShadow: '0 20px 52px rgba(0,113,227,.44)',
          duration: 1.8,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        });
        if (documentRef?.hidden) tween.pause?.();
        ownedInfiniteAnimations.push(tween);
        const onEnter = () => tween.pause?.();
        const onLeave = () => {
          if (!documentRef?.hidden) tween.play?.();
        };
        const listenerOptions = { passive: true };
        element.addEventListener?.('pointerenter', onEnter, listenerOptions);
        element.addEventListener?.('pointerleave', onLeave, listenerOptions);
        setElementResource(element, 'breathe', () => {
          element.removeEventListener?.('pointerenter', onEnter, listenerOptions);
          element.removeEventListener?.('pointerleave', onLeave, listenerOptions);
          tween?.kill?.();
          const index = ownedInfiniteAnimations.indexOf(tween);
          if (index >= 0) ownedInfiniteAnimations.splice(index, 1);
        });
      });
    }

    /* ========== Aggressive Dialog Entry/Exit ========== */
    function registerDialogs(root) {
      collect(root, 'dialog').forEach((dialog) => {
        if (!dialog.open && !dialog.hasAttribute?.('open')) {
          dialogStates.set(dialog, false);
          setElementResource(dialog, 'dialog', null);
          dialogTweens.delete?.(dialog);
        }
      });
      if (currentMode === 'static' || typeof gsap?.fromTo !== 'function') return;
      collect(root, 'dialog[open]').forEach((dialog) => {
        if (dialogStates.get(dialog) === true) return;
        dialogStates.set(dialog, true);
        const target = dialog.querySelector?.('.account-dialog-shell, .game-event-dialog-shell, .friend-invite-dialog-shell, .shop-purchase-shell, .checkin-confirmation-shell') || dialog;
        const tween = gsap.fromTo(target, {
          autoAlpha: 0,
          y: 72,
          scale: 0.82,
          rotate: -2,
        }, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          rotate: 0,
          duration: 0.65,
          ease: 'back.out(1.6)',
          clearProps: 'opacity,visibility,transform',
        });
        dialogTweens.set(dialog, tween);
        setElementResource(dialog, 'dialog', () => {
          tween?.kill?.();
          if (dialogTweens.get(dialog) === tween) dialogTweens.delete(dialog);
        });
      });
    }

    function registerNotificationBells(root) {
      collect(root, '.notification-bell').forEach((bell) => {
        const badge = bell.querySelector?.('.notification-unread-count');
        const active = isUnreadBadgeActive(badge);
        const previous = bellStates.get(bell) || false;
        bellStates.set(bell, active);
        if (!registeredBells.has(bell)) {
          registeredBells.add(bell);
          const onAnimationEnd = (event) => {
            if (event.animationName === 'apple-bell-unread') bell.classList?.remove('is-apple-ringing');
          };
          bell.addEventListener?.('animationend', onAnimationEnd);
          setElementResource(bell, 'bell', () => bell.removeEventListener?.('animationend', onAnimationEnd));
        }
        if (active && !previous && currentMode !== 'static') {
          bell.classList?.remove('is-apple-ringing');
          void bell.offsetWidth;
          bell.classList?.add('is-apple-ringing');
        }
      });
    }

    function getActiveTabPanel(name = '') {
      const selector = name === 'account-tab'
        ? '[data-apple-tab-panel]:not([hidden])'
        : '[role="tabpanel"]:not([hidden])';
      return documentRef?.querySelector?.(selector);
    }

    function positionTabHighlight(tablist, animate = true) {
      const activeTab = tablist?.querySelector?.('[role="tab"][aria-selected="true"]');
      if (!activeTab) return;
      tablist.classList?.add('has-apple-tab-highlight');
      const values = getTabHighlightGeometry(tablist, activeTab);
      if (!values) return;
      let state = tabHighlightStates.get(tablist);
      if (!state) {
        const highlight = documentRef.createElement?.('span');
        if (!highlight) return;
        highlight.className = 'apple-tab-highlight';
        highlight.setAttribute?.('aria-hidden', 'true');
        tablist.prepend?.(highlight);
        state = { highlight, initialized: false };
        tabHighlightStates.set(tablist, state);
      }
      if (!state.initialized || !animate || currentMode === 'static' || typeof gsap?.to !== 'function') {
        gsap?.set?.(state.highlight, values);
        if (!gsap?.set && state.highlight.style) {
          state.highlight.style.width = `${values.width}px`;
          state.highlight.style.height = `${values.height}px`;
          state.highlight.style.transform = `translate(${values.x}px, ${values.y}px)`;
        }
        state.initialized = true;
        return;
      }
      const tween = gsap.to(state.highlight, {
        ...values,
        duration: 0.4,
        ease: 'power3.out',
        overwrite: true,
      });
      setElementResource(tablist, 'tab-highlight-tween', () => tween?.kill?.());
    }

    function registerTabHighlights(root) {
      if (currentMode === 'static') return;
      collect(root, '[role="tablist"]').forEach((tablist) => {
        if (!registeredTablists.has(tablist)) {
          registeredTablists.add(tablist);
          const onResize = () => requestFrame(() => positionTabHighlight(tablist, false));
          windowRef?.addEventListener?.('resize', onResize, { passive: true });
          setElementResource(tablist, 'tab-highlight', () => {
            windowRef?.removeEventListener?.('resize', onResize, { passive: true });
            tabHighlightStates.get(tablist)?.highlight?.remove?.();
            tabHighlightStates.delete(tablist);
            tablist.classList?.remove('has-apple-tab-highlight');
          });
        }
        positionTabHighlight(tablist, true);
      });
    }

    function transitionTabPanels(mutator, name) {
      const oldPanel = getActiveTabPanel(name);
      if (currentMode === 'static' || typeof gsap?.timeline !== 'function' || !oldPanel) {
        const result = transitionWithDocument(mutator, name, documentRef);
        const newPanel = getActiveTabPanel(name);
        syncTabPanelTheme(newPanel);
        registerTabHighlights(documentRef);
        return result;
      }

      const rect = oldPanel.getBoundingClientRect?.();
      const snapshot = oldPanel.cloneNode?.(true);
      snapshot?.querySelectorAll?.('[id]').forEach((element) => element.removeAttribute?.('id'));
      snapshot?.removeAttribute?.('id');
      mutator?.();
      const newPanel = getActiveTabPanel(name);
      syncTabPanelTheme(newPanel);
      if (!snapshot || !rect || !documentRef?.body?.append) {
        if (newPanel) {
          const tween = gsap.fromTo(newPanel, { x: 22, autoAlpha: 0 }, {
            x: 0, autoAlpha: 1, duration: 0.38, ease: 'power3.out', clearProps: 'opacity,visibility,transform',
          });
          setElementResource(newPanel, 'tab', () => tween?.kill?.());
        }
        registerTabHighlights(documentRef);
        return null;
      }

      snapshot.hidden = false;
      snapshot.setAttribute?.('aria-hidden', 'true');
      snapshot.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:65;pointer-events:none;overflow:hidden;`;
      documentRef.body.append(snapshot);
      const timeline = gsap.timeline({ onComplete: () => snapshot.remove?.() });
      timeline.to(snapshot, { x: -22, autoAlpha: 0, duration: 0.26, ease: 'power2.in' }, 0);
      if (newPanel) {
        timeline.fromTo(newPanel, { x: 22, autoAlpha: 0 }, {
          x: 0,
          autoAlpha: 1,
          duration: 0.42,
          ease: 'power3.out',
          clearProps: 'opacity,visibility,transform',
        }, 0.04);
      }
      registerTabHighlights(documentRef);
      requestFrame(() => ScrollTrigger?.refresh?.());
      ownedAnimations.push(timeline);
      return timeline;
    }

    /* ========== Aggressive Toast Entry/Exit ========== */
    function registerToasts(root) {
      collect(root, '.social-toast').forEach((toast) => {
        if (registeredToasts.has(toast)) return;
        registeredToasts.add(toast);
        toast.setAttribute?.('data-toast-state', 'entering');
        if (currentMode === 'static' || typeof gsap?.fromTo !== 'function') {
          toast.setAttribute?.('data-toast-state', 'visible');
          return;
        }
        const tween = gsap.fromTo(toast, { autoAlpha: 0, y: 80, scale: 0.78 }, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.55,
          ease: 'back.out(1.8)',
          clearProps: 'opacity,visibility,transform',
          onComplete: () => { toast.setAttribute?.('data-toast-state', 'visible'); },
        });
        toastTweens.set(toast, tween);
        setElementResource(toast, 'toast', () => {
          tween?.kill?.();
          toastTweens.get(toast)?.kill?.();
          toastTweens.delete(toast);
        });
      });
    }

    function dismissToast(toast) {
      if (!toast) return null;
      toast.setAttribute?.('data-toast-state', 'leaving');
      toastTweens.get(toast)?.kill?.();
      if (currentMode === 'static' || typeof gsap?.to !== 'function') {
        toast.remove?.();
        return null;
      }
      const tween = gsap.to(toast, {
        autoAlpha: 0,
        y: -30,
        scale: 0.9,
        duration: 0.35,
        ease: 'power2.in',
        overwrite: true,
        onComplete: () => toast.remove?.(),
      });
      toastTweens.set(toast, tween);
      return tween;
    }

    function refresh(root = documentRef) {
      if (destroyed || !root) return activeController;
      cleanupDisconnectedElements();
      const revealsChanged = registerReveals(root);
      const cardsChanged = registerCards(root);
      const themesChanged = registerThemes(root);
      registerCounters(root);
      registerButtons(root);
      registerBreathingEffects(root);
      registerHeroMotion(root);
      registerDialogs(root);
      registerNotificationBells(root);
      registerTabHighlights(root);
      registerToasts(root);
      if ((revealsChanged || cardsChanged || themesChanged) && currentMode !== 'static') {
        ScrollTrigger?.refresh?.();
      }
      return activeController;
    }

    function scheduleRefresh(root = documentRef) {
      if (refreshFrame || destroyed) return;
      refreshFrame = requestFrame(() => {
        refreshFrame = 0;
        refresh(root);
      });
    }

    /* ========== Aggressive 4-Layer Pointer Parallax ========== */
    function setupPointerTracking() {
      const finePointer = windowRef?.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
      if (currentMode !== 'full' || finePointer === false || typeof gsap?.quickTo !== 'function') return;
      const glows = collect(documentRef, '.apple-glow');
      if (glows.length === 0) return;
      const layerConfigs = [
        { factor: 100, duration: 0.9 },   // blue — closest, fastest
        { factor: 140, duration: 1.1 },   // indigo
        { factor: 180, duration: 1.35 },  // purple
        { factor: 220, duration: 1.6 },   // pink — farthest, slowest
      ];
      const setters = glows.map((glow, index) => {
        const config = layerConfigs[index] || layerConfigs[layerConfigs.length - 1];
        return {
          x: gsap.quickTo(glow, 'x', { duration: config.duration, ease: 'power3.out' }),
          y: gsap.quickTo(glow, 'y', { duration: config.duration, ease: 'power3.out' }),
          factor: config.factor,
        };
      });
      let frame = 0;
      let point = null;
      const update = () => {
        frame = 0;
        if (!point) return;
        const x = (point.clientX / Math.max(1, Number(windowRef?.innerWidth || 1)) - 0.5) * 2;
        const y = (point.clientY / Math.max(1, Number(windowRef?.innerHeight || 1)) - 0.5) * 2;
        setters.forEach((setter) => {
          setter.x(x * setter.factor);
          setter.y(y * setter.factor * 0.7);
        });
      };
      const onPointerMove = (event) => {
        point = event;
        if (!frame) frame = requestFrame(update);
      };
      const reset = () => {
        point = null;
        setters.forEach((setter) => {
          setter.x(0);
          setter.y(0);
        });
      };
      listenForMotion(windowRef, 'pointermove', onPointerMove, { passive: true });
      listenForMotion(documentRef?.documentElement, 'pointerleave', reset, { passive: true });
      listenForMotion(windowRef, 'blur', reset);
      motionCleanups.push(() => cancelFrame(frame));
    }

    function resetMotion() {
      if (!pageEntranceComplete) pageEntrancePlayed = false;
      motionCleanups.splice(0).forEach((cleanup) => cleanup());
      clearElementResources();
      ownedAnimations.splice(0).forEach((animation) => animation?.kill?.());
      ownedInfiniteAnimations = [];
      ownedScrollTriggers.splice(0).forEach((trigger) => trigger?.kill?.());
      registeredCards = new Set();
      registeredReveals = new WeakSet();
      registeredThemes = new WeakSet();
      registeredButtons = new WeakSet();
      registeredBreathing = new WeakSet();
      registeredBells = new WeakSet();
      registeredHeroVisuals = new WeakSet();
      registeredTablists = new WeakSet();
      registeredToasts = new WeakSet();
    }

    const controller = {
      get mode() { return currentMode; },
      refresh,
      dismissToast,
      transition(mutator, name) {
        const reduced = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (reduced) {
          mutator?.();
          return null;
        }
        if (name === 'account-tab' || name === 'player-tab') return transitionTabPanels(mutator, name);
        const transition = transitionWithDocument(mutator, name, documentRef);
        if (String(name).includes('tab')) requestFrame(() => registerTabHighlights(documentRef));
        return transition;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        observer?.disconnect?.();
        observer = null;
        media?.revert?.();
        media = null;
        resetMotion();
        counterTweens.forEach?.((tween) => tween?.kill?.());
        cleanups.splice(0).forEach((cleanup) => cleanup());
        cancelFrame(refreshFrame);
        cancelFrame(scrollFrame);
        refreshFrame = 0;
        scrollFrame = 0;
        if (activeController === controller) activeController = null;
        if (globalScope.HYLAppleUI === controller) delete globalScope.HYLAppleUI;
      },
    };

    activeController = controller;
    globalScope.HYLAppleUI = controller;

    if (!documentRef || !body) return controller;
    setupNavigation();
    setupVisibilityControl();

    if (gsap && ScrollTrigger) {
      gsap.registerPlugin?.(ScrollTrigger);
      media = gsap.matchMedia?.();
      if (media?.add) {
        media.add({
          full: '(min-width: 901px)',
          compact: '(min-width: 720px) and (max-width: 900px)',
          light: '(max-width: 719px)',
          reduceMotion: '(prefers-reduced-motion: reduce)',
        }, (context) => {
          resetMotion();
          currentMode = context.conditions.reduceMotion
            ? 'static'
            : context.conditions.full ? 'full' : context.conditions.compact ? 'compact' : 'light';
          body.dataset.appleMotion = currentMode;
          setupPointerTracking();
          setupPageEntrance();
          refresh(documentRef);
          return resetMotion;
        });
      } else {
        currentMode = resolveAppleMotionMode({
          hasGsap: true,
          reduceMotion: windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
          width: windowRef?.innerWidth,
        });
        body.dataset.appleMotion = currentMode;
        setupPageEntrance();
        refresh(documentRef);
      }
    } else {
      currentMode = 'static';
      body.dataset.appleMotion = currentMode;
      refresh(documentRef);
    }

    const Observer = windowRef?.MutationObserver || globalScope.MutationObserver;
    if (typeof Observer === 'function') {
      observer = new Observer((mutations) => {
        cleanupDisconnectedElements();
        if (shouldRefreshForMutations(mutations, renderedCounterText)) scheduleRefresh(documentRef);
      });
      observer.observe(body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'hidden', 'open', 'aria-selected', 'data-apple-card', 'data-apple-counter',
          'data-apple-theme', 'data-apple-breathe', 'data-apple-hero-visual', 'data-toast-type',
        ],
      });
    }

    return controller;
  }

  const exported = {
    APPLE_CARD_EXCLUDE,
    getCardEntrance,
    getRevealMotion,
    getScrollProgress,
    getTabHighlightGeometry,
    getThemeState,
    isInteractiveCardCandidate,
    isThemeScopeCandidate,
    isUnreadBadgeActive,
    parseCounterText,
    registerAppleAnimations,
    resolveAppleMotionMode,
    cleanupDisconnectedCards,
    cleanupDisconnectedResources,
    shouldRefreshForMutations,
    syncInfiniteAnimations,
    transitionWithDocument,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  globalScope.registerAppleAnimations = registerAppleAnimations;

  if (typeof document !== 'undefined') {
    const mount = () => registerAppleAnimations();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
