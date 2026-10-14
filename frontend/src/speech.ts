// Speech output for the user page (the only speech owner in the system).
// Providers are replaceable; the browser's SpeechSynthesis is the default.
// Announcements are deduplicated by a semantic key (e.g. incident id + transition),
// so re-renders, reconnects and duplicate events never repeat speech.

export interface SpeechProvider {
  readonly name: string;
  available(): boolean;
  speak(text: string): void;
  stop(): void;
  /** Reports when audible output starts/stops, so voice recognition can pause meanwhile. */
  onActivity?: (speaking: boolean) => void;
}

// Upper bound used when a browser never fires the end event (seen with long utterances in Chromium).
const maxSpeechMs = (text: string) => 4000 + text.length * 90;

export class BrowserSpeechProvider implements SpeechProvider {
  readonly name = "browser";
  onActivity?: (speaking: boolean) => void;
  private current = 0;
  private guard: number | undefined;
  available() {
    return typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function";
  }
  speak(text: string) {
    if (!this.available()) return;
    window.speechSynthesis.cancel(); // newest meaningful message wins; stale speech is discarded
    const id = ++this.current;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    const done = () => { if (id === this.current) this.finish(); };
    u.onend = done;
    u.onerror = done;
    window.clearTimeout(this.guard);
    this.guard = window.setTimeout(done, maxSpeechMs(text));
    this.onActivity?.(true);
    window.speechSynthesis.speak(u);
  }
  stop() {
    this.current++;
    if (this.available()) window.speechSynthesis.cancel();
    this.finish();
  }
  private finish() {
    window.clearTimeout(this.guard);
    this.onActivity?.(false);
  }
}

/**
 * Server-side voice (ElevenLabs via /api/speech, cached) when the backend has a key;
 * falls back to browser speech on any failure or timeout. Newest message wins.
 */
export class ServerThenBrowserSpeech implements SpeechProvider {
  name = "browser";
  onActivity?: (speaking: boolean) => void;
  private useServer = false;
  private audio: HTMLAudioElement | null = null;
  private token = 0;
  private request: AbortController | null = null;
  private objectUrl: string | null = null;
  constructor(private fallback: SpeechProvider = new BrowserSpeechProvider()) {
    fallback.onActivity = (on) => this.onActivity?.(on);
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
    this.fallback.stop(); // also reports "not speaking"
  }
  speak(text: string) {
    this.stop();
    const token = this.token;
    if (!this.useServer) return this.fallback.speak(text);
    // From the request onward the app counts as speaking, so the microphone stays paused.
    this.onActivity?.(true);
    const ctrl = new AbortController();
    this.request = ctrl;
    const timer = window.setTimeout(() => ctrl.abort(), 3000);
    fetch(`/api/speech?text=${encodeURIComponent(text)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`speech ${r.status}`))))
      .then((blob) => {
        if (token !== this.token) return; // a newer message replaced this one
        this.objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(this.objectUrl);
        this.audio = audio;
        const done = () => { if (token === this.token) this.onActivity?.(false); };
        audio.onended = done;
        audio.onerror = done;
        window.setTimeout(done, maxSpeechMs(text));
        return audio.play();
      })
      .catch(() => {
        if (token === this.token) this.fallback.speak(text);
      })
      .finally(() => window.clearTimeout(timer));
  }
}

const LAST_KEY = "guidewing.lastMessage";
const SPOKEN_KEY = "guidewing.spokenKeys";

/**
 * "urgent": obstacle warnings. "normal": assistance and connection updates. "optional": narration
 * (spoken Status, simulated-route checkpoints, readiness). Optional speech never interrupts urgent or
 * normal speech; it is dropped instead of queued, so nothing stale plays later.
 */
export type Priority = "urgent" | "normal" | "optional";

export class Announcer {
  private spoken: string[];
  enabled = false;
  lastMessage: string | null;
  speaking = false;
  private speakingPriority: Priority = "normal";
  private listeners = new Set<(speaking: boolean) => void>();

  constructor(private provider: SpeechProvider, private onText: (text: string) => void) {
    const keys = readJson<unknown>(SPOKEN_KEY, []);
    this.spoken = Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
    this.lastMessage = safeGet(LAST_KEY);
    provider.onActivity = (on) => {
      if (on === this.speaking) return;
      this.speaking = on;
      this.listeners.forEach((fn) => fn(on));
    };
  }

  /** Subscribe to audible-speech changes (the voice controller pauses recognition meanwhile). */
  onSpeaking(fn: (speaking: boolean) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Stop current speech but stay enabled (used for push-to-talk barge-in). */
  silence() { this.provider.stop(); }

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

  announce(key: string, text: string, priority: Priority = "normal") {
    if (this.spoken.includes(key)) return false;
    this.remember(key);
    this.say(text, priority);
    return true;
  }

  /** Speak without dedupe (status confirmations for the user's own actions). Returns false if skipped. */
  say(text: string, priority: Priority = "normal") {
    if (priority === "optional" && this.speaking && this.speakingPriority !== "optional") return false; // dropped, never queued
    this.lastMessage = text;
    safeSet(LAST_KEY, text);
    this.onText(text);
    this.speakNow(text, priority);
    return true;
  }

  repeat() {
    if (!this.lastMessage) return false;
    this.onText(this.lastMessage);
    this.speakNow(this.lastMessage, "normal");
    return true;
  }

  private speakNow(text: string, priority: Priority) {
    if (!this.enabled) return;
    this.speakingPriority = priority;
    this.provider.speak(text);
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
