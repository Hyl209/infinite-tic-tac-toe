const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let portalContent = {};
let portal = {};
let notificationBell = {};
let socialInbox = {};

try {
  portalContent = require('../../src/config/portal.js');
} catch {
  portalContent = {};
}

try {
  portal = require('../../src/routes/portal.js');
} catch {
  portal = {};
}

try {
  notificationBell = require('../../src/routes/notification-bell.js');
} catch {
  notificationBell = {};
}

try {
  socialInbox = require('../../src/routes/social-inbox.js');
} catch {
  socialInbox = {};
}

class FakeSocialElement extends EventTarget {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this._textContent = '';
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

function createSocialInboxHarness({
  identity = { kind: 'guest', username: null },
  listRequests = async () => [],
  listInvites = async () => [],
  onSubscribe = null,
  subscribeError = null,
} = {}) {
  const region = new FakeSocialElement();
  const document = new EventTarget();
  document.querySelector = (selector) => (selector === '#social-toast-region' ? region : null);
  document.createElement = (tagName) => new FakeSocialElement(tagName);
  const socialCounts = [];
  document.addEventListener('hyl:social-count', (event) => socialCounts.push(event.detail.count));

  let currentIdentity = { ...identity };
  let accountListener = null;
  const accountClient = {};
  const accountPanel = {
    accountClient,
    getIdentity: () => ({ ...currentIdentity }),
    subscribe(listener) {
      accountListener = listener;
      return () => { accountListener = null; };
    },
  };
  const clients = [];
  const friendsApi = {
    createFriendsClient(options) {
      const identityKey = currentIdentity.username;
      let realtimeListener = null;
      const client = {
        identityKey,
        options,
        disconnects: 0,
        subscriptions: 0,
        cleanups: 0,
        async listRequests() {
          return listRequests(identityKey);
        },
        async listInvites() {
          return listInvites(identityKey);
        },
        async subscribe(listener) {
          this.subscriptions += 1;
          realtimeListener = listener;
          onSubscribe?.(listener, identityKey);
          if (subscribeError) throw subscribeError;
          let active = true;
          return async () => {
            if (!active) return;
            active = false;
            this.cleanups += 1;
            realtimeListener = null;
          };
        },
        async disconnect() {
          this.disconnects += 1;
          realtimeListener = null;
        },
        emitRealtime() {
          realtimeListener?.({ type: 'changed' });
        },
      };
      clients.push(client);
      return client;
    },
  };

  return {
    accountClient,
    accountPanel,
    clients,
    document,
    friendsApi,
    region,
    socialCounts,
    emitIdentity(nextIdentity) {
      currentIdentity = { ...nextIdentity };
      accountListener?.({ identity: { ...currentIdentity } });
    },
  };
}

function createNotificationBellHarness({ identity, unreadCounts = [] }) {
  const listeners = new Map();
  const badge = { hidden: true, textContent: '' };
  const bell = {
    ariaLabel: '查看通知',
    getAttribute(name) {
      return name === 'aria-label' ? this.ariaLabel : null;
    },
    setAttribute(name, value) {
      if (name === 'aria-label') this.ariaLabel = value;
    },
  };
  const document = {
    visibilityState: 'visible',
    querySelector(selector) {
      if (selector === '#notification-unread-count') return badge;
      if (selector === '#notification-bell') return bell;
      return null;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };
  let currentIdentity = identity;
  let accountListener = null;
  let accountCleanupCount = 0;
  const accountClient = {};
  const accountPanel = {
    accountClient,
    getIdentity: () => ({ ...currentIdentity }),
    subscribe(listener) {
      accountListener = listener;
      return () => {
        accountCleanupCount += 1;
        accountListener = null;
      };
    },
  };
  const calls = [];
  const notificationsClient = {
    async list(options) {
      calls.push({ type: 'list', options });
      return [];
    },
    async countUnread() {
      calls.push({ type: 'count' });
      const next = unreadCounts.shift();
      return typeof next === 'function' ? next() : next;
    },
  };
  const notificationsApi = {
    createNotificationsClient(options) {
      calls.push({ type: 'create', options });
      return notificationsClient;
    },
  };

  return {
    accountClient,
    accountPanel,
    badge,
    bell,
    calls,
    document,
    emitIdentity(nextIdentity) {
      currentIdentity = nextIdentity;
      accountListener?.({ identity: { ...nextIdentity } });
    },
    emitVisibility(state) {
      document.visibilityState = state;
      listeners.get('visibilitychange')?.();
    },
    get accountCleanupCount() {
      return accountCleanupCount;
    },
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('默认页面提供 HYL Space 门户并按工具、作品、游戏、动态排序', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const tools = html.indexOf('id="tools"');
  const works = html.indexOf('id="works"');
  const games = html.indexOf('id="games"');
  const updates = html.indexOf('id="updates"');

  assert.match(html, /id="portal-home"/);
  assert.match(html, /HYL SPACE/);
  assert.ok(tools > 0 && works > tools && games > works && updates > games);
  assert.doesNotMatch(html, /id="game-home"/);
  assert.doesNotMatch(html, /id="game-view"/);
  assert.doesNotMatch(html, /src="\/src\/routes\/game\.js"/);
  assert.match(html, /href="\/game\/\?game=tic_tac_toe"/);
  assert.match(html, /href="\/game\/\?game=gomoku"/);
  assert.match(html, /href="\/game\/"/);
  assert.match(html, /class="skip-link"\s+href="#site-main"/);
  assert.match(html, /<main id="site-main"[^>]*tabindex="-1"/);
  assert.doesNotMatch(html, /href="#"/);
});

test('旧游戏查询参数会重定向到独立游戏页面', () => {
  assert.equal(
    portal.getLegacyGameRedirect('https://hhhyl.me/?game=gomoku&room=ABC23D'),
    'https://hhhyl.me/game/?game=gomoku&room=ABC23D',
  );
  assert.equal(
    portal.getLegacyGameRedirect('https://hhhyl.me/?view=games'),
    'https://hhhyl.me/game/',
  );
  assert.equal(portal.getLegacyGameRedirect('https://hhhyl.me/#games'), null);
});

test('门户加载独立内容、样式、动效和本地 GSAP 资源', () => {
  const html = fs.readFileSync('./index.html', 'utf8');

  assert.match(html, /href="\/assets\/styles\/portal\.css"/);
  assert.match(html, /rel="icon"\s+href="\/assets\/images\/image_01\.png"/);
  assert.match(
    html,
    /class="site-brand-mark"[\s\S]*?<img[^>]+src="\/assets\/images\/image_01\.png"/,
  );
  assert.match(html, /src="\/assets\/vendor\/gsap\/gsap\.min\.js"[^>]*defer/);
  assert.match(html, /src="\/assets\/vendor\/gsap\/ScrollTrigger\.min\.js"[^>]*defer/);
  assert.match(html, /src="\/src\/config\/portal\.js"[^>]*defer/);
  const roomCodeIndex = html.indexOf('src="/src/utils/room-code.js"');
  const onlineIndex = html.indexOf('src="/src/services/online.js"');
  assert.ok(roomCodeIndex >= 0 && roomCodeIndex < onlineIndex);
  assert.match(html, /src="\/src\/routes\/account-panel\.js"[^>]*defer/);
  assert.match(html, /src="\/src\/routes\/portal\.js"[^>]*defer/);
  assert.match(html, /id="account-dialog"/);
});

test('门户导航提供玩家中心和可访问的通知入口', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const navStart = html.indexOf('class="site-nav"');
  const mainStart = html.indexOf('id="site-main"');
  const navMarkup = html.slice(navStart, mainStart);

  assert.match(navMarkup, /href="\/player\/"[^>]*>[^<]*玩家中心/);
  assert.match(navMarkup, /id="notification-bell"[^>]*href="\/player\/\?tab=notifications"/);
  assert.match(navMarkup, /id="notification-bell"[^>]*aria-label="[^"]*通知[^"]*"/);
  assert.match(navMarkup, /id="notification-unread-count"[^>]*hidden/);
  assert.match(navMarkup, /id="account-button"[^>]*aria-label="打开账号面板"/);
  assert.match(
    html,
    /src="\/src\/services\/account\.js"[^>]*defer[\s\S]*src="\/src\/services\/notifications\.js"[^>]*defer[\s\S]*src="\/src\/routes\/account-panel\.js"[^>]*defer[\s\S]*src="\/src\/routes\/notification-bell\.js"[^>]*defer/,
  );
});

test('通知服务等待账号初始化完成后再创建', async () => {
  let finishInitialize;
  const initialized = new Promise((resolve) => { finishInitialize = resolve; });
  const badge = { hidden: true, textContent: '' };
  const bell = { setAttribute() {} };
  const document = {
    visibilityState: 'visible',
    querySelector: (selector) => (selector === '#notification-bell' ? bell : badge),
    addEventListener() {},
    removeEventListener() {},
  };
  let createCount = 0;
  const accountClient = { initialize: () => initialized };
  const controller = notificationBell.mount({
    document,
    accountPanel: {
      accountClient,
      getIdentity: () => ({ kind: 'guest', username: null }),
      subscribe: () => () => {},
    },
    notificationsApi: {
      createNotificationsClient() {
        createCount += 1;
        return { list: async () => [], countUnread: async () => 0 };
      },
    },
  });

  assert.equal(createCount, 0);
  finishInitialize();
  await controller.refresh();
  assert.equal(createCount, 1);
  controller.destroy();
});

test('通知铃铛复用账号客户端，注册账号显示上限徽标而游客只保留入口', async () => {
  assert.equal(typeof notificationBell.mount, 'function');
  const harness = createNotificationBellHarness({
    identity: { kind: 'registered', username: 'player-a', displayName: '玩家 A' },
    unreadCounts: [108],
  });
  const controller = notificationBell.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    notificationsApi: {
      createNotificationsClient(options) {
        return harness.calls.find((call) => call.type === 'create')
          ? null
          : (() => {
              const api = createNotificationBellHarness;
              void api;
              harness.calls.push({ type: 'create', options });
              return {
                list: async (listOptions) => {
                  harness.calls.push({ type: 'list', options: listOptions });
                  return [];
                },
                countUnread: async () => {
                  harness.calls.push({ type: 'count' });
                  return 108;
                },
              };
            })();
      },
    },
  });
  await controller.refresh();

  assert.equal(harness.calls[0].options.accountClient, harness.accountClient);
  assert.deepEqual(harness.calls.find((call) => call.type === 'list').options, { limit: 5 });
  assert.equal(harness.calls.filter((call) => call.type === 'count').length, 1);
  assert.equal(harness.badge.hidden, false);
  assert.equal(harness.badge.textContent, '99+');
  assert.equal(harness.bell.getAttribute('aria-label'), '99+ 条未读通知');

  harness.emitIdentity({ kind: 'guest', username: null, displayName: '匿名玩家' });
  await flushAsyncWork();
  assert.equal(harness.calls.filter((call) => call.type === 'list').length, 2);
  assert.equal(harness.calls.filter((call) => call.type === 'count').length, 1);
  assert.equal(harness.badge.hidden, true);
  assert.equal(harness.bell.getAttribute('aria-label'), '查看通知');
  controller.destroy();
});

test('通知铃铛只在页面重新可见时刷新，且旧账号请求和销毁后事件不能回写', async () => {
  assert.equal(typeof notificationBell.mount, 'function');
  let resolveOldUnread;
  const oldUnread = new Promise((resolve) => { resolveOldUnread = resolve; });
  const harness = createNotificationBellHarness({
    identity: { kind: 'registered', username: 'player-a', displayName: '玩家 A' },
  });
  let unreadCall = 0;
  const controller = notificationBell.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    notificationsApi: {
      createNotificationsClient({ accountClient }) {
        harness.calls.push({ type: 'create', options: { accountClient } });
        return {
          async list(options) {
            harness.calls.push({ type: 'list', options });
            return [];
          },
          async countUnread() {
            harness.calls.push({ type: 'count' });
            unreadCall += 1;
            if (unreadCall === 1) return oldUnread;
            return unreadCall === 2 ? 3 : 0;
          },
        };
      },
    },
  });

  harness.emitIdentity({ kind: 'registered', username: 'player-b', displayName: '玩家 B' });
  await flushAsyncWork();
  assert.equal(harness.badge.textContent, '3');
  assert.equal(harness.bell.getAttribute('aria-label'), '3 条未读通知');
  resolveOldUnread(72);
  await flushAsyncWork();
  assert.equal(harness.badge.textContent, '3');
  assert.equal(harness.bell.getAttribute('aria-label'), '3 条未读通知');

  const listCalls = () => harness.calls.filter((call) => call.type === 'list').length;
  const beforeVisibility = listCalls();
  harness.emitVisibility('hidden');
  await flushAsyncWork();
  assert.equal(listCalls(), beforeVisibility);
  harness.emitVisibility('visible');
  await flushAsyncWork();
  assert.equal(listCalls(), beforeVisibility + 1);
  assert.equal(harness.badge.hidden, true);
  assert.equal(harness.bell.getAttribute('aria-label'), '查看通知');

  controller.destroy();
  const beforeDestroy = listCalls();
  harness.emitIdentity({ kind: 'registered', username: 'player-c', displayName: '玩家 C' });
  harness.emitVisibility('visible');
  await flushAsyncWork();
  assert.equal(listCalls(), beforeDestroy);
  assert.equal(harness.accountCleanupCount, 1);
});

test('门户配置使用统一字段且占位内容不提供假链接', () => {
  for (const section of ['tools', 'works', 'updates']) {
    assert.ok(Array.isArray(portalContent[section]));
    assert.ok(portalContent[section].length > 0);
    for (const item of portalContent[section]) {
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.title, 'string');
      assert.equal(typeof item.summary, 'string');
      assert.equal(typeof item.status, 'string');
      assert.notEqual(item.href, '#');
    }
  }
});

test('动效模式在缺少 GSAP、减少动态和移动端时安全降级', () => {
  assert.equal(portal.resolveMotionMode({ hasGsap: false, reduceMotion: false, desktop: true }), 'static');
  assert.equal(portal.resolveMotionMode({ hasGsap: true, reduceMotion: true, desktop: true }), 'static');
  assert.equal(portal.resolveMotionMode({ hasGsap: true, reduceMotion: false, desktop: false }), 'light');
  assert.equal(portal.resolveMotionMode({ hasGsap: true, reduceMotion: false, desktop: true }), 'immersive');
});

test('GSAP 响应式上下文包含移动端条件，缩放后会重新进入轻动效模式', () => {
  const source = fs.readFileSync('./src/routes/portal.js', 'utf8');
  assert.match(source, /mobile:\s*'\(max-width: 899px\)'/);
});

test('没有真实链接的门户条目保持不可交互', () => {
  assert.deepEqual(portal.getPortalItemState({ href: '', status: '内容整理中' }), {
    interactive: false,
    status: '内容整理中',
  });
  assert.deepEqual(portal.getPortalItemState({ href: '/game/', status: '在线' }), {
    interactive: true,
    status: '在线',
  });
});

test('移动菜单只在打开且点击菜单外部时关闭', () => {
  const outside = {};
  const inside = {};
  const menu = { contains: (target) => target === inside };
  const menuButton = { contains: () => false };

  assert.equal(portal.shouldCloseMenuOnOutsideClick({
    open: true, target: outside, menu, menuButton,
  }), true);
  assert.equal(portal.shouldCloseMenuOnOutsideClick({
    open: true, target: inside, menu, menuButton,
  }), false);
  assert.equal(portal.shouldCloseMenuOnOutsideClick({
    open: false, target: outside, menu, menuButton,
  }), false);
});

test('all public shells load the social inbox and expose an accessible toast region', () => {
  for (const path of ['./index.html', './game/index.html', './player/index.html']) {
    const html = fs.readFileSync(path, 'utf8');
    assert.match(html, /src=["']\/src\/services\/friends\.js["']/);
    assert.match(html, /src=["']\/src\/routes\/social-inbox\.js["']/);
    assert.match(html, /id=["']social-toast-region["']/);
    assert.match(html, /aria-live=["']polite["']/);
    assert.match(html, /id=["']profile-player-uid["']/);
    assert.ok(html.indexOf('/src/services/friends.js') < html.indexOf('/src/routes/account-panel.js'));
    assert.ok(html.indexOf('/src/routes/account-panel.js') < html.indexOf('/src/routes/social-inbox.js'));
  }
});

test('notification bell merges site unread and database social counts, then clears on logout', async () => {
  const harness = createNotificationBellHarness({
    identity: { kind: 'registered', username: 'player-a' },
  });
  let disconnected = 0;
  const controller = notificationBell.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    notificationsApi: {
      createNotificationsClient: () => ({
        list: async () => [],
        countUnread: async () => 4,
      }),
    },
    friendsApi: {
      createFriendsClient(options) {
        assert.equal(options.accountClient, harness.accountClient);
        return {
          listRequests: async () => [
            { id: 'request-in', direction: 'incoming' },
            { id: 'request-out', direction: 'outgoing' },
          ],
          listInvites: async () => [
            { id: 'invite-in', direction: 'incoming', status: 'pending' },
            { id: 'invite-out', direction: 'outgoing', status: 'pending' },
            { id: 'invite-done', direction: 'incoming', status: 'accepted' },
          ],
          async disconnect() { disconnected += 1; },
        };
      },
    },
  });

  await controller.refresh();
  assert.equal(harness.badge.textContent, '6');
  harness.emitIdentity({ kind: 'guest', username: null });
  await flushAsyncWork();
  assert.equal(harness.badge.hidden, true);
  assert.equal(harness.badge.textContent, '');
  controller.destroy();
  assert.equal(disconnected, 1);
});

test('social inbox logs in from guest, deduplicates database event ids, and exposes closeable accessible toasts', async () => {
  let requests = [];
  const harness = createSocialInboxHarness({
    listRequests: async () => requests,
  });
  const controller = socialInbox.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    friendsApi: harness.friendsApi,
  });

  assert.equal(harness.clients.length, 0);
  assert.equal(harness.socialCounts.at(-1), 0);
  harness.emitIdentity({ kind: 'registered', username: 'player-a' });
  await flushAsyncWork();
  assert.equal(harness.clients.length, 1);
  assert.equal(harness.clients[0].options.accountClient, harness.accountClient);
  assert.equal(harness.clients[0].subscriptions, 1);

  requests = [{
    id: 'request-1', direction: 'incoming', player: { displayName: '玩家乙' },
  }];
  harness.clients[0].emitRealtime();
  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 1);
  assert.equal(harness.region.children.length, 1);
  const toast = harness.region.children[0];
  const link = toast.children.find((child) => child.tagName === 'A');
  const closeButton = toast.children.find((child) => child.tagName === 'BUTTON');
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(link.getAttribute('href'), '/player/?tab=friends');
  assert.match(closeButton.getAttribute('aria-label'), /关闭/);

  harness.clients[0].emitRealtime();
  await flushAsyncWork();
  assert.equal(harness.region.children.length, 1);
  closeButton.dispatchEvent(new Event('click'));
  assert.equal(harness.region.children.length, 0);
  controller.destroy();
});

test('social inbox isolates late account refreshes and clears subscriptions, toasts, and counts', async () => {
  let resolveAccountA;
  const accountARequests = new Promise((resolve) => { resolveAccountA = resolve; });
  const harness = createSocialInboxHarness({
    identity: { kind: 'registered', username: 'player-a' },
    listRequests: (identityKey) => (identityKey === 'player-a'
      ? accountARequests
      : Promise.resolve([{ id: 'request-b', direction: 'incoming', player: {} }])),
  });
  const controller = socialInbox.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    friendsApi: harness.friendsApi,
  });

  await flushAsyncWork();
  harness.emitIdentity({ kind: 'registered', username: 'player-b' });
  await flushAsyncWork();
  assert.equal(harness.clients[0].cleanups, 1);
  assert.equal(harness.clients[0].disconnects, 1);
  assert.equal(harness.socialCounts.at(-1), 1);

  resolveAccountA([
    { id: 'request-a1', direction: 'incoming', player: {} },
    { id: 'request-a2', direction: 'incoming', player: {} },
  ]);
  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 1);
  assert.equal(harness.region.children.length, 0);

  harness.emitIdentity({ kind: 'guest', username: null });
  assert.equal(harness.socialCounts.at(-1), 0);
  assert.equal(harness.region.children.length, 0);
  await flushAsyncWork();
  assert.equal(harness.clients[1].cleanups, 1);
  assert.equal(harness.clients[1].disconnects, 1);

  controller.destroy();
  assert.equal(harness.socialCounts.at(-1), 0);
});

test('social inbox cannot let a later silent baseline swallow an event refresh', async () => {
  let resolveEventRequests;
  const eventRequests = new Promise((resolve) => { resolveEventRequests = resolve; });
  let requestCalls = 0;
  const newRequest = {
    id: 'request-new', direction: 'incoming', player: { displayName: '新玩家' },
  };
  const harness = createSocialInboxHarness({
    identity: { kind: 'registered', username: 'player-a' },
    listRequests: async () => {
      requestCalls += 1;
      return requestCalls === 1 ? eventRequests : [newRequest];
    },
    onSubscribe(listener) {
      listener({ type: 'changed' });
    },
  });
  const controller = socialInbox.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    friendsApi: harness.friendsApi,
  });

  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 0);
  assert.equal(harness.region.children.length, 0);
  resolveEventRequests([newRequest]);
  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 1);
  assert.equal(harness.region.children.length, 1);
  controller.destroy();
});

test('social inbox ignores an older silent baseline after a realtime database refresh commits', async () => {
  let resolveInitialRequests;
  const initialRequests = new Promise((resolve) => { resolveInitialRequests = resolve; });
  let requestCalls = 0;
  const newRequest = {
    id: 'request-during-load', direction: 'incoming', player: { displayName: '实时玩家' },
  };
  const harness = createSocialInboxHarness({
    identity: { kind: 'registered', username: 'player-a' },
    listRequests: async () => {
      requestCalls += 1;
      return requestCalls === 1 ? initialRequests : [newRequest];
    },
  });
  const controller = socialInbox.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    friendsApi: harness.friendsApi,
  });

  await flushAsyncWork();
  harness.clients[0].emitRealtime();
  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 1);
  assert.equal(harness.region.children.length, 1);

  resolveInitialRequests([]);
  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 1);
  assert.equal(harness.region.children.length, 1);
  controller.destroy();
});

test('notification bell keeps a newer social event count when an older database load finishes', async () => {
  let resolveOldRequests;
  const oldRequests = new Promise((resolve) => { resolveOldRequests = resolve; });
  const harness = createNotificationBellHarness({
    identity: { kind: 'registered', username: 'player-a' },
  });
  const controller = notificationBell.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    notificationsApi: {
      createNotificationsClient: () => ({
        list: async () => [],
        countUnread: async () => 4,
      }),
    },
    friendsApi: {
      createFriendsClient: () => ({
        listRequests: async () => oldRequests,
        listInvites: async () => [],
        disconnect: async () => {},
      }),
    },
  });

  harness.document.dispatchEvent(new CustomEvent('hyl:social-count', { detail: { count: 7 } }));
  assert.equal(harness.badge.textContent, '7');
  resolveOldRequests([{ id: 'old-request', direction: 'incoming' }]);
  await controller.refresh();
  assert.equal(harness.badge.textContent, '11');
  controller.destroy();
});

test('notification bell preserves a newer social event when an older social load rejects', async () => {
  let rejectOldRequests;
  const oldRequests = new Promise((_resolve, reject) => { rejectOldRequests = reject; });
  let requestCalls = 0;
  const harness = createNotificationBellHarness({
    identity: { kind: 'registered', username: 'player-a' },
  });
  const controller = notificationBell.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    notificationsApi: {
      createNotificationsClient: () => ({
        list: async () => [],
        countUnread: async () => 4,
      }),
    },
    friendsApi: {
      createFriendsClient: () => ({
        listRequests: async () => {
          requestCalls += 1;
          return requestCalls === 1 ? [] : oldRequests;
        },
        listInvites: async () => [],
        disconnect: async () => {},
      }),
    },
  });

  await controller.refresh();
  assert.equal(harness.badge.textContent, '4');
  await flushAsyncWork();
  const oldRefresh = controller.refresh();
  harness.document.dispatchEvent(new CustomEvent('hyl:social-count', { detail: { count: 7 } }));
  assert.equal(harness.badge.textContent, '11');
  rejectOldRequests(new Error('SOCIAL_LOAD_FAILED'));
  await oldRefresh;
  assert.equal(harness.badge.textContent, '11');
  controller.destroy();
});

test('social inbox falls back to a silent database baseline when realtime subscribe fails', async () => {
  let requestCalls = 0;
  let inviteCalls = 0;
  const harness = createSocialInboxHarness({
    identity: { kind: 'registered', username: 'player-a' },
    listRequests: async () => {
      requestCalls += 1;
      return [{ id: 'request-1', direction: 'incoming', player: { displayName: '玩家乙' } }];
    },
    listInvites: async () => {
      inviteCalls += 1;
      return [{
        id: 'invite-1', direction: 'incoming', status: 'pending', sender: { displayName: '玩家丙' },
      }];
    },
    subscribeError: new Error('CHANNEL_ERROR'),
  });
  const controller = socialInbox.mount({
    document: harness.document,
    accountPanel: harness.accountPanel,
    friendsApi: harness.friendsApi,
  });

  await flushAsyncWork();
  assert.equal(harness.socialCounts.at(-1), 2);
  assert.equal(harness.region.children.length, 0);
  assert.equal(requestCalls, 1);
  assert.equal(inviteCalls, 1);
  controller.destroy();
});

test('notification bell keeps site unread when social database calls partially or fully fail', async (t) => {
  for (const failure of ['requests', 'invites', 'both']) {
    await t.test(failure, async () => {
      const harness = createNotificationBellHarness({
        identity: { kind: 'registered', username: `player-${failure}` },
      });
      const controller = notificationBell.mount({
        document: harness.document,
        accountPanel: harness.accountPanel,
        notificationsApi: {
          createNotificationsClient: () => ({
            list: async () => [],
            countUnread: async () => 4,
          }),
        },
        friendsApi: {
          createFriendsClient: () => ({
            listRequests: async () => {
              if (failure === 'requests' || failure === 'both') throw new Error('REQUESTS_FAILED');
              return [];
            },
            listInvites: async () => {
              if (failure === 'invites' || failure === 'both') throw new Error('INVITES_FAILED');
              return [];
            },
            disconnect: async () => {},
          }),
        },
      });

      await controller.refresh();
      assert.equal(harness.badge.textContent, '4');
      controller.destroy();
    });
  }
});

test('shared social toasts stay visible, responsive, focusable, and motion-safe', () => {
  const css = fs.readFileSync('./assets/styles/portal.css', 'utf8');
  assert.match(css, /\.social-toast-region\s*\{[^}]*position:\s*fixed[^}]*top:[^;}]*env\(safe-area-inset-top\)[^}]*z-index:\s*\d+[^}]*max-width:/s);
  assert.match(css, /\.social-toast\s*\{[^}]*pointer-events:\s*auto[^}]*animation:/s);
  assert.match(css, /\.social-toast[^}]*:focus-visible[^}]*\{[^}]*outline:/s);
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*\.social-toast-region/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.social-toast[^}]*animation:\s*none/s);
});
