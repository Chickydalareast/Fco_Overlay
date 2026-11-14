import type { ClientCommand, ServerEvent } from "./contracts.js";

export class LiveConnection {
  private socket: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private reconnectHandle = 0;
  private readonly url: string;
  onEvent: (event: ServerEvent) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  /** Consecutive failed connection attempts (0 while connected). */
  get failures() { return this.retry; }
  constructor(role: "admin" | "output", token = "", label = "") {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const query = role === "output" ? `?role=output&token=${encodeURIComponent(token)}${label ? `&label=${encodeURIComponent(label)}` : ""}` : "?role=admin";
    this.url = `${scheme}//${location.host}/ws${query}`;
  }
  connect() {
    this.stopped = false;
    this.open();
  }
  private open() {
    if (this.stopped) return;
    try {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.onopen = () => {
        this.retry = 0;
        this.onStatus(true);
      };
      socket.onmessage = (event) => {
        try {
          const decoded: ServerEvent = JSON.parse(event.data);
          this.onEvent(decoded);
        } catch { /* discard malformed messages */ }
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.onStatus(false);
        if (!this.stopped) this.scheduleReconnect();
      };
      socket.onerror = () => { socket.close(); };
    } catch {
      this.onStatus(false);
      this.scheduleReconnect();
    }
  }
  private scheduleReconnect() {
    const delay = Math.min(8000, 300 * 2 ** this.retry++) + Math.floor(Math.random() * 180);
    this.reconnectHandle = window.setTimeout(() => this.open(), delay);
  }
  send(command: ClientCommand | { type: "renderer.ready"; revision: number }
    | {type:'renderer.media';revision:number;ready:string[];waiting:string[]}
    | { type: "camera.prewarm";boId:string;playerIds:string[] }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(command));
    return true;
  }
  close() {
    this.stopped = true;
    window.clearTimeout(this.reconnectHandle);
    this.socket?.close();
    this.socket = null;
  }
}
