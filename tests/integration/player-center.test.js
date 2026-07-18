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
