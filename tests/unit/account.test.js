const test = require('node:test');
const assert = require('node:assert/strict');

let account = {};
try {
  account = require('../../src/services/account.js');
} catch {
  account = {};
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createFakeSupabase({ user = null, profile = null } = {}) {
  const calls = [];
  let currentUser = user;
  let currentProfile = profile;

  function profileQuery(action, payload) {
    const query = {
      select() {
        calls.push(['select']);
        return query;
      },
      eq(column, value) {
        calls.push(['eq', column, value]);
        return query;
      },
      async maybeSingle() {
        calls.push(['maybeSingle']);
        return { data: currentProfile, error: null };
      },
      async single() {
        calls.push(['single']);
        if (payload) currentProfile = payload;
        return { data: currentProfile, error: null };
      },
    };
    return query;
  }

  const client = {
    auth: {
      async getSession() {
        calls.push(['getSession']);
        return { data: { session: currentUser ? { user: currentUser } : null }, error: null };
      },
      async signInAnonymously() {
        calls.push(['signInAnonymously']);
        currentUser = { id: 'guest-user', is_anonymous: true };
        return { data: { user: currentUser }, error: null };
      },
      async updateUser(credentials) {
        calls.push(['updateUser', credentials]);
        currentUser = {
          id: currentUser?.id || 'registered-user',
          email: credentials.email,
          is_anonymous: false,
        };
        return { data: { user: currentUser }, error: null };
      },
      async signInWithPassword(credentials) {
        calls.push(['signInWithPassword', credentials]);
        currentUser = {
          id: 'registered-user',
          email: credentials.email,
          is_anonymous: false,
        };
        return { data: { user: currentUser }, error: null };
      },
      async signOut(options) {
        calls.push(['signOut', options]);
        currentUser = null;
        return { error: null };
      },
    },
    from(table) {
      calls.push(['from', table]);
      return {
        select() {
          return profileQuery('select');
        },
        upsert(payload, options) {
          calls.push(['upsert', payload, options]);
          return profileQuery('upsert', payload);
        },
      };
    },
  };

  return { calls, client, getProfile: () => currentProfile };
}

test('账号字段规范化并执行长度和字符校验', () => {
  assert.equal(account.normalizeUsername(' Player_01 '), 'player_01');
  assert.equal(account.isValidUsername('player_01'), true);
  assert.equal(account.isValidUsername('玩家01'), false);
  assert.equal(account.isValidUsername('ab'), false);
  assert.equal(account.usernameToEmail('Player_01'), 'player_01@players.invalid');
  assert.equal(account.isValidPassword('12345678'), true);
  assert.equal(account.isValidPassword('1234567'), false);
  assert.equal(account.normalizeGameName(' 立哥 '), '立哥');
  assert.equal(account.isValidGameName('立哥'), true);
  assert.equal(account.isValidGameName(''), false);
  assert.equal(account.isValidGameName('一二三四五六七八九十一二三四五六七'), false);
});

test('游客名称生成一次后保存在当前浏览器', () => {
  const storage = createStorage();
  const randomValues = [0, 0.1, 0.2, 0.3];
  const random = () => randomValues.shift();

  const first = account.getGuestName({ storage, random });
  const second = account.getGuestName({ storage, random: () => 0.9 });

  assert.match(first, /^匿名玩家·[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(second, first);
});

test('账号错误转换为明确中文提示', () => {
  assert.equal(account.mapAccountError(new Error('INVALID_USERNAME')), '用户名需为 3 至 20 位英文、数字或下划线');
  assert.equal(account.mapAccountError(new Error('User already registered')), '这个用户名已被使用');
  assert.equal(account.mapAccountError(new Error('Invalid login credentials')), '用户名或密码错误');
  assert.equal(account.mapAccountError(new Error('unexpected')), '账号服务暂时不可用，请稍后重试');
});

test('初始化会恢复已登录账号和游戏名', async () => {
  const fake = createFakeSupabase({
    user: { id: 'registered-user', email: 'player_01@players.invalid', is_anonymous: false },
    profile: { username: 'player_01', game_name: '立哥' },
  });
  const client = account.createAccountClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
    storage: createStorage(),
  });

  const identity = await client.initialize();

  assert.deepEqual(identity, {
    kind: 'registered',
    username: 'player_01',
    displayName: '立哥',
    needsProfile: false,
  });
});

test('注册会升级匿名会话并保存独立游戏名', async () => {
  const fake = createFakeSupabase();
  const client = account.createAccountClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
    storage: createStorage(),
  });

  const identity = await client.register({
    username: 'Player_01',
    password: 'password8',
    gameName: '立哥',
  });

  assert.deepEqual(fake.calls.slice(0, 3), [
    ['getSession'],
    ['signInAnonymously'],
    ['updateUser', { email: 'player_01@players.invalid', password: 'password8' }],
  ]);
  assert.deepEqual(fake.calls.find((call) => call[0] === 'upsert'), [
    'upsert',
    { id: 'guest-user', username: 'player_01', game_name: '立哥' },
    { onConflict: 'id' },
  ]);
  assert.equal(identity.displayName, '立哥');
  assert.equal(identity.username, 'player_01');
});

test('登录使用隐藏邮箱并读取资料', async () => {
  const fake = createFakeSupabase({ profile: { username: 'player_01', game_name: '棋手甲' } });
  const client = account.createAccountClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
    storage: createStorage(),
  });

  const identity = await client.login({ username: 'Player_01', password: 'password8' });

  assert.deepEqual(fake.calls.find((call) => call[0] === 'signInWithPassword'), [
    'signInWithPassword',
    { email: 'player_01@players.invalid', password: 'password8' },
  ]);
  assert.equal(identity.displayName, '棋手甲');
});

test('初始化与登录并发时只加载一个客户端且登录等待初始化', async () => {
  const calls = [];
  let releaseSession;
  const sessionReady = new Promise((resolve) => {
    releaseSession = resolve;
  });
  const fakeClient = {
    auth: {
      async getSession() {
        calls.push('getSession:start');
        await sessionReady;
        calls.push('getSession:end');
        return { data: { session: null }, error: null };
      },
      async signInWithPassword(credentials) {
        calls.push(['login', credentials]);
        return {
          data: { user: { id: 'registered-user', email: credentials.email, is_anonymous: false } },
          error: null,
        };
      },
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: { username: 'player_01', game_name: '棋手甲' }, error: null };
        },
      };
    },
  };
  let sdkLoads = 0;
  let clients = 0;
  const client = account.createAccountClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => {
      sdkLoads += 1;
      return { createClient() { clients += 1; return fakeClient; } };
    },
    storage: createStorage(),
  });

  const initializing = client.initialize();
  const loggingIn = client.login({ username: 'player_01', password: 'password8' });
  await Promise.resolve();
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'login'), false);
  releaseSession();
  await Promise.all([initializing, loggingIn]);

  assert.equal(sdkLoads, 1);
  assert.equal(clients, 1);
  assert.deepEqual(calls.slice(0, 3), [
    'getSession:start',
    'getSession:end',
    ['login', { email: 'player_01@players.invalid', password: 'password8' }],
  ]);
});

test('修改游戏名后更新身份，退出后恢复持久匿名名', async () => {
  const storage = createStorage({ 'board-game-guest-name': '匿名玩家·ABCD' });
  const fake = createFakeSupabase({
    user: { id: 'registered-user', email: 'player_01@players.invalid', is_anonymous: false },
    profile: { username: 'player_01', game_name: '旧名字' },
  });
  const client = account.createAccountClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
    storage,
  });

  await client.initialize();
  const updated = await client.updateGameName(' 新名字 ');
  const guest = await client.logout();

  assert.equal(updated.displayName, '新名字');
  assert.deepEqual(fake.getProfile(), {
    id: 'registered-user',
    username: 'player_01',
    game_name: '新名字',
  });
  assert.deepEqual(guest, {
    kind: 'guest',
    username: null,
    displayName: '匿名玩家·ABCD',
    needsProfile: false,
  });
  assert.deepEqual(fake.calls.find((call) => call[0] === 'signOut'), ['signOut', { scope: 'local' }]);
});
