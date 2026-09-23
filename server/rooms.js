'use strict';
/* Multiplayer relay. The host's browser runs the game; this only passes messages
   between the host and the guests in a room. It never looks inside game messages. */
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { Buckets, log } = require('./util');

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_MSG = 3 * 1024 * 1024;         // a guest's song list can be ~1 MB
const MAX_CONN_PER_IP = 12;

function attach(server, cfg, { allowedOrigin, clientIp }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG, perMessageDeflate: false });
  const rooms = new Map();                 // code -> { host, guests: Map(id -> ws) }
  const perIp = new Map();
  const msgRate = new Buckets(40, 20);     // per socket
  const joinRate = new Buckets(10, 0.5);   // per IP: room creates / joins

  const send = (ws, m) => { if (ws.readyState === 1 && ws.bufferedAmount < 8 * MAX_MSG) ws.send(JSON.stringify(m)); };
  const newCode = () => { for (let i = 0; i < 50; i++) { const c = Array.from(crypto.randomBytes(5), b => LETTERS[b % LETTERS.length]).join(''); if (!rooms.has(c)) return c; } return null; };

  server.on('upgrade', (req, socket, head) => {
    const ip = clientIp(req);
    const url = req.url || '';
    if (!url.startsWith('/ws') || !allowedOrigin(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    if ((perIp.get(ip) || 0) >= MAX_CONN_PER_IP) { socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => { ws.ip = ip; wss.emit('connection', ws); });
  });

  wss.on('connection', ws => {
    perIp.set(ws.ip, (perIp.get(ws.ip) || 0) + 1);
    ws.id = crypto.randomBytes(6).toString('hex');
    ws.alive = true; ws.room = null; ws.role = null;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (raw, isBinary) => {
      if (isBinary || !msgRate.take(ws.id)) return;
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      handle(ws, m);
    });
    ws.on('close', () => {
      const n = (perIp.get(ws.ip) || 1) - 1; if (n > 0) perIp.set(ws.ip, n); else perIp.delete(ws.ip);
      leave(ws);
    });
    ws.on('error', () => {});
  });

  function handle(ws, m) {
    if (m.t === 'host' && !ws.room) {
      if (!joinRate.take(ws.ip)) return send(ws, { t: 'error', code: 'rate', msg: 'Too many games created. Wait a minute.' });
      if (rooms.size >= cfg.maxRooms) return send(ws, { t: 'error', code: 'full', msg: 'The server is full right now. Try again later.' });
      const code = newCode(); if (!code) return send(ws, { t: 'error', code: 'full', msg: 'Couldn’t create a game code.' });
      rooms.set(code, { host: ws, guests: new Map() });
      ws.room = code; ws.role = 'host';
      return send(ws, { t: 'hosted', code });
    }
    if (m.t === 'join' && !ws.room) {
      if (!joinRate.take(ws.ip)) return send(ws, { t: 'error', code: 'rate', msg: 'Too many attempts. Wait a minute.' });
      const code = String(m.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', code: 'no-room', msg: `No game found with code ${code.slice(0, 6)}.` });
      if (room.guests.size >= cfg.maxPlayers) return send(ws, { t: 'error', code: 'room-full', msg: 'That game is full.' });
      room.guests.set(ws.id, ws);
      ws.room = code; ws.role = 'guest';
      send(ws, { t: 'joined', id: ws.id });
      return send(room.host, { t: 'peer', ev: 'open', id: ws.id });
    }
    const room = ws.room && rooms.get(ws.room); if (!room) return;
    if (ws.role === 'host') {
      if (m.t === 'to') {
        if (m.to === '*') { const s = JSON.stringify({ t: 'msg', d: m.d }); for (const g of room.guests.values()) if (g.readyState === 1 && g.bufferedAmount < 8 * MAX_MSG) g.send(s); }
        else { const g = room.guests.get(String(m.to)); if (g) send(g, { t: 'msg', d: m.d }); }
      } else if (m.t === 'kick') { const g = room.guests.get(String(m.id)); if (g) g.close(4000, 'removed'); }
    } else if (ws.role === 'guest' && m.t === 'up') {
      send(room.host, { t: 'msg', from: ws.id, d: m.d });
    }
  }

  function leave(ws) {
    const room = ws.room && rooms.get(ws.room); if (!room) return;
    if (ws.role === 'host') {
      rooms.delete(ws.room);
      for (const g of room.guests.values()) { send(g, { t: 'closed' }); g.room = null; g.close(4001, 'host left'); }
    } else {
      room.guests.delete(ws.id);
      send(room.host, { t: 'peer', ev: 'close', id: ws.id });
    }
    ws.room = null;
  }

  const beat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} }
  }, 25_000);
  beat.unref();

  return { stats: () => ({ rooms: rooms.size, sockets: wss.clients.size }), close: () => { clearInterval(beat); for (const ws of wss.clients) ws.terminate(); log('multiplayer relay closed'); } };
}

module.exports = { attach };
