const test = require('node:test');
const assert = require('node:assert/strict');

let apple = {};
try {
  apple = require('../../src/ui/apple-animations.js');
} catch {
  apple = {};
}

test('Apple motion mode safely degrades by capability and viewport', () => {
  assert.equal(apple.resolveAppleMotionMode({ hasGsap: false, reduceMotion: false, width: 1440 }), 'static');
  assert.equal(apple.resolveAppleMotionMode({ hasGsap: true, reduceMotion: true, width: 1440 }), 'static');
  assert.equal(apple.resolveAppleMotionMode({ hasGsap: true, reduceMotion: false, width: 390 }), 'light');
  assert.equal(apple.resolveAppleMotionMode({ hasGsap: true, reduceMotion: false, width: 820 }), 'compact');
  assert.equal(apple.resolveAppleMotionMode({ hasGsap: true, reduceMotion: false, width: 1440 }), 'full');
});

test('scroll progress is clamped and handles pages without scroll range', () => {
  assert.equal(apple.getScrollProgress({ scrollY: -20, scrollHeight: 2000, viewportHeight: 1000 }), 0);
  assert.equal(apple.getScrollProgress({ scrollY: 500, scrollHeight: 2000, viewportHeight: 1000 }), 0.5);
  assert.equal(apple.getScrollProgress({ scrollY: 4000, scrollHeight: 2000, viewportHeight: 1000 }), 1);
  assert.equal(apple.getScrollProgress({ scrollY: 20, scrollHeight: 800, viewportHeight: 800 }), 0);
});

test('card entrance uses the shared Apple reveal contract', () => {
  assert.deepEqual(apple.getCardEntrance(), {
    autoAlpha: 0,
    y: 32,
    scale: 0.92,
  });
});

test('section themes change aura opacity, size, and position without tweening gradients', () => {
  const blue = apple.getThemeState('blue');
  const indigo = apple.getThemeState('indigo');
  const purple = apple.getThemeState('purple');
  const pink = apple.getThemeState('pink');

  assert.ok(blue['--apple-glow-blue-opacity'] > blue['--apple-glow-indigo-opacity']);
  assert.ok(indigo['--apple-glow-indigo-opacity'] > indigo['--apple-glow-blue-opacity']);
  assert.ok(purple['--apple-glow-purple-opacity'] > purple['--apple-glow-blue-opacity']);
  assert.ok(pink['--apple-glow-pink-opacity'] > pink['--apple-glow-purple-opacity']);
  assert.notEqual(blue['--apple-glow-blue-scale'], indigo['--apple-glow-blue-scale']);
  assert.match(String(blue['--apple-glow-blue-theme-x']), /px$/);
  assert.match(String(purple['--apple-glow-purple-theme-y']), /px$/);
});

test('scroll reveals alternate direction for interactive content and stay aggressive for sections', () => {
  assert.deepEqual(apple.getRevealMotion({ interactive: true, index: 0, total: 1 }), {
    autoAlpha: 0,
    x: -120,
    y: 52,
    scale: 0.88,
    rotate: -3,
    ease: 'back.out(1.55)',
    delay: 0,
  });
  assert.deepEqual(apple.getRevealMotion({ interactive: true, index: 3, total: 4 }), {
    autoAlpha: 0,
    x: 120,
    y: 52,
    scale: 0.88,
    rotate: 3,
    ease: 'back.out(1.55)',
    delay: 0.3,
  });
  assert.deepEqual(apple.getRevealMotion({ interactive: false, index: 2 }), {
    autoAlpha: 0,
    x: 0,
    y: 90,
    scale: 0.94,
    ease: 'power4.out',
    delay: 0,
  });
});

test('tilt eligibility is limited to real interactive cards', () => {
  assert.equal(apple.isInteractiveCardCandidate({ tagName: 'A', href: '/game/' }), true);
  assert.equal(apple.isInteractiveCardCandidate({ tagName: 'BUTTON' }), true);
  assert.equal(apple.isInteractiveCardCandidate({ tagName: 'ARTICLE', role: 'link' }), true);
  assert.equal(apple.isInteractiveCardCandidate({ tagName: 'ARTICLE' }), false);
  assert.equal(apple.isInteractiveCardCandidate({ tagName: 'BUTTON', disabled: true }), false);
});

test('tab highlight geometry uses local layout metrics and skips hidden tabs', () => {
  const tablist = { offsetWidth: 398, offsetHeight: 56 };
  const activeTab = {
    offsetParent: tablist,
    offsetLeft: 6,
    offsetTop: 6,
    offsetWidth: 190,
    offsetHeight: 44,
    getBoundingClientRect() {
      return { left: 527, top: 388.5, width: 178.6, height: 41.36 };
    },
  };

  assert.deepEqual(apple.getTabHighlightGeometry(tablist, activeTab), {
    x: 6,
    y: 6,
    width: 190,
    height: 44,
  });
  assert.equal(apple.getTabHighlightGeometry(tablist, { ...activeTab, offsetWidth: 0 }), null);
});

test('only semantic sections or explicit scopes can control the global aura theme', () => {
  assert.equal(apple.isThemeScopeCandidate({ tagName: 'SECTION' }), true);
  assert.equal(apple.isThemeScopeCandidate({ tagName: 'HEADER' }), true);
  assert.equal(apple.isThemeScopeCandidate({ tagName: 'A' }), false);
  assert.equal(apple.isThemeScopeCandidate({ tagName: 'ARTICLE' }), false);
  assert.equal(apple.isThemeScopeCandidate({ tagName: 'DIV', explicit: true }), true);
});

test('visibility control pauses and resumes only infinite owned animations', () => {
  const calls = [];
  const infinite = { repeat: () => -1, pause: () => calls.push('pause'), play: () => calls.push('play') };
  const finite = { repeat: () => 0, pause: () => calls.push('finite-pause'), play: () => calls.push('finite-play') };

  apple.syncInfiniteAnimations([infinite, finite], true);
  apple.syncInfiniteAnimations([infinite, finite], false);
  assert.deepEqual(calls, ['pause', 'play']);
});

test('unread bell activates only for a visible positive badge', () => {
  assert.equal(apple.isUnreadBadgeActive({ hidden: false, textContent: '3' }), true);
  assert.equal(apple.isUnreadBadgeActive({ hidden: true, textContent: '3' }), false);
  assert.equal(apple.isUnreadBadgeActive({ hidden: false, textContent: '0' }), false);
});

test('counter parsing preserves surrounding copy and decimal precision', () => {
  assert.deepEqual(apple.parseCounterText('金币 1,234'), {
    value: 1234,
    prefix: '金币 ',
    suffix: '',
    decimals: 0,
  });
  assert.deepEqual(apple.parseCounterText('胜率 62.5%'), {
    value: 62.5,
    prefix: '胜率 ',
    suffix: '%',
    decimals: 1,
  });
  assert.equal(apple.parseCounterText('暂无赛季'), null);
});

test('View Transition uses the browser API and falls back synchronously', async () => {
  const calls = [];
  const transition = {
    finished: Promise.resolve(),
  };
  const documentRef = {
    documentElement: { dataset: {} },
    startViewTransition(mutator) {
      calls.push('start');
      mutator();
      return transition;
    },
  };

  const returned = apple.transitionWithDocument(() => calls.push('mutate'), 'player-tab', documentRef);
  assert.equal(returned, transition);
  assert.deepEqual(calls, ['start', 'mutate']);
  await returned.finished;
  assert.equal(documentRef.documentElement.dataset.appleTransition, undefined);

  let fallback = 0;
  const fallbackResult = apple.transitionWithDocument(() => { fallback += 1; }, 'fallback', {});
  assert.equal(fallback, 1);
  assert.equal(fallbackResult, null);
});

test('View Transition keeps the mutator synchronous when the browser defers its callback', () => {
  let callback = null;
  let mutations = 0;
  const documentRef = {
    documentElement: { dataset: {} },
    startViewTransition(next) {
      callback = next;
      return { finished: Promise.resolve() };
    },
  };

  apple.transitionWithDocument(() => { mutations += 1; }, 'game-board', documentRef);
  assert.equal(mutations, 1);
  callback();
  assert.equal(mutations, 1);
});

test('counter observer ignores module-rendered frames but accepts external targets', () => {
  assert.equal(typeof apple.shouldRefreshForMutations, 'function');
  const counter = {
    textContent: '42',
    matches(selector) { return selector === '[data-apple-counter]'; },
  };
  const rendered = new WeakMap([[counter, '42']]);

  assert.equal(apple.shouldRefreshForMutations([{ target: counter }], rendered), false);
  counter.textContent = '100';
  assert.equal(apple.shouldRefreshForMutations([{ target: counter }], rendered), true);
});

test('disconnected cards release their owned animation, trigger, and listeners', () => {
  assert.equal(typeof apple.cleanupDisconnectedCards, 'function');
  const card = { isConnected: false };
  const registered = new Set([card]);
  let cleanups = 0;
  const resources = new Map([[card, () => { cleanups += 1; }]]);

  apple.cleanupDisconnectedCards(resources, registered);
  assert.equal(cleanups, 1);
  assert.equal(resources.size, 0);
  assert.equal(registered.has(card), false);
});

test('disconnected reveal and control resources are cleaned from every registry', () => {
  assert.equal(typeof apple.cleanupDisconnectedResources, 'function');
  const removed = { isConnected: false };
  const connected = { isConnected: true };
  const reveals = new Set([removed, connected]);
  const buttons = new Set([removed, connected]);
  const calls = [];
  const resources = new Map([
    [removed, new Map([
      ['reveal', () => calls.push('reveal')],
      ['button', () => calls.push('button')],
    ])],
    [connected, new Map([['reveal', () => calls.push('connected')]])],
  ]);

  apple.cleanupDisconnectedResources(resources, [reveals, buttons]);
  assert.deepEqual(calls.sort(), ['button', 'reveal']);
  assert.equal(resources.has(removed), false);
  assert.equal(resources.has(connected), true);
  assert.equal(reveals.has(removed), false);
  assert.equal(buttons.has(removed), false);
});

test('registration is idempotent and destroy allows a clean re-registration', () => {
  const first = apple.registerAppleAnimations({ document: null, window: null });
  const second = apple.registerAppleAnimations({ document: null, window: null });
  assert.equal(first, second);
  assert.equal(globalThis.HYLAppleUI, first);

  first.destroy();
  const third = apple.registerAppleAnimations({ document: null, window: null });
  assert.notEqual(third, first);
  third.destroy();
});
