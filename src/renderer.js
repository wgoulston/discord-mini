'use strict';

/* global discordAPI */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  currentUser: null,
  channels: [],
  activeChannelId: null,
  messages: {},   // channelId → array of messages
  typingTimers: {},
  pinned: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  loginView:       $('login-view'),
  appView:         $('app-view'),
  loginForm:       $('login-form'),
  tokenInput:      $('token-input'),
  tokenToggle:     $('token-toggle'),
  loginBtn:        $('login-btn'),
  loginBtnText:    $('login-btn-text'),
  loginSpinner:    $('login-spinner'),
  loginError:      $('login-error'),

  dmList:          $('dm-list'),
  dmSearch:        $('dm-search'),
  btnNewChat:      $('btn-new-chat'),
  btnSettings:     $('btn-settings'),

  userAvatar:      $('user-avatar'),
  userStatusDot:   $('user-status-dot'),
  userUsername:    $('user-username'),
  btnLogout:       $('btn-logout'),

  emptyState:      $('empty-state'),
  chatHeader:      $('chat-header'),
  chatAvatar:      $('chat-avatar'),
  chatUsername:    $('chat-username'),
  chatStatusText:  $('chat-status-text'),
  messagesArea:    $('messages-area'),
  messagesList:    $('messages-list'),
  typingIndicator: $('typing-indicator'),
  typingName:      $('typing-name'),
  messageInputArea:$('message-input-area'),
  messageInput:    $('message-input'),
  btnSend:         $('btn-send'),

  modalOverlay:    $('modal-overlay'),
  modalClose:      $('modal-close'),
  modalTabs:       document.querySelectorAll('.modal-tab'),
  dmUserId:        $('dm-user-id'),
  dmError:         $('dm-error'),
  btnOpenDM:       $('btn-open-dm'),
  friendUsername:  $('friend-username'),
  friendError:     $('friend-error'),
  friendSuccess:   $('friend-success'),
  btnAddFriend:    $('btn-add-friend'),

  settingsOverlay: $('settings-overlay'),
  settingsClose:   $('settings-close'),
  settingsAvatar:  $('settings-avatar'),
  settingsUsername:$('settings-username'),
  settingsUserId:  $('settings-user-id'),
  settingsLogout:  $('settings-logout'),
  toggleAlwaysTop: $('toggle-always-on-top'),

  btnMinimize:     $('btn-minimize'),
  btnPin:          $('btn-pin'),
  btnClose:        $('btn-close'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarUrl(user, size = 64) {
  if (!user) return '';
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
}

function displayName(user) {
  if (!user) return 'Unknown';
  return user.global_name || user.username || 'Unknown';
}

function channelName(channel) {
  if (channel.recipients && channel.recipients.length > 0) {
    return channel.recipients.map(displayName).join(', ');
  }
  return channel.name || 'Unknown';
}

function channelAvatar(channel) {
  if (channel.recipients && channel.recipients.length === 1) {
    return avatarUrl(channel.recipients[0]);
  }
  return '';
}

function channelUser(channel) {
  if (channel.recipients && channel.recipients.length === 1) {
    return channel.recipients[0];
  }
  return null;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setVisible(el, visible) {
  if (visible) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $(name + '-view').classList.add('active');
}

// ─── Login ────────────────────────────────────────────────────────────────────

els.tokenToggle.addEventListener('click', () => {
  const isPassword = els.tokenInput.type === 'password';
  els.tokenInput.type = isPassword ? 'text' : 'password';
  els.tokenToggle.textContent = isPassword ? '🙈' : '👁';
});

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = els.tokenInput.value.trim();
  if (!token) return;

  setLoginLoading(true);
  setVisible(els.loginError, false);

  const result = await discordAPI.login(token);
  if (result.success) {
    state.currentUser = result.user;
    onLoggedIn();
  } else {
    els.loginError.textContent = result.error || 'Login failed. Check your token.';
    setVisible(els.loginError, true);
    setLoginLoading(false);
  }
});

function setLoginLoading(loading) {
  els.loginBtn.disabled = loading;
  setVisible(els.loginBtnText, !loading);
  setVisible(els.loginSpinner, loading);
}

// ─── Post-login setup ─────────────────────────────────────────────────────────

async function onLoggedIn() {
  // Update user info bar
  els.userAvatar.src = avatarUrl(state.currentUser, 56);
  els.userUsername.textContent = displayName(state.currentUser);

  // Switch to app view
  showView('app');

  // Load DM list
  await refreshDMList();

  // Register real-time listeners
  discordAPI.onMessage(handleIncomingMessage);
  discordAPI.onDMCreated(handleDMCreated);
  discordAPI.onTypingStart(handleTypingStart);
}

// ─── DM list ──────────────────────────────────────────────────────────────────

async function refreshDMList() {
  els.dmList.innerHTML = '<li class="dm-loading">Loading…</li>';
  const result = await discordAPI.getDMs();
  if (!result.success) {
    els.dmList.innerHTML = `<li class="dm-empty">Error: ${escapeHtml(result.error)}</li>`;
    return;
  }
  state.channels = result.channels;
  renderDMList(state.channels);
}

function renderDMList(channels) {
  if (channels.length === 0) {
    els.dmList.innerHTML = '<li class="dm-empty">No direct messages yet.</li>';
    return;
  }

  els.dmList.innerHTML = '';
  channels.forEach((ch) => {
    const li = buildDMItem(ch);
    els.dmList.appendChild(li);
  });
}

function buildDMItem(channel) {
  const li = document.createElement('li');
  li.className = 'dm-item';
  li.dataset.channelId = channel.id;
  if (channel.id === state.activeChannelId) li.classList.add('active');

  const user = channelUser(channel);
  const name = channelName(channel);
  const avatarSrc = channelAvatar(channel);
  const initials = name.slice(0, 1).toUpperCase();

  const avatarHTML = avatarSrc
    ? `<img class="dm-avatar" src="${escapeHtml(avatarSrc)}" alt="" />`
    : `<div class="dm-avatar-placeholder">${escapeHtml(initials)}</div>`;

  li.innerHTML = `
    <div class="dm-avatar-wrap">
      ${avatarHTML}
      <span class="status-dot offline"></span>
    </div>
    <div class="dm-info">
      <div class="dm-name">${escapeHtml(name)}</div>
      <div class="dm-preview"></div>
    </div>
  `;

  li.addEventListener('click', () => openDMChannel(channel));
  return li;
}

function updateDMPreview(channelId, text) {
  const li = els.dmList.querySelector(`[data-channel-id="${channelId}"]`);
  if (li) {
    const preview = li.querySelector('.dm-preview');
    if (preview) preview.textContent = text;
  }
}

// ─── DM search ────────────────────────────────────────────────────────────────

els.dmSearch.addEventListener('input', () => {
  const q = els.dmSearch.value.toLowerCase();
  const filtered = q
    ? state.channels.filter((ch) => channelName(ch).toLowerCase().includes(q))
    : state.channels;
  renderDMList(filtered);
});

// ─── Open a DM channel ───────────────────────────────────────────────────────

async function openDMChannel(channel) {
  // Update active state in sidebar
  document.querySelectorAll('.dm-item').forEach((el) => el.classList.remove('active'));
  const li = els.dmList.querySelector(`[data-channel-id="${channel.id}"]`);
  if (li) li.classList.add('active');

  state.activeChannelId = channel.id;
  const user = channelUser(channel);
  const name = channelName(channel);
  const avatarSrc = channelAvatar(channel);

  // Update chat header
  els.chatAvatar.src = avatarSrc || '';
  els.chatUsername.textContent = name;
  els.chatStatusText.textContent = user ? `@${user.username}` : '';
  setVisible(els.chatHeader, true);
  setVisible(els.emptyState, false);
  setVisible(els.messagesArea, true);
  setVisible(els.messageInputArea, true);
  els.messageInput.placeholder = `Message @${name}`;

  // Load messages
  els.messagesList.innerHTML = '';
  const result = await discordAPI.getMessages(channel.id);
  if (result.success) {
    const msgs = result.messages.reverse(); // oldest first
    state.messages[channel.id] = msgs;
    msgs.forEach((msg) => appendMessage(msg, false));
    scrollToBottom();
  }

  els.messageInput.focus();
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function appendMessage(msg, scroll = true) {
  const isOwn = state.currentUser && msg.author.id === state.currentUser.id;
  const msgList = state.messages[state.activeChannelId] || [];
  const lastMsg = msgList[msgList.length - 2]; // previous before this
  const isContinuation =
    lastMsg &&
    lastMsg.author.id === msg.author.id &&
    new Date(msg.timestamp) - new Date(lastMsg.timestamp) < 7 * 60 * 1000;

  const name = displayName(msg.author);
  const avatarSrc = avatarUrl(msg.author);
  const initials = name.slice(0, 1).toUpperCase();

  const avatarHTML = avatarSrc
    ? `<img class="msg-avatar" src="${escapeHtml(avatarSrc)}" alt="" />`
    : `<div class="msg-avatar-placeholder">${escapeHtml(initials)}</div>`;

  const div = document.createElement('div');
  div.className = `msg-group${isOwn ? ' is-mine' : ''}${isContinuation ? ' continuation' : ''}`;
  div.dataset.msgId = msg.id;

  div.innerHTML = `
    ${avatarHTML}
    <div class="msg-content-wrap">
      <div class="msg-meta">
        <span class="msg-author">${escapeHtml(name)}</span>
        <span class="msg-timestamp">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="msg-text">${escapeHtml(msg.content || '')}</div>
    </div>
  `;

  els.messagesList.appendChild(div);
  if (scroll) scrollToBottom();
}

function scrollToBottom() {
  els.messagesArea.scrollTop = els.messagesArea.scrollHeight;
}

// ─── Send message ─────────────────────────────────────────────────────────────

async function sendMessage() {
  const content = els.messageInput.value.trim();
  if (!content || !state.activeChannelId) return;

  els.messageInput.value = '';
  resizeTextarea();

  const result = await discordAPI.sendMessage(state.activeChannelId, content);
  if (result.success) {
    // Optimistically append (gateway will echo it back too, deduplicate)
    const msgs = state.messages[state.activeChannelId] || [];
    if (!msgs.find((m) => m.id === result.message.id)) {
      msgs.push(result.message);
      state.messages[state.activeChannelId] = msgs;
      appendMessage(result.message, true);
    }
    updateDMPreview(state.activeChannelId, content);
  }
}

els.btnSend.addEventListener('click', sendMessage);

els.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

els.messageInput.addEventListener('input', resizeTextarea);

function resizeTextarea() {
  const ta = els.messageInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

// ─── Real-time events ─────────────────────────────────────────────────────────

function handleIncomingMessage(msg) {
  // If it's for the active channel, display it (avoid duplicates)
  if (msg.channel_id === state.activeChannelId) {
    const msgs = state.messages[state.activeChannelId] || [];
    if (!msgs.find((m) => m.id === msg.id)) {
      msgs.push(msg);
      state.messages[msg.channel_id] = msgs;
      appendMessage(msg, true);
    }
  }

  // Update DM preview in sidebar
  updateDMPreview(msg.channel_id, msg.content);

  // Move channel to top of list
  const idx = state.channels.findIndex((c) => c.id === msg.channel_id);
  if (idx > 0) {
    const [ch] = state.channels.splice(idx, 1);
    state.channels.unshift(ch);
    renderDMList(state.channels);
    // Re-apply active class
    if (state.activeChannelId) {
      const li = els.dmList.querySelector(`[data-channel-id="${state.activeChannelId}"]`);
      if (li) li.classList.add('active');
    }
  }
}

function handleDMCreated(channel) {
  // Add new DM to top of list
  if (!state.channels.find((c) => c.id === channel.id)) {
    state.channels.unshift(channel);
    renderDMList(state.channels);
    openDMChannel(channel);
  }
}

function handleTypingStart(data) {
  if (data.channel_id !== state.activeChannelId) return;
  if (state.currentUser && data.user_id === state.currentUser.id) return;

  // Get name from active channel recipients
  const ch = state.channels.find((c) => c.id === data.channel_id);
  const name = ch ? channelName(ch) : 'Someone';

  els.typingName.textContent = name;
  setVisible(els.typingIndicator, true);

  // Auto-hide after 5 seconds
  clearTimeout(state.typingTimers[data.channel_id]);
  state.typingTimers[data.channel_id] = setTimeout(() => {
    setVisible(els.typingIndicator, false);
  }, 5000);
}

// ─── New Chat / Add Friend modal ──────────────────────────────────────────────

els.btnNewChat.addEventListener('click', () => {
  setVisible(els.modalOverlay, true);
  setVisible(els.dmError, false);
  setVisible(els.friendError, false);
  setVisible(els.friendSuccess, false);
  els.dmUserId.value = '';
  els.friendUsername.value = '';
});

els.modalClose.addEventListener('click', () => setVisible(els.modalOverlay, false));
els.modalOverlay.addEventListener('click', (e) => {
  if (e.target === els.modalOverlay) setVisible(els.modalOverlay, false);
});

// Tab switching
els.modalTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.modalTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.modal-tab-content').forEach((c) => c.classList.remove('active'));
    $(`tab-${tabName}`).classList.add('active');
  });
});

els.btnOpenDM.addEventListener('click', async () => {
  const userId = els.dmUserId.value.trim();
  if (!userId) return;
  setVisible(els.dmError, false);

  const result = await discordAPI.createDM(userId);
  if (result.success) {
    // Add to list if not already there
    if (!state.channels.find((c) => c.id === result.channel.id)) {
      state.channels.unshift(result.channel);
    }
    renderDMList(state.channels);
    setVisible(els.modalOverlay, false);
    openDMChannel(result.channel);
  } else {
    els.dmError.textContent = result.error || 'Could not open DM. Check the user ID.';
    setVisible(els.dmError, true);
  }
});

els.dmUserId.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.btnOpenDM.click();
});

els.btnAddFriend.addEventListener('click', async () => {
  const username = els.friendUsername.value.trim();
  if (!username) return;
  setVisible(els.friendError, false);
  setVisible(els.friendSuccess, false);

  const result = await discordAPI.addFriend(username);
  if (result.success) {
    els.friendSuccess.textContent = `Friend request sent to ${username}!`;
    setVisible(els.friendSuccess, true);
    els.friendUsername.value = '';
  } else {
    els.friendError.textContent = result.error || 'Could not send friend request.';
    setVisible(els.friendError, true);
  }
});

els.friendUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.btnAddFriend.click();
});

// ─── Settings modal ───────────────────────────────────────────────────────────

els.btnSettings.addEventListener('click', () => {
  if (state.currentUser) {
    els.settingsAvatar.src = avatarUrl(state.currentUser, 88);
    els.settingsUsername.textContent = displayName(state.currentUser);
    els.settingsUserId.textContent = state.currentUser.id;
  }
  setVisible(els.settingsOverlay, true);
});

els.settingsClose.addEventListener('click', () => setVisible(els.settingsOverlay, false));
els.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === els.settingsOverlay) setVisible(els.settingsOverlay, false);
});

els.toggleAlwaysTop.addEventListener('change', () => {
  state.pinned = els.toggleAlwaysTop.checked;
  discordAPI.togglePin();
});

els.settingsLogout.addEventListener('click', logout);

// ─── Logout ───────────────────────────────────────────────────────────────────

els.btnLogout.addEventListener('click', logout);

async function logout() {
  await discordAPI.logout();
  state.currentUser = null;
  state.channels = [];
  state.activeChannelId = null;
  state.messages = {};

  // Remove event listeners
  discordAPI.removeAllListeners('message');
  discordAPI.removeAllListeners('dmCreated');
  discordAPI.removeAllListeners('typingStart');

  // Reset UI
  els.tokenInput.value = '';
  setVisible(els.loginError, false);
  setVisible(els.settingsOverlay, false);
  showView('login');
}

// ─── Window controls ──────────────────────────────────────────────────────────

els.btnClose.addEventListener('click', () => discordAPI.close());
els.btnMinimize.addEventListener('click', () => discordAPI.minimize());
els.btnPin.addEventListener('click', () => {
  state.pinned = !state.pinned;
  els.btnPin.classList.toggle('active', state.pinned);
  discordAPI.togglePin();
});

// ESC closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.modalOverlay.classList.contains('hidden')) {
      setVisible(els.modalOverlay, false);
    } else if (!els.settingsOverlay.classList.contains('hidden')) {
      setVisible(els.settingsOverlay, false);
    }
  }
});
