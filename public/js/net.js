// WebSocket connection to the game server with automatic reconnect.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.id = null;
    this.retry = 0;
    this.wanted = false;
  }

  on(type, fn) { this.handlers[type] = fn; }

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.retry = 0; this.emit('open'); };
    ws.onclose = () => {
      this.connected = false;
      this.emit('close');
      if (this.wanted) {
        this.retry = Math.min(this.retry + 1, 6);
        setTimeout(() => this.connect(), 500 * this.retry);
      }
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'hello') this.id = msg.id;
      this.emit(msg.t, msg);
    };
  }

  emit(type, msg) { const h = this.handlers[type]; if (h) h(msg); }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
