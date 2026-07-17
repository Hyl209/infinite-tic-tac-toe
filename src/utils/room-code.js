(function initRoomCodeUtils(globalScope) {
  'use strict';

  const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function normalizeRoomCode(value) {
    return String(value || '')
      .toUpperCase()
      .split('')
      .filter((character) => ROOM_ALPHABET.includes(character))
      .join('')
      .slice(0, 6);
  }

  function isValidRoomCode(value) {
    const normalized = normalizeRoomCode(value);
    return normalized.length === 6 && normalized === String(value || '').toUpperCase();
  }

  const roomCodeUtils = {
    ROOM_ALPHABET,
    isValidRoomCode,
    normalizeRoomCode,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = roomCodeUtils;
  globalScope.RoomCodeUtils = roomCodeUtils;
})(typeof window !== 'undefined' ? window : globalThis);
