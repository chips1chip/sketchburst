export type GamePhase =
  | "LOBBY"
  | "CHOOSING_WORD"
  | "DRAWING"
  | "ROUND_RESULTS"
  | "GAME_RESULTS";

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isDrawing: boolean;
}

export interface RoomSettings {
  maxPlayers: number;
  roundTimeSeconds: number;
  totalRounds: number;
  isPrivate: boolean;
}

export type RoomPhase =
  | "LOBBY"
  | "DRAWING"
  | "FINISHED";

export type Room = {
  id: string;
  code: string;
  hostId: string;
  players: Player[];
  settings: RoomSettings;
  phase: RoomPhase;
  currentRound: number;
};
export interface Guess {
  playerId: string;
  text: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}