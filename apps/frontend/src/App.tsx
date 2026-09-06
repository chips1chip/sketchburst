import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { io, Socket } from "socket.io-client";

type Player = {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isDrawing: boolean;
};

type RoomSettings = {
  maxPlayers: number;
  roundTimeSeconds: number;
  totalRounds: number;
  isPrivate: boolean;
};

type Room = {
  id: string;
  code: string;
  hostId: string;
  players: Player[];
  settings: RoomSettings;
  phase: string;
  currentRound: number;
};

type CreateRoomResponse = {
  success: boolean;
  room?: Room;
  playerId?: string;
  error?: string;
};

type JoinRoomResponse = {
  success: boolean;
  room?: Room;
  playerId?: string;
  error?: string;
};

type StartGameResponse = {
  success: boolean;
  error?: string;
};

type LeaveRoomResponse = {
  success: boolean;
  error?: string;
};

type DrawStroke = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
  erase: boolean;
};

type ChatMessage = {
  playerId: string;
  playerName: string;
  message: string;
  correct: boolean;
};

type RoundStartedData = {
  currentRound: number;
  drawerId: string;
  isDrawer: boolean;
  wordOptions?: string[];
  wordLength?: number;
};

type RoundBegunData = {
  seconds: number;
  drawerId: string;
  wordLength: number;
};

const socket: Socket = io("http://localhost:3000", {
  autoConnect: true,
});

const COLORS = [
  "#1f2937",
  "#ef476f",
  "#ff7b00",
  "#facc15",
  "#22c55e",
  "#0ea5e9",
  "#7c3aed",
  "#ec4899",
  "#ffffff",
];

const BRUSH_SIZES = [
  {
    label: "S",
    value: 4,
  },
  {
    label: "M",
    value: 8,
  },
  {
    label: "L",
    value: 14,
  },
  {
    label: "XL",
    value: 22,
  },
];

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value));
}

function App() {
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(
    socket.connected,
  );

  const [settings, setSettings] = useState<RoomSettings>({
    maxPlayers: 8,
    roundTimeSeconds: 60,
    totalRounds: 3,
    isPrivate: false,
  });

  const [settingsSaving, setSettingsSaving] = useState(false);

  const [isDrawer, setIsDrawer] = useState(false);
  const [wordOptions, setWordOptions] = useState<string[]>(
    [],
  );
  const [secretWord, setSecretWord] = useState<
    string | null
  >(null);
  const [wordLength, setWordLength] = useState(0);

  const [timer, setTimer] = useState(0);
  const [roundMessage, setRoundMessage] = useState(
    "Waiting for the drawer...",
  );
  const [revealedWord, setRevealedWord] = useState<
    string | null
  >(null);

  const [messages, setMessages] = useState<ChatMessage[]>(
    [],
  );
  const [guess, setGuess] = useState("");

  const [brushColor, setBrushColor] =
    useState("#7c3aed");

  const [brushSize, setBrushSize] = useState(8);
  const [eraser, setEraser] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(
    null,
  );

  const drawingRef = useRef(false);

  const lastPointRef = useRef<{
    x: number;
    y: number;
  } | null>(null);

  /*
   * -------------------------------------------------------
   * CANVAS HELPERS
   * -------------------------------------------------------
   */

  const redrawCanvasBackground = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#ffffff";
    context.fillRect(
      0,
      0,
      rect.width,
      rect.height,
    );
    context.restore();
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const devicePixelRatio =
      window.devicePixelRatio || 1;

    const previous = document.createElement("canvas");

    previous.width = canvas.width;
    previous.height = canvas.height;

    const previousContext =
      previous.getContext("2d");

    if (previousContext) {
      previousContext.drawImage(
        canvas,
        0,
        0,
      );
    }

    canvas.width = Math.max(
      1,
      Math.floor(
        rect.width * devicePixelRatio,
      ),
    );

    canvas.height = Math.max(
      1,
      Math.floor(
        rect.height * devicePixelRatio,
      ),
    );

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.setTransform(
      devicePixelRatio,
      0,
      0,
      devicePixelRatio,
      0,
      0,
    );

    context.fillStyle = "#ffffff";
    context.fillRect(
      0,
      0,
      rect.width,
      rect.height,
    );

    if (
      previous.width > 0 &&
      previous.height > 0
    ) {
      context.drawImage(
        previous,
        0,
        0,
        previous.width,
        previous.height,
        0,
        0,
        rect.width,
        rect.height,
      );
    }
  }, []);

  const drawSegment = useCallback(
    (
      stroke: DrawStroke,
    ) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      const rect = canvas.getBoundingClientRect();

      if (
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return;
      }

      const x1 = stroke.x1 * rect.width;
      const y1 = stroke.y1 * rect.height;
      const x2 = stroke.x2 * rect.width;
      const y2 = stroke.y2 * rect.height;

      context.save();

      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = stroke.size;

      if (stroke.erase) {
        context.globalCompositeOperation =
          "destination-out";
      } else {
        context.globalCompositeOperation =
          "source-over";
      }

      context.strokeStyle = stroke.erase
        ? "#ffffff"
        : stroke.color;

      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();

      context.restore();
    },
    [],
  );

  /*
   * -------------------------------------------------------
   * SOCKET EVENT LISTENERS
   * -------------------------------------------------------
   */

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setError("");
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    const handleConnectError = () => {
      setConnected(false);
      setError(
        "Unable to connect to the game server.",
      );
    };

    const handleRoomUpdated = (
      updatedRoom: Room,
    ) => {
      setRoom(updatedRoom);
    };

    const handleGameStarted = (
      startedRoom: Room,
    ) => {
      setRoom(startedRoom);
      setError("");
    };

    const handleRoomClosed = () => {
      setRoom(null);
      setPlayerId(null);
      setError("The room was closed.");
    };

    const handleRoomError = (data: {
      message?: string;
    }) => {
      setError(
        data.message ??
          "A room error occurred.",
      );
    };

    const handleRoundStarted = (
      data: RoundStartedData,
    ) => {
      setIsDrawer(data.isDrawer);
      setWordOptions(data.wordOptions ?? []);
      setSecretWord(null);
      setRevealedWord(null);
      setWordLength(data.wordLength ?? 0);
      setTimer(0);
      setMessages([]);
      setGuess("");

      if (data.isDrawer) {
        setRoundMessage(
          "Pick a word and start drawing!",
        );
      } else {
        setRoundMessage(
          "Get ready to guess!",
        );
      }

      window.setTimeout(() => {
        redrawCanvasBackground();
      }, 0);
    };

    const handleWordChosen = (data: {
      word: string;
    }) => {
      setSecretWord(data.word);
      setWordOptions([]);
      setRoundMessage(
        "Draw it! Your friends are guessing.",
      );
    };

    const handleRoundBegun = (
      data: RoundBegunData,
    ) => {
      setTimer(data.seconds);
      setWordLength(data.wordLength);

      if (playerId === data.drawerId) {
        setRoundMessage(
          "Draw quickly! Everyone is guessing!",
        );
      } else {
        setRoundMessage(
          "Look closely and guess the word!",
        );
      }

      redrawCanvasBackground();
    };

    const handleRoundTimer = (data: {
      seconds: number;
    }) => {
      setTimer(data.seconds);
    };

    const handleRoundEnded = (data: {
      word: string;
    }) => {
      setRevealedWord(data.word);
      setRoundMessage(
        `The word was "${data.word}"!`,
      );
      setTimer(0);
      setSecretWord(null);
      setWordOptions([]);
    };

    const handleGameFinished = (data: {
      players: Player[];
    }) => {
      setRoom((currentRoom) => {
        if (!currentRoom) {
          return currentRoom;
        }

        return {
          ...currentRoom,
          phase: "FINISHED",
          players: data.players,
        };
      });
    };

    const handleDrawStroke = (
      stroke: DrawStroke,
    ) => {
      drawSegment(stroke);
    };

    const handleCanvasCleared = () => {
      redrawCanvasBackground();
    };

    const handleChatMessage = (
      data: ChatMessage,
    ) => {
      setMessages((currentMessages) => [
        ...currentMessages,
        data,
      ]);
    };

    const handleGuessCorrect = (data: {
      playerName: string;
      points: number;
      score: number;
    }) => {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          playerId: "",
          playerName: "SYSTEM",
          message: `${data.playerName} got it! +${data.points} points`,
          correct: true,
        },
      ]);
    };

    socket.on(
      "connect",
      handleConnect,
    );

    socket.on(
      "disconnect",
      handleDisconnect,
    );

    socket.on(
      "connect_error",
      handleConnectError,
    );

    socket.on(
      "room-updated",
      handleRoomUpdated,
    );

    socket.on(
      "game-started",
      handleGameStarted,
    );

    socket.on(
      "room-closed",
      handleRoomClosed,
    );

    socket.on(
      "room-error",
      handleRoomError,
    );

    socket.on(
      "round-started",
      handleRoundStarted,
    );

    socket.on(
      "word-chosen",
      handleWordChosen,
    );

    socket.on(
      "round-begun",
      handleRoundBegun,
    );

    socket.on(
      "round-timer",
      handleRoundTimer,
    );

    socket.on(
      "round-ended",
      handleRoundEnded,
    );

    socket.on(
      "game-finished",
      handleGameFinished,
    );

    socket.on(
      "draw-stroke",
      handleDrawStroke,
    );

    socket.on(
      "canvas-cleared",
      handleCanvasCleared,
    );

    socket.on(
      "chat-message",
      handleChatMessage,
    );

    socket.on(
      "guess-correct",
      handleGuessCorrect,
    );

    return () => {
      socket.off(
        "connect",
        handleConnect,
      );

      socket.off(
        "disconnect",
        handleDisconnect,
      );

      socket.off(
        "connect_error",
        handleConnectError,
      );

      socket.off(
        "room-updated",
        handleRoomUpdated,
      );

      socket.off(
        "game-started",
        handleGameStarted,
      );

      socket.off(
        "room-closed",
        handleRoomClosed,
      );

      socket.off(
        "room-error",
        handleRoomError,
      );

      socket.off(
        "round-started",
        handleRoundStarted,
      );

      socket.off(
        "word-chosen",
        handleWordChosen,
      );

      socket.off(
        "round-begun",
        handleRoundBegun,
      );

      socket.off(
        "round-timer",
        handleRoundTimer,
      );

      socket.off(
        "round-ended",
        handleRoundEnded,
      );

      socket.off(
        "game-finished",
        handleGameFinished,
      );

      socket.off(
        "draw-stroke",
        handleDrawStroke,
      );

      socket.off(
        "canvas-cleared",
        handleCanvasCleared,
      );

      socket.off(
        "chat-message",
        handleChatMessage,
      );

      socket.off(
        "guess-correct",
        handleGuessCorrect,
      );
    };
  }, [
    drawSegment,
    playerId,
    redrawCanvasBackground,
  ]);

  /*
   * Keep the canvas responsive.
   */

  useEffect(() => {
    if (
      !room ||
      room.phase === "LOBBY" ||
      room.phase === "FINISHED"
    ) {
      return;
    }

    const timerId = window.setTimeout(() => {
      resizeCanvas();
    }, 0);

    const handleResize = () => {
      resizeCanvas();
    };

    window.addEventListener(
      "resize",
      handleResize,
    );

    return () => {
      window.clearTimeout(timerId);

      window.removeEventListener(
        "resize",
        handleResize,
      );
    };
  }, [
    room?.phase,
    resizeCanvas,
  ]);

  useEffect(() => {
    if (room) {
      setSettings(room.settings);
    }
  }, [room]);

  /*
   * -------------------------------------------------------
   * ROOM ACTIONS
   * -------------------------------------------------------
   */

  const createRoom = () => {
    const name = playerName.trim();

    if (!name) {
      setError("Enter your name first.");
      return;
    }

    if (!socket.connected) {
      setError(
        "Not connected to the game server.",
      );
      return;
    }

    setError("");
    setLoading(true);

    socket.emit(
      "create-room",
      {
        playerName: name,
        settings: {
          maxPlayers: 8,
          totalRounds: 3,
          roundTimeSeconds: 60,
          isPrivate: false,
        },
      },
      (
        response: CreateRoomResponse,
      ) => {
        setLoading(false);

        if (
          !response.success ||
          !response.room ||
          !response.playerId
        ) {
          setError(
            response.error ??
              "Failed to create room.",
          );
          return;
        }

        setRoom(response.room);
        setPlayerId(response.playerId);
        setRoomCode(response.room.code);
      },
    );
  };

  const joinRoom = () => {
    const name = playerName.trim();
    const code =
      roomCode.trim().toUpperCase();

    if (!name) {
      setError("Enter your name first.");
      return;
    }

    if (!code) {
      setError("Enter a room code.");
      return;
    }

    if (!socket.connected) {
      setError(
        "Not connected to the game server.",
      );
      return;
    }

    setError("");
    setLoading(true);

    socket.emit(
      "join-room",
      {
        playerName: name,
        roomCode: code,
      },
      (
        response: JoinRoomResponse,
      ) => {
        setLoading(false);

        if (
          !response.success ||
          !response.room ||
          !response.playerId
        ) {
          setError(
            response.error ??
              "Failed to join room.",
          );
          return;
        }

        setRoom(response.room);
        setPlayerId(response.playerId);
        setRoomCode(response.room.code);
      },
    );
  };

  const startGame = () => {
    if (!room || !playerId) {
      setError(
        "You are not currently in a room.",
      );
      return;
    }

    if (!socket.connected) {
      setError(
        "Not connected to the game server.",
      );
      return;
    }

    setError("");

    socket.timeout(5000).emit(
      "start-game",
      {
        roomCode: room.code,
        playerId,
      },
      (
        timeoutError: Error | null,
        response: StartGameResponse,
      ) => {
        if (timeoutError) {
          setError(
            "The server did not respond.",
          );
          return;
        }

        if (!response.success) {
          setError(
            response.error ??
              "Failed to start the game.",
          );
        }
      },
    );
  };

  const updateRoomSettings = () => {
    if (!room || !playerId) {
      return;
    }

    if (!socket.connected) {
      setError("Not connected to the game server.");
      return;
    }

    setError("");
    setSettingsSaving(true);

    socket.timeout(5000).emit(
      "update-room-settings",
      {
        roomCode: room.code,
        playerId,
        settings,
      },
      (
        timeoutError: Error | null,
        response: {
          success: boolean;
          room?: Room;
          error?: string;
        },
      ) => {
        setSettingsSaving(false);

        if (timeoutError) {
          setError("The server did not respond.");
          return;
        }

        if (!response.success) {
          setError(
            response.error ??
              "Failed to update room settings.",
          );
          return;
        }

        if (response.room) {
          setRoom(response.room);
        }
      },
    );
  };

  const leaveRoom = () => {
    socket.emit(
      "leave-room",
      (
        response: LeaveRoomResponse,
      ) => {
        if (!response.success) {
          setError(
            response.error ??
              "Failed to leave room.",
          );
          return;
        }

        setRoom(null);
        setPlayerId(null);
        setRoomCode("");
        setError("");
        setMessages([]);
        setWordOptions([]);
        setSecretWord(null);
        setRevealedWord(null);
        setTimer(0);
      },
    );
  };

  const copyRoomCode = async () => {
    if (!room) {
      return;
    }

    try {
      await navigator.clipboard.writeText(room.code);
      setRoundMessage("Room code copied!");
    } catch {
      setError("Could not copy the room code.");
    }
  };

  /*
   * -------------------------------------------------------
   * GAME ACTIONS
   * -------------------------------------------------------
   */

  const chooseWord = (word: string) => {
    if (!isDrawer) {
      return;
    }

    socket.emit(
      "choose-word",
      {
        word,
      },
    );

    setWordOptions([]);
  };

  const getCanvasCoordinates = (
    event:
      | ReactPointerEvent<HTMLCanvasElement>
      | PointerEvent,
  ) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect =
      canvas.getBoundingClientRect();

    if (
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return null;
    }

    return {
      x: clamp(
        (event.clientX - rect.left) /
          rect.width,
        0,
        1,
      ),
      y: clamp(
        (event.clientY - rect.top) /
          rect.height,
        0,
        1,
      ),
    };
  };

  const startDrawing = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (
      !isDrawer ||
      !secretWord ||
      timer <= 0
    ) {
      return;
    }

    const point =
      getCanvasCoordinates(event);

    if (!point) {
      return;
    }

    drawingRef.current = true;
    lastPointRef.current = point;

    event.currentTarget.setPointerCapture(
      event.pointerId,
    );
  };

  const continueDrawing = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (
      !drawingRef.current ||
      !isDrawer ||
      !secretWord ||
      timer <= 0
    ) {
      return;
    }

    const current =
      getCanvasCoordinates(event);

    const previous =
      lastPointRef.current;

    if (!current || !previous) {
      return;
    }

    const stroke: DrawStroke = {
      x1: previous.x,
      y1: previous.y,
      x2: current.x,
      y2: current.y,
      color: brushColor,
      size: brushSize,
      erase: eraser,
    };

    drawSegment(stroke);

    socket.emit(
      "draw-stroke",
      stroke,
    );

    lastPointRef.current = current;
  };

  const stopDrawing = (
    event?: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    drawingRef.current = false;
    lastPointRef.current = null;

    if (
      event &&
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }
  };

  const clearCanvas = () => {
    if (
      !isDrawer ||
      !secretWord
    ) {
      return;
    }

    socket.emit("clear-canvas");
  };

  const submitGuess = () => {
    const trimmedGuess = guess.trim();

    if (!trimmedGuess) {
      return;
    }

    socket.emit(
      "submit-guess",
      {
        guess: trimmedGuess,
      },
      (
        response: {
          success: boolean;
          correct?: boolean;
          error?: string;
        },
      ) => {
        if (!response.success) {
          setError(
            response.error ??
              "Unable to submit guess.",
          );
          return;
        }

        setGuess("");
        setError("");
      },
    );
  };

  /*
   * -------------------------------------------------------
   * DERIVED STATE
   * -------------------------------------------------------
   */

  /*
   * -------------------------------------------------------
   * FINISHED SCREEN
   * -------------------------------------------------------
   */

  if (
    room &&
    room.phase === "FINISHED"
  ) {
    const sortedPlayers = [
      ...room.players,
    ].sort(
      (a, b) => b.score - a.score,
    );

    const winner = sortedPlayers[0];

    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <section className="mx-auto flex min-h-[90vh] max-w-5xl items-center justify-center">
          <div className="w-full rounded-[3rem] border-4 border-white/80 bg-white/95 p-6 shadow-[0_30px_90px_rgba(124,58,237,0.16)] sm:p-10">
            <div className="rounded-[2.5rem] bg-gradient-to-br from-purple-100 via-pink-50 to-yellow-50 p-7 text-center sm:p-10">
              <div className="text-6xl sm:text-7xl">🏆</div>
              <p className="mt-4 text-xs font-black uppercase tracking-[0.35em] text-purple-500">
                Game Complete
              </p>
              <h1 className="mt-2 text-5xl font-black tracking-tight text-gray-900 sm:text-6xl">
                {winner ? `${winner.name} wins!` : "What a game!"}
              </h1>
              <p className="mx-auto mt-3 max-w-2xl font-bold leading-7 text-gray-500">
                Great drawings, questionable guesses, and a whole lot of chaos.
              </p>
            </div>

            <div className="mt-7 grid gap-3">
              {sortedPlayers.map((player, index) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between rounded-[1.75rem] border-2 px-5 py-4 ${
                    index === 0
                      ? "border-yellow-200 bg-yellow-50"
                      : "border-purple-100 bg-purple-50/70"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-black shadow-sm">
                      {index === 0 ? "👑" : `#${index + 1}`}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-black text-gray-900">
                        {player.name}
                        {player.id === playerId ? " · You" : ""}
                      </p>
                      {player.isHost && (
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-pink-500">
                          Host
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-4 py-2 font-black text-purple-600 shadow-sm">
                    {player.score} pts
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={leaveRoom}
              className="mt-7 w-full rounded-3xl bg-purple-600 px-6 py-4 font-black text-white shadow-[0_12px_25px_rgba(124,58,237,0.2)] hover:bg-purple-700"
            >
              Play Again
            </button>
          </div>
        </section>
      </main>
    );
  }

  /*
   * -------------------------------------------------------
   * GAME SCREEN
   * -------------------------------------------------------
   */

  if (
    room &&
    room.phase !== "LOBBY"
  ) {
    const drawerPlayer =
      room.players.find(
        (player) => player.isDrawing,
      );

    const timerDanger = timer <= 10 && timer > 0;

    return (
      <main className="min-h-screen px-3 py-4 sm:px-6 sm:py-5">
        <section className="mx-auto max-w-7xl">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border-2 border-purple-100 bg-white/90 px-4 py-4 shadow-sm backdrop-blur sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-2xl shadow-sm">
                🎨
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-purple-500">
                  SketchBurst
                </p>
                <p className="text-lg font-black text-gray-900">
                  Round {room.currentRound}
                  <span className="ml-2 text-sm text-gray-400">
                    / {room.settings.totalRounds}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <div
                className={`rounded-full px-5 py-3 font-black shadow-sm ring-2 ${
                  timerDanger
                    ? "bg-red-50 text-red-600 ring-red-100"
                    : "bg-purple-50 text-purple-700 ring-purple-100"
                }`}
              >
                ⏱ {timer}s
              </div>
              <button
                type="button"
                onClick={leaveRoom}
                className="rounded-full border-2 border-red-100 bg-white px-4 py-3 font-black text-red-500 hover:bg-red-50"
              >
                Leave
              </button>
            </div>
          </header>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-[2.5rem] border-4 border-white bg-purple-100 p-2 shadow-[0_20px_55px_rgba(124,58,237,0.12)] sm:p-3">
              <div className="relative overflow-hidden rounded-[2rem] bg-white">
                <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/90 px-4 py-2 text-xs font-black text-purple-600 shadow-sm backdrop-blur">
                  {isDrawer ? "✏️ Your turn to draw" : "👀 Watch & guess"}
                </div>

                <canvas
                  ref={canvasRef}
                  className={`block h-[58vh] min-h-[400px] w-full touch-none sm:h-[64vh] ${
                    isDrawer ? "cursor-crosshair" : "cursor-default"
                  }`}
                  onPointerDown={startDrawing}
                  onPointerMove={continueDrawing}
                  onPointerUp={stopDrawing}
                  onPointerCancel={stopDrawing}
                  onPointerLeave={() => {
                    if (drawingRef.current) {
                      drawingRef.current = false;
                      lastPointRef.current = null;
                    }
                  }}
                />

                {isDrawer && wordOptions.length > 0 && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 p-5 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-[2.5rem] border-4 border-purple-100 bg-white p-6 text-center shadow-[0_25px_80px_rgba(124,58,237,0.18)] sm:p-9">
                      <div className="text-5xl">✨</div>
                      <p className="mt-3 text-xs font-black uppercase tracking-[0.3em] text-purple-400">
                        Your secret word
                      </p>
                      <h2 className="mt-2 text-3xl font-black text-gray-900 sm:text-4xl">
                        Pick one!
                      </h2>
                      <p className="mt-2 font-bold text-gray-400">
                        Everyone else will only see your drawing.
                      </p>
                      <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        {wordOptions.map((word) => (
                          <button
                            key={word}
                            type="button"
                            onClick={() => chooseWord(word)}
                            className="rounded-3xl border-2 border-purple-200 bg-purple-50 px-4 py-5 text-lg font-black text-purple-700 shadow-sm hover:-translate-y-1 hover:bg-purple-600 hover:text-white"
                          >
                            {word}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {isDrawer && secretWord && (
                <div className="mt-3 rounded-[2rem] bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full bg-purple-50 px-3 py-2">
                      <span className="pl-1 text-xs font-black uppercase tracking-[0.15em] text-purple-400">
                        Color
                      </span>
                      {COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Choose ${color}`}
                          onClick={() => {
                            setBrushColor(color);
                            setEraser(false);
                          }}
                          className={`h-8 w-8 rounded-full border-2 transition ${
                            brushColor === color && !eraser
                              ? "scale-110 border-purple-500 shadow-sm"
                              : "border-white"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>

                    <div className="flex items-center gap-1 rounded-full bg-purple-50 p-1.5">
                      {BRUSH_SIZES.map((brush) => (
                        <button
                          key={brush.label}
                          type="button"
                          onClick={() => setBrushSize(brush.value)}
                          className={`rounded-full px-3 py-2 text-xs font-black ${
                            brushSize === brush.value
                              ? "bg-purple-600 text-white shadow-sm"
                              : "text-purple-600"
                          }`}
                        >
                          {brush.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setEraser((value) => !value)}
                      className={`rounded-full px-4 py-3 font-black shadow-sm ${
                        eraser
                          ? "bg-pink-500 text-white"
                          : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {eraser ? "Eraser On" : "Eraser"}
                    </button>

                    <button
                      type="button"
                      onClick={clearCanvas}
                      className="rounded-full bg-yellow-50 px-4 py-3 font-black text-yellow-700 shadow-sm"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-[2.5rem] border-2 border-purple-100 bg-gradient-to-br from-purple-100 via-pink-50 to-yellow-50 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.25em] text-purple-500">
                      Drawing now
                    </p>
                    <h2 className="mt-1 text-2xl font-black text-gray-900">
                      {drawerPlayer?.name ?? "Someone"}
                    </h2>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-2 text-xl shadow-sm">
                    ✏️
                  </div>
                </div>

                <p className="mt-3 rounded-2xl bg-white/75 px-4 py-3 font-bold text-gray-600">
                  {roundMessage}
                </p>

                {isDrawer && secretWord && (
                  <div className="mt-3 rounded-2xl bg-white px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-400">
                      Your word
                    </p>
                    <p className="mt-1 text-2xl font-black text-purple-600">
                      {secretWord}
                    </p>
                  </div>
                )}

                {!isDrawer && wordLength > 0 && !revealedWord && (
                  <div className="mt-3 rounded-2xl bg-white px-4 py-4 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                      Guess the word
                    </p>
                    <p className="mt-2 text-xl font-black tracking-[0.4em] text-purple-600">
                      {Array.from({ length: wordLength })
                        .map(() => "_")
                        .join(" ")}
                    </p>
                  </div>
                )}

                {revealedWord && (
                  <div className="mt-3 rounded-2xl bg-yellow-50 px-4 py-4 ring-2 ring-yellow-100">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-600">
                      Answer
                    </p>
                    <p className="mt-1 text-2xl font-black text-gray-900">
                      {revealedWord}
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-[2.5rem] border-2 border-purple-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-purple-400">
                      Scoreboard
                    </p>
                    <h2 className="mt-1 text-xl font-black">Players</h2>
                  </div>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-black text-purple-600">
                    {room.players.length}
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {[...room.players]
                    .sort((a, b) => b.score - a.score)
                    .map((player, index) => (
                      <div
                        key={player.id}
                        className={`flex items-center justify-between rounded-2xl px-3 py-3 ${
                          player.isDrawing
                            ? "bg-purple-50 ring-2 ring-purple-100"
                            : "bg-gray-50"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-black shadow-sm">
                            {index === 0 ? "👑" : index + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-gray-900">
                              {player.name}
                              {player.id === playerId ? " · You" : ""}
                            </p>
                            <p className="text-xs font-bold text-gray-400">
                              {player.isDrawing ? "Drawing" : "Guessing"}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-purple-600 shadow-sm">
                          {player.score}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex h-[320px] flex-col rounded-[2.5rem] border-2 border-purple-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-pink-400">
                      Live chat
                    </p>
                    <h2 className="mt-1 text-xl font-black">Guesses</h2>
                  </div>
                  <span className="text-xl">💬</span>
                </div>

                <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
                  {messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 text-center">
                      <p className="font-bold text-gray-400">
                        Guesses will pop up here. Be quick!
                      </p>
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={`${message.playerId}-${index}`}
                        className={`rounded-2xl px-3 py-2 ${
                          message.correct
                            ? "bg-emerald-50 ring-1 ring-emerald-100"
                            : "bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-black text-gray-500">
                            {message.playerName}
                          </p>
                          {message.correct && (
                            <span className="text-xs font-black text-emerald-600">
                              ✓ GOT IT
                            </span>
                          )}
                        </div>
                        <p className="mt-1 break-words text-sm font-bold text-gray-800">
                          {message.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {!isDrawer && (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitGuess();
                    }}
                  >
                    <input
                      value={guess}
                      onChange={(event) => setGuess(event.target.value)}
                      maxLength={50}
                      placeholder="Type a guess..."
                      className="min-w-0 flex-1 rounded-full border-2 border-purple-100 bg-purple-50 px-4 py-3 text-sm font-bold outline-none focus:border-purple-300"
                    />
                    <button
                      type="submit"
                      className="rounded-full bg-purple-600 px-5 py-3 font-black text-white shadow-sm hover:bg-purple-700"
                    >
                      Guess
                    </button>
                  </form>
                )}
              </div>
            </aside>
          </div>

          {error && (
            <p className="mt-4 rounded-3xl border-2 border-red-100 bg-red-50 px-5 py-4 text-center font-bold text-red-600">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  /*
   * -------------------------------------------------------
   * LOBBY
   * -------------------------------------------------------
   */

  if (room && room.phase === "LOBBY") {
    const isHost = room.hostId === playerId;

    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <section className="mx-auto flex min-h-[90vh] max-w-5xl items-center">
          <div className="w-full rounded-[3rem] border-4 border-white/80 bg-white/95 p-5 shadow-[0_30px_90px_rgba(124,58,237,0.15)] sm:p-8">
            <div className="rounded-[2.5rem] bg-gradient-to-br from-purple-100 via-pink-50 to-yellow-50 p-6 sm:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-purple-500 shadow-sm">
                    <span>🎨</span> Game Lobby
                  </div>
                  <h1 className="mt-4 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
                    Room <span className="text-purple-600">{room.code}</span>
                  </h1>
                  <p className="mt-2 font-bold text-gray-500">
                    Invite your friends and get ready to draw.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={leaveRoom}
                  className="rounded-full border-2 border-red-100 bg-white px-5 py-3 font-black text-red-500 shadow-sm hover:bg-red-50"
                >
                  Leave
                </button>
              </div>

              <div className="mt-6 flex flex-col gap-3 rounded-[2rem] bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">
                    Room code
                  </p>
                  <p className="mt-1 text-3xl font-black tracking-[0.15em] text-purple-600">
                    {room.code}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyRoomCode}
                  className="rounded-2xl bg-purple-600 px-5 py-3 font-black text-white shadow-sm hover:bg-purple-700"
                >
                  Copy Code
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[2.5rem] border-2 border-purple-100 bg-purple-50/70 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-purple-400">
                      Players
                    </p>
                    <h2 className="mt-1 text-2xl font-black">Who's playing?</h2>
                  </div>
                  <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-purple-600 shadow-sm">
                    {room.players.length}/{room.settings.maxPlayers}
                  </span>
                </div>

                <div className="mt-5 grid gap-3">
                  {room.players.map((player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded-3xl border-2 border-white bg-white px-4 py-4 shadow-sm"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-100 text-lg font-black text-purple-600">
                          {index === 0 ? "👑" : "😊"}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-black text-gray-900">
                            {player.name}
                            {player.id === playerId ? " · You" : ""}
                          </p>
                          <p className="text-xs font-bold text-gray-400">
                            {player.isHost ? "Room host" : "Player"}
                          </p>
                        </div>
                      </div>

                      {player.isHost && (
                        <span className="rounded-full bg-pink-100 px-3 py-1 text-xs font-black text-pink-500">
                          HOST
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2.5rem] border-2 border-yellow-100 bg-yellow-50/70 p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-600">
                  Game settings
                </p>
                <h2 className="mt-1 text-2xl font-black">Ready to doodle?</h2>

                {isHost ? (
                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-gray-500">
                        Maximum players
                      </label>
                      <select
                        value={settings.maxPlayers}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            maxPlayers: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-2xl border-2 border-white bg-white px-4 py-3 font-black text-gray-800 outline-none focus:border-purple-300"
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((value) => (
                          <option key={value} value={value}>
                            {value} players
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-gray-500">
                        Total rounds
                      </label>
                      <select
                        value={settings.totalRounds}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            totalRounds: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-2xl border-2 border-white bg-white px-4 py-3 font-black text-gray-800 outline-none focus:border-purple-300"
                      >
                        {[1, 2, 3, 4, 5, 6, 8, 10].map((value) => (
                          <option key={value} value={value}>
                            {value} rounds
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-gray-500">
                        Round time
                      </label>
                      <select
                        value={settings.roundTimeSeconds}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            roundTimeSeconds: Number(event.target.value),
                          }))
                        }
                        className="w-full rounded-2xl border-2 border-white bg-white px-4 py-3 font-black text-gray-800 outline-none focus:border-purple-300"
                      >
                        {[30, 45, 60, 90, 120].map((value) => (
                          <option key={value} value={value}>
                            {value} seconds
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white px-4 py-3">
                      <input
                        type="checkbox"
                        checked={settings.isPrivate}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            isPrivate: event.target.checked,
                          }))
                        }
                        className="h-5 w-5 accent-purple-600"
                      />
                      <div>
                        <p className="font-black text-gray-800">Private room</p>
                        <p className="text-xs font-bold text-gray-400">
                          Friends join using the room code.
                        </p>
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={updateRoomSettings}
                      disabled={settingsSaving}
                      className="w-full rounded-3xl bg-orange-400 px-5 py-3 font-black text-white shadow-sm hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {settingsSaving ? "Saving..." : "Save Settings"}
                    </button>

                    <button
                      type="button"
                      onClick={startGame}
                      disabled={room.players.length < 2}
                      className="w-full rounded-3xl bg-purple-600 px-5 py-4 font-black text-white shadow-[0_12px_25px_rgba(124,58,237,0.2)] hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {room.players.length < 2
                        ? "Waiting for a player..."
                        : "Start Game"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    <div className="rounded-2xl bg-white px-4 py-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-gray-400">
                        Players
                      </p>
                      <p className="mt-1 font-black text-gray-800">
                        {room.settings.maxPlayers} max
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-gray-400">
                        Rounds
                      </p>
                      <p className="mt-1 font-black text-gray-800">
                        {room.settings.totalRounds} rounds
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-gray-400">
                        Time
                      </p>
                      <p className="mt-1 font-black text-gray-800">
                        {room.settings.roundTimeSeconds} seconds each
                      </p>
                    </div>
                    <div className="rounded-3xl bg-white px-5 py-4 text-center shadow-sm">
                      <p className="font-black text-purple-600">
                        Waiting for the host to start...
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <p className="mt-5 rounded-3xl border-2 border-red-100 bg-red-50 px-5 py-4 text-center font-bold text-red-600">
                {error}
              </p>
            )}

            {!connected && (
              <p className="mt-4 rounded-3xl bg-yellow-50 px-5 py-4 text-center text-sm font-bold text-yellow-700">
                Reconnecting to the game server...
              </p>
            )}
          </div>
        </section>
      </main>
    );
  }

  /*
   * -------------------------------------------------------
   * HOME
   * -------------------------------------------------------
   */

  const doodleBackground = `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700">
      <rect width="900" height="700" fill="#fff9fd"/>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
        <path d="M40 90 l14 -22 l14 22 l24 5 l-18 16 l4 24 l-24 -12 l-24 12 l4 -24 l-18 -16z" stroke="#f4c85b" stroke-width="4"/>
        <path d="M155 45 q18 -20 36 0 q18 20 36 0" stroke="#8ad7f7" stroke-width="6"/>
        <path d="M285 78 q18 -28 36 0 q18 28 36 0 q18 -28 36 0" stroke="#ff9ccf" stroke-width="5"/>
        <path d="M500 62 q18 -30 36 0 q18 30 36 0" stroke="#7bdcca" stroke-width="5"/>
        <path d="M770 65 q25 -30 50 0 q25 30 50 0" stroke="#9e85ff" stroke-width="5"/>
        <path d="M90 210 q24 -35 48 0 q24 35 48 0" stroke="#f8a8c6" stroke-width="5"/>
        <path d="M700 205 l18 6 l5 19 l-14 14 l-19 -7 l-5 -19z" stroke="#74cfe8" stroke-width="4"/>
        <path d="M120 350 l12 12 l22 -32" stroke="#75d7c4" stroke-width="6"/>
        <path d="M785 330 l12 12 l22 -32" stroke="#f49bba" stroke-width="6"/>
        <path d="M50 500 q18 -28 36 0 q18 28 36 0" stroke="#8ac7ff" stroke-width="5"/>
        <path d="M720 520 q25 -35 50 0 q25 35 50 0" stroke="#f6cf6a" stroke-width="5"/>
        <path d="M175 590 q22 -22 44 0 q22 22 44 0" stroke="#b399ff" stroke-width="5"/>
        <path d="M560 595 q22 -22 44 0 q22 22 44 0" stroke="#ff9ac7" stroke-width="5"/>
        <path d="M365 140 q12 -22 24 0 q12 22 24 0" stroke="#78d7ec" stroke-width="5"/>
      </g>
      <g font-family="Arial, sans-serif" font-size="34" opacity="0.48">
        <text x="55" y="160" fill="#ff7fb4">♥</text>
        <text x="250" y="210" fill="#7b74ed">✦</text>
        <text x="610" y="165" fill="#ffd45a">☀</text>
        <text x="820" y="235" fill="#ff91bd">♥</text>
        <text x="265" y="500" fill="#8cd6ff">☁</text>
        <text x="635" y="455" fill="#a48cff">✦</text>
        <text x="395" y="620" fill="#ff9fca">♥</text>
        <text x="70" y="640" fill="#ffd15e">✦</text>
        <text x="845" y="610" fill="#71d9ca">☁</text>
      </g>
    </svg>
  `)}`;

  const titleLetters = "SketchBurst".split("");
  const titleColors = [
    "#ff6fae",
    "#ff7f73",
    "#f4a261",
    "#6ccfba",
    "#64b5e8",
    "#8b5cf6",
    "#9a63f6",
    "#7b45eb",
    "#8b52ee",
    "#6f3fe8",
  ];

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-8">
      <style>{`
        @keyframes sketchburstFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-7px) rotate(-1deg); }
        }
        @keyframes sketchburstLetter {
          0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
          25% { transform: translateY(-2px) rotate(-0.5deg) scale(1.015); }
          50% { transform: translateY(-7px) rotate(-1.5deg) scale(1.045); }
          75% { transform: translateY(-2px) rotate(0.5deg) scale(1.015); }
        }
        @keyframes sparklePulse {
          0%, 100% { opacity: .45; transform: scale(1) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.24) rotate(12deg); }
        }
        @keyframes sketchburstShimmer {
          0%, 100% { filter: drop-shadow(0 10px 10px rgba(124,58,237,.10)); }
          50% { filter: drop-shadow(0 14px 16px rgba(124,58,237,.18)); }
        }
      `}</style>

      <div 
        className="absolute inset-0 -z-20 bg-cover bg-center opacity-50" 
        style={{ backgroundImage: `url("${doodleBackground}")` }} 
        aria-hidden="true" 
      />
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-br from-purple-100/35 via-white/20 to-pink-100/35"
        aria-hidden="true"
      />

      <section className="mx-auto flex min-h-[94vh] max-w-6xl items-center justify-center">
        <div className="relative w-full overflow-hidden rounded-[3.2rem] border-4 border-white/70 bg-white/32 p-5 shadow-[0_30px_100px_rgba(124,58,237,0.18)] backdrop-blur-md sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute inset-0 rounded-[3rem] bg-gradient-to-br from-white/40 via-transparent to-purple-100/12" />

          <div className="relative grid items-center gap-5 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="flex min-h-[560px] flex-col justify-between rounded-[2.6rem] bg-transparent p-4 sm:p-7 lg:p-9">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-purple-100/85 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-purple-600 shadow-sm backdrop-blur">
                  <span className="animate-pulse">✨</span>
                  Multiplayer drawing game
                </div>

                <div className="relative mt-7 w-full max-w-full pr-5">
                  <div className="pointer-events-none absolute -left-4 -top-7 text-2xl" style={{ animation: "sparklePulse 2.2s ease-in-out infinite" }}>
                    ✦
                  </div>
                  <div className="pointer-events-none absolute right-1 top-2 text-xl" style={{ animation: "sparklePulse 1.8s ease-in-out infinite .4s" }}>
                    ✧
                  </div>
                  <div className="pointer-events-none absolute -bottom-2 right-2 text-xl" style={{ animation: "sparklePulse 2s ease-in-out infinite .7s" }}>
                    ✎
                  </div>

                  <h1
                    className="sketchburst-title whitespace-nowrap text-[clamp(3.15rem,5.4vw,5.35rem)] font-black leading-none tracking-[-0.055em]"
                    aria-label="SketchBurst"
                    style={{
                      WebkitTextStroke: "6px white",
                      paintOrder: "stroke fill",
                      animation: "sketchburstShimmer 3.2s ease-in-out infinite",
                      transformOrigin: "left center",
                    }}
                  >
                    {titleLetters.map((letter, index) => (
                      <span
                        key={`${letter}-${index}`}
                        className="inline-block"
                        style={{
                          color: titleColors[index] ?? "#8b5cf6",
                          animation: `sketchburstLetter 2.8s ease-in-out infinite ${index * 0.08}s`,
                          textShadow: "0 3px 0 rgba(255,255,255,.9), 0 10px 16px rgba(124,58,237,.12)",
                        }}
                      >
                        {letter}
                      </span>
                    ))}
                  </h1>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-2 text-lg font-black text-purple-700 sm:text-xl">
                  <span>Draw</span>
                  <span className="text-pink-500">•</span>
                  <span>Guess</span>
                  <span className="text-orange-400">•</span>
                  <span>Compete</span>
                </div>

                <p className="mt-4 max-w-xl text-base font-bold leading-7 text-gray-500 sm:text-lg sm:leading-8">
                  Draw ridiculous things, guess what your friends are making,
                  and see who can become the ultimate doodle champion.
                </p>

                <div className="mt-7 flex flex-wrap gap-2">
                  <span className="rounded-full bg-pink-50 px-4 py-2 text-sm font-black text-pink-500 shadow-sm">
                    Draw ✏️
                  </span>
                  <span className="rounded-full bg-yellow-50 px-4 py-2 text-sm font-black text-yellow-700 shadow-sm">
                    Guess 💭
                  </span>
                  <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-black text-green-700 shadow-sm">
                    Compete 🏆
                  </span>
                </div>
              </div>

              <div className="mt-10 rounded-[2rem] border border-white/80 bg-gradient-to-r from-purple-50/85 to-pink-50/85 p-5 shadow-sm backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
                    🖍️
                  </div>
                  <div>
                    <p className="font-black text-gray-900">Good vibes only ♡</p>
                    <p className="text-sm font-bold text-gray-400">
                      Create a room or jump into a friend's room.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[2.7rem] border-2 border-white/65 bg-white/24 p-3 shadow-[0_20px_60px_rgba(124,58,237,0.10)] backdrop-blur-md sm:p-4">
              <div className="rounded-[2.35rem] border-2 border-white/75 bg-white/58 p-6 shadow-sm backdrop-blur-xl sm:p-8">
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-purple-100 text-3xl shadow-sm" style={{ animation: "sketchburstFloat 3.5s ease-in-out infinite" }}>
                    🎨
                  </div>
                  <h2 className="mt-5 text-3xl font-black text-gray-900">Enter the game</h2>
                  <p className="mt-2 font-bold text-gray-400">Pick a name and let's doodle!</p>
                </div>

                <div className="mt-7 space-y-4">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg">✨</span>
                    <input
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") createRoom();
                      }}
                      maxLength={20}
                      placeholder="Your gamer name"
                      className="w-full rounded-2xl border-2 border-purple-100 bg-purple-50/85 py-4 pl-11 pr-4 font-bold outline-none placeholder:text-purple-300 focus:border-purple-400 focus:bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={createRoom}
                    disabled={loading}
                    className="w-full rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-6 py-4 font-black text-white shadow-[0_12px_25px_rgba(124,58,237,0.2)] transition hover:-translate-y-0.5 hover:from-purple-600 hover:to-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "Creating your room..." : "Create a Room →"}
                  </button>

                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-purple-100" />
                    <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-black text-purple-400">OR</span>
                    <div className="h-px flex-1 bg-purple-100" />
                  </div>

                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg">🔑</span>
                    <input
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") joinRoom();
                      }}
                      maxLength={8}
                      placeholder="ENTER ROOM CODE"
                      className="w-full rounded-2xl border-2 border-purple-100 bg-purple-50/85 py-4 pl-11 pr-4 font-bold uppercase outline-none placeholder:text-purple-300 focus:border-purple-400 focus:bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={joinRoom}
                    disabled={loading}
                    className="w-full rounded-2xl border-2 border-purple-200 bg-white px-6 py-4 font-black text-purple-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "Joining..." : "Join a Room"}
                  </button>

                  {error && (
                    <p className="rounded-2xl border-2 border-red-100 bg-red-50 px-4 py-3 text-center text-sm font-bold text-red-600">
                      {error}
                    </p>
                  )}

                  <div className="flex items-center justify-center gap-2 pt-1 text-xs font-bold text-gray-400">
                    <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-yellow-400 animate-pulse"}`} />
                    <span>{connected ? "Connected to SketchBurst" : "Connecting to SketchBurst..."}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
