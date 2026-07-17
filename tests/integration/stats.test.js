const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = './database/supabase/migrations/20260718_stats.sql';
const guestHistoryMigrationPath = './database/supabase/migrations/20260719_stats_guest_history.sql';
const seasonAdminMigrationPath = './database/supabase/migrations/20260720_stats_season_admin.sql';

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

function readSetupSql() {
  return read('./database/supabase/setup.sql');
}

function readStatsMigration() {
  return read(migrationPath);
}

function readGuestHistoryMigration() {
  return read(guestHistoryMigrationPath);
}

function readSeasonAdminMigration() {
  return read(seasonAdminMigrationPath);
}

test('Supabase migrations use unique versions', () => {
  const versions = fs.readdirSync('./database/supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.split('_', 1)[0]);
  assert.equal(new Set(versions).size, versions.length);
  assert.equal(new Set(versions.map((version) => version.length)).size, 1);
});

test('战绩迁移独立存在并同步到完整初始化脚本', () => {
  assert.equal(fs.existsSync(migrationPath), true);
  assert.equal(fs.existsSync(guestHistoryMigrationPath), true);
  assert.equal(fs.existsSync(seasonAdminMigrationPath), true);
  for (const sql of [readStatsMigration(), readSetupSql()]) {
    assert.match(sql, /create table if not exists public\.competitive_seasons/i);
    assert.match(sql, /create table if not exists public\.online_match_results/i);
    assert.match(sql, /create table if not exists public\.season_standings/i);
  }
});

test('完整初始化脚本最后应用战绩迁移避免被旧在线函数覆盖', () => {
  const migration = readSeasonAdminMigration().replace(/\r\n/g, '\n').trim();
  const setup = readSetupSql().replace(/\r\n/g, '\n').trim();
  assert.equal(setup.endsWith(migration), true);
});

test('赛季管理 RPC 限定表字段避免与输出参数歧义', () => {
  for (const sql of [readSeasonAdminMigration(), readSetupSql()]) {
    const start = sql.lastIndexOf('create or replace function public.start_competitive_season');
    const end = sql.indexOf('$$;', start) + 3;
    const fn = sql.slice(start, end);
    assert.match(fn, /from public\.competitive_seasons season[\s\S]*season\.status\s*=\s*'active'/i);
    assert.doesNotMatch(fn, /from public\.competitive_seasons\s+where\s+status\s*=\s*'active'/i);
  }
});

test('至少一方为正式账号时才写入历史且游客对局不进入赛季积分', () => {
  for (const sql of [readGuestHistoryMigration(), readSetupSql()]) {
    const start = sql.lastIndexOf('create or replace function public.record_online_round_result');
    const end = sql.indexOf('$$;', start) + 3;
    const fn = sql.slice(start, end);
    assert.match(fn, /old\.status\s*=\s*'playing'[\s\S]*new\.status in \('x_win', 'o_win', 'draw'\)/i);
    assert.match(fn, /new\.x_registered_for_round\s+or\s+new\.o_registered_for_round/i);
    assert.match(fn, /if new\.round_season_id is not null then/i);
  }
});

test('战绩表按房间轮次幂等并保存每轮账号与赛季快照', () => {
  const sql = readStatsMigration();
  assert.match(sql, /alter table public\.online_games\s+add column if not exists round_season_id uuid/i);
  assert.match(sql, /add column if not exists x_registered_for_round boolean not null default false/i);
  assert.match(sql, /add column if not exists o_registered_for_round boolean not null default false/i);
  assert.match(sql, /unique\s*\(online_game_id,\s*round\)/i);
  assert.match(sql, /primary key\s*\(season_id,\s*game_type,\s*player_id\)/i);
  assert.match(sql, /result\s+text\s+not null[\s\S]*'x_win'[\s\S]*'o_win'[\s\S]*'draw'/i);
  assert.match(sql, /x_points_awarded\s+smallint/i);
  assert.match(sql, /o_points_awarded\s+smallint/i);
});

test('数据库在开局锁定赛季并在终局原子记录积分', () => {
  const sql = readStatsMigration();
  assert.match(sql, /create or replace function public\.assign_online_round_context/i);
  assert.match(sql, /before update of status, round on public\.online_games/i);
  assert.match(sql, /new\.status\s*=\s*'playing'/i);
  assert.match(sql, /from public\.profiles[\s\S]*new\.x_player/i);
  assert.match(sql, /from public\.competitive_seasons[\s\S]*status\s*=\s*'active'/i);
  assert.match(sql, /create or replace function public\.record_online_round_result/i);
  assert.match(sql, /after update of status on public\.online_games/i);
  assert.match(sql, /old\.status\s*=\s*'playing'[\s\S]*new\.status in \('x_win', 'o_win', 'draw'\)/i);
  assert.match(sql, /on conflict \(online_game_id, round\) do nothing/i);
  assert.match(sql, /when new\.status = 'draw' then 1[\s\S]*when new\.status = 'x_win' then 3/i);
  assert.match(sql, /new\.round_season_id/i);
  assert.match(sql, /insert into public\.season_standings/i);
});

test('战绩和榜单只通过受控 RPC 暴露', () => {
  const sql = readStatsMigration();
  for (const name of [
    'list_competitive_seasons',
    'get_my_match_history',
    'get_my_standings',
    'get_competitive_leaderboard',
    'start_competitive_season',
    'end_competitive_season',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security definer`, 'i'));
  }
  for (const table of ['competitive_seasons', 'online_match_results', 'season_standings']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
  }
  assert.match(sql, /grant execute on function public\.list_competitive_seasons\(\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_competitive_leaderboard\(uuid, text, integer\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_my_match_history\(text, timestamptz, uuid, integer\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.get_my_match_history[^;]*to anon/i);
  assert.match(sql, /public\.is_economy_admin\(auth\.uid\(\)\)/i);
});

test('排行榜使用积分胜场负场排序并额外返回当前玩家', () => {
  const sql = readStatsMigration();
  const start = sql.indexOf('create or replace function public.get_competitive_leaderboard');
  const end = sql.indexOf('create or replace function public.start_competitive_season');
  const fn = sql.slice(start, end);
  assert.match(fn, /dense_rank\(\) over\s*\(\s*order by[\s\S]*points desc[\s\S]*wins desc[\s\S]*losses asc/i);
  assert.match(fn, /row_number\(\) over/i);
  assert.match(fn, /auth\.uid\(\)/i);
  assert.match(fn, /is_current_player/i);
  assert.match(fn, /is_top_entry/i);
});

test('主动退出对所有已开局房间判负而不再依赖彩头', () => {
  const sql = readStatsMigration();
  const start = sql.lastIndexOf('create or replace function public.leave_online_game');
  const fn = sql.slice(start);
  assert.match(fn, /if v_game\.status = 'playing' then/i);
  assert.doesNotMatch(fn, /status = 'playing' and v_game\.wager_amount > 0/i);
  assert.match(fn, /finish_reason = 'active_exit'/i);
  assert.match(fn, /status = lower\(v_winner_mark\) \|\| '_win'/i);
});

test('战绩迁移保持增量且不破坏现有数据', () => {
  const sql = readStatsMigration();
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate\s+/i);
  assert.match(sql, /create unique index if not exists competitive_seasons_one_active_idx/i);
  assert.match(sql, /where status = 'active'/i);
  assert.match(sql, /default gen_random_uuid\(\)/i);
  assert.doesNotMatch(sql, /extensions\.gen_random_uuid\(\)/i);
});
