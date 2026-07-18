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

  removeAttribute(name) {
    this.attributes.delete(name);
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
  refreshEconomy = async () => ({ balance: 0, isAdmin: false, loaded: true }),
  friends = [],
  friendRequests = [],
  gameInvites = [],
  listFriendData = async () => friends,
  listRequestData = async () => friendRequests,
  listInviteData = async () => gameInvites,
  searchFriend = async () => null,
  confirmFriendRemoval = () => true,
} = {}) {
  const tabList = new FakeElement();
  tabList.setAttribute('aria-orientation', 'vertical');
  const tabs = ['checkin', 'activities', 'notifications', 'friends'].map((tab) => new FakeElement({ playerTab: tab }));
  const panels = ['checkin', 'activities', 'notifications', 'friends'].map((tab) => new FakeElement({ playerPanel: tab }));
  const calendar = new FakeElement();
  const activityList = new FakeElement();
  const notificationList = new FakeElement();
  const friendSearchForm = new FakeElement({}, 'form');
  const friendSearchInput = new FakeElement({}, 'input');
  friendSearchForm.append(new FakeElement({}, 'button'));
  tabs[3].id = 'player-tab-friends';
  const nodes = new Map([
    ['.player-tabs', tabList],
    ['#player-summary-name', new FakeElement()],
    ['#player-summary-kind', new FakeElement()],
    ['#player-summary-uid', new FakeElement()],
    ['#player-summary-balance', new FakeElement()],
    ['#checkin-guest-state', new FakeElement()],
    ['#checkin-login-button', new FakeElement()],
    ['#checkin-calendar', calendar],
    ['#activity-list', activityList],
    ['#notification-list', notificationList],
    ['#friend-search-form', friendSearchForm],
    ['#friend-search-input', friendSearchInput],
    ['#friend-search-result', new FakeElement()],
    ['#incoming-friend-requests', new FakeElement()],
    ['#outgoing-friend-requests', new FakeElement()],
    ['#friend-list', new FakeElement()],
    ['#game-invite-list', new FakeElement()],
    ['#friend-message', new FakeElement()],
    ['#player-tab-friends', tabs[3]],
    ['#player-message', new FakeElement()],
  ]);
  const media = new FakeElement();
  media.matches = false;
  const urls = [];
  const subscriptionListeners = new Set();
  let opens = 0;
  let economyRefreshes = 0;
  let friendRealtimeSubscriptions = 0;
  let friendRealtimeCleanups = 0;
  let friendDisconnects = 0;
  let friendRealtimeListener = null;
  const confirmCalls = [];
  const checkinCalls = [];
  const monthCalls = [];
  const activityCalls = [];
  const notificationCalls = [];
  const friendCalls = [];
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
  const friendsClient = {
    async listFriends() {
      friendCalls.push({ type: 'list-friends' });
      return listFriendData();
    },
    async listRequests() {
      friendCalls.push({ type: 'list-requests' });
      return listRequestData();
    },
    async listInvites() {
      friendCalls.push({ type: 'list-invites' });
      return listInviteData();
    },
    async searchExact(value) {
      friendCalls.push({ type: 'search', value });
      return searchFriend(value);
    },
    async sendRequest(userId) {
      friendCalls.push({ type: 'send', userId });
    },
    async acceptRequest(requestId) {
      friendCalls.push({ type: 'accept', requestId });
    },
    async rejectRequest(requestId) {
      friendCalls.push({ type: 'reject', requestId });
    },
    async removeFriend(userId) {
      friendCalls.push({ type: 'remove', userId });
    },
    async declineGameInvite(inviteId) {
      friendCalls.push({ type: 'decline', inviteId });
    },
    async subscribe(listener) {
      friendCalls.push({ type: 'subscribe' });
      friendRealtimeSubscriptions += 1;
      friendRealtimeListener = listener;
      let active = true;
      return async () => {
        if (!active) return;
        active = false;
        friendRealtimeCleanups += 1;
        if (friendRealtimeListener === listener) friendRealtimeListener = null;
      };
    },
    async disconnect() {
      friendDisconnects += 1;
    },
  };
  const accountPanel = {
    accountClient,
    economyClient,
    getIdentity: () => ({ ...identity }),
    getEconomySnapshot: () => ({ balance: 0 }),
    subscribe(listener) {
      subscriptionListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscriptionListeners.delete(listener);
      };
    },
    open() {
      opens += 1;
    },
    async refreshEconomy() {
      economyRefreshes += 1;
      return refreshEconomy();
    },
  };
  const keys = [
    'document', 'location', 'history', 'matchMedia', 'HYLAccountPanel',
    'PlayerCheckin', 'PlayerActivities', 'PlayerNotifications', 'PlayerFriends', 'confirm',
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
  globalThis.PlayerFriends = {
    createFriendsClient: () => friendsClient,
    mapFriendsError: () => '好友服务暂时不可用，请稍后重试',
  };
  globalThis.confirm = (message) => {
    confirmCalls.push(message);
    return confirmFriendRemoval(message);
  };

  return {
    media,
    calendar,
    activityList,
    notificationList,
    activityCalls,
    notificationCalls,
    friendCalls,
    confirmCalls,
    checkinCalls,
    monthCalls,
    nodes,
    panels,
    tabList,
    tabs,
    urls,
    get opens() { return opens; },
    get economyRefreshes() { return economyRefreshes; },
    get subscriptions() { return subscriptionListeners.size; },
    get friendRealtimeSubscriptions() { return friendRealtimeSubscriptions; },
    get friendRealtimeCleanups() { return friendRealtimeCleanups; },
    get friendDisconnects() { return friendDisconnects; },
    emitFriendsChange() { friendRealtimeListener?.({ type: 'changed' }); },
    setIdentity(nextIdentity, economySnapshot = { balance: 0 }) {
      identity = nextIdentity;
      [...subscriptionListeners].forEach((listener) => {
        listener({ identity: { ...identity }, economySnapshot });
      });
    },
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

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
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
    assert.equal(harness.economyRefreshes, 2);
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

test('load retry clears only its own live error message', async () => {
  let activityLoads = 0;
  let notificationLoads = 0;
  let rejectNotification;
  const notificationPending = new Promise((_resolve, reject) => { rejectNotification = reject; });
  const harness = createPlayerRuntimeHarness({
    listActivities: async () => {
      activityLoads += 1;
      if (activityLoads === 1) throw new Error('ACTIVITY_NETWORK_FAILED');
      return [];
    },
    listNotifications: async () => {
      notificationLoads += 1;
      if (notificationLoads === 1) return notificationPending;
      return [];
    },
    mapActivitiesError: () => '活动加载失败，请重试',
    mapNotificationsError: () => '通知加载失败，请重试',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    assert.equal(harness.nodes.get('#player-message').textContent, '活动加载失败，请重试');

    rejectNotification(new Error('NOTIFICATION_NETWORK_FAILED'));
    await flushPromises();
    assert.equal(harness.nodes.get('#player-message').textContent, '通知加载失败，请重试');

    harness.activityList.querySelector('[data-activity-retry]').dispatchEvent(new Event('click'));
    await flushPromises();
    assert.equal(harness.nodes.get('#player-message').textContent, '通知加载失败，请重试');

    harness.notificationList.querySelector('[data-notification-retry]').dispatchEvent(new Event('click'));
    await flushPromises();
    assert.equal(harness.nodes.get('#player-message').textContent, '');
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

test('notification toggle controls a stable hidden detail region and marks read only when opened', async () => {
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    notifications: [{
      id: 'controlled-detail', activityId: 'activity-1', title: '受控详情', body: '仅在详情显示的正文',
      rewardAmount: 8, visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null,
      actionUrl: 'https://hhhyl.me/notification/detail', isRead: false, rewardClaimed: false,
    }],
    markRead: async () => ({ notificationId: 'controlled-detail', readAt: '2026-07-18T08:01:00.000Z' }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    let toggle = harness.notificationList.querySelector('[data-notification-open="controlled-detail"]');
    const detailId = 'notification-detail-controlled-detail';
    let detail = harness.notificationList.querySelector(`#${detailId}`);
    assert.equal(toggle.getAttribute('aria-controls'), detailId);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(detail.hidden, true);
    assert.equal(detail.querySelector('.notification-body').textContent, '仅在详情显示的正文');
    assert.ok(detail.querySelector('[data-notification-activity="activity-1"]'));
    assert.ok(detail.querySelector('[data-notification-action]'));
    assert.ok(detail.querySelector('[data-notification-claim="controlled-detail"]'));
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'read').length, 0);

    toggle.dispatchEvent(new Event('click'));
    await flushPromises();
    toggle = harness.notificationList.querySelector('[data-notification-open="controlled-detail"]');
    detail = harness.notificationList.querySelector(`#${detailId}`);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(detail.hidden, false);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'read').length, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('failed notification mark-read exposes an explicit single-submit retry that stays independent from rewards', async () => {
  let resolveRetry;
  const retryPending = new Promise((resolve) => { resolveRetry = resolve; });
  let attempts = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', displayName: '立哥' },
    notifications: [{
      id: 'read-retry', activityId: null, title: '需要重试', body: '通知正文', rewardAmount: 8,
      visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
      isRead: false, rewardClaimed: false,
    }],
    markRead: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('NETWORK_FAILED');
      return retryPending;
    },
    mapNotificationsError: () => '标记已读失败，请重试',
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="read-retry"]')
      .dispatchEvent(new Event('click'));
    await flushPromises();

    const retry = harness.notificationList.querySelector('[data-notification-read-retry="read-retry"]');
    assert.ok(retry);
    assert.equal(retry.textContent, '重试标记已读');
    assert.ok(harness.notificationList.querySelector('[data-notification-unread]'));

    retry.dispatchEvent(new Event('click'));
    retry.dispatchEvent(new Event('click'));
    assert.equal(retry.disabled, true);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'read').length, 2);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'claim').length, 0);

    resolveRetry({ notificationId: 'read-retry', readAt: '2026-07-18T08:01:00.000Z' });
    await flushPromises();
    assert.equal(harness.notificationList.querySelector('[data-notification-unread]'), null);
    assert.equal(harness.notificationList.querySelector('[data-notification-read-retry="read-retry"]'), null);
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
    let expired = harness.notificationList.querySelector('[data-notification-id="expired"]');
    assert.match(expired.textContent, /已过期/);
    expired.querySelector('[data-notification-open="expired"]').dispatchEvent(new Event('click'));
    expired = harness.notificationList.querySelector('[data-notification-id="expired"]');
    assert.equal(expired.querySelector('[data-notification-claim="expired"]').disabled, true);
    expired.querySelector('[data-notification-activity="disabled-activity"]').dispatchEvent(new Event('click'));
    assert.equal(harness.nodes.get('#player-message').textContent, '关联活动可能已下架，请在活动页确认');

    harness.notificationList.querySelector('[data-notification-open="retry"]').dispatchEvent(new Event('click'));
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

test('registered account changes reload engagement state while display-name changes keep current data', async () => {
  let activityLoad = 0;
  let notificationLoad = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listActivities: async () => ([{
      id: 'shared-activity', title: '共享活动', body: '正文', rewardAmount: 5,
      claimed: activityLoad++ === 0,
    }]),
    listNotifications: async () => ([{
      id: 'shared-notification', activityId: null, title: '共享通知', body: '正文', rewardAmount: 2,
      visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
      isRead: notificationLoad++ === 0, rewardClaimed: false,
    }]),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    assert.match(harness.activityList.textContent, /已领取/);
    assert.match(harness.notificationList.textContent, /已读/);

    harness.setIdentity({ kind: 'registered', username: 'account_a', displayName: '账号 A 新游戏名' });
    await flushPromises();
    assert.equal(harness.activityCalls.filter((call) => call.type === 'list').length, 1);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'list').length, 1);

    harness.setIdentity({ kind: 'registered', username: 'account_b', displayName: '账号 B' });
    await flushPromises();
    assert.equal(harness.activityCalls.filter((call) => call.type === 'list').length, 2);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'list').length, 2);
    assert.match(harness.activityList.textContent, /领取 5 金币/);
    assert.doesNotMatch(harness.activityList.textContent, /已领取/);
    assert.match(harness.notificationList.textContent, /未读/);
    assert.doesNotMatch(harness.notificationList.textContent, /奖励 2 金币 · 已领取/);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('activity claim completion updates the refreshed same-id model and stays single-submit', async () => {
  let resolveClaim;
  const pending = new Promise((resolve) => { resolveClaim = resolve; });
  let loads = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listActivities: async () => {
      loads += 1;
      return [{ id: 'race-activity', title: '竞态活动', body: '正文', rewardAmount: 7, claimed: false }];
    },
    claimActivity: async () => pending,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.activityList.querySelector('[data-activity-claim="race-activity"]')
      .dispatchEvent(new Event('click'));
    await instance.refreshActivities();
    assert.equal(loads, 2);

    resolveClaim({ rewardAmount: 7, balance: 107, claimedAt: '2026-07-18T08:00:00.000Z' });
    await flushPromises();
    await flushPromises();
    const current = harness.activityList.querySelector('[data-activity-claim="race-activity"]');
    assert.equal(current.textContent, '已领取');
    assert.equal(current.disabled, true);
    current.dispatchEvent(new Event('click'));
    assert.equal(harness.activityCalls.filter((call) => call.type === 'claim').length, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('notification mark-read completion updates the refreshed same-id model', async () => {
  let resolveRead;
  const pending = new Promise((resolve) => { resolveRead = resolve; });
  let loads = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listNotifications: async () => {
      loads += 1;
      return [{
        id: 'race-read', activityId: null, title: '竞态已读', body: '正文', rewardAmount: null,
        visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
        isRead: false, rewardClaimed: false,
      }];
    },
    markRead: async () => pending,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="race-read"]')
      .dispatchEvent(new Event('click'));
    await instance.refreshNotifications();
    assert.equal(loads, 2);

    resolveRead({ notificationId: 'race-read', readAt: '2026-07-18T08:01:00.000Z' });
    await flushPromises();
    assert.equal(harness.notificationList.querySelector('[data-notification-unread]'), null);
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'read').length, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('notification claim completion updates the refreshed same-id model and stays single-submit', async () => {
  let resolveClaim;
  const pending = new Promise((resolve) => { resolveClaim = resolve; });
  let loads = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listNotifications: async () => {
      loads += 1;
      return [{
        id: 'race-claim', activityId: null, title: '竞态领奖', body: '正文', rewardAmount: 9,
        visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
        isRead: true, rewardClaimed: false,
      }];
    },
    claimNotification: async () => pending,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="race-claim"]')
      .dispatchEvent(new Event('click'));
    harness.notificationList.querySelector('[data-notification-claim="race-claim"]')
      .dispatchEvent(new Event('click'));
    await instance.refreshNotifications();
    assert.equal(loads, 2);

    resolveClaim({ rewardAmount: 9, balance: 109, claimedAt: '2026-07-18T08:02:00.000Z' });
    await flushPromises();
    await flushPromises();
    const current = harness.notificationList.querySelector('[data-notification-claim="race-claim"]');
    assert.equal(current.textContent, '已领取');
    assert.equal(current.disabled, true);
    current.dispatchEvent(new Event('click'));
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'claim').length, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('already-claimed notification rewards still refresh the wallet and report refresh failure', async () => {
  let attempts = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    notifications: [{
      id: 'already-notification', activityId: null, title: '幂等奖励', body: '正文', rewardAmount: 5,
      visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
      isRead: true, rewardClaimed: false,
    }],
    claimNotification: async () => {
      attempts += 1;
      throw new Error(attempts === 1 ? 'NETWORK_FAILED' : 'NOTIFICATION_ALREADY_CLAIMED');
    },
    mapNotificationsError: (error) => (
      String(error.message).includes('ALREADY') ? '奖励已领取' : '通知领取失败，可重试'
    ),
    refreshEconomy: async () => ({ balance: 5, isAdmin: false, loaded: false }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="already-notification"]')
      .dispatchEvent(new Event('click'));
    let claim = harness.notificationList.querySelector('[data-notification-claim="already-notification"]');
    claim.dispatchEvent(new Event('click'));
    await flushPromises();
    assert.equal(harness.economyRefreshes, 0);

    claim = harness.notificationList.querySelector('[data-notification-claim="already-notification"]');
    claim.dispatchEvent(new Event('click'));
    await flushPromises();
    await flushPromises();
    assert.equal(harness.economyRefreshes, 1);
    assert.equal(harness.nodes.get('#player-message').textContent, '奖励已领取，但钱包刷新失败，请刷新页面');
    assert.equal(harness.nodes.get('#player-message').dataset.state, 'error');
    assert.equal(harness.notificationList.querySelector('[data-notification-claim="already-notification"]').textContent, '已领取');
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('account switch keeps old activity claim results and finally blocks out of the new account', async () => {
  let resolveA;
  let resolveB;
  const pendingA = new Promise((resolve) => { resolveA = resolve; });
  const pendingB = new Promise((resolve) => { resolveB = resolve; });
  let claimAttempt = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listActivities: async () => ([{
      id: 'shared-claim', title: '共享领奖', body: '正文', rewardAmount: 6, claimed: false,
    }]),
    claimActivity: async () => (claimAttempt++ === 0 ? pendingA : pendingB),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.activityList.querySelector('[data-activity-claim="shared-claim"]')
      .dispatchEvent(new Event('click'));

    harness.setIdentity({ kind: 'registered', username: 'account_b', displayName: '账号 B' });
    await flushPromises();
    harness.activityList.querySelector('[data-activity-claim="shared-claim"]')
      .dispatchEvent(new Event('click'));
    assert.equal(harness.activityCalls.filter((call) => call.type === 'claim').length, 2);

    resolveA({ rewardAmount: 6, balance: 106, claimedAt: '2026-07-18T08:00:00.000Z' });
    await flushPromises();
    await flushPromises();
    const pendingForB = harness.activityList.querySelector('[data-activity-claim="shared-claim"]');
    assert.equal(pendingForB.textContent, '领取中…');
    assert.equal(pendingForB.disabled, true);
    assert.equal(harness.economyRefreshes, 0);
    assert.equal(harness.nodes.get('#player-message').textContent, '');

    resolveB({ rewardAmount: 6, balance: 206, claimedAt: '2026-07-18T08:01:00.000Z' });
    await flushPromises();
    await flushPromises();
    assert.equal(harness.activityList.querySelector('[data-activity-claim="shared-claim"]').textContent, '已领取');
    assert.equal(harness.economyRefreshes, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('account switch keeps old notification read results and finally blocks out of the new account', async () => {
  let resolveA;
  let resolveB;
  const pendingA = new Promise((resolve) => { resolveA = resolve; });
  const pendingB = new Promise((resolve) => { resolveB = resolve; });
  let readAttempt = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listNotifications: async () => ([{
      id: 'shared-read', activityId: null, title: '共享已读', body: '正文', rewardAmount: null,
      visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
      isRead: false, rewardClaimed: false,
    }]),
    markRead: async () => (readAttempt++ === 0 ? pendingA : pendingB),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="shared-read"]')
      .dispatchEvent(new Event('click'));

    harness.setIdentity({ kind: 'registered', username: 'account_b', displayName: '账号 B' });
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="shared-read"]')
      .dispatchEvent(new Event('click'));
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'read').length, 2);

    resolveA({ notificationId: 'shared-read', readAt: '2026-07-18T08:00:00.000Z' });
    await flushPromises();
    assert.ok(harness.notificationList.querySelector('[data-notification-unread]'));

    resolveB({ notificationId: 'shared-read', readAt: '2026-07-18T08:01:00.000Z' });
    await flushPromises();
    assert.equal(harness.notificationList.querySelector('[data-notification-unread]'), null);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('account switch keeps old notification claim results and finally blocks out of the new account', async () => {
  let resolveA;
  let resolveB;
  const pendingA = new Promise((resolve) => { resolveA = resolve; });
  const pendingB = new Promise((resolve) => { resolveB = resolve; });
  let claimAttempt = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    listNotifications: async () => ([{
      id: 'shared-notification-claim', activityId: null, title: '共享通知领奖', body: '正文', rewardAmount: 4,
      visibleAt: '2026-07-18T08:00:00.000Z', expiresAt: null, actionUrl: null,
      isRead: true, rewardClaimed: false,
    }]),
    claimNotification: async () => (claimAttempt++ === 0 ? pendingA : pendingB),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="shared-notification-claim"]')
      .dispatchEvent(new Event('click'));
    harness.notificationList.querySelector('[data-notification-claim="shared-notification-claim"]')
      .dispatchEvent(new Event('click'));

    harness.setIdentity({ kind: 'registered', username: 'account_b', displayName: '账号 B' });
    await flushPromises();
    harness.notificationList.querySelector('[data-notification-open="shared-notification-claim"]')
      .dispatchEvent(new Event('click'));
    harness.notificationList.querySelector('[data-notification-claim="shared-notification-claim"]')
      .dispatchEvent(new Event('click'));
    assert.equal(harness.notificationCalls.filter((call) => call.type === 'claim').length, 2);

    resolveA({ rewardAmount: 4, balance: 104, claimedAt: '2026-07-18T08:00:00.000Z' });
    await flushPromises();
    await flushPromises();
    const pendingForB = harness.notificationList.querySelector('[data-notification-claim="shared-notification-claim"]');
    assert.equal(pendingForB.textContent, '领取中…');
    assert.equal(pendingForB.disabled, true);
    assert.equal(harness.economyRefreshes, 0);

    resolveB({ rewardAmount: 4, balance: 204, claimedAt: '2026-07-18T08:01:00.000Z' });
    await flushPromises();
    await flushPromises();
    assert.equal(harness.notificationList.querySelector('[data-notification-claim="shared-notification-claim"]').textContent, '已领取');
    assert.equal(harness.economyRefreshes, 1);
  } finally {
    instance?.destroy();
    harness.restore();
  }
});

test('account switch keeps an old check-in finally from unlocking the new account action', async () => {
  let resolveA;
  let resolveB;
  const pendingA = new Promise((resolve) => { resolveA = resolve; });
  const pendingB = new Promise((resolve) => { resolveB = resolve; });
  let checkinAttempt = 0;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const day = {
    checkinDate: today, rewardAmount: 8, checkedIn: false, checkinType: null,
    paymentMethod: null, paymentAmount: null, isToday: true, canMakeup: false, makeupCost: 20,
  };
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A' },
    getMonth: async () => [{ ...day }],
    checkIn: async () => (checkinAttempt++ === 0 ? pendingA : pendingB),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    harness.calendar.querySelector('[data-checkin-action="checkin"]').dispatchEvent(new Event('click'));

    harness.setIdentity({ kind: 'registered', username: 'account_b', displayName: '账号 B' });
    await flushPromises();
    harness.calendar.querySelector('[data-checkin-action="checkin"]').dispatchEvent(new Event('click'));
    assert.equal(harness.checkinCalls.length, 2);

    resolveA({ rewardAmount: 8, balance: 108 });
    await flushPromises();
    await flushPromises();
    const pendingForB = harness.calendar.querySelector('[data-checkin-action="checkin"]');
    assert.equal(pendingForB.disabled, true);
    assert.equal(harness.economyRefreshes, 0);
    assert.equal(harness.nodes.get('#player-message').textContent, '');

    resolveB({ rewardAmount: 8, balance: 208 });
    await flushPromises();
    await flushPromises();
    assert.equal(harness.economyRefreshes, 1);
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

test('guest login starts one friends realtime subscription', async () => {
  const harness = createPlayerRuntimeHarness();
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    assert.equal(harness.friendRealtimeSubscriptions, 0);

    harness.setIdentity({
      kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001',
    });
    await flushPromises();

    assert.equal(harness.friendRealtimeSubscriptions, 1);
    assert.equal(harness.friendCalls.filter((call) => call.type === 'list-friends').length, 1);
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('opening the friends tab refreshes current friend data', async () => {
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const initialRefreshes = harness.friendCalls.filter((call) => call.type === 'list-friends').length;

    harness.tabs[3].dispatchEvent(new Event('click'));
    await flushPromises();

    assert.equal(harness.urls.at(-1), '/player/?tab=friends');
    assert.equal(
      harness.friendCalls.filter((call) => call.type === 'list-friends').length,
      initialRefreshes + 1,
    );
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('friends realtime subscription is cleaned across logout, relogin, and destroy', async () => {
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    assert.equal(harness.friendRealtimeSubscriptions, 1);

    harness.setIdentity({ kind: 'guest', displayName: '匿名玩家' });
    await flushPromises();
    assert.equal(harness.friendRealtimeCleanups, 1);

    harness.setIdentity({
      kind: 'registered', username: 'account_b', displayName: '账号 B', uid: '000002',
    });
    await flushPromises();
    assert.equal(harness.friendRealtimeSubscriptions, 2);

    harness.setIdentity({
      kind: 'registered', username: 'account_c', displayName: '账号 C', uid: '000003',
    });
    await flushPromises();
    assert.equal(harness.friendRealtimeSubscriptions, 2);

    instance.destroy();
    await flushPromises();
    assert.equal(harness.friendRealtimeCleanups, 2);
    assert.equal(harness.friendDisconnects, 1);
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('a friend search resolved after logout cannot replace the guest state', async () => {
  let resolveSearch;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
    searchFriend: () => new Promise((resolve) => { resolveSearch = resolve; }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const searchInput = harness.nodes.get('#friend-search-input');
    searchInput.value = '000042';
    harness.nodes.get('#friend-search-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();

    harness.setIdentity({ kind: 'guest', displayName: '匿名玩家' });
    const guestMessage = harness.nodes.get('#friend-message').textContent;
    resolveSearch({
      id: 'old-player', uid: '000042', username: 'old_player',
      displayName: '旧账号结果', relationshipState: 'none',
    });
    await flushPromises();

    assert.equal(harness.nodes.get('#friend-search-result').textContent, '');
    assert.equal(harness.nodes.get('#friend-message').textContent, guestMessage);
    assert.equal(searchInput.disabled, true);
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('a friend search resolved after an account switch cannot render the old account result', async () => {
  let resolveSearch;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
    searchFriend: () => new Promise((resolve) => { resolveSearch = resolve; }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const searchInput = harness.nodes.get('#friend-search-input');
    searchInput.value = 'old_player';
    harness.nodes.get('#friend-search-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();

    harness.setIdentity({
      kind: 'registered', username: 'account_b', displayName: '账号 B', uid: '000002',
    });
    await flushPromises();
    resolveSearch({
      id: 'old-player', uid: '000042', username: 'old_player',
      displayName: '旧账号结果', relationshipState: 'none',
    });
    await flushPromises();

    assert.equal(harness.nodes.get('#friend-search-result').textContent, '');
    assert.doesNotMatch(harness.nodes.get('#friend-message').textContent, /旧账号结果/);
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('game invite cards label the host name and padded UID explicitly', async () => {
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
    gameInvites: [{
      id: 'invite-1', direction: 'incoming', status: 'pending', gameType: 'gomoku',
      roomCode: 'ABC123', wagerAmount: 12, expiresAt: '2026-07-19T12:00:00.000Z',
      sender: { id: 'host-1', username: 'host_user', displayName: '房主甲', uid: '000007' },
    }],
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();

    const inviteText = harness.nodes.get('#game-invite-list').textContent;
    assert.match(inviteText, /五子棋/);
    assert.match(inviteText, /房主：房主甲 · UID 000007/);
    assert.match(inviteText, /彩头 12 金币/);
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('account switch clears old friend data before the new account requests resolve', async () => {
  const oldFriends = createDeferred();
  const oldRequests = createDeferred();
  const oldInvites = createDeferred();
  const nextFriends = createDeferred();
  const nextRequests = createDeferred();
  const nextInvites = createDeferred();
  let friendLists = 0;
  let requestLists = 0;
  let inviteLists = 0;
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
    listFriendData: () => {
      friendLists += 1;
      if (friendLists === 1) return [{
        id: 'a-friend', uid: '000010', username: 'a_friend', displayName: 'A 的好友', online: true,
      }];
      return friendLists === 2 ? oldFriends.promise : nextFriends.promise;
    },
    listRequestData: () => {
      requestLists += 1;
      if (requestLists === 1) return [{
        id: 'a-request', direction: 'incoming',
        player: { id: 'a-requester', uid: '000011', username: 'a_requester', displayName: 'A 的申请人' },
      }];
      return requestLists === 2 ? oldRequests.promise : nextRequests.promise;
    },
    listInviteData: () => {
      inviteLists += 1;
      if (inviteLists === 1) return [{
        id: 'a-invite', direction: 'incoming', status: 'pending', gameType: 'gomoku',
        roomCode: 'AAAAAA', wagerAmount: 0, expiresAt: '2026-07-19T12:00:00.000Z',
        sender: { id: 'a-host', uid: '000012', username: 'a_host', displayName: 'A 的房主' },
      }];
      return inviteLists === 2 ? oldInvites.promise : nextInvites.promise;
    },
    searchFriend: async () => ({
      id: 'a-search', uid: '000013', username: 'a_search',
      displayName: 'A 的搜索结果', relationshipState: 'none',
    }),
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const searchInput = harness.nodes.get('#friend-search-input');
    searchInput.value = 'a_search';
    harness.nodes.get('#friend-search-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    assert.match(harness.nodes.get('#friend-list').textContent, /A 的好友/);
    assert.match(harness.nodes.get('#friend-search-result').textContent, /A 的搜索结果/);

    harness.tabs[3].dispatchEvent(new Event('click'));
    harness.setIdentity({
      kind: 'registered', username: 'account_b', displayName: '账号 B', uid: '000002',
    });

    assert.doesNotMatch(harness.nodes.get('#friend-list').textContent, /A 的好友/);
    assert.doesNotMatch(harness.nodes.get('#incoming-friend-requests').textContent, /A 的申请人/);
    assert.doesNotMatch(harness.nodes.get('#game-invite-list').textContent, /A 的房主/);
    assert.equal(harness.nodes.get('#friend-search-result').textContent, '');
    assert.equal(harness.tabs[3].dataset.pendingCount, '0');

    oldFriends.resolve([{ id: 'late-a', uid: '000014', username: 'late_a', displayName: 'A 的迟到好友' }]);
    oldRequests.resolve([]);
    oldInvites.resolve([]);
    await flushPromises();
    assert.doesNotMatch(harness.nodes.get('#friend-list').textContent, /A 的迟到好友/);

    nextFriends.resolve([{ id: 'b-friend', uid: '000020', username: 'b_friend', displayName: 'B 的好友' }]);
    nextRequests.resolve([]);
    nextInvites.resolve([]);
    await flushPromises();
    assert.match(harness.nodes.get('#friend-list').textContent, /B 的好友/);
  } finally {
    instance?.destroy();
    await flushPromises();
    harness.restore();
  }
});

test('cancelling friend removal preserves search state and skips success refresh', async () => {
  const harness = createPlayerRuntimeHarness({
    identity: { kind: 'registered', username: 'account_a', displayName: '账号 A', uid: '000001' },
    friends: [{
      id: 'friend-1', uid: '000010', username: 'friend_one',
      displayName: '好友一', online: false, lastSeenAt: '2026-07-19T10:00:00.000Z',
    }],
    searchFriend: async () => ({
      id: 'search-1', uid: '000099', username: 'search_one',
      displayName: '保留的搜索结果', relationshipState: 'none',
    }),
    confirmFriendRemoval: () => false,
  });
  let instance;
  try {
    instance = player.mount();
    await flushPromises();
    const searchInput = harness.nodes.get('#friend-search-input');
    searchInput.value = 'search_one';
    harness.nodes.get('#friend-search-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    const searchText = harness.nodes.get('#friend-search-result').textContent;
    const refreshes = harness.friendCalls.filter((call) => call.type === 'list-friends').length;
    const deleteButton = harness.nodes.get('#friend-list').querySelectorAll('button')
      .find((button) => button.textContent === '删除好友');

    deleteButton.dispatchEvent(new Event('click'));
    await flushPromises();

    assert.equal(harness.confirmCalls.length, 1);
    assert.equal(harness.friendCalls.filter((call) => call.type === 'remove').length, 0);
    assert.equal(harness.friendCalls.filter((call) => call.type === 'list-friends').length, refreshes);
    assert.equal(harness.nodes.get('#friend-search-result').textContent, searchText);
    assert.doesNotMatch(harness.nodes.get('#friend-message').textContent, /操作成功|正在处理/);
  } finally {
    instance?.destroy();
    await flushPromises();
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
  assert.match(css, /\.notification-detail\[hidden\]/);
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

test('player center exposes UID-aware friend management and invite inbox structure', () => {
  const html = read('./player/index.html');
  for (const id of [
    'player-summary-uid', 'player-tab-friends', 'player-panel-friends',
    'friend-search-form', 'friend-search-input', 'friend-search-result',
    'incoming-friend-requests', 'outgoing-friend-requests', 'friend-list',
    'game-invite-list', 'friend-message', 'profile-player-uid',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /输入 6 位 UID 或完整用户名/);
  assert.match(html, /src=["']\/src\/services\/friends\.js["']/);
  assert.match(html, /src=["']\/src\/routes\/social-inbox\.js["']/);
});

test('player route reuses the shared account client and renders padded friend UIDs', () => {
  const source = read('./src/routes/player.js');
  assert.match(source, /createFriendsClient\s*\(\s*\{\s*accountClient\s*\}\s*\)/);
  assert.match(source, /searchExact\s*\(/);
  assert.match(source, /listFriends\s*\(/);
  assert.match(source, /listRequests\s*\(/);
  assert.match(source, /listInvites\s*\(/);
  assert.match(source, /UID\s*\$\{/);
  assert.match(source, /confirm\s*\(/);
  assert.doesNotMatch(source, /createAccountClient\s*\(/);
});

test('friend UI keeps product states, focus visibility, and responsive layout', () => {
  const css = read('./assets/styles/player.css');
  assert.match(css, /\.friend-search-form/);
  assert.match(css, /\.friend-list/);
  assert.match(css, /\.friend-player-uid/);
  assert.match(css, /\.friend-status\[data-online=["']true["']\]/);
  assert.match(css, /\.friend-action:focus-visible/);
  assert.match(css, /@media\s*\(max-width:\s*759px\)[\s\S]*\.friend-search-form/s);
});
