const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const expectedFiles = [
  'game/index.html',
  'player/index.html',
  'admin/index.html',
  'src/config/portal.js',
  'src/routes/game.js',
  'src/routes/account-panel.js',
  'src/routes/portal.js',
  'src/routes/player.js',
  'src/routes/admin.js',
  'src/routes/notification-bell.js',
  'src/services/account.js',
  'src/services/online.js',
  'src/services/activities.js',
  'src/services/notifications.js',
  'src/services/checkin.js',
  'src/domain/games/tic-tac-toe.js',
  'src/domain/games/gomoku.js',
  'src/utils/room-code.js',
  'src/config/online.js',
  'src/types/game.d.ts',
  'src/workers/gomoku-ai-worker.js',
  'assets/styles/game.css',
  'assets/styles/portal.css',
  'assets/styles/player.css',
  'assets/styles/admin.css',
  'assets/vendor/gsap/gsap.min.js',
  'assets/vendor/gsap/ScrollTrigger.min.js',
  'tests/unit/account.test.js',
  'tests/unit/online.test.js',
  'tests/unit/activities.test.js',
  'tests/unit/notifications.test.js',
  'tests/unit/checkin.test.js',
  'tests/unit/tic-tac-toe.test.js',
  'tests/unit/gomoku.test.js',
  'tests/integration/game.test.js',
  'tests/integration/portal.test.js',
  'tests/integration/supabase.test.js',
  'tests/integration/engagement-supabase.test.js',
  'tests/integration/player-center.test.js',
  'tests/integration/admin-center.test.js',
  'tests/integration/structure.test.js',
  'database/supabase/setup.sql',
];

test('源码、测试和数据库文件按职责归档', () => {
  for (const file of expectedFiles) {
    assert.equal(fs.existsSync(file), true, `缺少 ${file}`);
  }
});

test('根目录只保留静态入口，不再散落 JavaScript 和 CSS 源码', () => {
  const rootCodeFiles = fs.readdirSync('.')
    .filter((file) => /\.(?:js|css)$/.test(file));
  assert.deepEqual(rootCodeFiles, []);
});
