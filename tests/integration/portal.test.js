const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let portalContent = {};
let portal = {};

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
