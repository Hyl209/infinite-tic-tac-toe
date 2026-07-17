(function initPlayerEconomy(globalScope) {
  'use strict';

  const REDEEM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;
  const ERROR_MESSAGES = {
    REGISTERED_ACCOUNT_REQUIRED: '请先注册并登录账号',
    INVALID_REDEEM_CODE: '请输入正确的兑换码',
    INVALID_WAGER: '请选择正确的彩头金额',
    INSUFFICIENT_COINS: '金币不足',
    CODE_NOT_FOUND: '兑换码不存在',
    CODE_ALREADY_REDEEMED: '这个兑换码你已经领取过了',
    CODE_EXPIRED: '兑换码已过期',
    CODE_DISABLED: '兑换码已停用',
    CODE_EXHAUSTED: '兑换码领取次数已用完',
    ADMIN_REQUIRED: '需要管理员权限',
  };

  function normalizeRedeemCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
  }

  function formatRedeemCode(value) {
    return normalizeRedeemCode(value).match(/.{1,4}/g)?.join('-') || '';
  }

  function isValidRedeemCode(value) {
    return REDEEM_CODE_PATTERN.test(normalizeRedeemCode(value));
  }

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function mapEconomyError(error) {
    const message = error?.message || String(error || '');
    const code = Object.keys(ERROR_MESSAGES).find((item) => message.includes(item));
    return code ? ERROR_MESSAGES[code] : '金币服务暂时不可用，请稍后重试';
  }

  function mapRedeemCode(row) {
    return {
      id: row.id,
      codeHint: row.code_hint,
      amount: Number(row.amount || 0),
      maxClaims: Number(row.max_claims || 0),
      claimCount: Number(row.claim_count || 0),
      expiresAt: row.expires_at || null,
      active: Boolean(row.is_active),
      createdAt: row.created_at || null,
    };
  }

  function createEconomyClient({
    accountClient = null,
    onSnapshot = () => {},
  } = {}) {
    const listeners = new Set();
    let snapshot = { balance: 0, isAdmin: false, loaded: false };

    function getSnapshot() {
      return { ...snapshot };
    }

    function setSnapshot(nextSnapshot) {
      snapshot = { ...nextSnapshot };
      const current = getSnapshot();
      onSnapshot(current);
      listeners.forEach((listener) => listener(current));
      return current;
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function isRegistered() {
      return accountClient?.getIdentity?.().kind === 'registered';
    }

    function requireRegistered() {
      if (!isRegistered()) throw new Error('REGISTERED_ACCOUNT_REQUIRED');
    }

    async function callRpc(name, params) {
      const supabase = await accountClient?.getSupabaseClient?.();
      if (!supabase) throw new Error('ONLINE_NOT_CONFIGURED');
      const result = await supabase.rpc(name, params);
      if (result.error) throw result.error;
      return result.data;
    }

    async function refresh() {
      if (!isRegistered()) {
        return setSnapshot({ balance: 0, isAdmin: false, loaded: true });
      }
      const row = firstRpcRow(await callRpc('get_economy_snapshot')) || {};
      return setSnapshot({
        balance: Number(row.balance || 0),
        isAdmin: Boolean(row.is_admin),
        loaded: true,
      });
    }

    async function redeemCode(value) {
      requireRegistered();
      const code = normalizeRedeemCode(value);
      if (!isValidRedeemCode(code)) throw new Error('INVALID_REDEEM_CODE');
      const row = firstRpcRow(await callRpc('redeem_coin_code', { p_code: code })) || {};
      const result = {
        grantedAmount: Number(row.granted_amount || 0),
        balance: Number(row.balance || 0),
      };
      setSnapshot({ ...snapshot, balance: result.balance, loaded: true });
      return result;
    }

    async function createRedeemCode({ amount, maxClaims, expiresAt = null }) {
      requireRegistered();
      const row = firstRpcRow(await callRpc('create_redeem_code', {
        p_amount: Number(amount),
        p_max_claims: Number(maxClaims),
        p_expires_at: expiresAt || null,
      })) || {};
      return {
        id: row.id,
        code: row.code,
        amount: Number(row.amount || 0),
        maxClaims: Number(row.max_claims || 0),
        expiresAt: row.expires_at || null,
      };
    }

    async function listRedeemCodes() {
      requireRegistered();
      const rows = await callRpc('list_redeem_codes');
      return (rows || []).map(mapRedeemCode);
    }

    async function disableRedeemCode(id) {
      requireRegistered();
      await callRpc('disable_redeem_code', { p_code_id: id });
    }

    return {
      createRedeemCode,
      disableRedeemCode,
      getSnapshot,
      listRedeemCodes,
      redeemCode,
      refresh,
      subscribe,
    };
  }

  const playerEconomy = {
    REDEEM_CODE_PATTERN,
    createEconomyClient,
    formatRedeemCode,
    isValidRedeemCode,
    mapEconomyError,
    normalizeRedeemCode,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = playerEconomy;
  globalScope.PlayerEconomy = playerEconomy;
})(typeof window !== 'undefined' ? window : globalThis);
