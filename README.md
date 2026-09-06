# 🎨 SketchBurst

> Draw • Guess • Compete

SketchBurst is a real-time multiplayer drawing and guessing game inspired by games like Skribbl.io. Players join a room, take turns drawing secret words, and compete to guess them before time runs out.

## ✨ Features

- 🎨 Real-time multiplayer drawing
- 🔐 Create and join game rooms
- 🏠 Host-controlled game settings
- ✏️ Random word selection
- 💬 Real-time guessing and chat
- ⏱️ Timed drawing rounds
- 🏆 Score-based gameplay
- 🔄 Automatic player turn rotation
- 🎉 Final scoreboard
- 📱 Responsive and playful UI

## 🛠️ Tech Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- Socket.IO Client

### Backend
- Node.js
- Express.js
- TypeScript
- Socket.IO

### Shared
- TypeScript
- Zod

## 📁 Project Structure

```text
SketchBurst/
├── apps/
│   ├── frontend/      # React frontend
│   └── backend/       # Node.js + Socket.IO backend
├── packages/
│   └── shared/        # Shared types and schemas
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
