const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = './database/supabase/migrations/20260722_engagement.sql';
const setupPath = './database/supabase/setup.sql';

const tables = [
  'activities',
  'activity_claims',
  'site_notifications',
  'notification_reads',
  'notification_claims',
  'checkin_rule_versions',
  'player_checkins',
];

const rpcs = [
  'list_active_activities',
  'claim_activity_reward',
  'admin_list_activities',
  'admin_save_activity',
  'admin_unpublish_activity',
  'list_site_notifications',
  'count_unread_site_notifications',
  'mark_site_notification_read',
  'claim_site_notification_reward',
  'admin_list_site_notifications',
  'admin_publish_site_notification',
  'admin_disable_site_notification',
  'get_checkin_month',
  'perform_daily_checkin',
  'perform_makeup_checkin',
  'admin_list_checkin_rules',
  'admin_create_checkin_rule',
];

const adminRpcs = [
  'admin_list_activities',
  'admin_save_activity',
  'admin_unpublish_activity',
  'admin_list_site_notifications',
  'admin_publish_site_notification',
  'admin_disable_site_notification',
  'admin_list_checkin_rules',
  'admin_create_checkin_rule',
];

const publicListRpcs = [
  'list_active_activities',
  'list_site_notifications',
];

const authenticatedOnlyRpcs = rpcs.filter((rpc) => !publicListRpcs.includes(rpc));

const registeredUserRpcs = [
  'claim_activity_reward',
  'count_unread_site_notifications',
  'mark_site_notification_read',
  'claim_site_notification_reward',
  'get_checkin_month',
  'perform_daily_checkin',
  'perform_makeup_checkin',
];

const checkinRpcs = [
  'get_checkin_month',
  'perform_daily_checkin',
  'perform_makeup_checkin',
];

const publicUrlRpcs = ['admin_save_activity'];

const sharedHelpers = [
  'site_local_date',
  'require_registered_user',
  'require_site_admin',
  'checkin_rule_for_date',
  'validate_public_url',
];

const sqlSources = [
  ['engagement migration', migrationPath],
  ['complete setup', setupPath],
];

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

function readSql(path) {
  return stripSqlComments(read(path));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSqlComments(sql) {
  let result = '';
  let quote = '';
  for (let index = 0; index < sql.length;) {
    const current = sql[index];
    const next = sql[index + 1];
    if (quote) {
      result += current;
      index += 1;
      if (current === quote) {
        if (sql[index] === quote) result += sql[index++];
        else quote = '';
      } else if (quote === "'" && current === '\\' && index < sql.length) {
        result += sql[index++];
      }
    } else if (current === "'" || current === '"') {
      quote = current;
      result += current;
      index += 1;
    } else if (current === '-' && next === '-') {
      result += ' ';
      index += 2;
      while (index < sql.length && !/[\r\n]/.test(sql[index])) index += 1;
    } else if (current === '/' && next === '*') {
      let depth = 1;
      result += ' ';
      index += 2;
      while (index < sql.length && depth) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          if (/[\r\n]/.test(sql[index])) result += sql[index];
          index += 1;
        }
      }
    } else {
      result += current;
      index += 1;
    }
  }
  return result;
}

function maskSqlQuotedContents(source) {
  let result = '';
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      result += /[\r\n]/.test(current) ? current : ' ';
      if (current === quote) {
        if (source[index + 1] === quote) result += source[++index].replace(/./, ' ');
        else quote = '';
      } else if (quote === "'" && current === '\\' && index + 1 < source.length) {
        result += /[\r\n]/.test(source[++index]) ? source[index] : ' ';
      }
    } else if (current === "'" || current === '"') {
      quote = current;
      result += ' ';
    } else {
      result += current;
    }
  }
  return result;
}

function extractFunction(sql, name) {
  const source = stripSqlComments(sql);
  const marker = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escapeRegExp(name)}\\b`,
    'ig',
  );
  let latest = '';
  for (const match of source.matchAll(marker)) {
    const tail = source.slice(match.index + match[0].length);
    const opening = /\bas\s+(\$\$|\$[a-z_][a-z0-9_]*\$)/i.exec(tail);
    if (!opening) continue;
    const delimiter = opening[1];
    const bodyStart = match.index + match[0].length + opening.index + opening[0].lastIndexOf(delimiter);
    const bodyEnd = source.indexOf(delimiter, bodyStart + delimiter.length);
    if (bodyEnd < 0) continue;
    const terminator = /^\s*;/.exec(source.slice(bodyEnd + delimiter.length));
    if (!terminator) continue;
    latest = source.slice(match.index, bodyEnd + delimiter.length + terminator[0].length);
  }
  return latest;
}

function splitTopLevelSqlArguments(source) {
  const argumentsList = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (current === quote) {
        if (source[index + 1] === quote) index += 1;
        else quote = '';
      } else if (quote === "'" && current === '\\') index += 1;
    } else if (current === "'" || current === '"') quote = current;
    else if (current === '(') depth += 1;
    else if (current === ')') depth -= 1;
    else if (current === ',' && depth === 0) {
      argumentsList.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  argumentsList.push(source.slice(start).trim());
  return argumentsList;
}

function functionCallArguments(source, name) {
  const clean = stripSqlComments(source);
  const searchable = maskSqlQuotedContents(clean);
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, 'ig');
  const calls = [];
  for (const match of searchable.matchAll(pattern)) {
    const opening = match.index + match[0].lastIndexOf('(');
    let depth = 0;
    for (let index = opening; index < searchable.length; index += 1) {
      if (searchable[index] === '(') depth += 1;
      if (searchable[index] !== ')') continue;
      depth -= 1;
      if (depth === 0) {
        calls.push(splitTopLevelSqlArguments(clean.slice(opening + 1, index)));
        break;
      }
    }
  }
  return calls;
}

function coinCallWithKey(body, rpc, prefix) {
  const calls = functionCallArguments(body, 'public.apply_coin_delta');
  const prefixPattern = new RegExp(`['"]${escapeRegExp(prefix)}`, 'i');
  const call = calls.find((argumentsList) => (
    argumentsList.length >= 5 && prefixPattern.test(argumentsList[4])
  ));
  assert.ok(call, `${rpc} must pass ${prefix} in the apply_coin_delta fifth argument`);
  return { call, calls, key: call[4] };
}

function assertCoinMutationContracts(sql) {
  const user = /\b(?:v_user_id|p_user_id|v_user|p_user)\b|auth\s*\.\s*uid\s*\(/i;
  const date = /\b(?:p_date|v_(?:business_|checkin_)?date)\b|public\.site_local_date\s*\(/i;
  const activityId = /\b(?:p_activity_id|v_activity_id)\b|\b[a-z_][a-z0-9_]*activity[a-z0-9_]*\s*\.\s*id\b/i;
  const notificationId = /\b(?:p_notification_id|v_notification_id)\b|\b[a-z_][a-z0-9_]*notification[a-z0-9_]*\s*\.\s*id\b/i;
  const contracts = [
    ['claim_activity_reward', 'activity_reward:', [[activityId, 'activity id'], [user, 'user']]],
    ['claim_site_notification_reward', 'notification_reward:', [[notificationId, 'notification id'], [user, 'user']]],
    ['perform_daily_checkin', 'checkin:daily:', [[date, 'business date'], [user, 'user']]],
    ['perform_makeup_checkin', 'checkin:makeup:cost:', [[date, 'date'], [user, 'user']]],
    ['perform_makeup_checkin', 'checkin:makeup:reward:', [[date, 'date'], [user, 'user']]],
  ];
  for (const [rpc, prefix, bindings] of contracts) {
    const body = extractFunction(sql, rpc);
    const { key } = coinCallWithKey(body, rpc, prefix);
    const expression = maskSqlQuotedContents(key);
    for (const [pattern, label] of bindings) {
      assert.match(expression, pattern, `${rpc} ${prefix} key must bind the ${label}`);
    }
  }
  assert.equal(
    functionCallArguments(extractFunction(sql, 'perform_makeup_checkin'), 'public.apply_coin_delta').length >= 2,
    true,
    'perform_makeup_checkin must make separate cost and reward coin calls',
  );
}

function extractTableContract(sql, name) {
  const source = stripSqlComments(sql);
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`create table(?: if not exists)? public\\.${escaped}\\s*\\([\\s\\S]*?\\);`, 'ig'),
    new RegExp(`alter table public\\.${escaped}[\\s\\S]*?;`, 'ig'),
    new RegExp(`create unique index[^;]*on public\\.${escaped}[^;]*;`, 'ig'),
  ];
  return patterns.flatMap((pattern) => source.match(pattern) || []).join('\n');
}

function assertUniquePair(sql, table, left, right) {
  const contract = extractTableContract(sql, table);
  const pair = `(?:${left}\\s*,\\s*${right}|${right}\\s*,\\s*${left})`;
  assert.match(
    contract,
    new RegExp(`(?:unique(?:\\s+index)?|primary key)[^;()]*\\(\\s*${pair}\\s*\\)`, 'i'),
    `${table} must uniquely constrain ${left} and ${right}`,
  );
}

function functionPrivilegeRoles(sql, action, rpc) {
  const source = stripSqlComments(sql);
  const direction = action === 'grant' ? 'to' : 'from';
  const pattern = new RegExp(
    `${action}\\s+(?:all(?:\\s+privileges)?|execute)\\s+on\\s+function\\s+public\\.${escapeRegExp(rpc)}\\s*\\([^;]*\\)\\s+${direction}\\s+([^;]+);`,
    'ig',
  );
  return new Set(
    [...source.matchAll(pattern)].flatMap((match) => match[1]
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean)),
  );
}

function assertClientWritesRevoked(sql, table) {
  const source = stripSqlComments(sql);
  const revoke = new RegExp(
    `revoke\\s+(?:all(?:\\s+privileges)?|insert\\s*,\\s*update\\s*,\\s*delete)\\s+on\\s+(?:table\\s+)?public\\.${escapeRegExp(table)}\\s+from\\s+([^;]+);`,
    'i',
  ).exec(source)?.[1] || '';
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(revoke, new RegExp(`\\b${role}\\b`, 'i'), `${table} must revoke writes from ${role}`);
  }
  assert.doesNotMatch(
    source,
    new RegExp(`grant\\s+(?:all(?:\\s+privileges)?|insert|update|delete)[^;]*on\\s+(?:table\\s+)?public\\.${escapeRegExp(table)}[^;]*to\\s+[^;]*(?:public|anon|authenticated)`, 'i'),
    `${table} must not grant client writes`,
  );
}

function hasRealtimeContract(sql, table) {
  const source = stripSqlComments(sql);
  const escaped = escapeRegExp(table);
  return [
    `alter\\s+publication\\s+supabase_realtime[^;]*\\b(?:add|set)\\s+table\\b[^;]*public\\.${escaped}\\b`,
    `create\\s+publication\\s+supabase_realtime[^;]*\\bfor\\s+table\\b[^;]*public\\.${escaped}\\b`,
  ].some((pattern) => new RegExp(pattern, 'i').test(source));
}

function assertAdminUnpublishContract(sql) {
  const body = extractFunction(sql, 'admin_unpublish_activity');
  const update = /update\s+public\.site_notifications[\s\S]*?;/i.exec(body)?.[0] || '';
  assert.match(update, /(?:is_active\s*=\s*false|status\s*=\s*'disabled'|disabled_at\s*=\s*now\s*\(\s*\))/i);
  const where = /\bwhere\b([\s\S]*);/i.exec(update)?.[1] || '';
  assert.match(
    where,
    /(?:\b(?:[a-z_][a-z0-9_]*\.)?activity_id\s*=\s*(?:p_activity_id|v_activity\s*\.\s*id)\b|\b(?:p_activity_id|v_activity\s*\.\s*id)\s*=\s*(?:[a-z_][a-z0-9_]*\.)?activity_id\b)/i,
    'linked notification update WHERE must bind activity_id',
  );
}

test('engagement migration and complete setup are present', () => {
  assert.equal(fs.existsSync(migrationPath), true, `missing ${migrationPath}`);
  assert.equal(fs.existsSync(setupPath), true, `missing ${setupPath}`);
});

// Static checks stay intentionally small. Task 9 verifies complex policy merging,
// final publication state, and aggregate/RLS/idempotency semantics on real Supabase.
for (const [label, path] of sqlSources) {
  test(`${label} defines all engagement tables`, () => {
    const sql = readSql(path);
    assert.notEqual(sql, '', `${label} is missing or empty`);
    for (const table of tables) {
      assert.equal(
        new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i').test(sql),
        true,
        `${label} is missing table ${table}`,
      );
    }
  });

  test(`${label} defines the player and admin RPC surface`, () => {
    const sql = readSql(path);
    assert.notEqual(sql, '', `${label} is missing or empty`);
    for (const rpc of rpcs) {
      assert.equal(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\b`, 'i').test(sql),
        true,
        `${label} is missing RPC ${rpc}`,
      );
    }
  });

  test(`${label} defines the shared engagement helpers`, () => {
    const sql = readSql(path);
    for (const helper of sharedHelpers) {
      assert.equal(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${helper}\\b`, 'i').test(sql),
        true,
        `${label} is missing helper ${helper}`,
      );
    }
  });

  test(`${label} makes claims, reads, and daily check-ins unique per player`, () => {
    const sql = readSql(path);
    assertUniquePair(sql, 'activity_claims', 'activity_id', 'user_id');
    assertUniquePair(sql, 'notification_reads', 'notification_id', 'user_id');
    assertUniquePair(sql, 'notification_claims', 'notification_id', 'user_id');
    assertUniquePair(sql, 'player_checkins', 'user_id', 'checkin_date');
  });

  test(`${label} enables RLS, revokes writes, and prevents direct client writes`, () => {
    const sql = readSql(path);
    for (const table of tables) {
      assert.equal(
        new RegExp(`alter table(?: if exists)? public\\.${table}\\s+enable row level security`, 'i').test(sql),
        true,
        `${table} must enable RLS`,
      );
      assertClientWritesRevoked(sql, table);
    }
  });

  test(`${label} makes reward claims and check-ins immutable`, () => {
    const sql = readSql(path);
    for (const table of ['activity_claims', 'notification_claims', 'player_checkins']) {
      assert.match(
        sql,
        new RegExp(`create\\s+trigger\\s+engagement_record_immutable\\s+before\\s+update\\s+or\\s+delete\\s+on\\s+public\\.${table}\\s+for\\s+each\\s+row\\s+execute\\s+function\\s+public\\.prevent_engagement_record_mutation\\s*\\(\\s*\\)\\s*;`, 'i'),
        `${table} must have a BEFORE UPDATE OR DELETE immutability trigger`,
      );
      assert.match(
        sql,
        new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+engagement_record_immutable\\s+on\\s+public\\.${table}\\s*;`, 'i'),
        `${table} trigger setup must be idempotent`,
      );
    }

    const helper = extractFunction(sql, 'prevent_engagement_record_mutation');
    assert.notEqual(helper, '', 'missing shared engagement immutability trigger function');
    assert.match(helper, /returns\s+trigger/i);
    assert.match(helper, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
    assert.match(helper, /ENGAGEMENT_RECORD_IMMUTABLE/);
    assert.match(helper, /tg_op\s*=\s*'DELETE'[\s\S]*not\s+exists[\s\S]*from\s+public\.profiles[\s\S]*old\.user_id[\s\S]*return\s+old/i);
    assert.deepEqual(
      [...functionPrivilegeRoles(sql, 'revoke', 'prevent_engagement_record_mutation')].sort(),
      ['anon', 'authenticated', 'public'],
    );
    assert.deepEqual([...functionPrivilegeRoles(sql, 'grant', 'prevent_engagement_record_mutation')], []);
  });

  test(`${label} secures every engagement RPC with a fixed execution context`, () => {
    const sql = readSql(path);
    for (const rpc of rpcs) {
      const body = extractFunction(sql, rpc);
      assert.notEqual(body, '', `${label} is missing RPC body ${rpc}`);
      assert.match(body, /security\s+definer/i, `${rpc} must use security definer`);
      assert.match(
        body,
        /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
        `${rpc} must fix search_path`,
      );
    }
  });

  test(`${label} grants public lists to guests and keeps all other RPCs authenticated-only`, () => {
    const sql = readSql(path);
    for (const rpc of publicListRpcs) {
      assert.deepEqual(
        [...functionPrivilegeRoles(sql, 'grant', rpc)].sort(),
        ['anon', 'authenticated'],
        `${rpc} must grant only anon and authenticated`,
      );
      assert.equal(
        functionPrivilegeRoles(sql, 'revoke', rpc).has('public'),
        true,
        `${rpc} must revoke the default PUBLIC execution privilege`,
      );
    }
    for (const rpc of authenticatedOnlyRpcs) {
      const revoked = functionPrivilegeRoles(sql, 'revoke', rpc);
      assert.equal(revoked.has('public'), true, `${rpc} must explicitly revoke PUBLIC`);
      assert.equal(revoked.has('anon'), true, `${rpc} must explicitly revoke anon`);
      assert.deepEqual(
        [...functionPrivilegeRoles(sql, 'grant', rpc)].sort(),
        ['authenticated'],
        `${rpc} must grant only authenticated`,
      );
    }
  });

  test(`${label} protects every admin RPC with an authoritative admin check`, () => {
    const sql = readSql(path);
    const helper = extractFunction(sql, 'require_site_admin');
    assert.notEqual(functionCallArguments(helper, 'public.is_economy_admin').length, 0, 'require_site_admin must verify the admin role');
    assert.match(helper, /ADMIN_REQUIRED/, 'require_site_admin must reject non-admin callers');
    for (const rpc of adminRpcs) {
      const body = extractFunction(sql, rpc);
      assert.notEqual(
        functionCallArguments(body, 'public.require_site_admin').length,
        0,
        `${rpc} must reuse require_site_admin`,
      );
    }
  });

  test(`${label} reuses registration, check-in rule, and public URL helpers`, () => {
    const sql = readSql(path);
    for (const rpc of registeredUserRpcs) {
      assert.notEqual(
        functionCallArguments(extractFunction(sql, rpc), 'public.require_registered_user').length,
        0,
        `${rpc} must reuse require_registered_user`,
      );
    }
    for (const rpc of checkinRpcs) {
      assert.notEqual(
        functionCallArguments(extractFunction(sql, rpc), 'public.checkin_rule_for_date').length,
        0,
        `${rpc} must reuse checkin_rule_for_date`,
      );
    }
    for (const rpc of publicUrlRpcs) {
      assert.notEqual(
        functionCallArguments(extractFunction(sql, rpc), 'public.validate_public_url').length,
        0,
        `${rpc} must reuse validate_public_url`,
      );
    }
  });

  test(`${label} serializes claims and routes non-zero coin changes through the ledger`, () => {
    const sql = readSql(path);
    for (const rpc of [
      'claim_activity_reward',
      'claim_site_notification_reward',
      'perform_daily_checkin',
      'perform_makeup_checkin',
    ]) {
      const body = extractFunction(sql, rpc);
      assert.match(body, /for\s+update/i, `${rpc} must lock mutable state`);
      assert.notEqual(
        functionCallArguments(body, 'public.apply_coin_delta').length,
        0,
        `${rpc} must use apply_coin_delta when it changes coins`,
      );
    }
    assertCoinMutationContracts(sql);
  });

  test(`${label} uses the Asia/Hong_Kong calendar for check-ins`, () => {
    const sql = readSql(path);
    assert.match(
      extractFunction(sql, 'site_local_date'),
      /Asia\/Hong_Kong/,
      'site_local_date must define the Asia/Hong_Kong calendar',
    );
    for (const rpc of ['get_checkin_month', 'perform_daily_checkin', 'perform_makeup_checkin']) {
      assert.notEqual(
        functionCallArguments(extractFunction(sql, rpc), 'public.site_local_date').length,
        0,
        `${rpc} must use site_local_date`,
      );
    }
  });

  test(`${label} publishes notification and read changes to Realtime`, () => {
    const sql = readSql(path);
    for (const table of ['site_notifications', 'notification_reads']) {
      assert.equal(hasRealtimeContract(sql, table), true, `${table} needs an explicit Realtime publication add`);
    }
    const siteGrant = /grant\s+select\s+on\s+(?:table\s+)?public\.site_notifications\s+to\s+([^;]+);/i.exec(sql)?.[1] || '';
    assert.match(siteGrant, /\banon\b/i);
    assert.match(siteGrant, /\bauthenticated\b/i);
    const readGrant = /grant\s+select\s+on\s+(?:table\s+)?public\.notification_reads\s+to\s+([^;]+);/i.exec(sql)?.[1] || '';
    assert.match(readGrant, /\bauthenticated\b/i);
    const sitePolicy = /create\s+policy[^;]*on\s+public\.site_notifications[^;]*;/i.exec(sql)?.[0] || '';
    for (const token of [/for\s+select/i, /\bis_active\b/i, /visible_at\s*<=/i, /expires_at\s+is\s+null/i, /expires_at\s*>/i]) assert.match(sitePolicy, token);
    const readPolicy = /create\s+policy[^;]*on\s+public\.notification_reads[^;]*;/i.exec(sql)?.[0] || '';
    assert.match(readPolicy, /for\s+select[\s\S]*to\s+authenticated/i);
    assert.match(readPolicy, /(?:auth\s*\.\s*uid\s*\(\s*\)\s*=\s*(?:[a-z_][a-z0-9_]*\.)?user_id|(?:[a-z_][a-z0-9_]*\.)?user_id\s*=\s*auth\s*\.\s*uid\s*\(\s*\))/i);
  });

  test(`${label} disables linked notifications when an activity is unpublished`, () => {
    assertAdminUnpublishContract(readSql(path));
  });

  test(`${label} keeps admin lists and unread counts tied to their source rows`, () => {
    const sql = readSql(path);
    const activities = extractFunction(sql, 'admin_list_activities');
    for (const token of [/from\s+public\.activities/i, /public\.activity_claims/i, /count\s*\(/i, /activity_id/i]) assert.match(activities, token);
    const notifications = extractFunction(sql, 'admin_list_site_notifications');
    for (const token of [/from\s+public\.site_notifications/i, /public\.notification_reads/i, /public\.notification_claims/i, /notification_id/i]) assert.match(notifications, token);
    assert.equal((notifications.match(/count\s*\(/ig) || []).length >= 2, true);
    const unread = extractFunction(sql, 'count_unread_site_notifications');
    for (const token of [/count\s*\(/i, /from\s+public\.site_notifications/i, /\bis_active\b/i, /visible_at\s*<=/i, /expires_at\s+is\s+null/i, /expires_at\s*>/i, /not\s+exists/i, /public\.notification_reads/i]) assert.match(unread, token);
    assert.match(unread, /notification_id\s*=\s*(?:[a-z_][a-z0-9_]*\.)?id/i);
    assert.match(unread, /user_id\s*=\s*(?:v_user_id|auth\s*\.\s*uid\s*\(\s*\))/i);
  });
}

test('engagement migration is incremental and non-destructive', () => {
  const sql = readSql(migrationPath);
  assert.doesNotMatch(sql, /drop\s+table\b/i);
  assert.doesNotMatch(sql, /truncate\b/i);
});

test('fixture: critical searches ignore SQL comments', () => {
  const sql = stripSqlComments("-- create table public.fake(id int);\n/* public.require_site_admin(); */ select '-- keep';");
  assert.doesNotMatch(sql, /create table|require_site_admin/i);
  assert.match(sql, /'-- keep'/);
});

test('fixture: function extraction uses the last complete tagged definition', () => {
  const sql = `create or replace function public.fixture_rpc() returns void as $$ begin perform old_call(); end; $$;
    create or replace function public.fixture_rpc() returns void as $final$ begin perform new_call(); end; $final$;`;
  const body = extractFunction(sql, 'fixture_rpc');
  assert.match(body, /\$final\$[\s\S]*new_call/);
  assert.doesNotMatch(body, /old_call/);
});

test('fixture: helper calls inside strings do not count', () => {
  const body = "perform 'public.require_site_admin()'; perform public.require_site_admin();";
  assert.equal(functionCallArguments(body, 'public.require_site_admin').length, 1);
});

test('fixture: a coin key outside the fifth argument is rejected', () => {
  const body = "perform public.apply_coin_delta(v_user_id, 1, 'reason', 'activity_reward:' || v_activity.id, 'wrong');";
  assert.throws(() => coinCallWithKey(body, 'fixture_rpc', 'activity_reward:'), /fifth argument/);
});

test('fixture: Realtime requires ADD, SET, or CREATE FOR TABLE', () => {
  assert.equal(hasRealtimeContract('alter publication supabase_realtime add table public.fixture_table;', 'fixture_table'), true);
  assert.equal(hasRealtimeContract('alter publication supabase_realtime set table public.fixture_table;', 'fixture_table'), true);
  assert.equal(hasRealtimeContract('create publication supabase_realtime for table public.fixture_table;', 'fixture_table'), true);
  assert.equal(hasRealtimeContract('alter publication supabase_realtime drop table public.fixture_table;', 'fixture_table'), false);
});

test('fixture: an activity_id tautology is not an unpublish filter', () => {
  const sql = `create or replace function public.admin_unpublish_activity() returns void as $$ begin
    update public.site_notifications as notification set is_active = false
    where notification.activity_id = notification.activity_id; end; $$;`;
  assert.throws(() => assertAdminUnpublishContract(sql), /bind activity_id/);
});
