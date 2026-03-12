# discord-mini

A mini Discord client that lives in your system tray — DMs only, always at hand.

## Features

- **System tray icon** — Click to show/hide the app window. Right-click for a context menu.
- **Login with your Discord user token** — No OAuth flow required; enter your token once to get started.
- **DM list** — Left sidebar lists all your open direct messages, sorted by most recent activity.
- **Chat panel** — Select a DM to view the conversation and reply in real time.
- **"+" button** — Opens a modal to start a new DM (by user ID) or send a friend request (by username).
- **Settings** — User profile, *Always on Top* toggle, and a logout button.
- **Real-time updates** — New messages, typing indicators, and new DM channels appear instantly via the Discord Gateway WebSocket.
- **Pin window** — Click the pin icon in the title bar to keep the window visible when it loses focus.

## Screenshot

> Run `npm start` to see the app in action.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+  
- A Discord account

### Install

```bash
npm install
```

### Run

```bash
npm start
```

### Find your Discord user token

1. Open Discord in your **web browser** (discord.com/app).
2. Press **F12** to open DevTools.
3. Go to **Application → Local Storage → https://discord.com**.
4. Copy the value of the `token` key.

> ⚠️ **Warning:** Using unofficial third-party clients with a user account may violate [Discord's Terms of Service](https://discord.com/terms). Use this application at your own risk. Never share your token with anyone.

## Project Structure

```
discord-mini/
├── main.js              # Electron main process — tray, window, IPC handlers
├── preload.js           # Secure context bridge for renderer ↔ main IPC
├── src/
│   ├── discord-client.js  # Discord REST + Gateway WebSocket client
│   ├── index.html         # Main UI (login + app views)
│   ├── styles.css         # Discord-inspired dark theme
│   └── renderer.js        # Frontend logic
└── assets/
    └── icon.png           # Tray icon
```

## License

MIT
