'use strict';

importScripts('gomoku.js');

self.onmessage = (event) => {
  const { requestId, position, aiMark } = event.data || {};
  try {
    const move = self.GomokuEngine.chooseAIMove(position, 'hard', aiMark, {
      timeLimitMs: 1200,
    });
    self.postMessage({ requestId, move });
  } catch (error) {
    self.postMessage({ requestId, move: null, error: error.message });
  }
};
