export type Mark = 'X' | 'O';
export type GameType = 'tic_tac_toe' | 'gomoku';
export type GameMode = 'ai' | 'pvp' | 'online';
export type GameStatus = 'waiting' | 'playing' | 'x_win' | 'o_win' | 'draw' | 'abandoned';
export type FinishReason = 'normal' | 'draw' | 'active_exit' | 'disconnect' | 'expired' | null;

export interface GamePosition {
  board: Array<Mark | null>;
  moveHistory: number[];
  moveOrders?: Record<Mark, number[]>;
}

export interface OnlineGameState extends GamePosition {
  gameMode: 'online';
  gameType: GameType;
  roomId: string;
  roomCode: string;
  playerMark: Mark | null;
  playerNames: Record<Mark, string | null>;
  status: GameStatus;
  currentMark: Mark;
  winningLine: number[];
  scores: Record<Mark, number>;
  round: number;
  rematchReady: Record<Mark, boolean>;
  undoRemaining: Record<Mark, number>;
  wagerAmount: number;
  stakeLocked: Record<Mark, boolean>;
  wagerSettledAt: string | null;
  finishReason: FinishReason;
  lastSeenAt: Record<Mark, string | null>;
  opponentOnline: boolean;
  version: number;
}

export interface EconomySnapshot {
  balance: number;
  isAdmin: boolean;
  loaded: boolean;
}

export interface RoomPreview {
  gameType: GameType;
  hostName: string;
  wagerAmount: number;
  status: 'waiting';
}

export interface RedeemCodeSummary {
  id: string;
  codeHint: string;
  amount: number;
  maxClaims: number;
  claimCount: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}
