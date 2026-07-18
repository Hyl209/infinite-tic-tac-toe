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

test('后台样式包含可达焦点、加载禁用和窄屏布局', () => {
  const css = read('./assets/styles/admin.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /:disabled/);
  assert.match(css, /\[aria-busy="true"\]/);
  assert.match(css, /@media\s*\(max-width:/);
  assert.match(css, /--admin-accent:\s*oklch\(0\.61\s+0\.23\s+266\)/i);
});
