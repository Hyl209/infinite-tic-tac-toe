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
  constructor(dataset = {}, tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.dataset = { ...dataset };
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.tabIndex = 0;
    this.disabled = false;
    this.id = '';
    this.className = '';
    this.open = false;
    this._textContent = '';
    this.focusCount = 0;
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  set innerHTML(_value) {
    throw new Error('UNSAFE_INNER_HTML');
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

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = /^\[data-([a-z-]+)(?:="([^"]+)")?\]$/.exec(selector);
    if (!attribute) return this.tagName.toLowerCase() === selector.toLowerCase();
    const key = attribute[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return Object.hasOwn(this.dataset, key) && (attribute[2] == null || this.dataset[key] === attribute[2]);
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

function createPlayerRuntimeHarness({
  identity = { kind: 'guest', displayName: '匿名玩家' },
  locationHref = 'https://hhhyl.me/player/?tab=checkin',
  month = [],
  getMonth = async () => month,
  checkIn = async () => null,
  makeUp = async () => null,
  mapError = () => '签到失败，请稍后重试',
  activities = [],
  listActivities = async () => activities,
  claimActivity = async () => null,
  mapActivitiesError = () => '活动服务暂时不可用，请稍后重试',
  notifications = [],
  listNotifications = async () => notifications,
  markRead = async () => null,
  claimNotification = async () => null,
  mapNotificationsError = () => '通知服务暂时不可用，请稍后重试',
} = {}) {
  const tabList = new FakeElement();
  tabList.setAttribute('aria-orientation', 'vertical');
  const tabs = ['checkin', 'activities', 'notifications'].map((tab) => new FakeElement({ playerTab: tab }));
  const panels = ['checkin', 'activities', 'notifications'].map((tab) => new FakeElement({ playerPanel: tab }));
  const calendar = new FakeElement();
  const activityList = new FakeElement();
  const notificationList = new FakeElement();
  const nodes = new Map([
    ['.player-tabs', tabList],
    ['#player-summary-name', new FakeElement()],
    ['#player-summary-kind', new FakeElement()],
    ['#player-summary-balance', new FakeElement()],
    ['#checkin-guest-state', new FakeElement()],
    ['#checkin-login-button', new FakeElement()],
    ['#checkin-calendar', calendar],
    ['#activity-list', activityList],
    ['#notification-list', notificationList],
    ['#player-message', new FakeElement()],
  ]);
  const media = new FakeElement();
  media.matches = false;
  const urls = [];
  let subscriptions = 0;
  let opens = 0;
  let economyRefreshes = 0;
  const checkinCalls = [];
  const monthCalls = [];
  const activityCalls = [];
  const notificationCalls = [];
  const accountClient = {};
  const economyClient = { refresh: async () => ({ balance: 0, isAdmin: false, loaded: true }) };
  const checkinClient = {
    async getMonth(value) {
      monthCalls.push(value);
      return getMonth(value);
    },
    async checkIn(requestId) {
      checkinCalls.push({ type: 'checkin', requestId });
      return checkIn(requestId);
    },
    async makeUp(date, paymentMethod, requestId) {
      checkinCalls.push({ type: 'makeup', date, paymentMethod, requestId });
      return makeUp(date, paymentMethod, requestId);
    },
  };
  const activitiesClient = {
    async listActive() {
      activityCalls.push({ type: 'list' });
      return listActivities();
    },
    async claimReward(activityId, requestId) {
      activityCalls.push({ type: 'claim', activityId, requestId });
      return claimActivity(activityId, requestId);
    },
  };
  const notificationsClient = {
    async list() {
      notificationCalls.push({ type: 'list' });
      return listNotifications();
    },
    async markRead(notificationId) {
      notificationCalls.push({ type: 'read', notificationId });
      return markRead(notificationId);
    },
    async claimReward(notificationId, requestId) {
      notificationCalls.push({ type: 'claim', notificationId, requestId });
      return claimNotification(notificationId, requestId);
    },
  };
  const accountPanel = {
    accountClient,
    economyClient,
    getIdentity: () => identity,
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
    async refreshEconomy() {
      economyRefreshes += 1;
      return { balance: 0, isAdmin: false, loaded: true };
    },
  };
  const keys = [
    'document', 'location', 'history', 'matchMedia', 'HYLAccountPanel',
    'PlayerCheckin', 'PlayerActivities', 'PlayerNotifications',
  ];
  const previous = new Map(keys.map((key) => [key, globalThis[key]]));
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement({}, tagName);
    },
    querySelectorAll(selector) {
      if (selector === '[data-player-tab]') return tabs;
      if (selector === '[data-player-panel]') return panels;
      return [];
    },
    querySelector(selector) {
      return nodes.get(selector) || null;
    },
  };
  globalThis.location = { href: locationHref };
  globalThis.history = {
    replaceState(_state, _title, url) {
      urls.push(url);
      globalThis.location.href = new URL(url, globalThis.location.href).href;
    },
  };
  globalThis.matchMedia = () => media;
  globalThis.HYLAccountPanel = { mount: () => accountPanel };
  globalThis.PlayerCheckin = {
    createCheckinClient: () => checkinClient,
    mapCheckinError: mapError,
  };
  globalThis.PlayerActivities = {
    createActivitiesClient: () => activitiesClient,
    mapActivitiesError,
  };
  globalThis.PlayerNotifications = {
    createNotificationsClient: () => notificationsClient,
    mapNotificationsError,
  };

  return {
    media,
    calendar,
    activityList,
    notificationList,
    activityCalls,
    notificationCalls,
    checkinCalls,
    monthCalls,
    nodes,
    panels,
    tabList,
    tabs,
    urls,
    get opens() { return opens; },
    get economyRefreshes() { return economyRefreshes; },
    get subscriptions() { return subscriptions; },
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

function createMonthSnapshot(year, month, overrides = {}) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_value, index) => {
    const day = index + 1;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
      checkinDate: date,
      rewardAmount: day,
      checkedIn: false,
      checkinType: null,
      paymentMethod: null,
      paymentAmount: null,
      isToday: false,
      canMakeup: false,
      makeupCost: 20,
      ...(overrides[date] || {}),
    };
  });
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
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

test('activities render safe cards and a deep-linked detail with a cover fallback and validated action URL', async () => {
  const malicious = '<img src=x onerror="globalThis.pwned=true">';
  const activities = [{
    id: 'activity-1',
    title: `夏日活动 ${malicious}`,
    body: `正文 ${malicious}`,
    coverUrl: 'https://cdn.hhhyl.me/activity.webp',
    actionLabel: '查看规则',
    actionUrl: 'https://hhhyl.me/rules/summer',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T12:00:00.000Z',
    rewardAmount: 0,
    claimed: false,
  }];
  const harness = createPlayerRuntimeHarness({
    locationHref: 'https://hhhyl.me/player/?tab=activities&activity=activity-1',
    activities,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();

    const card = harness.activityList.querySelector('[data-activity-id="activity-1"]');
    const detail = harness.activityList.querySelector('[data-activity-detail="activity-1"]');
    assert.ok(card);
    assert.ok(detail);
    assert.match(card.textContent, /夏日活动 <img src=x/);
    assert.match(card.textContent, /7 月 1 日.*7 月 31 日/);
    assert.match(card.textContent, /无金币奖励/);
    assert.match(card.textContent, /查看活动/);
    assert.equal(detail.querySelector('.activity-detail-body').textContent, `正文 ${malicious}`);
    assert.equal(detail.querySelector('img'), null, 'admin body must stay text, not markup');

    const action = detail.querySelector('[data-activity-action]');
    assert.equal(action.href, 'https://hhhyl.me/rules/summer');
    assert.equal(action.target, '_blank');
    assert.equal(action.rel, 'noopener noreferrer');

    const cover = card.querySelector('[data-activity-cover]');
    cover.dispatchEvent(new Event('error'));
    assert.equal(cover.hidden, true);
    assert.match(card.textContent, /封面不可用/);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('activity rewards prevent duplicate submission, update the card and wallet, and accept already-claimed replies', async () => {
  let resolveClaim;
  const pending = new Promise((resolve) => { resolveClaim = resolve; });
  let attempts = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    activities: [
      { id: 'reward-1', title: '首发奖励', body: '奖励正文', rewardAmount: 12, claimed: false },
      { id: 'reward-2', title: '重复奖励', body: '重复正文', rewardAmount: 6, claimed: false },
    ],
    claimActivity: async (activityId) => {
      if (activityId === 'reward-1') return pending;
      attempts += 1;
      throw new Error(attempts === 1 ? 'NETWORK_FAILED' : 'ACTIVITY_ALREADY_CLAIMED');
    },
    mapActivitiesError: (error) => (
      String(error.message).includes('ALREADY') ? '活动奖励已经领取' : '活动领取失败，可重试'
    ),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const first = harness.activityList.querySelector('[data-activity-claim="reward-1"]');
    first.dispatchEvent(new Event('click'));
    first.dispatchEvent(new Event('click'));
    assert.equal(first.disabled, true);
    assert.equal(harness.activityCalls.filter((call) => call.type === 'claim' && call.activityId === 'reward-1').length, 1);
    resolveClaim({ rewardAmount: 12, balance: 112, claimedAt: '2026-07-18T00:00:00.000Z' });
    await flushPromises();
    await flushPromises();
    assert.equal(harness.activityList.querySelector('[data-activity-claim="reward-1"]').textContent, '已领取');
    assert.equal(harness.economyRefreshes, 1);

    let second = harness.activityList.querySelector('[data-activity-claim="reward-2"]');
    second.dispatchEvent(new Event('click'));
    await flushPromises();
    assert.equal(second.disabled, false);
    assert.equal(harness.nodes.get('#player-message').textContent, '活动领取失败，可重试');
    second.dispatchEvent(new Event('click'));
    await flushPromises();
    second = harness.activityList.querySelector('[data-activity-claim="reward-2"]');
    assert.equal(second.textContent, '已领取');
    assert.equal(second.disabled, true);
    assert.match(harness.activityList.textContent, /重复奖励.*已领取/);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('activity empty, retry, guest claim, and unavailable deep-link states use explicit Chinese copy', async () => {
  let loads = 0;
  const harness = createPlayerRuntimeHarness({
    locationHref: 'https://hhhyl.me/player/?tab=activities&activity=removed-activity',
    listActivities: async () => {
      loads += 1;
      if (loads === 1) throw new Error('NETWORK_FAILED');
      if (loads === 2) return [];
      return [{ id: 'reward', title: '登录奖励', body: '请登录', rewardAmount: 5, claimed: false }];
    },
    mapActivitiesError: () => '活动加载失败，请重试',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    assert.match(harness.activityList.textContent, /活动加载失败，请重试/);
    harness.activityList.querySelector('[data-activity-retry]').dispatchEvent(new Event('click'));
    await flushPromises();
    assert.match(harness.activityList.textContent, /暂无可参与的活动/);
    assert.match(harness.nodes.get('#player-message').textContent, /活动已下架或不可用/);

    instance.refreshActivities();
    await flushPromises();
    const claim = harness.activityList.querySelector('[data-activity-claim="reward"]');
    claim.dispatchEvent(new Event('click'));
    assert.equal(harness.activityCalls.filter((call) => call.type === 'claim').length, 0);
    assert.equal(harness.nodes.get('#player-message').textContent, '请先登录正式账号领取活动奖励');
    assert.equal(harness.opens, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('notifications sort newest first and keep detail read state independent from reward claims', async () => {
  const notifications = [
    {
      id: 'old', activityId: null, title: '旧通知', body: '旧正文', rewardAmount: null,
      visibleAt: '2026-07-01T00:00:00.000Z', expiresAt: null, actionUrl: null,
      isRead: true, rewardClaimed: false,
    },
    {
      id: 'new', activityId: 'activity-1', title: '新通知', body: '新正文', rewardAmount: 9,
      visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: '2099-07-30T00:00:00.000Z', actionUrl: null,
      isRead: false, rewardClaimed: false,
    },
  ];
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    notifications,
    markRead: async () => ({ notificationId: 'new', readAt: '2026-07-18T08:01:00.000Z' }),
    claimNotification: async () => ({ rewardAmount: 9, balance: 109, claimedAt: '2026-07-18T08:02:00.000Z' }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const items = harness.notificationList.querySelectorAll('[data-notification-id]');
    assert.equal(items[0].dataset.notificationId, 'new');
    assert.match(items[0].textContent, /新正文/);
    assert.ok(items[0].querySelector('[data-notification-unread]'));
    assert.match(items[0].textContent, /奖励 9 金币.*未领取/);

    items[0].querySelector('[data-notification-open="new"]').dispatchEvent(new Event('click'));
    await flushPromises();
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'read').length, 1);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'claim').length, 0);
    assert.equal(harness.notificationList.querySelector('[data-notification-id="new"]').querySelector('[data-notification-unread]'), null);

    const claim = harness.notificationList.querySelector('[data-notification-claim="new"]');
    claim.dispatchEvent(new Event('click'));
    claim.dispatchEvent(new Event('click'));
    await flushPromises();
    await flushPromises();
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'claim').length, 1);
    assert.equal(harness.notificationList.querySelector('[data-notification-claim="new"]').textContent, '已领取');
    assert.equal(harness.economyRefreshes, 1);

    harness.notificationList.querySelector('[data-notification-activity="activity-1"]').dispatchEvent(new Event('click'));
    assert.match(harness.urls.at(-1), /tab=activities&activity=activity-1/);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('notifications expose empty, retry, guest, expired, and disabled activity states', async () => {
  let loads = 0;
  const harness = createPlayerRuntimeHarness({
    notifications: [],
    listNotifications: async () => {
      loads += 1;
      if (loads === 1) throw new Error('NETWORK_FAILED');
      if (loads === 2) return [];
      return [{
        id: 'expired', activityId: 'disabled-activity', title: '过期通知', body: '已失效正文',
        rewardAmount: 4, visibleAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z',
        actionUrl: null, isRead: false, rewardClaimed: false,
      }, {
        id: 'retry', activityId: null, title: '可重试通知', body: '重试正文',
        rewardAmount: 3, visibleAt: '2099-01-01T00:00:00.000Z', expiresAt: null,
        actionUrl: null, isRead: true, rewardClaimed: false,
      }];
    },
    mapNotificationsError: () => '通知操作失败，可重试',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    assert.match(harness.notificationList.textContent, /通知加载失败|通知操作失败，可重试/);
    harness.notificationList.querySelector('[data-notification-retry]').dispatchEvent(new Event('click'));
    await flushPromises();
    assert.match(harness.notificationList.textContent, /暂无通知/);

    instance.refreshNotifications();
    await flushPromises();
    const expired = harness.notificationList.querySelector('[data-notification-id="expired"]');
    assert.match(expired.textContent, /已过期/);
    assert.equal(expired.querySelector('[data-notification-claim="expired"]').disabled, true);
    expired.querySelector('[data-notification-activity="disabled-activity"]').dispatchEvent(new Event('click'));
    assert.equal(harness.nodes.get('#player-message').textContent, '关联活动可能已下架，请在活动页确认');

    const retry = harness.notificationList.querySelector('[data-notification-claim="retry"]');
    retry.dispatchEvent(new Event('click'));
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'claim').length, 0);
    assert.equal(harness.nodes.get('#player-message').textContent, '请先登录正式账号领取通知奖励');
    assert.equal(harness.opens, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('player check-in helpers build a labeled Monday-first calendar including leap day', () => {
  assert.equal(typeof player.buildCalendarCells, 'function');
  assert.equal(typeof player.getCheckinAction, 'function');
  assert.equal(typeof player.formatCoinDelta, 'function');

  const august = createMonthSnapshot(2026, 8, {
    '2026-08-01': { checkedIn: true, checkinType: 'daily' },
    '2026-08-02': { checkedIn: true, checkinType: 'makeup' },
    '2026-08-03': { canMakeup: true },
    '2026-08-04': { isToday: true },
  });
  const cells = player.buildCalendarCells(august);

  assert.equal(cells.filter((cell) => cell.kind === 'empty').length, 5);
  assert.equal(cells.find((cell) => cell.date === '2026-08-01').statusLabel, '已签到');
  assert.equal(cells.find((cell) => cell.date === '2026-08-02').statusLabel, '已补签');
  assert.equal(cells.find((cell) => cell.date === '2026-08-03').statusLabel, '可补签');
  assert.equal(cells.find((cell) => cell.date === '2026-08-05').statusLabel, '未来日期');
  assert.equal(cells.at(-1).date, '2026-08-31');

  const leapCells = player.buildCalendarCells(createMonthSnapshot(2028, 2));
  assert.ok(leapCells.some((cell) => cell.date === '2028-02-29'));
  assert.equal(leapCells.filter((cell) => cell.kind === 'day').length, 29);
  assert.equal(player.formatCoinDelta(8), '+8 金币');
  assert.equal(player.formatCoinDelta(-12), '-12 金币');
  assert.equal(player.formatCoinDelta(0), '0 金币');
});

test('check-in actions respect Hong Kong month boundaries and never turn today into makeup', () => {
  assert.deepEqual(player.getCheckinAction({
    checkinDate: '2026-08-01', rewardAmount: 6, checkedIn: false, isToday: true, canMakeup: true,
  }, '2026-08-01'), {
    type: 'checkin', label: '签到领取 6 金币', rewardAmount: 6,
  });
  assert.deepEqual(player.getCheckinAction({
    checkinDate: '2026-07-31', rewardAmount: 5, checkedIn: false, isToday: true, canMakeup: true,
  }, '2026-07-31'), {
    type: 'checkin', label: '签到领取 5 金币', rewardAmount: 5,
  });
  assert.equal(player.getCheckinAction({
    checkinDate: '2026-08-02', checkedIn: false, canMakeup: true,
  }, '2026-08-01'), null);
  assert.equal(player.getCheckinAction({
    checkinDate: '2026-07-31', checkedIn: false, canMakeup: true,
  }, '2026-08-01'), null);
  assert.deepEqual(player.getCheckinAction({
    checkinDate: '2026-08-01', rewardAmount: 4, checkedIn: false, canMakeup: true, makeupCost: 20,
  }, '2026-08-02'), {
    type: 'makeup', label: '补签 8 月 1 日', rewardAmount: 4, makeupCost: 20, netAmount: -16,
  });
});

test('daily check-in renders its reward and duplicate clicks submit one UUID request', async () => {
  let finishCheckin;
  const pending = new Promise((resolve) => { finishCheckin = resolve; });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    month: [{
      checkinDate: today, rewardAmount: 8, checkedIn: false, checkinType: null,
      paymentMethod: null, paymentAmount: null, isToday: true, canMakeup: false, makeupCost: 20,
    }],
    checkIn: () => pending,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const button = harness.calendar.querySelector('[data-checkin-action="checkin"]');
    assert.ok(button);
    assert.equal(button.textContent, '签到领取 8 金币');

    button.dispatchEvent(new Event('click'));
    button.dispatchEvent(new Event('click'));
    assert.equal(button.disabled, true);
    assert.equal(harness.checkinCalls.length, 1);
    assert.match(harness.checkinCalls[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    finishCheckin({ rewardAmount: 8, balance: 108 });
    await flushPromises();
    await flushPromises();
    assert.equal(harness.monthCalls.length, 2);
    assert.equal(harness.economyRefreshes, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('calendar exposes signed, makeup, available, and future states as visible and aria text', async () => {
  const month = createMonthSnapshot(2026, 8, {
    '2026-08-01': { checkedIn: true, checkinType: 'daily' },
    '2026-08-02': { checkedIn: true, checkinType: 'makeup' },
    '2026-08-03': { canMakeup: true },
    '2026-08-04': { isToday: true },
  });
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    month,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();

    for (const [status, label] of [
      ['checked', '已签到'],
      ['made-up', '已补签'],
      ['makeup', '可补签'],
      ['future', '未来日期'],
    ]) {
      const cell = harness.calendar.querySelector(`[data-checkin-status="${status}"]`);
      assert.ok(cell, `missing ${status} cell`);
      assert.match(cell.textContent, new RegExp(label));
      assert.match(cell.getAttribute('aria-label'), new RegExp(label));
    }
    assert.equal(harness.calendar.querySelectorAll('[data-calendar-empty]').length, 5);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('calendar groups each week in a row and keeps gridcells out of the grid root', async () => {
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    month: createMonthSnapshot(2026, 8, {
      '2026-08-04': { isToday: true },
    }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const grid = harness.calendar.querySelector('.checkin-grid');
    assert.ok(grid);
    assert.ok(grid.children.length > 0);
    assert.ok(grid.children.every((row) => row.getAttribute('role') === 'row'));
    assert.equal(grid.children[0].children.length, 7);

    const dayCells = harness.calendar.querySelectorAll('[data-checkin-status]');
    assert.ok(dayCells.length > 0);
    assert.ok(dayCells.every((cell) => (
      cell.getAttribute('role') === 'gridcell'
      && cell.parentElement?.getAttribute('role') === 'row'
    )));
    const emptyCells = harness.calendar.querySelectorAll('[data-calendar-empty]');
    assert.equal(emptyCells.length, 5);
    assert.ok(emptyCells.every((cell) => (
      cell.parentElement?.getAttribute('role') === 'row'
      && cell.getAttribute('aria-hidden') === 'true'
    )));
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('failed daily check-in is retryable without refreshing local wallet state', async () => {
  let attempts = 0;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    month: [{
      checkinDate: today, rewardAmount: 8, checkedIn: false, checkinType: null,
      paymentMethod: null, paymentAmount: null, isToday: true, canMakeup: false, makeupCost: 20,
    }],
    checkIn: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('CHECKIN_FAILED');
      return { rewardAmount: 8, balance: 108 };
    },
    mapError: () => '签到失败，可重试',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const button = harness.calendar.querySelector('[data-checkin-action="checkin"]');

    button.dispatchEvent(new Event('click'));
    await flushPromises();
    assert.equal(button.disabled, false);
    assert.equal(harness.checkinCalls.length, 1);
    assert.equal(harness.economyRefreshes, 0);
    assert.equal(harness.nodes.get('#player-message').textContent, '签到失败，可重试');

    button.dispatchEvent(new Event('click'));
    await flushPromises();
    await flushPromises();
    assert.equal(harness.checkinCalls.length, 2);
    assert.equal(harness.economyRefreshes, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('a successful check-in reports a refresh failure instead of overwriting it with success', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const month = [{
    checkinDate: today, rewardAmount: 8, checkedIn: false, checkinType: null,
    paymentMethod: null, paymentAmount: null, isToday: true, canMakeup: false, makeupCost: 20,
  }];
  let loads = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    getMonth: async () => {
      loads += 1;
      if (loads === 1) return month;
      throw new Error('REFRESH_FAILED');
    },
    checkIn: async () => ({ rewardAmount: 8, balance: 108 }),
    mapError: () => '刷新失败',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const button = harness.calendar.querySelector('[data-checkin-action="checkin"]');
    button.dispatchEvent(new Event('click'));
    await flushPromises();
    await flushPromises();

    assert.equal(harness.checkinCalls.length, 1);
    assert.equal(harness.monthCalls.length, 2);
    assert.equal(harness.nodes.get('#player-message').textContent, '操作已成功，但状态刷新失败，请刷新页面');
    assert.equal(harness.nodes.get('#player-message').dataset.state, 'error');
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('coin makeup confirms reward, cost, and net change and trusts the service on insufficient balance', async () => {
  let attempts = 0;
  const month = createMonthSnapshot(2026, 8, {
    '2026-08-01': { rewardAmount: 4, canMakeup: true, makeupCost: 20 },
    '2026-08-02': { isToday: true, rewardAmount: 6 },
  });
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    month,
    makeUp: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('INSUFFICIENT_COINS');
      return { rewardAmount: 4, paymentAmount: 20, balance: 84 };
    },
    mapError: () => '金币不足',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const makeupButton = harness.calendar.querySelector('[data-checkin-action="makeup"]');
    assert.ok(makeupButton);

    makeupButton.dispatchEvent(new Event('click'));
    const dialog = harness.calendar.querySelector('[data-makeup-dialog]');
    const confirm = harness.calendar.querySelector('[data-checkin-action="confirm-makeup"]');
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent, /奖励 4 金币/);
    assert.match(dialog.textContent, /费用 20 金币/);
    assert.match(dialog.textContent, /净变化 -16 金币/);
    assert.equal(confirm.textContent, '使用金币补签');
    assert.doesNotMatch(dialog.textContent, /道具/);

    confirm.dispatchEvent(new Event('click'));
    await flushPromises();
    assert.deepEqual(harness.checkinCalls[0], {
      type: 'makeup',
      date: '2026-08-01',
      paymentMethod: 'coins',
      requestId: harness.checkinCalls[0].requestId,
    });
    assert.match(harness.checkinCalls[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(confirm.disabled, false);
    assert.equal(harness.economyRefreshes, 0);
    assert.equal(harness.nodes.get('#player-message').textContent, '金币不足');

    confirm.dispatchEvent(new Event('click'));
    await flushPromises();
    await flushPromises();
    assert.equal(harness.checkinCalls.length, 2);
    assert.equal(harness.monthCalls.length, 2);
    assert.equal(harness.economyRefreshes, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
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
  assert.match(css, /\.checkin-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.checkin-day-status/);
  assert.match(css, /\.checkin-confirmation::backdrop/);
  assert.match(css, /\.checkin-day-action:disabled/);
  assert.match(css, /\.activity-layout\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.activity-cover-image/);
  assert.match(css, /\.activity-card-status/);
  assert.match(css, /\.notification-inbox/);
  assert.match(css, /\.notification-unread-dot/);
  assert.match(css, /\.notification-expired-status/);
  assert.match(css, /\.player-secondary-action:focus-visible/);
  assert.match(css, /(?:\.activity-card|\.notification-item)[^}]*var\(--portal-line\)/s);
  assert.match(css, /\.notification-actions[^}]*flex/s);
  assert.match(css, /(?:\.player-primary-action|\.player-secondary-action):disabled/);
  assert.match(css, /@media\s*\(max-width:\s*759px\)/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /background-clip:\s*text/);
  assert.doesNotMatch(css, /backdrop-filter/);
});
