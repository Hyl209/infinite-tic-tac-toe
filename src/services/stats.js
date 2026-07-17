(function initPlayerStats(globalScope) {
  const GAME_TYPES = new Set(['tic_tac_toe', 'gomoku']);

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function mapSeason(row = {}) {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? null,
      isCurrent: Boolean(row.is_current),
    };
  }

  function mapHistoryItem(row = {}) {
    return {
      id: row.id,
      gameType: row.game_type,
      opponentName: row.opponent_name,
      result: row.result,
      finishReason: row.finish_reason,
      wagerAmount: numberValue(row.wager_amount),
      coinDelta: numberValue(row.coin_delta),
      pointsAwarded: row.points_awarded === null || row.points_awarded === undefined
        ? null
        : numberValue(row.points_awarded),
      seasonId: row.season_id ?? null,
      seasonName: row.season_name ?? null,
      finishedAt: row.finished_at,
    };
  }

  function mapStanding(row = {}) {
    return {
      seasonId: row.season_id,
      gameType: row.game_type,
      rank: numberValue(row.rank),
      points: numberValue(row.points),
      wins: numberValue(row.wins),
      draws: numberValue(row.draws),
      losses: numberValue(row.losses),
      games: numberValue(row.games),
      winRate: numberValue(row.win_rate),
    };
  }

  function mapLeaderboardEntry(row = {}) {
    return {
      rank: numberValue(row.rank),
      playerId: row.player_id,
      displayName: row.display_name,
      points: numberValue(row.points),
      wins: numberValue(row.wins),
      draws: numberValue(row.draws),
      losses: numberValue(row.losses),
      games: numberValue(row.games),
      winRate: numberValue(row.win_rate),
      isCurrentPlayer: Boolean(row.is_current_player),
      isTopEntry: Boolean(row.is_top_entry),
    };
  }

  function mapStatsError(error) {
    const message = String(error?.message || error || '');
    const known = [
      ['REGISTERED_ACCOUNT_REQUIRED', '请先登录正式账号'],
      ['NO_ACTIVE_SEASON', '当前没有进行中的赛季'],
      ['ACTIVE_SEASON_EXISTS', '请先结束当前赛季'],
      ['SEASON_NAME_EXISTS', '赛季名称已存在'],
      ['SEASON_NOT_FOUND', '赛季不存在'],
      ['SEASON_NOT_ACTIVE', '这个赛季已经结束'],
      ['INVALID_SEASON_NAME', '赛季名称需为 1 至 40 个有效字符'],
      ['INVALID_GAME_TYPE', '不支持这个游戏'],
      ['INVALID_CURSOR', '战绩分页参数无效'],
      ['ADMIN_REQUIRED', '需要管理员权限'],
    ];
    return known.find(([code]) => message.includes(code))?.[1]
      || '战绩服务暂时不可用，请稍后重试';
  }

  function createStatsClient({ accountClient } = {}) {
    if (!accountClient) throw new Error('ACCOUNT_CLIENT_REQUIRED');

    function requireRegistered() {
      if (accountClient.getIdentity().kind !== 'registered') {
        throw new Error('REGISTERED_ACCOUNT_REQUIRED');
      }
    }

    function validateGameType(gameType, { optional = false } = {}) {
      if (optional && gameType === null) return;
      if (!GAME_TYPES.has(gameType)) throw new Error('INVALID_GAME_TYPE');
    }

    async function callRpc(name, params) {
      const client = await accountClient.getSupabaseClient();
      const result = await client.rpc(name, params);
      if (result.error) throw new Error(result.error.message || name, { cause: result.error });
      return result.data;
    }

    async function listSeasons() {
      const rows = await callRpc('list_competitive_seasons');
      return (rows || []).map(mapSeason);
    }

    async function getHistory({
      gameType = null,
      beforeFinishedAt = null,
      beforeId = null,
      limit = 20,
    } = {}) {
      requireRegistered();
      validateGameType(gameType, { optional: true });
      const rows = await callRpc('get_my_match_history', {
        p_game_type: gameType,
        p_before_finished_at: beforeFinishedAt,
        p_before_id: beforeId,
        p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
      });
      return (rows || []).map(mapHistoryItem);
    }

    async function getMyStandings(seasonId = null) {
      requireRegistered();
      const rows = await callRpc('get_my_standings', { p_season_id: seasonId });
      return (rows || []).map(mapStanding);
    }

    async function getLeaderboard({ seasonId, gameType, limit = 100 } = {}) {
      if (!seasonId) throw new Error('SEASON_NOT_FOUND');
      validateGameType(gameType);
      const rows = await callRpc('get_competitive_leaderboard', {
        p_season_id: seasonId,
        p_game_type: gameType,
        p_limit: Math.min(Math.max(Number(limit) || 100, 1), 100),
      });
      return (rows || []).map(mapLeaderboardEntry);
    }

    async function startSeason(value) {
      const name = String(value || '').trim();
      if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new Error('INVALID_SEASON_NAME');
      }
      return mapSeason(firstRpcRow(await callRpc('start_competitive_season', { p_name: name })) || {});
    }

    async function endSeason(seasonId) {
      if (!seasonId) throw new Error('SEASON_NOT_FOUND');
      return mapSeason(firstRpcRow(await callRpc('end_competitive_season', {
        p_season_id: seasonId,
      })) || {});
    }

    return {
      endSeason,
      getHistory,
      getLeaderboard,
      getMyStandings,
      listSeasons,
      startSeason,
    };
  }

  const playerStats = {
    createStatsClient,
    mapHistoryItem,
    mapLeaderboardEntry,
    mapSeason,
    mapStanding,
    mapStatsError,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = playerStats;
  globalScope.PlayerStats = playerStats;
})(typeof window !== 'undefined' ? window : globalThis);
