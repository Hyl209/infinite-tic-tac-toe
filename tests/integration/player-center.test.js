const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

let player = {};
try {
  player = require('../../src/routes/player.js');
} catch {
  player = {};
}

class FakeElement extends EventTarget {
  constructor(dataset = {}) {
    super();
    this.dataset = { ...dataset };
    this.attributes = new Map();
    this.hidden = false;
    this.tabIndex = 0;
    this.textContent = '';
    this.focusCount = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.focusCount += 1;
  }
}

function createPlayerRuntimeHarness() {
  const tabList = new FakeElement();
  tabList.setAttribute('aria-orientation', 'vertical');
  const tabs = ['checkin', 'activities', 'notifications'].map((tab) => new FakeElement({ playerTab: tab }));
  const panels = ['checkin', 'activities', 'notifications'].map((tab) => new FakeElement({ playerPanel: tab }));
  const nodes = new Map([
    ['.player-tabs', tabList],
    ['#player-summary-name', new FakeElement()],
    ['#player-summary-kind', new FakeElement()],
    ['#player-summary-balance', new FakeElement()],
    ['#checkin-guest-state', new FakeElement()],
    ['#checkin-login-button', new FakeElement()],
    ['#player-message', new FakeElement()],
  ]);
  const media = new FakeElement();
  media.matches = false;
  const urls = [];
  let subscriptions = 0;
  let opens = 0;
  const accountClient = {};
  const economyClient = {};
  const accountPanel = {
    accountClient,
    economyClient,
    getIdentity: () => ({ kind: 'guest', displayName: '匿名玩家' }),
    getEconomySnapshot: () => ({ balance: 0 }),
    subscribe() {
      subscriptions += 1;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscriptions -= 1;
      };
    },
    open() {
      opens += 1;
    },
  };
  const keys = [
    'document', 'location', 'history', 'matchMedia', 'HYLAccountPanel',
    'PlayerCheckin', 'PlayerActivities', 'PlayerNotifications',
  ];
  const previous = new Map(keys.map((key) => [key, globalThis[key]]));
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === '[data-player-tab]') return tabs;
      if (selector === '[data-player-panel]') return panels;
      return [];
    },
    querySelector(selector) {
      return nodes.get(selector) || null;
    },
  };
  globalThis.location = { href: 'https://hhhyl.me/player/?tab=checkin' };
  globalThis.history = { replaceState(_state, _title, url) { urls.push(url); } };
  globalThis.matchMedia = () => media;
  globalThis.HYLAccountPanel = { mount: () => accountPanel };
  globalThis.PlayerCheckin = { createCheckinClient: () => ({}) };
  globalThis.PlayerActivities = { createActivitiesClient: () => ({}) };
  globalThis.PlayerNotifications = { createNotificationsClient: () => ({}) };

  return {
    media,
    nodes,
    panels,
    tabList,
    tabs,
    urls,
    get opens() { return opens; },
    get subscriptions() { return subscriptions; },
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

function keyEvent(key) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

test('player center loads the shared clients and engagement services in dependency order', () => {
  const html = read('./player/index.html');
  const scripts = [
    '/src/config/online.js',
    '/src/utils/room-code.js',
    '/src/services/online.js',
    '/src/services/account.js',
    '/src/services/economy.js',
    '/src/services/stats.js',
    '/src/services/checkin.js',
    '/src/services/activities.js',
    '/src/services/notifications.js',
    '/src/routes/account-panel.js',
    '/src/routes/player.js',
  ];
  const positions = scripts.map((src) => html.indexOf(`src="${src}"`));

  assert.ok(positions.every((position) => position >= 0), 'player scripts are incomplete');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(html, /href="\/assets\/styles\/game\.css"/);
  assert.match(html, /href="\/assets\/styles\/portal\.css"/);
  assert.match(html, /href="\/assets\/styles\/player\.css"/);
});

test('player center exposes stable, keyboard-reachable tabs and live status', () => {
  const html = read('./player/index.html');

  for (const id of [
    'player-summary',
    'player-tab-checkin',
    'player-tab-activities',
    'player-tab-notifications',
    'checkin-calendar',
    'activity-list',
    'notification-list',
    'player-message',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="player-tab-checkin"[^>]*type="button"[^>]*role="tab"/);
  assert.match(html, /id="player-tab-activities"[^>]*type="button"[^>]*role="tab"/);
  assert.match(html, /id="player-tab-notifications"[^>]*type="button"[^>]*role="tab"/);
  assert.match(html, /id="player-message"[^>]*aria-live="polite"/);
  assert.match(html, /id="checkin-login-button"[^>]*type="button"/);
  assert.match(html, /id="account-button"[^>]*aria-label="打开账号面板"/);
  assert.match(html, /游客[^<]*(?:活动|通知)|(?:活动|通知)[^<]*游客/);
});

test('player route normalizes tabs and preserves an activity deep link', () => {
  assert.equal(typeof player.normalizePlayerTab, 'function');
  assert.equal(typeof player.readPlayerRoute, 'function');
  assert.equal(player.normalizePlayerTab('checkin'), 'checkin');
  assert.equal(player.normalizePlayerTab('activities'), 'activities');
  assert.equal(player.normalizePlayerTab('notifications'), 'notifications');
  assert.equal(player.normalizePlayerTab('invalid'), 'checkin');

  assert.deepEqual(
    player.readPlayerRoute('https://hhhyl.me/player/?tab=activities&activity=550e8400-e29b-41d4-a716-446655440000'),
    {
      tab: 'activities',
      activity: '550e8400-e29b-41d4-a716-446655440000',
    },
  );
  assert.deepEqual(player.readPlayerRoute('https://hhhyl.me/player/?tab=wrong'), {
    tab: 'checkin',
    activity: null,
  });
});

test('player route reuses the account panel clients for all engagement services', () => {
  const source = read('./src/routes/player.js');

  assert.match(source, /HYLAccountPanel\?*\.mount\s*\(/);
  assert.doesNotMatch(source, /createAccountClient\s*\(/);
  assert.doesNotMatch(source, /createEconomyClient\s*\(/);
  assert.match(source, /createCheckinClient\s*\(\s*\{\s*accountClient\s*\}\s*\)/);
  assert.match(source, /createActivitiesClient\s*\(\s*\{\s*accountClient\s*\}\s*\)/);
  assert.match(source, /createNotificationsClient\s*\(\s*\{\s*accountClient\s*\}\s*\)/);
  assert.match(source, /getIdentity\s*\(/);
  assert.match(source, /getEconomySnapshot\s*\(/);
  assert.match(source, /subscribe\s*\(/);
});

test('player tabs update the URL without reloading and mount only in a browser', () => {
  const source = read('./src/routes/player.js');

  assert.match(source, /history\.replaceState\s*\(/);
  assert.doesNotMatch(source, /location\.reload\s*\(/);
  assert.match(source, /typeof document !== ['"]undefined['"]/);
  assert.match(source, /addEventListener\s*\(\s*['"]click['"]/);
});

test('player tab arrow navigation keeps focus in the tab list', () => {
  const source = read('./src/routes/player.js');

  assert.match(source, /button\?\.focus\s*\(/);
  assert.doesNotMatch(source, /data-player-panel[^\n]+\.focus\s*\(/);
});

test('player runtime synchronizes responsive tab orientation and arrow keys', () => {
  const harness = createPlayerRuntimeHarness();
  let instance;
  try {
    instance = player.mount();
    assert.equal(harness.tabList.getAttribute('aria-orientation'), 'vertical');

    harness.media.matches = true;
    harness.media.dispatchEvent(new Event('change'));
    assert.equal(harness.tabList.getAttribute('aria-orientation'), 'horizontal');

    harness.tabs[0].dispatchEvent(keyEvent('ArrowDown'));
    assert.equal(harness.urls.length, 0);
    harness.tabs[0].dispatchEvent(keyEvent('ArrowRight'));
    assert.equal(harness.urls.length, 1);
    assert.match(harness.urls[0], /tab=activities/);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('player destroy removes handlers and an old instance cannot clear a new mount', () => {
  const harness = createPlayerRuntimeHarness();
  let first;
  let second;
  try {
    first = player.mount();
    harness.tabs[1].dispatchEvent(new Event('click'));
    assert.equal(harness.urls.length, 1);
    first.destroy();
    assert.equal(harness.subscriptions, 0);

    second = player.mount();
    first.destroy();
    assert.equal(player.mount(), second);
    harness.tabs[2].dispatchEvent(new Event('click'));
    assert.equal(harness.urls.length, 2);

    second.destroy();
    harness.tabs[0].dispatchEvent(new Event('click'));
    assert.equal(harness.urls.length, 2);
  } finally {
    second?.destroy();
    first?.destroy();
    harness.restore();
  }
});

test('player styles preserve the Black Obsidian system on narrow and reduced-motion screens', () => {
  const css = read('./assets/styles/player.css');

  assert.match(css, /var\(--portal-bg\)/);
  assert.match(css, /Onest/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(max-width:\s*759px\)/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /background-clip:\s*text/);
  assert.doesNotMatch(css, /backdrop-filter/);
});
