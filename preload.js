'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, typed API to the renderer (no direct Node.js access)
contextBridge.exposeInMainWorld('discordAPI', {
  // Auth
  login: (token) => ipcRenderer.invoke('discord:login', token),
  loginWithCredentials: (email, password) => ipcRenderer.invoke('discord:loginWithCredentials', email, password),
  logout: () => ipcRenderer.invoke('discord:logout'),

  // Data
  getDMs: () => ipcRenderer.invoke('discord:getDMs'),
  getMessages: (channelId) => ipcRenderer.invoke('discord:getMessages', channelId),
  sendMessage: (channelId, content) => ipcRenderer.invoke('discord:sendMessage', channelId, content),
  createDM: (userId) => ipcRenderer.invoke('discord:createDM', userId),
  addFriend: (username) => ipcRenderer.invoke('discord:addFriend', username),
  getRelationships: () => ipcRenderer.invoke('discord:getRelationships'),

  // Real-time event listeners
  onMessage: (cb) => ipcRenderer.on('discord:message', (_e, msg) => cb(msg)),
  onDMCreated: (cb) => ipcRenderer.on('discord:dmCreated', (_e, ch) => cb(ch)),
  onTypingStart: (cb) => ipcRenderer.on('discord:typingStart', (_e, data) => cb(data)),
  onRelationshipAdd: (cb) => ipcRenderer.on('discord:relationshipAdd', (_e, data) => cb(data)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(`discord:${channel}`),

  // Window controls
  close: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  togglePin: () => ipcRenderer.send('window:togglePin'),
});
