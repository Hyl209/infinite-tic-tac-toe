(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlayerCheckin = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ERROR_MESSAGES = {
    ACCOUNT_CLIENT_REQUIRED: '账号服务不可用',
    REGISTERED_ACCOUNT_REQUIRED: '请先登录正式账号',
    ADMIN_REQUIRED: '需要管理员权限',
    INVALID_CHECKIN_MONTH: '签到月份格式无效',
    INVALID_REQUEST_ID: '请求 ID 无效',
    CHECKIN_ALREADY_DONE: '今天已经签到',
    MAKEUP_DATE_INVALID: '补签日期无效',
    MAKEUP_OUTSIDE_CURRENT_MONTH: '只能补签本月日期',
    ITEM_PAYMENT_UNAVAILABLE: '暂不支持道具补签',
    INVALID_PAYMENT_METHOD: '补签支付方式无效',
    INVALID_CHECKIN_RULE: '签到规则无效',
    CHECKIN_RULE_DATE_INVALID: '签到规则生效日期无效',
    CHECKIN_RULE_DATE_EXISTS: '该生效日期已存在签到规则',
    INSUFFICIENT_COINS: '金币不足',
    INVALID_CHECKIN_RESPONSE: '签到服务返回了无效数据，请稍后重试',
  };

  var CHECKIN_RESULT_SCHEMA = {
    fields: [
      'checkin_date', 'reward_amount', 'balance', 'checkin_type',
      'payment_method', 'payment_amount',
    ],
    numbers: ['reward_amount', 'balance', 'payment_amount'],
  };
  var CHECKIN_RULE_SCHEMA = {
    fields: [
      'id', 'effective_from', 'monday_reward', 'tuesday_reward',
      'wednesday_reward', 'thursday_reward', 'friday_reward',
      'saturday_reward', 'sunday_reward', 'makeup_cost', 'created_by', 'created_at',
    ],
    numbers: [
      'id', 'monday_reward', 'tuesday_reward', 'wednesday_reward',
      'thursday_reward', 'friday_reward', 'saturday_reward', 'sunday_reward', 'makeup_cost',
    ],
  };

  function errorCode(error) {
    var text = [error && error.code, error && error.message, error && error.details, error && error.hint]
      .filter(Boolean).join(' ');
    return Object.keys(ERROR_MESSAGES).find(function (code) {
      return text.indexOf(code) !== -1;
    });
  }

  function mapCheckinError(error) {
    return ERROR_MESSAGES[errorCode(error)] || '签到失败，请稍后重试';
  }

  function fail(code) {
    throw new Error(code);
  }

  function nullableNumber(value) {
    return value == null ? null : Number(value);
  }

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-').map(Number);
    var year = parts[0];
    var month = parts[1];
    var day = parts[2];
    if (year < 1 || month < 1 || month > 12) return false;
    var days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1];
  }

  function normalizeMonth(value) {
    if (typeof value !== 'string') fail('INVALID_CHECKIN_MONTH');
    var match = /^(\d{4})-(\d{2})$/.exec(value);
    if (match) {
      var year = Number(match[1]);
      var month = Number(match[2]);
      if (year < 1 || month < 1 || month > 12) fail('INVALID_CHECKIN_MONTH');
      return value + '-01';
    }
    if (!isValidDate(value)) fail('INVALID_CHECKIN_MONTH');
    return value.slice(0, 7) + '-01';
  }

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function isFiniteNumberValue(value) {
    var type = typeof value;
    if ((type !== 'number' && type !== 'bigint' && type !== 'string') ||
        (type === 'string' && value.trim() === '')) return false;
    return Number.isFinite(Number(value));
  }

  function requiredRpcRow(data, schema) {
    var row = firstRpcRow(data);
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        schema.fields.some(function (field) { return row[field] == null; }) ||
        (schema.numbers || []).some(function (field) {
          return !isFiniteNumberValue(row[field]);
        })) {
      fail('INVALID_CHECKIN_RESPONSE');
    }
    return row;
  }

  function mapDay(row) {
    row = row || {};
    return {
      checkinDate: row.checkin_date ?? null,
      rewardAmount: nullableNumber(row.reward_amount),
      checkedIn: Boolean(row.checked_in),
      checkinType: row.checkin_type ?? null,
      paymentMethod: row.payment_method ?? null,
      paymentAmount: nullableNumber(row.payment_amount),
      isToday: Boolean(row.is_today),
      canMakeup: Boolean(row.can_makeup),
      makeupCost: nullableNumber(row.makeup_cost),
    };
  }

  function mapResult(row) {
    row = row || {};
    return {
      checkinDate: row.checkin_date ?? null,
      rewardAmount: nullableNumber(row.reward_amount),
      balance: nullableNumber(row.balance),
      checkinType: row.checkin_type ?? null,
      paymentMethod: row.payment_method ?? null,
      paymentAmount: nullableNumber(row.payment_amount),
    };
  }

  function mapRule(row) {
    row = row || {};
    return {
      id: nullableNumber(row.id),
      effectiveFrom: row.effective_from ?? null,
      mondayReward: nullableNumber(row.monday_reward),
      tuesdayReward: nullableNumber(row.tuesday_reward),
      wednesdayReward: nullableNumber(row.wednesday_reward),
      thursdayReward: nullableNumber(row.thursday_reward),
      fridayReward: nullableNumber(row.friday_reward),
      saturdayReward: nullableNumber(row.saturday_reward),
      sundayReward: nullableNumber(row.sunday_reward),
      makeupCost: nullableNumber(row.makeup_cost),
      createdBy: row.created_by ?? null,
      createdAt: row.created_at ?? null,
    };
  }

  function createCheckinClient({ accountClient } = {}) {
    if (!accountClient || typeof accountClient.getIdentity !== 'function' ||
        typeof accountClient.getSupabaseClient !== 'function') fail('ACCOUNT_CLIENT_REQUIRED');

    function requireRegistered() {
      var identity = accountClient.getIdentity();
      if (!identity || identity.kind !== 'registered') fail('REGISTERED_ACCOUNT_REQUIRED');
    }

    async function callRpc(name, params) {
      var supabase = await accountClient.getSupabaseClient();
      if (!supabase || typeof supabase.rpc !== 'function') fail('ACCOUNT_CLIENT_REQUIRED');
      var result = await supabase.rpc(name, params);
      if (result && result.error) throw result.error;
      return result && result.data;
    }

    function requireRequestId(requestId) {
      if (typeof requestId !== 'string' || requestId.length === 0) fail('INVALID_REQUEST_ID');
    }

    async function getMonth(month) {
      requireRegistered();
      var normalized = normalizeMonth(month);
      var data = await callRpc('get_checkin_month', { p_month: normalized });
      return (data || []).map(mapDay);
    }

    async function checkIn(requestId) {
      requireRegistered();
      requireRequestId(requestId);
      return mapResult(requiredRpcRow(await callRpc('perform_daily_checkin', {
        p_request_id: requestId,
      }), CHECKIN_RESULT_SCHEMA));
    }

    async function makeUp(date, paymentMethod, requestId) {
      requireRegistered();
      if (!isValidDate(date)) fail('MAKEUP_DATE_INVALID');
      if (paymentMethod === 'item') fail('ITEM_PAYMENT_UNAVAILABLE');
      if (paymentMethod !== 'coins') fail('INVALID_PAYMENT_METHOD');
      requireRequestId(requestId);
      return mapResult(requiredRpcRow(await callRpc('perform_makeup_checkin', {
        p_date: date,
        p_payment_method: paymentMethod,
        p_request_id: requestId,
      }), CHECKIN_RESULT_SCHEMA));
    }

    async function adminListRules() {
      requireRegistered();
      var data = await callRpc('admin_list_checkin_rules', undefined);
      return (data || []).map(mapRule);
    }

    async function adminCreateRule(rule) {
      requireRegistered();
      rule = rule || {};
      return mapRule(requiredRpcRow(await callRpc('admin_create_checkin_rule', {
        p_effective_from: rule.effectiveFrom ?? null,
        p_monday_reward: nullableNumber(rule.mondayReward),
        p_tuesday_reward: nullableNumber(rule.tuesdayReward),
        p_wednesday_reward: nullableNumber(rule.wednesdayReward),
        p_thursday_reward: nullableNumber(rule.thursdayReward),
        p_friday_reward: nullableNumber(rule.fridayReward),
        p_saturday_reward: nullableNumber(rule.saturdayReward),
        p_sunday_reward: nullableNumber(rule.sundayReward),
        p_makeup_cost: nullableNumber(rule.makeupCost),
      }), CHECKIN_RULE_SCHEMA));
    }

    return {
      getMonth: getMonth,
      checkIn: checkIn,
      makeUp: makeUp,
      adminListRules: adminListRules,
      adminCreateRule: adminCreateRule,
    };
  }

  return {
    createCheckinClient: createCheckinClient,
    mapCheckinError: mapCheckinError,
  };
}));
