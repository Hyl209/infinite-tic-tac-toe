const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let app = {};
try {
  app = require('../../src/routes/game.js');
} catch {
  app = {};
}

test('页面加载战绩服务并提供分开的个人历史和排行榜入口', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  assert.match(
    html,
    /src="src\/services\/economy\.js"[^>]*defer[\s\S]*src="src\/services\/stats\.js"[^>]*defer[\s\S]*src="src\/routes\/game\.js"[^>]*defer/,
  );
  for (const id of [
    'open-leaderboard-button',
    'leaderboard-view',
    'leaderboard-back-button',
    'leaderboard-season-select',
    'leaderboard-game-tabs',
    'leaderboard-list',
    'leaderboard-current-player',
    'match-history-panel',
    'match-history-filter',
    'match-history-list',
    'load-more-history-button',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('管理后台提供赛季开启结束和历史列表', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  for (const id of [
    'admin-season-form',
    'admin-season-name',
    'admin-current-season',
    'end-current-season-button',
    'admin-season-list',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="admin-title">管理后台</);
  assert.match(html, /id="open-admin-button"[^>]*>管理后台</);
});

test('页面控制器接入战绩查询、分页、排行榜和赛季管理', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(source, /PlayerStats/);
  assert.match(source, /createStatsClient\(\{[\s\S]*accountClient/);
  assert.match(source, /statsClient\.listSeasons/);
  assert.match(source, /statsClient\.getHistory/);
  assert.match(source, /statsClient\.getMyStandings/);
  assert.match(source, /statsClient\.getLeaderboard/);
  assert.match(source, /statsClient\.startSeason/);
  assert.match(source, /statsClient\.endSeason/);
  assert.match(source, /beforeFinishedAt/);
  assert.match(source, /beforeId/);
});

test('战绩和排行榜格式化函数返回稳定中文文案', () => {
  assert.equal(app.formatMatchResult('win'), '胜利');
  assert.equal(app.formatMatchResult('draw'), '平局');
  assert.equal(app.formatMatchResult('loss'), '失败');
  assert.equal(app.formatFinishReason('active_exit', 'win'), '对手主动退出');
  assert.equal(app.formatFinishReason('disconnect', 'loss'), '断线判负');
  assert.equal(app.formatWinRate(66.666), '66.7%');
});

test('排行榜错误态不显示空榜且赛季摘要优先进行中赛季', () => {
  assert.equal(app.shouldShowLeaderboardEmpty({
    busy: false, error: '请求失败', entries: [], hasSeason: true,
  }), false);
  assert.equal(app.shouldShowLeaderboardEmpty({
    busy: false, error: '', entries: [], hasSeason: true,
  }), true);
  assert.equal(app.shouldShowLeaderboardEmpty({
    busy: false, error: '', entries: [], hasSeason: false,
  }), false);
  assert.equal(app.selectPreferredSeason([
    { id: 'ended', status: 'ended' },
    { id: 'active', status: 'active' },
  ]).id, 'active');
});

test('排行榜使用请求序号阻止旧响应覆盖新分榜', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(source, /leaderboardRequestId/);
  assert.match(source, /requestId\s*!==\s*leaderboardRequestId/);
});

test('个人战绩使用请求序号阻止旧账号响应覆盖', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(source, /matchHistoryRequestId/);
  assert.match(source, /requestId\s*!==\s*matchHistoryRequestId/);
  assert.match(source, /matchHistoryBusy\s*&&\s*!reset/);
  assert.match(
    source,
    /accountClient\?\.subscribe\([\s\S]*matchHistoryRequestId\s*\+=\s*1/,
  );
});

test('战绩类型声明覆盖赛季历史摘要和榜单', () => {
  const types = fs.readFileSync('./src/types/game.d.ts', 'utf8');
  for (const name of [
    'CompetitiveSeason',
    'MatchHistoryItem',
    'PlayerStanding',
    'LeaderboardEntry',
  ]) {
    assert.match(types, new RegExp(`interface ${name}`));
  }
  assert.match(types, /pointsAwarded:\s*number \| null/);
  assert.match(types, /isCurrentPlayer:\s*boolean/);
  assert.match(types, /isTopEntry:\s*boolean/);
});

test('战绩和排行榜复用现有视觉体系并支持窄屏', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  for (const selector of [
    '.leaderboard-shell',
    '.leaderboard-list',
    '.leaderboard-row',
    '.match-history-panel',
    '.match-history-item',
    '.season-summary',
    '.admin-season-section',
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  }
  const mobile = css.slice(css.indexOf('@media (max-width: 760px)'));
  assert.match(mobile, /\.leaderboard-shell/);
  assert.match(mobile, /\.leaderboard-row/);
  assert.match(mobile, /\.match-history-item/);
});
