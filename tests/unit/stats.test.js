const test = require('node:test');
const assert = require('node:assert/strict');

let stats = {};
try {
  stats = require('../../src/services/stats.js');
} catch {
  stats = {};
}

function createFakeAccount({ kind = 'registered' } = {}) {
  const calls = [];
  const responses = new Map();
  const supabase = {
    async rpc(name, params) {
      calls.push([name, params]);
      return responses.get(name) || { data: [], error: null };
    },
  };
  return {
    calls,
    responses,
    accountClient: {
      getIdentity() {
        return {
          kind,
          username: kind === 'registered' ? 'player_01' : null,
          displayName: kind === 'registered' ? '棋手甲' : '匿名玩家·ABCD',
        };
      },
      async getSupabaseClient() {
        return supabase;
      },
    },
  };
}

test('赛季列表把数据库字段映射成页面模型', async () => {
  const fake = createFakeAccount();
  fake.responses.set('list_competitive_seasons', {
    data: [{
      id: 'season-1',
      name: '第一赛季',
      status: 'active',
      started_at: '2026-07-17T00:00:00Z',
      ended_at: null,
      is_current: true,
    }],
    error: null,
  });
  const client = stats.createStatsClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.listSeasons(), [{
    id: 'season-1',
    name: '第一赛季',
    status: 'active',
    startedAt: '2026-07-17T00:00:00Z',
    endedAt: null,
    isCurrent: true,
  }]);
  assert.deepEqual(fake.calls, [['list_competitive_seasons', undefined]]);
});

test('个人历史使用稳定游标并映射对手结果和彩头', async () => {
  const fake = createFakeAccount();
  fake.responses.set('get_my_match_history', {
    data: [{
      id: 'match-1',
      game_type: 'gomoku',
      opponent_name: '棋手乙',
      result: 'win',
      finish_reason: 'disconnect',
      wager_amount: 50,
      coin_delta: 50,
      points_awarded: 3,
      season_id: 'season-1',
      season_name: '第一赛季',
      finished_at: '2026-07-17T08:00:00Z',
    }],
    error: null,
  });
  const client = stats.createStatsClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.getHistory({
    gameType: 'gomoku',
    beforeFinishedAt: '2026-07-18T00:00:00Z',
    beforeId: 'match-2',
    limit: 20,
  }), [{
    id: 'match-1',
    gameType: 'gomoku',
    opponentName: '棋手乙',
    result: 'win',
    finishReason: 'disconnect',
    wagerAmount: 50,
    coinDelta: 50,
    pointsAwarded: 3,
    seasonId: 'season-1',
    seasonName: '第一赛季',
    finishedAt: '2026-07-17T08:00:00Z',
  }]);
  assert.deepEqual(fake.calls, [['get_my_match_history', {
    p_game_type: 'gomoku',
    p_before_finished_at: '2026-07-18T00:00:00Z',
    p_before_id: 'match-2',
    p_limit: 20,
  }]]);
});

test('游客不能读取个人历史', async () => {
  const fake = createFakeAccount({ kind: 'guest' });
  const client = stats.createStatsClient({ accountClient: fake.accountClient });

  await assert.rejects(client.getHistory(), /REGISTERED_ACCOUNT_REQUIRED/);
  await assert.rejects(client.getMyStandings(), /REGISTERED_ACCOUNT_REQUIRED/);
  assert.deepEqual(fake.calls, []);
});

test('个人赛季摘要映射两个游戏的名次和胜率', async () => {
  const fake = createFakeAccount();
  fake.responses.set('get_my_standings', {
    data: [{
      season_id: 'season-1', game_type: 'tic_tac_toe', rank: 4,
      points: 19, wins: 6, draws: 1, losses: 2, games: 9, win_rate: 66.7,
    }],
    error: null,
  });
  const client = stats.createStatsClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.getMyStandings('season-1'), [{
    seasonId: 'season-1', gameType: 'tic_tac_toe', rank: 4,
    points: 19, wins: 6, draws: 1, losses: 2, games: 9, winRate: 66.7,
  }]);
  assert.deepEqual(fake.calls, [['get_my_standings', { p_season_id: 'season-1' }]]);
});

test('公开排行榜返回前百名并标记当前玩家固定行', async () => {
  const fake = createFakeAccount();
  fake.responses.set('get_competitive_leaderboard', {
    data: [{
      rank: 123,
      player_id: 'player-1',
      display_name: '棋手甲',
      points: 8,
      wins: 2,
      draws: 2,
      losses: 7,
      games: 11,
      win_rate: 18.2,
      is_current_player: true,
      is_top_entry: false,
    }],
    error: null,
  });
  const client = stats.createStatsClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.getLeaderboard({
    seasonId: 'season-1', gameType: 'gomoku', limit: 100,
  }), [{
    rank: 123,
    playerId: 'player-1',
    displayName: '棋手甲',
    points: 8,
    wins: 2,
    draws: 2,
    losses: 7,
    games: 11,
    winRate: 18.2,
    isCurrentPlayer: true,
    isTopEntry: false,
  }]);
  assert.deepEqual(fake.calls, [['get_competitive_leaderboard', {
    p_season_id: 'season-1', p_game_type: 'gomoku', p_limit: 100,
  }]]);
});

test('管理员赛季操作会规范化名称并传递赛季 ID', async () => {
  const fake = createFakeAccount();
  fake.responses.set('start_competitive_season', {
    data: [{ id: 'season-2', name: '第二赛季', status: 'active' }],
    error: null,
  });
  fake.responses.set('end_competitive_season', {
    data: [{ id: 'season-2', name: '第二赛季', status: 'ended' }],
    error: null,
  });
  const client = stats.createStatsClient({ accountClient: fake.accountClient });

  assert.equal((await client.startSeason('  第二赛季  ')).name, '第二赛季');
  assert.equal((await client.endSeason('season-2')).status, 'ended');
  assert.deepEqual(fake.calls, [
    ['start_competitive_season', { p_name: '第二赛季' }],
    ['end_competitive_season', { p_season_id: 'season-2' }],
  ]);
});

test('战绩错误码映射成明确中文提示', () => {
  assert.equal(stats.mapStatsError(new Error('NO_ACTIVE_SEASON')), '当前没有进行中的赛季');
  assert.equal(stats.mapStatsError(new Error('ACTIVE_SEASON_EXISTS')), '请先结束当前赛季');
  assert.equal(stats.mapStatsError(new Error('ADMIN_REQUIRED')), '需要管理员权限');
  assert.equal(stats.mapStatsError(new Error('unexpected')), '战绩服务暂时不可用，请稍后重试');
});
