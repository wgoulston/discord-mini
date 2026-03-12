'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const DiscordClient = require('./src/discord-client');

let tray = null;
let mainWindow = null;
let client = null;

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Don't show dock icon (macOS) or taskbar button
  if (app.dock) app.dock.hide();

  createTray();
  createWindow();
  setupIPC();
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  if (client) client.disconnect();
});

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Discord Mini');

  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open Discord Mini', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.popUpContextMenu(menu);
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 520,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.isPinned = false;

  // Open all external https:// links in the default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('blur', () => {
    // Only auto-hide if the user hasn't pinned the window
    if (!mainWindow.isPinned) mainWindow.hide();
  });
}

function toggleWindow() {
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function showWindow() {
  positionWindow();
  mainWindow.show();
  mainWindow.focus();
}

function positionWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = mainWindow.getSize();
  // Bottom-right corner above the taskbar
  const x = Math.floor(workArea.x + workArea.width - w - 10);
  const y = Math.floor(workArea.y + workArea.height - h - 10);
  mainWindow.setPosition(x, y);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function setupIPC() {
  // ── Auth ────────────────────────────────────────────────────────────────────

  /** Attach real-time event forwarders from the Discord client to the renderer. */
  function attachClientEvents() {
    client.on('message', (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord:message', msg);
      }
    });
    client.on('dmCreated', (ch) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord:dmCreated', ch);
      }
    });
    client.on('typingStart', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord:typingStart', data);
      }
    });
    client.on('relationshipAdd', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord:relationshipAdd', data);
      }
    });
  }

  ipcMain.handle('discord:login', async (_event, token) => {
    try {
      if (client) client.disconnect();
      client = new DiscordClient(token);
      const user = await client.login();
      attachClientEvents();
      return { success: true, user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:loginWithCredentials', async (_event, email, password) => {
    try {
      if (client) client.disconnect();
      const token = await DiscordClient.getTokenFromCredentials(email, password);
      client = new DiscordClient(token);
      const user = await client.login();
      attachClientEvents();
      return { success: true, user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:logout', async () => {
    if (client) {
      client.disconnect();
      client = null;
    }
    return { success: true };
  });

  // ── Data fetching ───────────────────────────────────────────────────────────
  ipcMain.handle('discord:getDMs', async () => {
    if (!client) return { success: false, error: 'Not logged in' };
    try {
      const channels = await client.getDMChannels();
      // Sort by last_message_id descending (most recent first)
      channels.sort((a, b) => {
        const aId = BigInt(a.last_message_id || '0');
        const bId = BigInt(b.last_message_id || '0');
        return bId > aId ? 1 : bId < aId ? -1 : 0;
      });
      return { success: true, channels };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:getMessages', async (_event, channelId) => {
    if (!client) return { success: false, error: 'Not logged in' };
    try {
      const messages = await client.getMessages(channelId, 50);
      return { success: true, messages };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:sendMessage', async (_event, channelId, content) => {
    if (!client) return { success: false, error: 'Not logged in' };
    try {
      const message = await client.sendMessage(channelId, content);
      return { success: true, message };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:createDM', async (_event, userId) => {
    if (!client) return { success: false, error: 'Not logged in' };
    try {
      const channel = await client.createDM(userId);
      return { success: true, channel };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:addFriend', async (_event, username) => {
    if (!client) return { success: false, error: 'Not logged in' };
    try {
      await client.addFriend(username);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('discord:getRelationships', async () => {
    if (!client) return { success: false, error: 'Not logged in' };
    try {
      const relationships = await client.getRelationships();
      return { success: true, relationships };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Window controls ─────────────────────────────────────────────────────────
  ipcMain.on('window:close', () => mainWindow.hide());
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:togglePin', () => {
    mainWindow.isPinned = !mainWindow.isPinned;
    mainWindow.setAlwaysOnTop(mainWindow.isPinned);
  });
}
