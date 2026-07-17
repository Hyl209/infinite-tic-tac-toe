const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function readSetupSql() {
  return fs.existsSync('./database/supabase/setup.sql')
    ? fs.readFileSync('./database/supabase/setup.sql', 'utf8')
    : '';
}

function readEconomyMigration() {
  const path = './database/supabase/migrations/20260717_economy.sql';
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

test('Supabase 脚本创建线上棋局表和全部 RPC', () => {
  const sql = readSetupSql();
  assert.match(sql, /create table(?: if not exists)? public\.online_games/i);
  for (const name of [
    'create_online_game',
    'join_online_game',
    'play_online_move',
    'request_online_undo',
    'respond_online_undo',
    'cancel_online_undo',
    'request_online_rematch',
    'leave_online_game',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`, 'i'));
  }
});

test('Supabase 脚本创建账号资料表并限制用户只能维护自己的资料', () => {
  const sql = readSetupSql();
  assert.match(sql, /create table if not exists public\.profiles/i);
  assert.match(sql, /username\s+text\s+not null\s+unique/i);
  assert.match(sql, /game_name\s+text\s+not null/i);
  assert.match(sql, /game_name\s*!~\s*'\[\[:cntrl:\]\]'/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /on public\.profiles[\s\S]*auth\.uid\(\)\s*=\s*id/i);
  assert.doesNotMatch(sql, /grant select on table public\.profiles to anon/i);
});

test('在线房间保存双方名称快照并由服务端优先采用注册资料', () => {
  const sql = readSetupSql();
  assert.match(sql, /x_player_name\s+text\s+not null/i);
  assert.match(sql, /o_player_name\s+text/i);
  assert.match(sql, /create or replace function public\.resolve_online_player_name/i);
  const resolverStart = sql.indexOf('create or replace function public.resolve_online_player_name');
  const createStart = sql.indexOf('create or replace function public.create_online_game');
  const resolver = sql.slice(resolverStart, createStart);
  assert.match(resolver, /from public\.profiles/i);
  assert.match(resolver, /game_name/i);
  assert.match(resolver, /匿名玩家/i);
  assert.match(
    resolver,
    /\[A-HJ-NP-Z2-9\]\[A-HJ-NP-Z2-9\]\[A-HJ-NP-Z2-9\]\[A-HJ-NP-Z2-9\]/,
  );
  assert.doesNotMatch(resolver, /\[A-HJ-NP-Z2-9\]\{4\}/);
  assert.match(
    sql,
    /create_online_game\(\s*p_game_type text,\s*p_guest_name text,\s*p_wager_amount integer default 0\s*\)/i,
  );
  assert.match(sql, /join_online_game\(p_room_code text, p_game_type text, p_guest_name text\)/i);
});

test('经济系统使用独立钱包、不可变流水和受限兑换码表', () => {
  const sql = readSetupSql();
  for (const table of ['player_wallets', 'coin_ledger', 'admins', 'redeem_codes', 'redeem_claims']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  }
  assert.match(sql, /balance\s+bigint\s+not null\s+default\s+100/i);
  assert.match(sql, /idempotency_key\s+text\s+not null\s+unique/i);
  assert.match(sql, /primary key\s*\(code_id,\s*user_id\)/i);
  assert.match(sql, /digest\([^)]*,\s*'sha256'\)/i);
  assert.match(sql, /revoke all on table public\.player_wallets from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.coin_ledger from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*player_wallets[^;]*authenticated/i);
});

test('注册资料自动创建 100 金币钱包并为老账号幂等补发', () => {
  const sql = readSetupSql();
  assert.match(sql, /create or replace function public\.ensure_profile_wallet/i);
  assert.match(sql, /after insert on public\.profiles/i);
  assert.match(sql, /insert into public\.player_wallets\s*\(user_id, balance\)[\s\S]*select\s+id,\s*100[\s\S]*on conflict\s*\(user_id\)\s*do nothing/i);
  assert.match(sql, /initial_grant:[^']*/i);
});

test('经济 RPC 由服务端校验注册身份、管理员权限和兑换限制', () => {
  const sql = readSetupSql();
  for (const name of [
    'get_economy_snapshot',
    'redeem_coin_code',
    'create_redeem_code',
    'list_redeem_codes',
    'disable_redeem_code',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security definer`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}`, 'i'));
  }
  assert.match(sql, /REGISTERED_ACCOUNT_REQUIRED/);
  assert.match(sql, /ADMIN_REQUIRED/);
  assert.match(sql, /CODE_ALREADY_REDEEMED/);
  assert.match(sql, /CODE_EXPIRED/);
  assert.match(sql, /CODE_DISABLED/);
  assert.match(sql, /CODE_EXHAUSTED/);
});

test('经济和彩头 RPC 显式拒绝 PUBLIC 与匿名角色执行', () => {
  const sql = readSetupSql();
  for (const signature of [
    'get_economy_snapshot\\(\\)',
    'redeem_coin_code\\(text\\)',
    'create_redeem_code\\(integer, integer, timestamptz\\)',
    'list_redeem_codes\\(\\)',
    'disable_redeem_code\\(uuid\\)',
    'create_online_game\\(text, text, integer\\)',
    'preview_online_game\\(text, text\\)',
    'join_online_game\\(text, text, text\\)',
    'heartbeat_online_game\\(uuid\\)',
    'claim_online_disconnect\\(uuid\\)',
    'request_online_rematch\\(uuid\\)',
    'leave_online_game\\(uuid\\)',
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${signature} from public, anon`, 'i'),
    );
  }
});

test('线上房间在数据库事务中托管、结算和处理掉线', () => {
  const sql = readSetupSql();
  for (const column of [
    'wager_amount',
    'x_stake_locked',
    'o_stake_locked',
    'wager_settled_at',
    'finish_reason',
    'x_last_seen_at',
    'o_last_seen_at',
  ]) {
    assert.match(sql, new RegExp(`${column}\\s+`, 'i'));
  }
  assert.match(sql, /create or replace function public\.lock_online_stake/i);
  assert.match(sql, /create or replace function public\.settle_online_wager/i);
  assert.match(sql, /create or replace function public\.preview_online_game/i);
  assert.match(sql, /create or replace function public\.heartbeat_online_game/i);
  assert.match(sql, /create or replace function public\.claim_online_disconnect/i);
  assert.match(sql, /interval\s+'30 seconds'/i);
  assert.match(sql, /INSUFFICIENT_COINS/);
  assert.match(sql, /OPPONENT_STILL_ONLINE/);
});

test('经济迁移是增量且不会删除现有线上房间或账号资料', () => {
  const sql = readEconomyMigration();
  assert.match(sql, /create table if not exists public\.profiles/i);
  assert.match(sql, /create or replace function public\.resolve_online_player_name/i);
  assert.match(sql, /alter table public\.online_games\s+add column if not exists x_player_name/i);
  assert.match(sql, /update public\.online_games[\s\S]*set x_player_name/i);
  assert.match(sql, /alter table public\.online_games\s+alter column x_player_name set not null/i);
  assert.match(sql, /alter table public\.online_games\s+add column if not exists wager_amount/i);
  assert.match(sql, /create table if not exists public\.player_wallets/i);
  assert.doesNotMatch(sql, /drop table[^;]*(?:online_games|profiles)/i);
  assert.doesNotMatch(sql, /truncate\s+/i);
});

test('线上表支持两种游戏、落子历史和每人三次悔棋额度', () => {
  const sql = readSetupSql();
  assert.match(sql, /drop table if exists public\.online_games cascade/i);
  assert.match(sql, /game_type\s+text\s+not null/i);
  assert.match(sql, /game_type\s+in\s*\(\s*'tic_tac_toe'\s*,\s*'gomoku'\s*\)/i);
  assert.match(sql, /move_history\s+smallint\[\]/i);
  assert.match(sql, /x_undos_remaining\s+smallint\s+not null\s+default\s+3/i);
  assert.match(sql, /o_undos_remaining\s+smallint\s+not null\s+default\s+3/i);
  assert.match(sql, /jsonb_array_length\(board\)\s*=\s*225/i);
});

test('线上落子 RPC 使用行锁并包含稳定错误码', () => {
  const sql = readSetupSql();
  const start = sql.indexOf('create or replace function public.play_online_move');
  const end = sql.indexOf('create or replace function public.request_online_rematch');
  const moveFunction = sql.slice(start, end);
  assert.match(moveFunction, /for update/i);
  assert.match(moveFunction, /NOT_YOUR_TURN/);
  assert.match(moveFunction, /CELL_OCCUPIED/);
  assert.match(moveFunction, /GAME_NOT_PLAYING/);
  assert.match(moveFunction, /array_length\([^)]*,\s*1\)\s*>\s*3/i);
  assert.match(moveFunction, /UNDO_PENDING/);
  assert.match(moveFunction, /p_cell\s*>\s*224/i);
  assert.match(moveFunction, /move_history\s*=\s*array_append/i);
  assert.match(moveFunction, /game_type\s*=\s*'gomoku'/i);
});

test('PLpgSQL 动态胜利阈值使用可解析的 CASE 表达式', () => {
  const sql = readSetupSql();
  assert.match(
    sql,
    /if\s+cardinality\(v_winning_line\)\s*>=\s*\(\s*case\s+when\s+v_game\.game_type\s*=\s*'gomoku'\s+then\s+5\s+else\s+3\s+end\s*\)\s+then/i,
  );
});

test('五子棋连续线扫描在 JSON 空位处停止', () => {
  const sql = readSetupSql();
  const start = sql.indexOf('create or replace function public.online_winning_line');
  const end = sql.indexOf('create or replace function public.replay_online_history');
  const winningFunction = sql.slice(start, end);
  assert.equal(
    (winningFunction.match(/exit when p_board ->> v_index is distinct from p_mark/gi) || []).length,
    2,
  );
});

test('线上悔棋使用行锁、15 秒超时、发起即扣额度并重放历史', () => {
  const sql = readSetupSql();
  const requestStart = sql.indexOf('create or replace function public.request_online_undo');
  const respondStart = sql.indexOf('create or replace function public.respond_online_undo');
  const cancelStart = sql.indexOf('create or replace function public.cancel_online_undo');
  const rematchStart = sql.indexOf('create or replace function public.request_online_rematch');
  const requestFunction = sql.slice(requestStart, respondStart);
  const respondFunction = sql.slice(respondStart, cancelStart);
  const cancelFunction = sql.slice(cancelStart, rematchStart);

  assert.match(requestFunction, /for update/i);
  assert.match(requestFunction, /UNDO_LIMIT_REACHED/);
  assert.match(requestFunction, /interval\s+'15 seconds'/i);
  assert.match(requestFunction, /undos_remaining\s*=\s*[^,]+-\s*1/i);
  assert.match(respondFunction, /for update/i);
  assert.match(respondFunction, /array_remove_last|array_length\([^)]*move_history/i);
  assert.match(respondFunction, /replay_online_history/i);
  assert.match(cancelFunction, /UNDO_NOT_REQUESTER/);
});

test('重赛按游戏类型重建棋盘并重置悔棋历史和额度', () => {
  const sql = readSetupSql();
  const start = sql.lastIndexOf('create or replace function public.request_online_rematch');
  const end = sql.lastIndexOf('create or replace function public.leave_online_game');
  const rematchFunction = sql.slice(start, end);
  assert.match(rematchFunction, /lock_online_stake/i);
  assert.match(rematchFunction, /online_empty_board\(game_type\)/i);
  assert.match(rematchFunction, /move_history\s*=\s*'\{\}'::smallint\[\]/i);
  assert.match(rematchFunction, /x_undos_remaining\s*=\s*3/i);
  assert.match(rematchFunction, /o_undos_remaining\s*=\s*3/i);
});

test('Supabase 脚本启用 RLS、Realtime 和私有频道权限', () => {
  const sql = readSetupSql();
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.online_games/i);
  assert.match(sql, /on realtime\.messages for select/i);
  assert.match(sql, /on realtime\.messages for insert/i);
  assert.match(sql, /realtime\.topic\(\)/i);
  assert.match(sql, /grant execute on function public\.play_online_move/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test('Realtime policies use a security-definer room membership check', () => {
  const sql = readSetupSql();
  assert.match(
    sql,
    /create or replace function public\.is_online_game_player[\s\S]*security definer/i,
  );
  assert.match(
    sql,
    /on realtime\.messages for select[\s\S]*public\.is_online_game_player/i,
  );
  assert.match(
    sql,
    /on realtime\.messages for insert[\s\S]*public\.is_online_game_player/i,
  );
});

test('公开配置文件不包含服务端密钥字段', () => {
  const config = fs.readFileSync('./src/config/online.js', 'utf8');
  assert.match(config, /supabaseUrl/);
  assert.match(config, /supabaseAnonKey/);
  assert.doesNotMatch(config, /service[_-]?role/i);
});

test('Private room read policy authorizes broadcast and presence channel joins', () => {
  const sql = readSetupSql();
  const start = sql.indexOf('on realtime.messages for select');
  const end = sql.indexOf('on realtime.messages for insert');
  const readPolicy = sql.slice(start, end);
  assert.match(readPolicy, /extension\s+in\s*\(\s*'broadcast'\s*,\s*'presence'\s*\)/i);
});

test('Supabase SQL avoids unsupported bounded regex quantifiers', () => {
  for (const sql of [readSetupSql(), readEconomyMigration()]) {
    assert.doesNotMatch(sql, /\{(?:3,20|4|6|12)\}/);
    assert.match(sql, /char_length\(room_code\)\s*=\s*6/i);
    assert.match(sql, /char_length\(v_code\)\s*<>\s*6/i);
    assert.match(sql, /char_length\(v_normalized\)\s*<>\s*12/i);
    assert.match(sql, /char_length\(username\)\s+between\s+3\s+and\s+20/i);
  }
  assert.match(
    readEconomyMigration(),
    /drop constraint if exists online_games_room_code_check/i,
  );
});

test('Economy migration removes legacy online RPC overloads', () => {
  for (const sql of [readSetupSql(), readEconomyMigration()]) {
    assert.match(sql, /drop function if exists public\.create_online_game\(text\)/i);
    assert.match(sql, /drop function if exists public\.join_online_game\(text,\s*text\)/i);
  }
});
