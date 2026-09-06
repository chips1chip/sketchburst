import {
  GAME_CONSTANTS,
  type Player,
  type Room,
  type RoomSettings,
} from "@sketchburst/shared";

const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomService {
  private readonly rooms = new Map<string, Room>();

  createRoom(
    playerName: string,
    settings: RoomSettings,
  ): { room: Room; player: Player } {
    const normalizedName = playerName.trim();

    const code = this.generateUniqueRoomCode();

    const player: Player = {
      id: crypto.randomUUID(),
      name: normalizedName,
      score: 0,
      isHost: true,
      isDrawing: false,
    };

    const room: Room = {
      id: crypto.randomUUID(),
      code,
      hostId: player.id,
      players: [player],
      settings,
      phase: "LOBBY",
      currentRound: 0,
    };

    this.rooms.set(code, room);

    return { room, player };
  }

  joinRoom(
    roomCode: string,
    playerName: string,
  ): { room: Room; player: Player } {
    const code = roomCode.trim().toUpperCase();
    const normalizedName = playerName.trim();

    const room = this.rooms.get(code);

    if (!room) {
      throw new Error("Room not found.");
    }

    if (room.phase !== "LOBBY") {
      throw new Error("The game has already started.");
    }

    if (room.players.length >= room.settings.maxPlayers) {
      throw new Error("Room is full.");
    }

    const nameAlreadyUsed = room.players.some(
      (player) => player.name.toLowerCase() === normalizedName.toLowerCase(),
    );

    if (nameAlreadyUsed) {
      throw new Error("That player name is already in use.");
    }

    const player: Player = {
      id: crypto.randomUUID(),
      name: normalizedName,
      score: 0,
      isHost: false,
      isDrawing: false,
    };

    room.players.push(player);

    return { room, player };
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  removePlayer(roomCode: string, playerId: string): Room | undefined {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      return undefined;
    }

    room.players = room.players.filter((player) => player.id !== playerId);

    if (room.players.length === 0) {
      this.rooms.delete(code);
      return undefined;
    }

    if (room.hostId === playerId) {
      const newHost = room.players[0];

      room.hostId = newHost.id;

      room.players = room.players.map((player) => ({
        ...player,
        isHost: player.id === newHost.id,
      }));
    }

    return room;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  private generateUniqueRoomCode(): string {
    let code: string;

    do {
      code = Array.from(
        { length: GAME_CONSTANTS.ROOM_CODE_LENGTH },
        () =>
          ROOM_CODE_CHARACTERS[
            Math.floor(Math.random() * ROOM_CODE_CHARACTERS.length)
          ],
      ).join("");
    } while (this.rooms.has(code));

    return code;
  }
}