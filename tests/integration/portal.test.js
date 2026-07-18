const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let portalContent = {};
let portal = {};
let notificationBell = {};

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
  }
});

test('notification bell merges site and social pending counts', () => {
  const source = fs.readFileSync('./src/routes/notification-bell.js', 'utf8');
  assert.match(source, /friendsApi/);
  assert.match(source, /createFriendsClient\s*\(/);
  assert.match(source, /listRequests\s*\(/);
  assert.match(source, /listInvites\s*\(/);
  assert.match(source, /site[^\n]*\+[^\n]*social|social[^\n]*\+[^\n]*site/i);
});
