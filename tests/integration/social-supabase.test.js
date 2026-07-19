'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = './database/supabase/migrations/20260725_social.sql';
const setupPath = './database/supabase/setup.sql';
const verifyPath = './database/supabase/verify-social.sql';

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

function socialSqlFiles() {
  return [read(migrationPath), read(setupPath)];
}

function functionBody(sql, name, nextName) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? sql.indexOf(`create or replace function public.${nextName}`, start + 1)
    : sql.indexOf('$$;', start) + 3;
  return start < 0 ? '' : sql.slice(start, end < 0 ? undefined : end);
}

function acceptanceTemplate(sql, start, end) {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  if (from < 0) return '';
  assert.notEqual(to, -1, `missing acceptance template end marker: ${end}`);
  return sql.slice(from, to);
}

test('social acceptance verifier is read-only and covers UID, ACL, RLS, RPC, timing, and operator checks', () => {
  const sql = read(verifyPath);
  assert.notEqual(sql, '', 'missing database/supabase/verify-social.sql');
  assert.match(sql, /SAFETY:[^\n]*(?:read-only|read only)/i);
  assert.doesNotMatch(sql, /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/im);

  for (const table of ['friend_requests', 'friendships', 'player_presence', 'game_invites']) {
    assert.match(sql, new RegExp(`'${table}'`, 'i'));
  }
  for (const rpc of [
    'search_player_by_username(text)', 'search_player_by_uid(integer)', 'list_friends()',
    'list_friend_requests()', 'send_friend_request(uuid)', 'accept_friend_request(uuid)',
    'reject_friend_request(uuid)', 'remove_friend(uuid)', 'heartbeat_player_presence()',
    'list_game_invites()', 'send_game_invite(uuid,uuid)', 'cancel_game_invite(uuid)',
    'decline_game_invite(uuid)',
  ]) {
    assert.match(sql, new RegExp(rpc.replace(/[()]/g, '\\$&').replace(',', '\\s*,\\s*'), 'i'));
  }

  assert.match(sql, /information_schema\.columns[\s\S]*player_uid[\s\S]*is_nullable[\s\S]*NO/i);
  assert.match(sql, /profiles_player_uid_unique/i);
  assert.match(sql, /profiles_player_uid_range/i);
  assert.match(sql, /pg_sequences[\s\S]*player_uid_seq[\s\S]*min_value[\s\S]*max_value[\s\S]*cycle/i);
  assert.match(sql, /profiles_assign_player_uid[\s\S]*assign_player_uid/i);
  assert.match(sql, /profiles_prevent_player_uid_change[\s\S]*prevent_player_uid_change/i);
  assert.match(sql, /has_column_privilege[\s\S]*player_uid[\s\S]*(?:INSERT|UPDATE)/i);

  assert.match(sql, /row_number\(\)\s+over/i);
  assert.match(sql, /left join public\.admins as admin on admin\.user_id = profile\.id/i);
  assert.match(sql, /order by\s*\(admin\.user_id is not null\) desc,\s*profile\.created_at,\s*profile\.id/i);
  assert.match(sql, /lpad\s*\(\s*profile\.player_uid::text\s*,\s*6\s*,\s*'0'\s*\)/i);
  assert.match(sql, /expected_player_uid[\s\S]*actual_player_uid/i);
  assert.match(sql, /player_uid\s*=\s*0[\s\S]*000000/i);
  assert.match(sql, /player_uid\s*=\s*1[\s\S]*000001/i);
  assert.match(sql, /group by player_uid[\s\S]*having count\(\*\)\s*>\s*1/i);
  assert.match(sql, /player_uid\s+not between\s+0\s+and\s+999999/i);

  assert.match(sql, /pg_policies/i);
  assert.match(sql, /pg_publication_tables[\s\S]*supabase_realtime/i);
  assert.match(sql, /game_invites_one_pending_per_game/i);
  assert.match(sql, /90 seconds/i);
  assert.match(sql, /15 minutes/i);
  assert.match(sql, /search_player_by_uid\s*\(\s*0\s*\)/i);
  assert.match(sql, /search_player_by_uid\s*\(\s*1\s*\)/i);
  assert.match(sql, /search_player_by_username\s*\(/i);
  assert.match(sql, /concurrent/i);
  assert.match(sql, /PLAYER_UID_IMMUTABLE/i);
  assert.match(sql, /BEGIN[\s\S]*ROLLBACK/i);

  for (const [table, firstColumn, secondColumn] of [
    ['friend_requests', 'requester_id', 'recipient_id'],
    ['friendships', 'user_low', 'user_high'],
    ['game_invites', 'sender_id', 'recipient_id'],
  ]) {
    const policyCheck = new RegExp(
      `tablename = '${table}'[\\s\\S]*qual is not null[\\s\\S]*auth\\.uid[\\s\\S]*${firstColumn}[\\s\\S]*${secondColumn}`,
      'i',
    );
    assert.match(sql, policyCheck);
  }
  const presencePolicy = acceptanceTemplate(
    sql,
    "tablename = 'player_presence'",
    "tablename = 'game_invites'",
  );
  for (const pattern of [/qual is not null/i, /auth\.uid/i, /user_id/i, /friendships/i, /user_low/i, /user_high/i]) {
    assert.match(presencePolicy, pattern);
  }
});

test('social write acceptance templates are copyable, isolated, and assert trigger and RPC behavior', () => {
  const sql = read(verifyPath);
  const immutable = acceptanceTemplate(sql, 'TEMPLATE: UID IMMUTABILITY', 'TEMPLATE: CONCURRENT REGISTRATION SESSION A');
  assert.match(immutable, /BEGIN;[\s\S]*SET LOCAL ROLE postgres;/i);
  assert.match(immutable, /DO \$verify_uid_immutable\$[\s\S]*UPDATE public\.profiles[\s\S]*SET player_uid/i);
  assert.match(immutable, /SQLERRM[\s\S]*PLAYER_UID_IMMUTABLE/i);
  assert.match(immutable, /ROLLBACK;/i);
  assert.match(sql, /has_column_privilege\s*\(\s*'authenticated'[\s\S]*'player_uid'[\s\S]*'UPDATE'/i);

  const sessionA = acceptanceTemplate(sql, 'TEMPLATE: CONCURRENT REGISTRATION SESSION A', 'TEMPLATE: CONCURRENT REGISTRATION SESSION B');
  const sessionB = acceptanceTemplate(sql, 'TEMPLATE: CONCURRENT REGISTRATION SESSION B', 'TEMPLATE: FRIEND REQUEST BY UID');
  for (const session of [sessionA, sessionB]) {
    assert.match(session, /BEGIN;[\s\S]*INSERT INTO auth\.users/i);
    assert.match(session, /gen_random_uuid\(\)/i);
    assert.match(session, /INSERT INTO public\.profiles\s*\(\s*id\s*,\s*username\s*,\s*game_name\s*\)/i);
    assert.match(session, /lpad\s*\(\s*profile\.player_uid::text\s*,\s*6\s*,\s*'0'\s*\)/i);
    assert.match(session, /ROLLBACK;/i);
    assert.doesNotMatch(session, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    assert.doesNotMatch(session, /\b[^\s']+@[^\s']+\b/);
  }

  const uidRequest = acceptanceTemplate(sql, 'TEMPLATE: FRIEND REQUEST BY UID', 'TEMPLATE: FRIEND REQUEST BY USERNAME');
  const usernameRequest = acceptanceTemplate(sql, 'TEMPLATE: FRIEND REQUEST BY USERNAME', 'END OPT-IN WRITE ACCEPTANCE');
  for (const template of [uidRequest, usernameRequest]) {
    assert.match(template, /BEGIN;/i);
    assert.match(template, /set_config\s*\(\s*'request\.jwt\.claim\.sub'/i);
    assert.match(template, /set_config\s*\(\s*'request\.jwt\.claim\.role'\s*,\s*'authenticated'/i);
    assert.match(template, /SET LOCAL ROLE authenticated;/i);
    assert.match(template, /count\s*\(\s*\*\s*\)[\s\S]*array_agg\s*\([^)]*user_id[^)]*\)[\s\S]*INTO\s+v_match_count\s*,\s*v_target_id/i);
    assert.match(template, /v_match_count\s*<>\s*1[\s\S]*v_target_id is null[\s\S]*RAISE EXCEPTION/i);
    assert.match(template, /v_request_id\s*:=\s*public\.send_friend_request\s*\(\s*v_target_id\s*\)/i);
    assert.match(template, /v_request_id is null[\s\S]*RAISE EXCEPTION/i);
    assert.match(template, /ROLLBACK;/i);
  }
  assert.match(uidRequest, /search_player_by_uid\s*\(/i);
  assert.match(usernameRequest, /search_player_by_username\s*\(/i);
  assert.match(sql, /uid_000000_present[\s\S]*uid_000001_present/i);
});

test('acceptance template helper rejects a missing end marker', () => {
  assert.throws(
    () => acceptanceTemplate('TEMPLATE: START only', 'TEMPLATE: START', 'TEMPLATE: END'),
    /missing acceptance template end marker/i,
  );
});

test('社交迁移是增量迁移且 setup 同步包含完整功能', () => {
  const migration = read(migrationPath);
  assert.notEqual(migration, '');
  assert.doesNotMatch(migration, /drop table[^;]*(?:profiles|online_games)/i);
  assert.doesNotMatch(migration, /truncate\s+/i);

  for (const sql of socialSqlFiles()) {
    for (const table of ['friend_requests', 'friendships', 'player_presence', 'game_invites']) {
      assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}`, 'i'));
    }
    for (const rpc of [
      'search_player_by_username', 'search_player_by_uid', 'list_friends',
      'list_friend_requests', 'send_friend_request', 'accept_friend_request',
      'reject_friend_request', 'remove_friend', 'heartbeat_player_presence',
      'list_game_invites', 'send_game_invite', 'cancel_game_invite',
      'decline_game_invite',
    ]) {
      assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, 'i'));
    }
  }
});

test('六位纯数字用户名由写入触发器保留给玩家 UID 并由验收脚本报告', () => {
  for (const sql of socialSqlFiles()) {
    assert.match(sql, /create or replace function public\.reject_player_uid_username/i);
    assert.match(sql, /if new\.username ~ '\^\[0-9\]\+\$' and char_length\s*\(\s*new\.username\s*\)\s*=\s*6/i);
    assert.match(sql, /create trigger profiles_reject_player_uid_username[\s\S]*before insert or update of username/i);
    assert.doesNotMatch(sql, /profiles_username_not_player_uid/);
  }

  const verify = read(verifyPath);
  assert.match(verify, /profiles_reject_player_uid_username[\s\S]*reject_player_uid_username/i);
  assert.match(verify, /profiles_username_not_player_uid_present\s+is intentionally absent/i);
});

test('玩家 UID 从 000000 原子分配、管理员优先回填且永远不可修改', () => {
  for (const sql of socialSqlFiles()) {
    assert.match(sql, /create sequence(?: if not exists)? public\.player_uid_seq[\s\S]*minvalue\s+0[\s\S]*maxvalue\s+999999[\s\S]*start\s+with\s+0/i);
    assert.match(sql, /add column if not exists player_uid integer/i);
    assert.match(sql, /profiles_player_uid_(?:key|unique)|unique\s*\(player_uid\)/i);
    assert.match(sql, /player_uid between 0 and 999999/i);
    assert.match(sql, /row_number\(\)\s+over\s*\([\s\S]*admin[\s\S]*created_at[\s\S]*id/i);
    assert.match(sql, /setval\s*\(\s*'public\.player_uid_seq'/i);
    assert.match(sql, /nextval\s*\(\s*'public\.player_uid_seq'/i);
    assert.match(sql, /PLAYER_UID_EXHAUSTED/);
    assert.match(sql, /new\.player_uid\s+is distinct from\s+old\.player_uid/i);
    assert.match(sql, /PLAYER_UID_IMMUTABLE/);
    assert.match(sql, /revoke all on sequence public\.player_uid_seq from public, anon, authenticated/i);
    assert.match(sql, /grant insert\s*\([^)]*id[^)]*username[^)]*game_name[^)]*\)\s+on public\.profiles to authenticated/i);
    assert.doesNotMatch(sql, /grant insert\s*\([^)]*player_uid[^)]*\)\s+on public\.profiles to authenticated/i);
  }
});

test('好友关系、申请与邀请使用 canonical 唯一约束和事务行锁', () => {
  for (const sql of socialSqlFiles()) {
    assert.match(sql, /least\s*\(requester_id::text,\s*recipient_id::text\)[\s\S]*greatest\s*\(requester_id::text,\s*recipient_id::text\)/i);
    assert.match(sql, /primary key\s*\(user_low,\s*user_high\)/i);
    assert.match(sql, /user_low::text\s*<\s*user_high::text/i);
    assert.match(sql, /references public\.online_games\s*\(id\)/i);
    assert.match(sql, /where\s+status\s*=\s*'pending'/i);
    assert.match(functionBody(sql, 'accept_friend_request', 'reject_friend_request'), /for update/i);
    assert.match(functionBody(sql, 'send_game_invite', 'cancel_game_invite'), /for update/i);
    assert.match(sql, /interval\s+'90 seconds'/i);
    assert.match(sql, /interval\s+'15 minutes'/i);
  }
});

test('好友搜索仅支持精确 UID 或完整用户名且返回补零 UID', () => {
  for (const sql of socialSqlFiles()) {
    const usernameSearch = functionBody(sql, 'search_player_by_username', 'search_player_by_uid');
    const uidSearch = functionBody(sql, 'search_player_by_uid', 'list_friends');
    assert.match(usernameSearch, /lower\s*\(btrim\s*\(coalesce\s*\(p_username/i);
    assert.match(usernameSearch, /profile\.username\s*=\s*v_username/i);
    assert.doesNotMatch(usernameSearch, /\bilike\b|\blike\b/i);
    assert.match(uidSearch, /p_player_uid\s+between\s+0\s+and\s+999999/i);
    assert.match(uidSearch, /profile\.player_uid\s*=\s*p_player_uid/i);
    assert.match(sql, /lpad\s*\([^;]*player_uid[^;]*6[^;]*'0'/i);
    assert.match(sql, /INVALID_PLAYER_UID/);
  }
});

test('社交表只读、参与者 RLS、Realtime 与 RPC 权限均显式收口', () => {
  for (const sql of socialSqlFiles()) {
    for (const table of ['friend_requests', 'friendships', 'player_presence', 'game_invites']) {
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
      assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
      assert.doesNotMatch(sql, new RegExp(`grant\\s+(?:insert|update|delete)[^;]*public\\.${table}[^;]*authenticated`, 'i'));
    }
    assert.match(sql, /auth\.uid\(\)\s+in\s*\(requester_id,\s*recipient_id\)/i);
    assert.match(sql, /auth\.uid\(\)\s+in\s*\(user_low,\s*user_high\)/i);
    assert.match(sql, /auth\.uid\(\)\s+in\s*\(sender_id,\s*recipient_id\)/i);
    assert.match(sql, /alter publication supabase_realtime add table public\.friend_requests/i);
    assert.match(sql, /alter publication supabase_realtime add table public\.game_invites/i);
    assert.match(sql, /revoke execute on function public\.search_player_by_uid\(integer\) from public, anon/i);
    assert.match(sql, /grant execute on function public\.search_player_by_uid\(integer\) to authenticated/i);
  }
});

test('房间变化触发器只同步邀请状态，不修改棋局内容', () => {
  for (const sql of socialSqlFiles()) {
    const triggerFunction = functionBody(sql, 'sync_game_invite_status');
    assert.match(triggerFunction, /update public\.game_invites/i);
    assert.match(triggerFunction, /status\s*=\s*'accepted'/i);
    assert.match(triggerFunction, /status\s*=\s*'cancelled'/i);
    assert.doesNotMatch(triggerFunction, /update public\.online_games/i);
    assert.match(sql, /after update of o_player, status on public\.online_games/i);
  }
});
