// Speech output for the user page (the only speech owner in the system).
// Providers are replaceable; the browser's SpeechSynthesis is the default.
// Announcements are deduplicated by a semantic key (e.g. incident id + transition),
// so re-renders, reconnects and duplicate events never repeat speech.

export interface SpeechProvider {
  readonly name: string;
  available(): boolean;
  speak(text: string): void;
  stop(): void;
}

export class BrowserSpeechProvider implements SpeechProvider {
  readonly name = "browser";
  available() {
    return typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function";
  }
  speak(text: string) {
    if (!this.available()) return;
    window.speechSynthesis.cancel(); // newest meaningful message wins; stale speech is discarded
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }
  stop() {
    if (this.available()) window.speechSynthesis.cancel();
  }
}

/**
 * Server-side voice (ElevenLabs via /api/speech, cached) when the backend has a key;
 * falls back to browser speech on any failure or timeout. Newest message wins.
 */
export class ServerThenBrowserSpeech implements SpeechProvider {
  name = "browser";
  private useServer = false;
  private audio: HTMLAudioElement | null = null;
  private token = 0;
  private request: AbortController | null = null;
  private objectUrl: string | null = null;
  constructor(private fallback: SpeechProvider = new BrowserSpeechProvider()) {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        if (typeof h.speech_provider === "string" && h.speech_provider.startsWith("elevenlabs")) {
          this.useServer = true;
          this.name = "elevenlabs";
        }
      })
      .catch(() => undefined);
  }
  available() {
    return this.useServer || this.fallback.available();
  }
  stop() {
    this.token++;
    this.request?.abort();
    this.request = null;
    this.audio?.pause();
    this.audio = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.fallback.stop();
  }
  speak(text: string) {
    this.stop();
    const token = this.token;
    if (!this.useServer) return this.fallback.speak(text);
    const ctrl = new AbortController();
    this.request = ctrl;
    const timer = window.setTimeout(() => ctrl.abort(), 3000);
    fetch(`/api/speech?text=${encodeURIComponent(text)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`speech ${r.status}`))))
      .then((blob) => {
        if (token !== this.token) return; // a newer message replaced this one
        this.objectUrl = URL.createObjectURL(blob);
        this.audio = new Audio(this.objectUrl);
        return this.audio.play();
      })
      .catch(() => {
        if (token === this.token) this.fallback.speak(text);
      })
      .finally(() => window.clearTimeout(timer));
  }
}

const LAST_KEY = "guidewing.lastMessage";
const SPOKEN_KEY = "guidewing.spokenKeys";

export class Announcer {
  private spoken: string[];
  enabled = false;
  lastMessage: string | null;

  constructor(private provider: SpeechProvider, private onText: (text: string) => void) {
    const keys = readJson<unknown>(SPOKEN_KEY, []);
    this.spoken = Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
    this.lastMessage = safeGet(LAST_KEY);
  }

  get providerName() {
    return this.provider.name;
  }

  speechAvailable() {
    return this.provider.available();
  }

  /** Must be called from a user gesture (click/keypress) before audio is allowed. */
  enable() {
    this.enabled = true;
  }

  stop() { this.enabled = false; this.provider.stop(); }

  /** Mark a key as already handled without speaking (initial load / reconnect). */
  seed(key: string) {
    if (!this.spoken.includes(key)) this.remember(key);
  }

  announce(key: string, text: string) {
    if (this.spoken.includes(key)) return false;
    this.remember(key);
    this.say(text);
    return true;
  }

  /** Speak without dedupe (status confirmations for the user's own actions). */
  say(text: string) {
    this.lastMessage = text;
    safeSet(LAST_KEY, text);
    this.onText(text);
    if (this.enabled) this.provider.speak(text);
  }

  repeat() {
    if (!this.lastMessage) return false;
    this.onText(this.lastMessage);
    if (this.enabled) this.provider.speak(this.lastMessage);
    return true;
  }

  private remember(key: string) {
    this.spoken = [...this.spoken, key].slice(-200);
    safeSet(SPOKEN_KEY, JSON.stringify(this.spoken));
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: dedupe still works in memory */
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = safeGet(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
