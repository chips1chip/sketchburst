import type { Server, Socket } from "socket.io";
import {
  createRoomSchema,
  joinRoomSchema,
  type Player,
  type Room,
} from "@sketchburst/shared";
import { RoomService } from "../rooms/room.service.js";

interface SocketRoomData {
  roomCode?: string;
  playerId?: string;
}

interface CreateRoomResponse {
  success: boolean;
  room?: Room;
  playerId?: string;
  error?: string;
}

interface JoinRoomResponse {
  success: boolean;
  room?: Room;
  playerId?: string;
  error?: string;
}

interface StartGameResponse {
  success: boolean;
  error?: string;
}

interface LeaveRoomResponse {
  success: boolean;
  error?: string;
}

interface UpdateRoomSettingsResponse {
  success: boolean;
  room?: Room;
  error?: string;
}

interface DrawStrokePayload {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
  erase: boolean;
}

interface ChooseWordPayload {
  word: string;
}

interface GuessPayload {
  guess: string;
}

interface ActiveRound {
  drawerId: string;
  options: string[];
  word: string | null;
  guessedPlayerIds: Set<string>;
  startedAt: number | null;
  timer: ReturnType<typeof setInterval> | null;
  endTimeout: ReturnType<typeof setTimeout> | null;
}

const WORD_BANK = [
  "cat",
  "dog",
  "pizza",
  "rocket",
  "rainbow",
  "ice cream",
  "castle",
  "banana",
  "dinosaur",
  "sunflower",
  "guitar",
  "football",
  "butterfly",
  "laptop",
  "camera",
  "airplane",
  "hamburger",
  "wizard",
  "unicorn",
  "robot",
  "tree",
  "moon",
  "star",
  "cake",
  "car",
  "house",
  "ghost",
  "dragon",
  "crown",
  "pencil",
  "school",
  "beach",
  "mountain",
  "snowman",
  "mermaid",
];

const activeRounds = new Map<string, ActiveRound>();

const NEXT_ROUND_DELAY_MS = 2500;

/**
 * Safely call a Socket.IO acknowledgement callback.
 *
 * This prevents the server from crashing if the final argument
 * received from the client is not actually a function.
 */
function sendCallback<T>(
  callback: unknown,
  response: T,
): void {
  if (typeof callback === "function") {
    callback(response);
  }
}

function chooseRandomWords(count: number): string[] {
  const shuffled = [...WORD_BANK].sort(
    () => Math.random() - 0.5,
  );

  return shuffled.slice(0, count);
}

function normalizeWord(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function clearRoundTimers(round: ActiveRound): void {
  if (round.timer) {
    clearInterval(round.timer);
    round.timer = null;
  }

  if (round.endTimeout) {
    clearTimeout(round.endTimeout);
    round.endTimeout = null;
  }
}

async function emitRoundStart(
  io: Server,
  room: Room,
  round: ActiveRound,
): Promise<void> {
  const sockets = await io
    .in(room.code)
    .fetchSockets();

  for (const client of sockets) {
    const playerId = (
      client.data as SocketRoomData
    ).playerId;

    if (playerId === round.drawerId) {
      client.emit("round-started", {
        currentRound: room.currentRound,
        drawerId: round.drawerId,
        isDrawer: true,
        wordOptions: round.options,
        wordLength: 0,
      });
    } else {
      client.emit("round-started", {
        currentRound: room.currentRound,
        drawerId: round.drawerId,
        isDrawer: false,
        wordLength: 0,
        wordOptions: [],
      });
    }
  }
}

async function beginRound(
  io: Server,
  room: Room,
): Promise<void> {
  const previousRound = activeRounds.get(
    room.code,
  );

  if (previousRound) {
    clearRoundTimers(previousRound);
  }

  const players = room.players;

  if (players.length === 0) {
    room.phase = "FINISHED";

    io.to(room.code).emit(
      "room-updated",
      room,
    );

    return;
  }

  const drawerIndex =
    (room.currentRound - 1) %
    players.length;

  const drawer = players[drawerIndex];

  room.players = players.map((player) => ({
    ...player,
    isDrawing:
      player.id === drawer.id,
  }));

  room.phase = "DRAWING";

  const round: ActiveRound = {
    drawerId: drawer.id,
    options: chooseRandomWords(3),
    word: null,
    guessedPlayerIds:
      new Set<string>(),
    startedAt: null,
    timer: null,
    endTimeout: null,
  };

  activeRounds.set(
    room.code,
    round,
  );

  io.to(room.code).emit(
    "room-updated",
    room,
  );

  await emitRoundStart(
    io,
    room,
    round,
  );
}

function scheduleRoundEnd(
  io: Server,
  room: Room,
): void {
  const round = activeRounds.get(
    room.code,
  );

  if (
    !round ||
    round.startedAt === null
  ) {
    return;
  }

  const elapsedSeconds = Math.floor(
    (Date.now() - round.startedAt) /
      1000,
  );

  const remaining = Math.max(
    0,
    room.settings.roundTimeSeconds -
      elapsedSeconds,
  );

  io.to(room.code).emit(
    "round-timer",
    {
      seconds: remaining,
    },
  );

  if (remaining <= 0) {
    endRound(io, room);
  }
}

function beginTimedRound(
  io: Server,
  room: Room,
  round: ActiveRound,
): void {
  if (round.timer) {
    clearInterval(round.timer);
    round.timer = null;
  }

  round.startedAt = Date.now();

  io.to(room.code).emit(
    "round-begun",
    {
      seconds:
        room.settings.roundTimeSeconds,
      drawerId: round.drawerId,
      wordLength:
        round.word?.length ?? 0,
    },
  );

  io.to(room.code).emit(
    "canvas-cleared",
  );

  round.timer = setInterval(() => {
    scheduleRoundEnd(
      io,
      room,
    );
  }, 1000);
}

function endRound(
  io: Server,
  room: Room,
): void {
  const round = activeRounds.get(
    room.code,
  );

  if (!round) {
    return;
  }

  if (round.endTimeout) {
    return;
  }

  clearRoundTimers(round);

  const revealedWord =
    round.word ??
    "No word selected.";

  io.to(room.code).emit(
    "round-ended",
    {
      word: revealedWord,
    },
  );

  if (
    room.currentRound >=
    room.settings.totalRounds
  ) {
    room.phase = "FINISHED";

    io.to(room.code).emit(
      "room-updated",
      room,
    );

    io.to(room.code).emit(
      "game-finished",
      {
        players: room.players,
      },
    );

    activeRounds.delete(
      room.code,
    );

    return;
  }

  round.endTimeout =
    setTimeout(() => {
      room.currentRound += 1;

      void beginRound(
        io,
        room,
      );
    }, NEXT_ROUND_DELAY_MS);
}

export function registerRoomSocketHandlers(
  io: Server,
  socket: Socket,
  roomService: RoomService,
): void {
  const socketData =
    socket.data as SocketRoomData;

  /*
   * -------------------------------------------------------
   * CREATE ROOM
   * -------------------------------------------------------
   */

  socket.on(
    "create-room",
    (
      payload: unknown,
      callback?: unknown,
    ) => {
      const result =
        createRoomSchema.safeParse(
          payload,
        );

      if (!result.success) {
        console.error(
          "Create room validation failed:",
          result.error.issues,
        );

        sendCallback(
          callback,
          {
            success: false,
            error:
              result.error.issues
                .map(
                  (issue) =>
                    `${issue.path.join(".")}: ${issue.message}`,
                )
                .join(", "),
          },
        );

        return;
      }

      try {
        const { room, player } =
          roomService.createRoom(
            result.data.playerName,
            result.data.settings,
          );

        socketData.roomCode =
          room.code;

        socketData.playerId =
          player.id;

        socket.join(room.code);

        sendCallback(
          callback,
          {
            success: true,
            room,
            playerId:
              player.id,
          } satisfies CreateRoomResponse,
        );

        socket.emit(
          "room-created",
          {
            room,
            playerId:
              player.id,
          },
        );
      } catch (error) {
        sendCallback(
          callback,
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to create room.",
          } satisfies CreateRoomResponse,
        );
      }
    },
  );

  /*
   * -------------------------------------------------------
   * JOIN ROOM
   * -------------------------------------------------------
   */

  socket.on(
    "join-room",
    (
      payload: unknown,
      callback?: unknown,
    ) => {
      const result =
        joinRoomSchema.safeParse(
          payload,
        );

      if (!result.success) {
        sendCallback(
          callback,
          {
            success: false,
            error:
              result.error.issues
                .map(
                  (issue) =>
                    `${issue.path.join(".")}: ${issue.message}`,
                )
                .join(", "),
          } satisfies JoinRoomResponse,
        );

        return;
      }

      try {
        const { room, player } =
          roomService.joinRoom(
            result.data.roomCode,
            result.data.playerName,
          );

        socketData.roomCode =
          room.code;

        socketData.playerId =
          player.id;

        socket.join(room.code);

        sendCallback(
          callback,
          {
            success: true,
            room,
            playerId:
              player.id,
          } satisfies JoinRoomResponse,
        );

        io.to(room.code).emit(
          "room-updated",
          room,
        );

        io.to(room.code).emit(
          "player-joined",
          player,
        );
      } catch (error) {
        sendCallback(
          callback,
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to join room.",
          } satisfies JoinRoomResponse,
        );
      }
    },
  );

  /*
   * -------------------------------------------------------
   * UPDATE ROOM SETTINGS
   * -------------------------------------------------------
   */

  socket.on(
    "update-room-settings",
    (
      payload: unknown,
      callback?: unknown,
    ) => {
      const respond = (
        response: UpdateRoomSettingsResponse,
      ) => {
        sendCallback(
          callback,
          response,
        );
      };

      if (
        typeof payload !== "object" ||
        payload === null
      ) {
        respond({
          success: false,
          error:
            "Invalid room settings data.",
        });

        return;
      }

      const data = payload as {
        roomCode?: unknown;
        playerId?: unknown;
        settings?: unknown;
      };

      if (
        typeof data.roomCode !==
          "string" ||
        typeof data.playerId !==
          "string" ||
        typeof data.settings !==
          "object" ||
        data.settings === null
      ) {
        respond({
          success: false,
          error:
            "Invalid room or player data.",
        });

        return;
      }

      const settings =
        data.settings as {
          maxPlayers?: unknown;
          totalRounds?: unknown;
          roundTimeSeconds?: unknown;
          isPrivate?: unknown;
        };

      if (
        typeof settings.maxPlayers !==
          "number" ||
        typeof settings.totalRounds !==
          "number" ||
        typeof settings.roundTimeSeconds !==
          "number" ||
        typeof settings.isPrivate !==
          "boolean"
      ) {
        respond({
          success: false,
          error:
            "Invalid settings values.",
        });

        return;
      }

      const roomCode =
        data.roomCode
          .trim()
          .toUpperCase();

      const playerId =
        data.playerId;

      const room =
        roomService.getRoom(
          roomCode,
        );

      if (!room) {
        respond({
          success: false,
          error:
            "Room no longer exists.",
        });

        return;
      }

      /*
       * Make sure the socket itself belongs to
       * the player claiming to change settings.
       */
      if (
        socketData.roomCode !== roomCode ||
        socketData.playerId !== playerId
      ) {
        respond({
          success: false,
          error:
            "You are not authorized to update this room.",
        });

        return;
      }

      /*
       * Only the host may change settings.
       */
      if (
        room.hostId !== playerId
      ) {
        respond({
          success: false,
          error:
            "Only the host can change room settings.",
        });

        return;
      }

      /*
       * Settings can only be changed before
       * the game starts.
       */
      if (
        room.phase !== "LOBBY"
      ) {
        respond({
          success: false,
          error:
            "Room settings can only be changed in the lobby.",
        });

        return;
      }

      /*
       * Validate allowed values.
       */
      const allowedMaxPlayers = [
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        10,
        12,
      ];

      const allowedTotalRounds = [
        1,
        2,
        3,
        4,
        5,
        6,
        8,
        10,
      ];

      const allowedRoundTimes = [
        30,
        45,
        60,
        90,
        120,
      ];

      if (
        !allowedMaxPlayers.includes(
          settings.maxPlayers,
        )
      ) {
        respond({
          success: false,
          error:
            "Invalid maximum player setting.",
        });

        return;
      }

      if (
        !allowedTotalRounds.includes(
          settings.totalRounds,
        )
      ) {
        respond({
          success: false,
          error:
            "Invalid total rounds setting.",
        });

        return;
      }

      if (
        !allowedRoundTimes.includes(
          settings.roundTimeSeconds,
        )
      ) {
        respond({
          success: false,
          error:
            "Invalid round time setting.",
        });

        return;
      }

      /*
       * Don't let the host reduce the room size
       * below the number of players already inside.
       */
      if (
        settings.maxPlayers <
        room.players.length
      ) {
        respond({
          success: false,
          error:
            `Maximum players cannot be lower than the current player count (${room.players.length}).`,
        });

        return;
      }

      room.settings = {
        maxPlayers:
          settings.maxPlayers,
        totalRounds:
          settings.totalRounds,
        roundTimeSeconds:
          settings.roundTimeSeconds,
        isPrivate:
          settings.isPrivate,
      };

      /*
       * Send the updated room to everyone
       * currently inside the lobby.
       */
      io.to(room.code).emit(
        "room-updated",
        room,
      );

      respond({
        success: true,
        room,
      });
    },
  );

  /*
   * -------------------------------------------------------
   * START GAME
   * -------------------------------------------------------
   */

  socket.on(
    "start-game",
    (
      payload: unknown,
      callback?: unknown,
    ) => {
      const respond = (
        response: StartGameResponse,
      ) => {
        sendCallback(
          callback,
          response,
        );
      };

      if (
        typeof payload !==
          "object" ||
        payload === null ||
        !(
          "roomCode" in
          payload
        ) ||
        !(
          "playerId" in
          payload
        )
      ) {
        respond({
          success: false,
          error:
            "Invalid start-game data.",
        });

        return;
      }

      const {
        roomCode,
        playerId,
      } = payload as {
        roomCode: unknown;
        playerId: unknown;
      };

      if (
        typeof roomCode !==
          "string" ||
        typeof playerId !==
          "string"
      ) {
        respond({
          success: false,
          error:
            "Invalid room or player data.",
        });

        return;
      }

      const normalizedRoomCode =
        roomCode
          .trim()
          .toUpperCase();

      const room =
        roomService.getRoom(
          normalizedRoomCode,
        );

      if (!room) {
        respond({
          success: false,
          error:
            "Room no longer exists.",
        });

        return;
      }

      if (
        socketData.roomCode !==
          normalizedRoomCode ||
        socketData.playerId !==
          playerId
      ) {
        respond({
          success: false,
          error:
            "You are not authorized to start this game.",
        });

        return;
      }

      const player =
        room.players.find(
          (currentPlayer) =>
            currentPlayer.id ===
            playerId,
        );

      if (!player) {
        respond({
          success: false,
          error:
            "Player is not part of this room.",
        });

        return;
      }

      if (
        room.hostId !==
        playerId
      ) {
        respond({
          success: false,
          error:
            "Only the host can start the game.",
        });

        return;
      }

      if (
        room.players.length < 2
      ) {
        respond({
          success: false,
          error:
            "At least 2 players are required to start the game.",
        });

        return;
      }

      if (
        room.phase !==
        "LOBBY"
      ) {
        respond({
          success: false,
          error:
            "The game has already started.",
        });

        return;
      }

      room.currentRound = 1;
      room.phase = "DRAWING";

      respond({
        success: true,
      });

      void beginRound(
        io,
        room,
      );
    },
  );

  /*
   * -------------------------------------------------------
   * CHOOSE WORD
   * -------------------------------------------------------
   */

  socket.on(
    "choose-word",
    (
      payload: unknown,
    ) => {
      const roomCode =
        socketData.roomCode;

      const playerId =
        socketData.playerId;

      if (
        !roomCode ||
        !playerId
      ) {
        return;
      }

      const room =
        roomService.getRoom(
          roomCode,
        );

      const round =
        activeRounds.get(
          roomCode,
        );

      if (
        !room ||
        !round
      ) {
        return;
      }

      if (
        round.drawerId !==
        playerId
      ) {
        return;
      }

      if (
        typeof payload !==
          "object" ||
        payload === null ||
        !("word" in payload) ||
        typeof payload.word !==
          "string"
      ) {
        return;
      }

      const choosePayload =
        payload as ChooseWordPayload;

      const selectedWord =
        choosePayload.word.trim();

      if (
        !round.options.includes(
          selectedWord,
        )
      ) {
        return;
      }

      if (
        round.word !== null
      ) {
        return;
      }

      round.word =
        selectedWord;

      socket.emit(
        "word-chosen",
        {
          word: round.word,
        },
      );

      io.to(roomCode).emit(
        "drawer-selected",
        {
          drawerId:
            round.drawerId,
        },
      );

      beginTimedRound(
        io,
        room,
        round,
      );
    },
  );

  /*
   * -------------------------------------------------------
   * DRAW STROKE
   * -------------------------------------------------------
   */

  socket.on(
    "draw-stroke",
    (
      payload: unknown,
    ) => {
      const roomCode =
        socketData.roomCode;

      const playerId =
        socketData.playerId;

      if (
        !roomCode ||
        !playerId
      ) {
        return;
      }

      const round =
        activeRounds.get(
          roomCode,
        );

      if (
        !round ||
        round.drawerId !==
          playerId
      ) {
        return;
      }

      if (
        typeof payload !==
          "object" ||
        payload === null
      ) {
        return;
      }

      const stroke =
        payload as Partial<DrawStrokePayload>;

      if (
        typeof stroke.x1 !==
          "number" ||
        typeof stroke.y1 !==
          "number" ||
        typeof stroke.x2 !==
          "number" ||
        typeof stroke.y2 !==
          "number" ||
        typeof stroke.color !==
          "string" ||
        typeof stroke.size !==
          "number" ||
        typeof stroke.erase !==
          "boolean"
      ) {
        return;
      }

      if (
        stroke.x1 < 0 ||
        stroke.x1 > 1 ||
        stroke.y1 < 0 ||
        stroke.y1 > 1 ||
        stroke.x2 < 0 ||
        stroke.x2 > 1 ||
        stroke.y2 < 0 ||
        stroke.y2 > 1
      ) {
        return;
      }

      socket
        .to(roomCode)
        .emit(
          "draw-stroke",
          {
            x1: stroke.x1,
            y1: stroke.y1,
            x2: stroke.x2,
            y2: stroke.y2,
            color: stroke.color,
            size: Math.max(
              1,
              Math.min(
                50,
                stroke.size,
              ),
            ),
            erase:
              stroke.erase,
          },
        );
    },
  );

  /*
   * -------------------------------------------------------
   * CLEAR CANVAS
   * -------------------------------------------------------
   */

  socket.on(
    "clear-canvas",
    () => {
      const roomCode =
        socketData.roomCode;

      const playerId =
        socketData.playerId;

      if (
        !roomCode ||
        !playerId
      ) {
        return;
      }

      const round =
        activeRounds.get(
          roomCode,
        );

      if (
        !round ||
        round.drawerId !==
          playerId
      ) {
        return;
      }

      io.to(roomCode).emit(
        "canvas-cleared",
      );
    },
  );

  /*
   * -------------------------------------------------------
   * SUBMIT GUESS
   * -------------------------------------------------------
   */

  socket.on(
    "submit-guess",
    (
      payload: unknown,
      callback?: unknown,
    ) => {
      const respond = (
        response: {
          success: boolean;
          correct?: boolean;
          error?: string;
        },
      ) => {
        sendCallback(
          callback,
          response,
        );
      };

      const roomCode =
        socketData.roomCode;

      const playerId =
        socketData.playerId;

      if (
        !roomCode ||
        !playerId
      ) {
        respond({
          success: false,
          error:
            "You are not currently in a room.",
        });

        return;
      }

      const room =
        roomService.getRoom(
          roomCode,
        );

      const round =
        activeRounds.get(
          roomCode,
        );

      if (
        !room ||
        !round ||
        !round.word
      ) {
        respond({
          success: false,
          error:
            "The round is not ready yet.",
        });

        return;
      }

      if (
        playerId ===
        round.drawerId
      ) {
        respond({
          success: false,
          error:
            "The drawer cannot submit guesses.",
        });

        return;
      }

      if (
        round.guessedPlayerIds.has(
          playerId,
        )
      ) {
        respond({
          success: false,
          error:
            "You already guessed the word.",
        });

        return;
      }

      if (
        typeof payload !==
          "object" ||
        payload === null ||
        !("guess" in payload) ||
        typeof payload.guess !==
          "string"
      ) {
        respond({
          success: false,
          error:
            "Invalid guess.",
        });

        return;
      }

      const guessPayload =
        payload as GuessPayload;

      const guess =
        guessPayload.guess
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 50);

      if (!guess) {
        respond({
          success: false,
          error:
            "Enter a guess first.",
        });

        return;
      }

      const guesser =
        room.players.find(
          (player) =>
            player.id ===
            playerId,
        );

      if (!guesser) {
        respond({
          success: false,
          error:
            "Player not found.",
        });

        return;
      }

      const correct =
        normalizeWord(
          guess,
        ) ===
        normalizeWord(
          round.word,
        );

      io.to(roomCode).emit(
        "chat-message",
        {
          playerId,
          playerName:
            guesser.name,
          message: guess,
          correct,
        },
      );

      if (!correct) {
        respond({
          success: true,
          correct: false,
        });

        return;
      }

      round.guessedPlayerIds.add(
        playerId,
      );

      const elapsedSeconds =
        round.startedAt
          ? Math.floor(
              (Date.now() -
                round.startedAt) /
                1000,
            )
          : room.settings
                .roundTimeSeconds;

      const remainingSeconds =
        Math.max(
          0,
          room.settings
            .roundTimeSeconds -
            elapsedSeconds,
        );

      const points =
        100 +
        remainingSeconds * 5;

      const updatedPlayer: Player =
        {
          ...guesser,
          score:
            guesser.score +
            points,
        };

      room.players =
        room.players.map(
          (player) =>
            player.id ===
            playerId
              ? updatedPlayer
              : player,
        );

      io.to(roomCode).emit(
        "guess-correct",
        {
          playerId,
          playerName:
            guesser.name,
          points,
          score:
            updatedPlayer.score,
        },
      );

      io.to(roomCode).emit(
        "room-updated",
        room,
      );

      respond({
        success: true,
        correct: true,
      });

      const guesserCount =
        room.players.length - 1;

      if (
        guesserCount > 0 &&
        round.guessedPlayerIds
          .size >=
          guesserCount
      ) {
        endRound(
          io,
          room,
        );
      }
    },
  );

  /*
   * -------------------------------------------------------
   * LEAVE ROOM
   * -------------------------------------------------------
   */

  socket.on(
    "leave-room",
    (
      callback?: unknown,
    ) => {
      const respond = (
        response: LeaveRoomResponse,
      ) => {
        sendCallback(
          callback,
          response,
        );
      };

      const roomCode =
        socketData.roomCode;

      const playerId =
        socketData.playerId;

      if (
        !roomCode ||
        !playerId
      ) {
        respond({
          success: false,
          error:
            "You are not currently in a room.",
        });

        return;
      }

      const roomBeforeLeaving =
        roomService.getRoom(
          roomCode,
        );

      const leavingPlayer =
        roomBeforeLeaving?.players.find(
          (player) =>
            player.id ===
            playerId,
        );

      const room =
        roomService.removePlayer(
          roomCode,
          playerId,
        );

      socket.leave(
        roomCode,
      );

      delete socketData.roomCode;
      delete socketData.playerId;

      if (room) {
        io.to(roomCode).emit(
          "room-updated",
          room,
        );

        if (leavingPlayer) {
          io.to(roomCode).emit(
            "player-left",
            {
              playerId,
              playerName:
                leavingPlayer.name,
            },
          );
        }
      } else {
        const round =
          activeRounds.get(
            roomCode,
          );

        if (round) {
          clearRoundTimers(
            round,
          );

          activeRounds.delete(
            roomCode,
          );
        }

        io.to(roomCode).emit(
          "room-closed",
        );
      }

      respond({
        success: true,
      });
    },
  );

  /*
   * -------------------------------------------------------
   * GET ROOM
   * -------------------------------------------------------
   */

  socket.on(
    "get-room",
    () => {
      const roomCode =
        socketData.roomCode;

      if (!roomCode) {
        socket.emit(
          "room-error",
          {
            message:
              "You are not currently in a room.",
          },
        );

        return;
      }

      const room =
        roomService.getRoom(
          roomCode,
        );

      if (!room) {
        socket.emit(
          "room-error",
          {
            message:
              "Room no longer exists.",
          },
        );

        return;
      }

      socket.emit(
        "room-updated",
        room,
      );
    },
  );
}