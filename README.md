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

🚀 Getting Started
Prerequisites

Make sure you have installed:

Node.js
pnpm
1. Clone the repository
git clone https://github.com/YOUR_USERNAME/SketchBurst.git
cd SketchBurst
2. Install dependencies
pnpm install
3. Start the backend
pnpm --filter backend dev

The backend runs on:

http://localhost:3000
4. Start the frontend

Open another terminal:

pnpm --filter frontend dev

The frontend runs on:

http://localhost:5173
🎮 How to Play
Create a room.
Share the room code with your friends.
Players join the room.
The host starts the game.
One player receives a secret word and draws it.
Other players try to guess the word.
Players earn points for correct guesses.
Turns rotate between players.
The player with the highest score wins.
🔮 Future Improvements
User accounts and authentication
Persistent player statistics
Custom word lists
More drawing tools
Game history
Spectator mode
Improved moderation and anti-cheat features
Production database integration
👩‍💻 Author

Developed as a multiplayer web application project.

⭐ If you like SketchBurst, consider giving the repository a star!
