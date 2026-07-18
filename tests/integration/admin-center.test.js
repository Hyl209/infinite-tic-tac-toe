const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

let admin = {};
try {
  admin = require('../../src/routes/admin.js');
} catch {
  admin = {};
}

class FakeElement extends EventTarget {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.disabled = false;
    this.className = '';
    this.value = '';
    this.defaultValue = '';
    this.min = '';
    this._textContent = '';
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this._textContent = '';
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {}

  matches(selector) {
    const data = /^\[data-([a-z-]+)(?:="([^"]+)")?\]$/.exec(selector);
    if (data) {
      const key = data[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      return Object.hasOwn(this.dataset, key) && (data[2] == null || String(this.dataset[key]) === data[2]);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim());
    return this.children.flatMap((child) => [
      ...(selectors.some((item) => child.matches(item)) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

class FakeForm extends FakeElement {
  constructor(fieldNames) {
    super('form');
    this.elements = {};
    fieldNames.forEach((name) => {
      const control = new FakeElement(name === 'body' ? 'textarea' : 'input');
      control.name = name;
      this.elements[name] = control;
      this.append(control);
    });
    const submit = new FakeElement('button');
    this.append(submit);
  }

  reset() {
    Object.values(this.elements).forEach((control) => {
      control.value = control.defaultValue;
    });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settleAdminRuntime() {
  await flushPromises();
  await flushPromises();
  await flushPromises();
}

function adminActivity(id, title, active = true) {
  return {
    id,
    title,
    body: `${title}正文`,
    coverUrl: null,
    actionLabel: null,
    actionUrl: null,
    publishAt: '2026-07-18T08:00:00.000Z',
    startsAt: '2026-07-18T09:00:00.000Z',
    endsAt: '2099-07-18T10:00:00.000Z',
    rewardAmount: 0,
    claimCount: 0,
    active,
  };
}

function createAdminRuntimeHarness({ listActivities } = {}) {
  let identity = { kind: 'registered', username: 'admin-a', displayName: '管理员 A' };
  let economySnapshot = { loaded: true, isAdmin: true, balance: 10 };
  let subscriptionListener = null;
  const activityCalls = [];
  const nodes = new Map();
  const add = (selector, element = new FakeElement()) => {
    nodes.set(selector, element);
    return element;
  };

  const workspace = add('#admin-workspace');
  workspace.hidden = true;
  add('#admin-access-state');
  add('#admin-login-button', new FakeElement('button'));
  add('#admin-retry-button', new FakeElement('button'));
  const activityForm = add('#admin-activity-form', new FakeForm([
    'id', 'title', 'body', 'coverUrl', 'rewardAmount', 'actionLabel',
    'actionUrl', 'publishAt', 'startsAt', 'endsAt',
  ]));
  const activityCancel = add('#admin-activity-cancel', new FakeElement('button'));
  activityCancel.hidden = true;
  const activityList = add('#admin-activity-list');
  add('#admin-activity-message');
  add('#admin-checkin-form', new FakeForm([
    'effectiveFrom', 'mondayReward', 'tuesdayReward', 'wednesdayReward',
    'thursdayReward', 'fridayReward', 'saturdayReward', 'sundayReward', 'makeupCost',
  ]));
  add('#admin-checkin-list');
  add('#admin-checkin-message');
  add('#admin-notification-form', new FakeForm([
    'title', 'body', 'rewardAmount', 'visibleAt', 'expiresAt',
  ]));
  add('#admin-notification-list');
  add('#admin-notification-message');
  add('#admin-season-form', new FakeForm(['seasonName']));
  add('#admin-current-season');
  add('#end-current-season-button', new FakeElement('button'));
  add('#admin-season-list');
  add('#admin-season-message');
  add('#admin-redeem-form', new FakeForm(['amount', 'maxClaims', 'expiresAt']));
  add('#admin-redeem-list');
  add('#admin-redeem-message');
  add('#admin-generated-code');
  add('#admin-generated-code-value');
  add('#copy-generated-code-button', new FakeElement('button'));
  add('#admin-system-status');

  const accountClient = {
    async initialize() { return { ...identity }; },
    getIdentity() { return { ...identity }; },
  };
  const economyClient = {
    async refresh() { return { ...economySnapshot }; },
    async listRedeemCodes() { return []; },
    async createRedeemCode() { return {}; },
    async disableRedeemCode() {},
  };
  const statsClient = {
    async listSeasons() { return []; },
    async startSeason() {},
    async endSeason() {},
  };
  const activitiesClient = {
    async adminList() {
      const key = identity.kind === 'registered' ? identity.username : identity.kind;
      activityCalls.push(key);
      return listActivities ? listActivities(key) : [];
    },
    async adminSave() {},
    async adminUnpublish() {},
  };
  const checkinClient = {
    async adminListRules() { return []; },
    async adminCreateRule() {},
  };
  const notificationsClient = {
    async adminList() { return []; },
    async adminPublish() {},
    async adminDisable() {},
  };
  const accountPanel = {
    accountClient,
    economyClient,
    statsClient,
    getIdentity: () => ({ ...identity }),
    getEconomySnapshot: () => ({ ...economySnapshot }),
    subscribe(listener) {
      subscriptionListener = listener;
      return () => { subscriptionListener = null; };
    },
    open() {},
  };

  const keys = [
    'document', 'HYLAccountPanel', 'PlayerActivities', 'PlayerCheckin',
    'PlayerNotifications', 'PlayerEconomy', 'PlayerStats', 'confirm',
  ];
  const previous = new Map(keys.map((key) => [key, globalThis[key]]));
  globalThis.document = {
    querySelector(selector) { return nodes.get(selector) || null; },
    createElement(tagName) { return new FakeElement(tagName); },
  };
  globalThis.HYLAccountPanel = { mount: () => accountPanel };
  globalThis.PlayerActivities = {
    createActivitiesClient: () => activitiesClient,
    mapActivitiesError: () => '活动失败',
  };
  globalThis.PlayerCheckin = {
    createCheckinClient: () => checkinClient,
    mapCheckinError: () => '签到失败',
  };
  globalThis.PlayerNotifications = {
    createNotificationsClient: () => notificationsClient,
    mapNotificationsError: () => '通知失败',
  };
  globalThis.PlayerEconomy = { mapEconomyError: () => '经济失败' };
  globalThis.PlayerStats = { mapStatsError: () => '赛季失败' };
  globalThis.confirm = () => true;

  return {
    workspace,
    activityForm,
    activityList,
    activityCalls,
    mount() { return globalThis.HYLAdminCenter.mount(); },
    setIdentity(nextIdentity, nextEconomySnapshot) {
      identity = { ...nextIdentity };
      economySnapshot = { ...nextEconomySnapshot };
      subscriptionListener?.({
        identity: { ...identity },
        economySnapshot: { ...economySnapshot },
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

test('统一管理中心提供六个首阶段分区和受保护工作区', () => {
  const html = read('./admin/index.html');
  assert.equal(fs.existsSync('./admin/index.html'), true);
  assert.equal(fs.existsSync('./assets/styles/admin.css'), true);
  assert.match(html, /href="\/"[^>]*>返回首页</);
  assert.match(html, /id="admin-access-state"[^>]*aria-live="polite"/);
  assert.match(html, /id="admin-login-button"/);
  assert.match(html, /id="admin-workspace"[^>]*hidden/);

  const sections = [
    ['activity', '活动'],
    ['checkin', '签到规则'],
    ['notification', '通知'],
    ['season', '赛季'],
    ['redeem', '兑换码'],
    ['system', '系统状态'],
  ];
  for (const [id, title] of sections) {
    assert.match(html, new RegExp(`id="admin-${id}-section"[\\s\\S]*${title}`));
  }

  for (const formId of [
    'admin-activity-form',
    'admin-checkin-form',
    'admin-notification-form',
    'admin-season-form',
    'admin-redeem-form',
  ]) {
    assert.match(html, new RegExp(`id="${formId}"`));
  }
});

test('管理页按账号、经济快照、业务客户端、路由顺序加载', () => {
  const html = read('./admin/index.html');
  assert.match(
    html,
    /src="\/src\/services\/online\.js"[^>]*defer[\s\S]*src="\/src\/services\/account\.js"[^>]*defer[\s\S]*src="\/src\/services\/economy\.js"[^>]*defer[\s\S]*src="\/src\/services\/stats\.js"[^>]*defer[\s\S]*src="\/src\/services\/activities\.js"[^>]*defer[\s\S]*src="\/src\/services\/checkin\.js"[^>]*defer[\s\S]*src="\/src\/services\/notifications\.js"[^>]*defer[\s\S]*src="\/src\/routes\/account-panel\.js"[^>]*defer[\s\S]*src="\/src\/routes\/admin\.js"[^>]*defer/,
  );
});

test('权限状态明确区分游客、普通账号和管理员', () => {
  assert.equal(typeof admin.resolveAdminAccess, 'function');
  assert.equal(admin.resolveAdminAccess({
    identity: { kind: 'guest' },
    economySnapshot: { loaded: true, isAdmin: false },
  }), 'login');
  assert.equal(admin.resolveAdminAccess({
    identity: { kind: 'registered' },
    economySnapshot: { loaded: true, isAdmin: false },
  }), 'forbidden');
  assert.equal(admin.resolveAdminAccess({
    identity: { kind: 'registered' },
    economySnapshot: { loaded: true, isAdmin: true },
  }), 'admin');
});

test('管理页等待账号初始化后才读取经济权限', async () => {
  assert.equal(typeof admin.initializeAdminAccess, 'function');
  const calls = [];
  const result = await admin.initializeAdminAccess({
    accountClient: {
      async initialize() {
        calls.push('account:start');
        await Promise.resolve();
        calls.push('account:end');
        return { kind: 'registered', username: 'lige' };
      },
      getIdentity() {
        return { kind: 'registered', username: 'lige' };
      },
    },
    economyClient: {
      async refresh() {
        calls.push('economy');
        return { loaded: true, isAdmin: true, balance: 100 };
      },
    },
  });
  assert.deepEqual(calls, ['account:start', 'account:end', 'economy']);
  assert.equal(result.access, 'admin');
  assert.equal(result.economySnapshot.isAdmin, true);
});

test('活动表单匹配服务契约并把浏览器本地时间转为 UTC', () => {
  const html = read('./admin/index.html');
  for (const name of [
    'id', 'title', 'body', 'coverUrl', 'actionLabel', 'actionUrl',
    'publishAt', 'startsAt', 'endsAt', 'rewardAmount',
  ]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  for (const name of ['publishAt', 'startsAt', 'endsAt']) {
    assert.match(html, new RegExp(`name="${name}"[^>]*type="datetime-local"|type="datetime-local"[^>]*name="${name}"`));
  }
  assert.equal(typeof admin.localDateTimeToIso, 'function');
  assert.equal(
    admin.localDateTimeToIso('2026-07-18T16:30'),
    new Date('2026-07-18T16:30').toISOString(),
  );
  assert.match(admin.activityScheduledMessage('2026-07-18T08:30:00.000Z'), /^已排期，将于 .* 自动发布$/);
});

test('活动公开地址接受站内路径并拒绝非 HTTPS 外链，操作文字和地址必须成对', () => {
  const html = read('./admin/index.html');
  assert.match(html, /name="actionLabel"[^>]*maxlength="30"/);
  assert.match(html, /name="actionUrl"[^>]*type="text"/);
  assert.match(html, /name="coverUrl"[^>]*type="url"/);
  assert.match(html, /id="admin-notification-form"[\s\S]*?name="title"[^>]*maxlength="80"/);
  assert.equal(typeof admin.validateAdminPublicUrl, 'function');
  assert.equal(admin.validateAdminPublicUrl('/player/?tab=activities', { allowRelative: true }), '/player/?tab=activities');
  assert.equal(admin.validateAdminPublicUrl('https://cdn.example.com/cover.webp'), 'https://cdn.example.com/cover.webp');
  assert.throws(() => admin.validateAdminPublicUrl('http://example.com/cover.webp'), /HTTPS/);
  assert.throws(() => admin.validateAdminPublicUrl('http://example.com/action', { allowRelative: true }), /HTTPS|站内路径/);
  assert.equal(typeof admin.validateAdminActivityLinks, 'function');
  assert.deepEqual(admin.validateAdminActivityLinks({
    coverUrl: 'https://cdn.example.com/cover.webp',
    actionLabel: '查看活动',
    actionUrl: '/player/?tab=activities',
  }), {
    coverUrl: 'https://cdn.example.com/cover.webp',
    actionLabel: '查看活动',
    actionUrl: '/player/?tab=activities',
  });
  assert.throws(() => admin.validateAdminActivityLinks({ actionLabel: '查看活动' }), /同时填写/);
  assert.throws(() => admin.validateAdminActivityLinks({ actionUrl: '/player/' }), /同时填写/);
  assert.equal(typeof admin.validateAdminNotificationTitle, 'function');
  assert.equal(admin.validateAdminNotificationTitle('  独立通知  '), '独立通知');
  assert.throws(() => admin.validateAdminNotificationTitle('通'.repeat(81)), /80/);
  const source = read('./src/routes/admin.js');
  const submitStart = source.indexOf("activityForm.addEventListener('submit'");
  const saveStart = source.indexOf('activitiesClient.adminSave', submitStart);
  assert.ok(submitStart >= 0 && saveStart > submitStart);
  assert.match(source.slice(submitStart, saveStart), /validateAdminActivityLinks/);
  const notificationSubmit = source.indexOf("notificationForm.addEventListener('submit'");
  const publishStart = source.indexOf('notificationsClient.adminPublish', notificationSubmit);
  assert.ok(notificationSubmit >= 0 && publishStart > notificationSubmit);
  assert.match(source.slice(notificationSubmit, publishStart), /validateAdminNotificationTitle/);
});

test('签到规则只接受范围内整数且生效日期不早于香港今天', () => {
  assert.equal(typeof admin.validateCheckinRule, 'function');
  const valid = admin.validateCheckinRule({
    effectiveFrom: '2026-07-18',
    mondayReward: '1',
    tuesdayReward: '2',
    wednesdayReward: '3',
    thursdayReward: '4',
    fridayReward: '5',
    saturdayReward: '6',
    sundayReward: '7',
    makeupCost: '8',
  }, '2026-07-18');
  assert.equal(valid.mondayReward, 1);
  assert.equal(valid.makeupCost, 8);
  assert.throws(() => admin.validateCheckinRule({ ...valid, mondayReward: 1.5 }, '2026-07-18'), /整数/);
  assert.throws(() => admin.validateCheckinRule({ ...valid, sundayReward: 1_000_001 }, '2026-07-18'), /0 至 1000000/);
  assert.throws(() => admin.validateCheckinRule({ ...valid, effectiveFrom: '2026-07-17' }, '2026-07-18'), /香港今天/);
});

test('管理控制器复用现有业务客户端并并行加载配置', () => {
  const source = read('./src/routes/admin.js');
  for (const call of [
    'activitiesClient.adminList',
    'activitiesClient.adminSave',
    'activitiesClient.adminUnpublish',
    'checkinClient.adminListRules',
    'checkinClient.adminCreateRule',
    'notificationsClient.adminList',
    'notificationsClient.adminPublish',
    'notificationsClient.adminDisable',
    'statsClient.listSeasons',
    'statsClient.startSeason',
    'statsClient.endSeason',
    'economyClient.listRedeemCodes',
    'economyClient.createRedeemCode',
    'economyClient.disableRedeemCode',
  ]) {
    assert.match(source, new RegExp(call.replace('.', '\\.')));
  }
  assert.match(source, /Promise\.all\(\[/);
  assert.doesNotMatch(source, /\.rpc\(|select\s+.*\s+from/i);
});

test('管理员切换后只渲染新账号配置，旧账号延迟响应不能覆盖', async () => {
  const firstLoad = deferred();
  const harness = createAdminRuntimeHarness({
    listActivities(accountKey) {
      if (accountKey === 'admin-a') return firstLoad.promise;
      return [adminActivity('activity-b', '管理员 B 活动')];
    },
  });
  try {
    harness.mount();
    await settleAdminRuntime();
    assert.deepEqual(harness.activityCalls, ['admin-a']);
    harness.setIdentity(
      { kind: 'registered', username: 'admin-b', displayName: '管理员 B' },
      { loaded: true, isAdmin: true, balance: 20 },
    );
    await settleAdminRuntime();
    assert.deepEqual(harness.activityCalls, ['admin-a', 'admin-b']);
    assert.match(harness.activityList.textContent, /管理员 B 活动/);
    firstLoad.resolve([adminActivity('activity-a', '管理员 A 活动')]);
    await settleAdminRuntime();
    assert.match(harness.activityList.textContent, /管理员 B 活动/);
    assert.doesNotMatch(harness.activityList.textContent, /管理员 A 活动/);
  } finally {
    firstLoad.resolve([]);
    await settleAdminRuntime();
    harness.restore();
  }
});

test('管理员切换为游客会立即隐藏工作区并清除旧请求结果', async () => {
  const firstLoad = deferred();
  const harness = createAdminRuntimeHarness({
    listActivities: () => firstLoad.promise,
  });
  try {
    harness.mount();
    await settleAdminRuntime();
    harness.setIdentity(
      { kind: 'guest', displayName: '匿名玩家' },
      { loaded: true, isAdmin: false, balance: 0 },
    );
    assert.equal(harness.workspace.hidden, true);
    firstLoad.resolve([adminActivity('activity-a', '管理员 A 私有配置')]);
    await settleAdminRuntime();
    assert.doesNotMatch(harness.activityList.textContent, /管理员 A 私有配置/);
  } finally {
    firstLoad.resolve([]);
    await settleAdminRuntime();
    harness.restore();
  }
});

test('通知表单包含独立发布时间、失效时间与奖励字段', () => {
  const html = read('./admin/index.html');
  const start = html.indexOf('id="admin-notification-form"');
  const end = html.indexOf('</form>', start);
  const form = html.slice(start, end);
  for (const name of ['title', 'body', 'rewardAmount', 'visibleAt', 'expiresAt']) {
    assert.match(form, new RegExp(`name="${name}"`));
  }
  assert.match(form, /name="visibleAt"[^>]*type="datetime-local"|type="datetime-local"[^>]*name="visibleAt"/);
  assert.match(form, /name="expiresAt"[^>]*type="datetime-local"|type="datetime-local"[^>]*name="expiresAt"/);
});

test('通知管理记录显示关联活动来源并明确标记独立通知', () => {
  assert.equal(typeof admin.notificationActivitySource, 'function');
  assert.equal(
    admin.notificationActivitySource({ activityId: 'summer-event-2026' }),
    '关联活动：summer-event-2026',
  );
  assert.equal(admin.notificationActivitySource({ activityId: null }), '独立通知');
  assert.match(read('./src/routes/admin.js'), /notificationActivitySource\(notification\)/);
});

test('已下架活动不再提供可提交的编辑入口', () => {
  const source = read('./src/routes/admin.js');
  assert.equal(typeof admin.canEditAdminActivity, 'function');
  assert.equal(admin.canEditAdminActivity({ active: true }), true);
  assert.equal(admin.canEditAdminActivity({ active: false }), false);
  assert.match(source, /label:\s*'编辑'[\s\S]{0,160}disabled:\s*!activity\.active/);
  assert.match(source, /if\s*\(!activity\s*\|\|\s*!activity\.active\)\s*return/);
  const submitStart = source.indexOf("activityForm.addEventListener('submit'");
  const saveStart = source.indexOf('activitiesClient.adminSave', submitStart);
  assert.match(source.slice(submitStart, saveStart), /canEditAdminActivity/);
});

test('已下架活动渲染的编辑控件原生禁用', async () => {
  const harness = createAdminRuntimeHarness({
    listActivities: () => [adminActivity('inactive', '已下架活动', false)],
  });
  try {
    harness.mount();
    await settleAdminRuntime();
    const editButton = harness.activityList.querySelector('[data-edit-activity="inactive"]');
    assert.ok(editButton);
    assert.equal(editButton.disabled, true);
    assert.equal(harness.activityForm.elements.id.value, '');
  } finally {
    harness.restore();
  }
});

test('后台样式包含可达焦点、加载禁用和窄屏布局', () => {
  const css = read('./assets/styles/admin.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /:disabled/);
  assert.match(css, /\[aria-busy="true"\]/);
  assert.match(css, /@media\s*\(max-width:/);
  assert.match(css, /--admin-accent:\s*oklch\(0\.61\s+0\.23\s+266\)/i);
});
