'use strict';

const https = require('https');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const API_BASE = 'discord.com';
const API_PATH = '/api/v10';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

// Discord client properties sent during Gateway Identify.
// These mimic a standard Discord desktop client to reduce Gateway rejections.
// Update periodically to match current Discord client releases.
const CLIENT_PROPERTIES = {
  os: 'Windows',
  browser: 'Discord Client',
  release_channel: 'stable',
  client_version: '1.0.9163',
  os_version: '10.0.22621',
  os_arch: 'x64',
  app_arch: 'x64',
  system_locale: 'en-US',
  browser_user_agent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9163 Chrome/120.0.6099.291 Electron/28.2.10 Safari/537.36',
  browser_version: '28.2.10',
  client_build_number: 282759,
  native_build_number: 50744,
};

const GatewayOpcodes = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

/**
 * Minimal Discord REST + Gateway client for user accounts (DM focused).
 */
class DiscordClient extends EventEmitter {
  constructor(token) {
    super();
    this.token = token;
    this.ws = null;
    this.heartbeatInterval = null;
    this.sessionId = null;
    this.resumeGatewayUrl = null;
    this.sequence = null;
    this.user = null;
    this.ready = false;
  }

  // ─────────────────────────────── REST helpers ────────────────────────────

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const options = {
        hostname: API_BASE,
        path: `${API_PATH}${path}`,
        method,
        headers: {
          Authorization: this.token,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordMini/1.0.0 (discord-mini)',
        },
      };
      if (data) {
        options.headers['Content-Length'] = Buffer.byteLength(data);
      }

      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode === 204) {
            return resolve(null);
          }
          try {
            const json = JSON.parse(raw);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.message || `HTTP ${res.statusCode}`));
            }
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          }
        });
      });

      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  /** Fetch current user profile */
  async getMe() {
    return this._request('GET', '/users/@me');
  }

  /** Fetch all open DM channels */
  async getDMChannels() {
    return this._request('GET', '/users/@me/channels');
  }

  /** Fetch messages for a channel */
  async getMessages(channelId, limit = 50) {
    return this._request('GET', `/channels/${channelId}/messages?limit=${limit}`);
  }

  /** Send a message to a channel */
  async sendMessage(channelId, content) {
    return this._request('POST', `/channels/${channelId}/messages`, { content });
  }

  /** Open (or get existing) DM with a userId */
  async createDM(recipientId) {
    return this._request('POST', '/users/@me/channels', { recipient_id: recipientId });
  }

  /** Send friend request by username */
  async addFriend(username) {
    // Discord username without discriminator (new system)
    return this._request('POST', '/users/@me/relationships', { username });
  }

  /** Look up a user by their ID */
  async getUser(userId) {
    return this._request('GET', `/users/${userId}`);
  }

  /** Fetch relationships (friends list) */
  async getRelationships() {
    return this._request('GET', '/users/@me/relationships');
  }

  // ──────────────────────────────── Gateway ────────────────────────────────

  /** Connect to Discord Gateway for real-time events */
  connect() {
    const url = this.resumeGatewayUrl || GATEWAY_URL;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      // Identify is sent after receiving HELLO
    });

    this.ws.on('message', (data) => {
      try {
        this._handlePayload(JSON.parse(data.toString()));
      } catch (e) {
        // ignore parse errors
      }
    });

    this.ws.on('close', (code) => {
      this._clearHeartbeat();
      if (code !== 1000 && code !== 4004) {
        // Attempt reconnect after 5 s (skip if invalid token)
        setTimeout(() => this.connect(), 5000);
      }
    });

    this.ws.on('error', () => {
      // Will be followed by 'close'
    });
  }

  _handlePayload(payload) {
    const { op, d, s, t } = payload;
    if (s !== null && s !== undefined) this.sequence = s;

    switch (op) {
      case GatewayOpcodes.HELLO: {
        this._startHeartbeat(d.heartbeat_interval);
        if (this.sessionId) {
          this._send(GatewayOpcodes.RESUME, {
            token: this.token,
            session_id: this.sessionId,
            seq: this.sequence,
          });
        } else {
          this._identify();
        }
        break;
      }
      case GatewayOpcodes.HEARTBEAT_ACK:
        // Heartbeat acknowledged
        break;
      case GatewayOpcodes.HEARTBEAT:
        this._sendHeartbeat();
        break;
      case GatewayOpcodes.RECONNECT:
        this.ws.close(4000);
        break;
      case GatewayOpcodes.INVALID_SESSION:
        if (d) {
          // Resumable
          setTimeout(() => this._identify(), 2000);
        } else {
          this.sessionId = null;
          this.sequence = null;
          setTimeout(() => this._identify(), 2000);
        }
        break;
      case GatewayOpcodes.DISPATCH:
        this._handleDispatch(t, d);
        break;
    }
  }

  _identify() {
    this._send(GatewayOpcodes.IDENTIFY, {
      token: this.token,
      capabilities: 16381,
      properties: CLIENT_PROPERTIES,
      presence: { activities: [], status: 'online', since: 0, afk: false },
      compress: false,
    });
  }

  _handleDispatch(event, data) {
    switch (event) {
      case 'READY':
        this.user = data.user;
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        this.ready = true;
        this.emit('ready', data);
        break;
      case 'MESSAGE_CREATE':
        this.emit('message', data);
        break;
      case 'MESSAGE_UPDATE':
        this.emit('messageUpdate', data);
        break;
      case 'MESSAGE_DELETE':
        this.emit('messageDelete', data);
        break;
      case 'CHANNEL_CREATE':
        if (data.type === 1) {
          // DM channel
          this.emit('dmCreated', data);
        }
        break;
      case 'TYPING_START':
        this.emit('typingStart', data);
        break;
      case 'RELATIONSHIP_ADD':
        this.emit('relationshipAdd', data);
        break;
      case 'RELATIONSHIP_REMOVE':
        this.emit('relationshipRemove', data);
        break;
    }
  }

  _send(op, d) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  _startHeartbeat(intervalMs) {
    this._clearHeartbeat();
    // Send one immediately then on interval
    this._sendHeartbeat();
    this.heartbeatInterval = setInterval(() => this._sendHeartbeat(), intervalMs);
  }

  _sendHeartbeat() {
    this._send(GatewayOpcodes.HEARTBEAT, this.sequence);
  }

  _clearHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Login: validate token and connect to Gateway */
  async login() {
    this.user = await this.getMe();
    this.connect();
    return this.user;
  }

  /**
   * Exchange email/password credentials for a user token.
   * Returns the token string on success, or throws an error.
   */
  static getTokenFromCredentials(email, password) {
    return new Promise((resolve, reject) => {
      const browserUserAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36';
      const xSuperProperties = Buffer.from(
        JSON.stringify({
          os: 'Windows',
          browser: 'Chrome',
          device: '',
          system_locale: 'en-US',
          browser_user_agent: browserUserAgent,
          browser_version: '120.0.6099.291',
          os_version: '10',
          referrer: '',
          referring_domain: '',
          referrer_current: '',
          referring_domain_current: '',
          release_channel: 'stable',
          client_build_number: CLIENT_PROPERTIES.client_build_number,
          client_event_source: null,
        }),
      ).toString('base64');

      const data = JSON.stringify({
        login: email,
        password,
        undelete: false,
        captcha_key: null,
        login_source: null,
        gift_code_sku_id: null,
      });
      const options = {
        hostname: API_BASE,
        path: `${API_PATH}/auth/login`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': browserUserAgent,
          'X-Super-Properties': xSuperProperties,
          'X-Discord-Locale': 'en-US',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            if (json.token) {
              resolve(json.token);
            } else if (json.mfa) {
              reject(new Error('MFA is enabled on this account. Please switch to the Token tab and use your user token instead.'));
            } else {
              reject(new Error(json.message || `Login failed (HTTP ${res.statusCode})`));
            }
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  /** Disconnect from gateway */
  disconnect() {
    this._clearHeartbeat();
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    this.ready = false;
    this.sessionId = null;
    this.sequence = null;
  }
}

module.exports = DiscordClient;
