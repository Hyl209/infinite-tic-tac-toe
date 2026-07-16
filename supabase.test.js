const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function readSetupSql() {
  return fs.existsSync('./supabase/setup.sql')
    ? fs.readFileSync('./supabase/setup.sql', 'utf8')
    : '';
}

test('Supabase 脚本创建线上棋局表和全部 RPC', () => {
  const sql = readSetupSql();
  assert.match(sql, /create table(?: if not exists)? public\.online_games/i);
  for (const name of [
    'create_online_game',
    'join_online_game',
    'play_online_move',
    'request_online_rematch',
    'leave_online_game',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`, 'i'));
  }
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

test('公开配置文件不包含服务端密钥字段', () => {
  const config = fs.readFileSync('./online-config.js', 'utf8');
  assert.match(config, /supabaseUrl/);
  assert.match(config, /supabaseAnonKey/);
  assert.doesNotMatch(config, /service[_-]?role/i);
});
