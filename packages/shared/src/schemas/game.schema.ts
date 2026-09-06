import { z } from "zod";
import { GAME_CONSTANTS } from "../constants/game.js";

export const playerNameSchema = z
  .string()
  .trim()
  .min(GAME_CONSTANTS.MIN_PLAYER_NAME_LENGTH)
  .max(GAME_CONSTANTS.MAX_PLAYER_NAME_LENGTH);

export const roomCodeSchema = z
  .string()
  .trim()
  .length(GAME_CONSTANTS.ROOM_CODE_LENGTH)
  .regex(/^[A-Z0-9]+$/);

export const roomSettingsSchema = z.object({
  maxPlayers: z
    .number()
    .int()
    .min(GAME_CONSTANTS.MIN_PLAYERS)
    .max(GAME_CONSTANTS.MAX_PLAYERS),

  roundTimeSeconds: z
    .number()
    .int()
    .min(GAME_CONSTANTS.MIN_ROUND_TIME_SECONDS)
    .max(GAME_CONSTANTS.MAX_ROUND_TIME_SECONDS),

  totalRounds: z
    .number()
    .int()
    .min(1)
    .max(GAME_CONSTANTS.MAX_ROUNDS),

  isPrivate: z.boolean(),
});

export const createRoomSchema = z.object({
  playerName: playerNameSchema,
  settings: roomSettingsSchema,
});

export const joinRoomSchema = z.object({
  roomCode: roomCodeSchema,
  playerName: playerNameSchema,
});