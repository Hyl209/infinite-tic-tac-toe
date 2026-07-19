(function initPlayerAccount(globalScope) {
  'use strict';

  const USERNAME_EMAIL_DOMAIN = 'players.invalid';
  const GUEST_NAME_STORAGE_KEY = 'board-game-guest-name';
  const GUEST_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
  const PLAYER_UID_USERNAME_PATTERN = /^[0-9]{6}$/;
  const GUEST_NAME_PATTERN = /^匿名玩家·[A-HJ-NP-Z2-9]{4}$/;
  const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

  const ERROR_MESSAGES = {
    ONLINE_NOT_CONFIGURED: '账号服务尚未配置',
    SUPABASE_SDK_LOAD_FAILED: '账号服务加载失败，请稍后重试',
    INVALID_USERNAME: '用户名需为 3 至 20 位英文、数字或下划线',
    PLAYER_UID_USERNAME_RESERVED: '6 位纯数字用户名保留为玩家 UID，请使用其他用户名',
    INVALID_PASSWORD: '密码需为 8 至 64 位',
    INVALID_GAME_NAME: '游戏名需为 1 至 16 个字符',
    PROFILE_REQUIRED: '请先完成个人资料',
    PROFILE_SAVE_FAILED: '个人资料保存失败，请稍后重试',
    PLAYER_UID_EXHAUSTED: '玩家 UID 已发放完毕，请联系管理员',
    PLAYER_UID_IMMUTABLE: '玩家 UID 不可修改',
    INSUFFICIENT_ITEMS: '需要一张改名卡',
  };

  function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isValidUsername(value) {
    const username = String(value || '');
    return USERNAME_PATTERN.test(username) && !PLAYER_UID_USERNAME_PATTERN.test(username);
  }

  function usernameErrorCode(value) {
    return PLAYER_UID_USERNAME_PATTERN.test(String(value || ''))
      ? 'PLAYER_UID_USERNAME_RESERVED'
      : 'INVALID_USERNAME';
  }

  function isValidPassword(value) {
    const length = String(value || '').length;
    return length >= 8 && length <= 64;
  }

  function normalizeGameName(value) {
    return String(value || '').trim();
  }

  function isValidGameName(value) {
    const normalized = normalizeGameName(value);
    return normalized.length >= 1
      && normalized.length <= 16
      && !CONTROL_CHARACTER_PATTERN.test(normalized);
  }

  function usernameToEmail(value, { allowReservedUsername = false } = {}) {
    const username = normalizeUsername(value);
    if (!USERNAME_PATTERN.test(username)
      || (!allowReservedUsername && PLAYER_UID_USERNAME_PATTERN.test(username))) {
      throw new Error(usernameErrorCode(username));
    }
    return `${username}@${USERNAME_EMAIL_DOMAIN}`;
  }

  function formatPlayerUid(value) {
    if (value == null) return null;
    const uid = Number(value);
    if (!Number.isInteger(uid) || uid < 0 || uid > 999999) throw new Error('INVALID_PLAYER_UID');
    return String(uid).padStart(6, '0');
  }

  function createRequestId() {
    if (typeof globalScope.crypto?.randomUUID === 'function') return globalScope.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalScope.crypto?.getRandomValues?.(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getGuestName({
    storage = globalScope.localStorage,
    random = Math.random,
  } = {}) {
    const stored = storage?.getItem?.(GUEST_NAME_STORAGE_KEY);
    if (GUEST_NAME_PATTERN.test(stored || '')) return stored;

    let suffix = '';
    for (let index = 0; index < 4; index += 1) {
      const position = Math.min(
        GUEST_ALPHABET.length - 1,
        Math.floor(random() * GUEST_ALPHABET.length),
      );
      suffix += GUEST_ALPHABET[position];
    }
    const name = `匿名玩家·${suffix}`;
    storage?.setItem?.(GUEST_NAME_STORAGE_KEY, name);
    return name;
  }

  function mapAccountError(error) {
    const message = [
      error?.code,
      error?.message,
      error?.details,
      error?.cause?.code,
      error?.cause?.message,
      error?.cause?.details,
    ].filter(Boolean).join(' ') || String(error || '');
    if (/profiles_username_not_player_uid/i.test(message)) {
      return ERROR_MESSAGES.PLAYER_UID_USERNAME_RESERVED;
    }
    const stableCode = Object.keys(ERROR_MESSAGES).find((code) => message.includes(code));
    if (stableCode) return ERROR_MESSAGES[stableCode];
    if (/already registered|duplicate key|23505/i.test(message)) return '这个用户名已被使用';
    if (/invalid login credentials/i.test(message)) return '用户名或密码错误';
    if (/password/i.test(message) && /weak|short|characters/i.test(message)) return ERROR_MESSAGES.INVALID_PASSWORD;
    return '账号服务暂时不可用，请稍后重试';
  }

  function guestIdentity(guestName) {
    return {
      kind: 'guest',
      uid: null,
      username: null,
      displayName: guestName,
      needsProfile: false,
    };
  }

  function createAccountClient({
    config = globalScope.ONLINE_GAME_CONFIG || {},
    loadSupabase = (...args) => globalScope.OnlineGame.loadSupabaseSdk(...args),
    storage = globalScope.localStorage,
    random = Math.random,
    onIdentity = () => {},
  } = {}) {
    const guestName = getGuestName({ storage, random });
    const listeners = new Set();
    let supabase = null;
    let supabasePromise = null;
    let initializationPromise = null;
    let identity = guestIdentity(guestName);

    function isConfigured() {
      return Boolean(config.supabaseUrl && config.supabaseAnonKey);
    }

    function getIdentity() {
      return { ...identity };
    }

    function setIdentity(nextIdentity) {
      identity = nextIdentity;
      onIdentity(getIdentity());
      listeners.forEach((listener) => listener(getIdentity()));
      return getIdentity();
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    async function getSupabaseClient() {
      if (supabase) return supabase;
      if (supabasePromise) return supabasePromise;
      if (!isConfigured()) throw new Error('ONLINE_NOT_CONFIGURED');
      supabasePromise = loadSupabase().then((sdk) => {
        supabase = sdk.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });
        return supabase;
      }).catch((error) => {
        supabasePromise = null;
        throw error;
      });
      return supabasePromise;
    }

    async function readProfile(userId) {
      const client = await getSupabaseClient();
      const result = await client
        .from('profiles')
        .select('username, game_name, player_uid')
        .eq('id', userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    }

    function registeredIdentity(user, profile) {
      const fallbackUsername = String(user?.email || '').split('@')[0];
      const username = profile?.username || fallbackUsername;
      const result = {
        kind: 'registered',
        uid: formatPlayerUid(profile?.player_uid),
        username,
        displayName: profile?.game_name || username,
        needsProfile: !profile,
      };
      if (profile?.rename_card_quantity != null) {
        result.renameCardQuantity = Number(profile.rename_card_quantity || 0);
      }
      return result;
    }

    async function identityForUser(user) {
      if (!user || user.is_anonymous) return guestIdentity(guestName);
      const profile = await readProfile(user.id);
      return registeredIdentity(user, profile);
    }

    function initialize() {
      if (!isConfigured()) return Promise.resolve(setIdentity(guestIdentity(guestName)));
      if (!initializationPromise) {
        initializationPromise = (async () => {
          const client = await getSupabaseClient();
          const result = await client.auth.getSession();
          if (result.error) throw result.error;
          const user = result.data.session?.user || null;
          return setIdentity(await identityForUser(user));
        })().catch((error) => {
          initializationPromise = null;
          throw error;
        });
      }
      return initializationPromise;
    }

    async function waitForInitialization() {
      if (!initializationPromise) return;
      try {
        await initializationPromise;
      } catch {
        // The explicit account action below retries through the reset client promise.
      }
    }

    function validateCredentials({
      username,
      password,
      gameName,
      requireGameName = false,
      allowReservedUsername = false,
    }) {
      const normalizedUsername = normalizeUsername(username);
      if (!USERNAME_PATTERN.test(normalizedUsername)
        || (!allowReservedUsername && PLAYER_UID_USERNAME_PATTERN.test(normalizedUsername))) {
        throw new Error(usernameErrorCode(normalizedUsername));
      }
      if (!isValidPassword(password)) throw new Error('INVALID_PASSWORD');
      const normalizedGameName = normalizeGameName(gameName);
      if (requireGameName && !isValidGameName(normalizedGameName)) throw new Error('INVALID_GAME_NAME');
      return { normalizedUsername, normalizedGameName };
    }

    async function createProfile(user, username, gameName) {
      const client = await getSupabaseClient();
      const payload = { id: user.id, username, game_name: gameName };
      const result = await client
        .from('profiles')
        .insert(payload)
        .select('username, game_name, player_uid')
        .single();
      if (result.error) throw new Error('PROFILE_SAVE_FAILED', { cause: result.error });
      return result.data || payload;
    }

    async function register({ username, password, gameName }) {
      const { normalizedUsername, normalizedGameName } = validateCredentials({
        username,
        password,
        gameName,
        requireGameName: true,
      });
      await waitForInitialization();
      const client = await getSupabaseClient();
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      let user = sessionResult.data.session?.user || null;
      if (!user) {
        const anonymousResult = await client.auth.signInAnonymously();
        if (anonymousResult.error) throw anonymousResult.error;
        user = anonymousResult.data.user;
      }

      const updateResult = await client.auth.updateUser({
        email: usernameToEmail(normalizedUsername),
        password,
      });
      if (updateResult.error) throw updateResult.error;
      user = updateResult.data.user;
      const profile = await createProfile(user, normalizedUsername, normalizedGameName);
      return setIdentity(registeredIdentity(user, profile));
    }

    async function login({ username, password }) {
      const { normalizedUsername } = validateCredentials({
        username,
        password,
        allowReservedUsername: true,
      });
      await waitForInitialization();
      const client = await getSupabaseClient();
      const result = await client.auth.signInWithPassword({
        email: usernameToEmail(normalizedUsername, { allowReservedUsername: true }),
        password,
      });
      if (result.error) throw result.error;
      return setIdentity(await identityForUser(result.data.user));
    }

    async function updateGameName(value) {
      const gameName = normalizeGameName(value);
      if (!isValidGameName(gameName)) throw new Error('INVALID_GAME_NAME');
      const client = await getSupabaseClient();
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      const user = sessionResult.data.session?.user;
      if (!user || user.is_anonymous || !identity.username) throw new Error('PROFILE_REQUIRED');
      const result = await client.rpc('rename_with_item', {
        p_game_name: gameName,
        p_request_id: createRequestId(),
      });
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row?.username || !row?.game_name) throw new Error('PROFILE_SAVE_FAILED');
      return setIdentity(registeredIdentity(user, {
        username: row.username,
        game_name: row.game_name,
        player_uid: identity.uid,
        rename_card_quantity: row.rename_card_quantity,
      }));
    }

    async function logout() {
      if (supabase) {
        const result = await supabase.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
      }
      return setIdentity(guestIdentity(guestName));
    }

    async function ensureOnlineIdentity() {
      const client = await getSupabaseClient();
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      let user = sessionResult.data.session?.user || null;
      if (!user) {
        const anonymousResult = await client.auth.signInAnonymously();
        if (anonymousResult.error) throw anonymousResult.error;
        user = anonymousResult.data.user;
      }
      const nextIdentity = await identityForUser(user);
      setIdentity(nextIdentity);
      return { supabase: client, user, identity: getIdentity() };
    }

    return {
      ensureOnlineIdentity,
      getIdentity,
      getSupabaseClient,
      initialize,
      isConfigured,
      login,
      logout,
      register,
      subscribe,
      updateGameName,
    };
  }

  const playerAccount = {
    GUEST_ALPHABET,
    GUEST_NAME_STORAGE_KEY,
    USERNAME_EMAIL_DOMAIN,
    createAccountClient,
    formatPlayerUid,
    getGuestName,
    isValidGameName,
    isValidPassword,
    isValidUsername,
    mapAccountError,
    normalizeGameName,
    normalizeUsername,
    usernameToEmail,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = playerAccount;
  globalScope.PlayerAccount = playerAccount;
})(typeof window !== 'undefined' ? window : globalThis);
