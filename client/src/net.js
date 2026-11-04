// WebSocket connection to the game server, with automatic reconnect.
export class Net {
  constructor({ url, join, onMessage, onStatus }) {
    this.url = url;
    this.join = join;
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.retry = 0;
    this.connect();
  }

  connect() {
    this.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus('connected');
      ws.send(JSON.stringify(this.join));
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error('bad message', err);
      }
    };
    ws.onclose = (e) => {
      if (e.code === 4000) {
        this.onStatus('replaced');
        return; // this player opened the game somewhere else
      }
      this.onStatus('reconnecting');
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
