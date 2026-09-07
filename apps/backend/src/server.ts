import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";

import { RoomService } from "./rooms/room.service.js";
import { registerRoomSocketHandlers } from "./socket/room.socket.js";

const app = express();
const httpServer = http.createServer(app);

const port = Number(process.env.PORT ?? 3000);
const frontendUrl =
  process.env.FRONTEND_URL ?? "http://localhost:5173";

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  }),
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).json({
    service: "SketchBurst Backend",
    status: "running",
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "sketchburst-backend",
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: frontendUrl,
    credentials: true,
  },
});

const roomService = new RoomService();

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  registerRoomSocketHandlers(io, socket, roomService);

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(
    `SketchBurst backend running on port ${port}`,
  );
});