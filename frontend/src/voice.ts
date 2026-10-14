// Optional voice commands for the user page.
// Transcript matching against a tiny fixed vocabulary ("GuideWing, help" etc.), not a wake-word model
// and not conversational AI. Recognition is the browser's Web Speech API; in Chrome and Edge the audio
// is normally processed by the browser vendor's cloud service, so it is NOT offline.
// Nothing is recorded or stored: the last transcript lives only in memory for the on-screen display.
//
// VoiceController is the single coordinator between the microphone and app speech: recognition is
// stopped while the app speaks (so announcements cannot be heard as commands), results that overlap
// speech are discarded, and continuous listening resumes only after a short tail with restart backoff.

export type VoiceCommand = "help" | "cancel" | "status" | "repeat";
export type VoiceState = "unsupported" | "off" | "permission" | "ready" | "listening" | "processing" | "speaking" | "error";
export interface Alternative { transcript: string; confidence: number }

/** Below this reported confidence a final result never runs a command. 0 means the browser did not report one. */
export const MIN_CONFIDENCE = 0.5;
const PREFIX = /^(?:(?:hey|ok|okay|um|uh)\s+)*(?:guide\s?wings?|guidewings?)\s+/;
const COMMANDS: Record<string, VoiceCommand> = { help: "help", cancel: "cancel", status: "status", repeat: "repeat" };

/** Exact grammar: optional filler, the GuideWing prefix, one command word, optional "please". */
export function parseCommand(transcript: string): VoiceCommand | null {
  const text = transcript.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const m = PREFIX.exec(text);
  if (!m) return null;
  const rest = text.slice(m[0].length).replace(/\s+please$/, "");
  return COMMANDS[rest] ?? null;
}

export type Heard = { transcript: string; command: VoiceCommand | null; confidence: number; reason?: string };

/** Picks the first alternative that parses with acceptable confidence; otherwise reports why nothing ran. */
export function pickCommand(alternatives: Alternative[], min = MIN_CONFIDENCE): Heard {
  const top = alternatives[0] ?? { transcript: "", confidence: 0 };
  for (const alt of alternatives) {
    const command = parseCommand(alt.transcript);
    if (!command) continue;
    if (alt.confidence > 0 && alt.confidence < min) return { transcript: alt.transcript, command: null, confidence: alt.confidence, reason: "low-confidence" };
    return { transcript: alt.transcript, command, confidence: alt.confidence };
  }
  return { transcript: top.transcript, command: null, confidence: top.confidence, reason: "not-a-command" };
}

// ---- recognizer abstraction (browser adapter + test mocks) --------------------------------

export interface Recognizer {
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((alternatives: Alternative[]) => void) | null; // final results only
  onerror: ((code: string) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => {
  continuous: boolean; interimResults: boolean; maxAlternatives: number; lang: string;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  start(): void; stop(): void; abort(): void;
};

export function speechRecognitionCtor(win: unknown = typeof window === "undefined" ? undefined : window): SpeechRecognitionCtor | null {
  const w = win as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

export function createBrowserRecognizer(win?: unknown): Recognizer | null {
  const Ctor = speechRecognitionCtor(win);
  if (!Ctor) return null;
  const native = new Ctor();
  native.interimResults = false; // partial transcripts are never used
  native.maxAlternatives = 3;
  native.lang = "en-US";
  const r: Recognizer = {
    continuous: false, onstart: null, onresult: null, onerror: null, onend: null,
    start() { native.continuous = r.continuous; native.start(); },
    stop() { native.stop(); },
    abort() { native.abort(); },
  };
  native.onstart = () => r.onstart?.();
  native.onend = () => r.onend?.();
  native.onerror = e => r.onerror?.(e.error);
  native.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result.isFinal) continue;
      r.onresult?.(Array.from({ length: result.length }, (_, k) => ({ transcript: result[k].transcript, confidence: result[k].confidence })));
    }
  };
  return r;
}

// ---- controller ----------------------------------------------------------------------------

export interface VoiceSnapshot {
  state: VoiceState;
  enabled: boolean;
  continuous: boolean;
  lastHeard: Heard | null;
  message: string;
}

export interface VoiceOptions {
  createRecognizer: () => Recognizer | null;
  /** Prompts for microphone permission (and releases the device immediately). */
  requestMicrophone?: () => Promise<void>;
  onCommand: (command: VoiceCommand, transcript: string) => Promise<unknown> | unknown;
  onChange: (snapshot: VoiceSnapshot) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const FATAL: Record<string, string> = {
  "not-allowed": "Microphone access was denied. Allow the microphone in the browser's site settings, then enable voice again.",
  "service-not-allowed": "This browser blocked its speech recognition service. Use the buttons or keyboard instead.",
  "audio-capture": "No microphone was found. Connect one, then enable voice again.",
  "language-not-supported": "Speech recognition does not support English (US) in this browser.",
};
export const SPEECH_TAIL_MS = 700;       // continuous listening restarts this long after app speech ends
export const DUPLICATE_WINDOW_MS = 4000; // the same command again within this window is ignored
const MAX_RAPID_RESTARTS = 5;

export class VoiceController {
  readonly supported: boolean;
  private recognizer: Recognizer | null = null;
  private enabled = false;
  private continuous = false;
  private sessionActive = false;
  private sessionStarted = 0;
  private sessionTainted = false; // app speech overlapped this session: its results are discarded
  private speaking = false;
  private speechEndedAt = -Infinity;
  private processing = false;
  private hidden = false;
  private wantSingle = false;    // a push-to-talk request is waiting for (or using) a session
  private singleSession = false; // the open session was started for push-to-talk
  private ending = false;        // we asked the open session to stop; its onend is still due
  private fatal: string | null = null;
  private rapidEnds = 0;
  private restartTimer: unknown = null;
  private last: { command: VoiceCommand; at: number } | null = null;
  private snap: VoiceSnapshot;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (id: unknown) => void;

  constructor(private o: VoiceOptions) {
    this.now = o.now ?? (() => Date.now());
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? (id => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.recognizer = o.createRecognizer();
    this.supported = !!this.recognizer;
    if (this.recognizer) this.wire(this.recognizer);
    this.snap = { state: this.supported ? "off" : "unsupported", enabled: false, continuous: false, lastHeard: null,
      message: this.supported ? "Voice commands are off." : "Voice commands are not supported in this browser. Buttons, keyboard and gestures still work." };
  }

  get snapshot() { return this.snap; }

  async enable() {
    if (!this.supported || this.enabled) return;
    this.fatal = null;
    this.update("permission", "Waiting for microphone permission...");
    try { await this.o.requestMicrophone?.(); }
    catch (e) {
      const name = (e as { name?: string })?.name;
      this.fail(name === "NotFoundError" ? FATAL["audio-capture"] : FATAL["not-allowed"]);
      return;
    }
    this.enabled = true;
    this.rapidEnds = 0;
    this.update("ready", this.continuous ? "Voice on. Listening for GuideWing commands." : "Voice on. Press Speak a command, then say a GuideWing command.");
    if (this.continuous) this.scheduleStart(0);
  }

  disable() {
    this.enabled = false; this.wantSingle = false;
    this.cancelRestart();
    this.endSession("abort");
    this.sessionActive = false;
    this.update(this.supported ? "off" : "unsupported", this.supported ? "Voice commands are off." : this.snap.message);
  }

  setContinuous(on: boolean) {
    this.continuous = on;
    this.rapidEnds = 0;
    if (!this.enabled) { this.update(this.snap.state, this.snap.message); return; }
    if (on) this.scheduleStart(0);
    else { this.cancelRestart(); if (!this.wantSingle) this.endSession("stop"); }
    this.update(this.sessionActive ? "listening" : "ready", on ? "Continuous listening on." : "Continuous listening off. Use Speak a command.");
  }

  /** Push-to-talk: listen for one utterance. The caller silences app speech first. */
  pushToTalk() {
    if (!this.enabled || this.fatal || this.processing) return false;
    this.wantSingle = true;
    this.cancelRestart();
    if (this.sessionActive && !this.ending) { this.update("listening", "Listening. Say a GuideWing command."); return true; }
    if (!this.sessionActive) this.scheduleStart(Math.max(0, this.speechEndedAt + 250 - this.now()));
    // else: the closing session's onend starts a fresh one
    return true;
  }

  /** Fed by the speech output: recognition pauses while the app is talking. */
  setSpeaking(on: boolean) {
    if (on === this.speaking) return;
    this.speaking = on;
    if (on) {
      this.cancelRestart();
      if (this.sessionActive) { this.sessionTainted = true; this.endSession("abort"); }
      if (this.enabled && !this.fatal) this.update("speaking", "Paused while GuideWing speaks.");
    } else {
      this.speechEndedAt = this.now();
      if (!this.enabled || this.fatal) return;
      this.update(this.processing ? "processing" : "ready", this.idleMessage());
      if (this.continuous || this.wantSingle) this.scheduleStart(SPEECH_TAIL_MS);
    }
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) { this.cancelRestart(); this.endSession("abort"); }
    else if (this.enabled && this.continuous && !this.fatal) this.scheduleStart(SPEECH_TAIL_MS);
    if (this.enabled && !this.fatal) this.update("ready", hidden ? "Listening paused while this tab is in the background." : this.idleMessage());
  }

  destroy() { this.disable(); if (this.recognizer) { this.recognizer.onstart = this.recognizer.onresult = this.recognizer.onerror = this.recognizer.onend = null; } }

  // ---- internals ----

  private wire(r: Recognizer) {
    r.onstart = () => {
      this.sessionActive = true; this.sessionStarted = this.now(); this.sessionTainted = false;
      this.update("listening", this.wantSingle ? "Listening. Say a GuideWing command." : "Listening for GuideWing commands.");
    };
    r.onresult = alts => this.handleResult(alts);
    r.onerror = code => {
      if (code === "aborted") return; // we caused it (speech, hide, disable)
      if (FATAL[code]) { this.fail(FATAL[code]); return; }
      if (code === "no-speech") { if (this.wantSingle) { this.wantSingle = false; this.update("ready", "No command heard. Press Speak a command to try again."); } return; }
      if (code === "network") {
        this.continuous = false; this.wantSingle = false;
        this.update("error", "Speech recognition needs a network connection in this browser and could not reach its service. Buttons and keyboard still work.");
        return;
      }
      this.wantSingle = false;
      this.update("error", `Speech recognition error (${code}). Buttons and keyboard still work.`);
    };
    r.onend = () => {
      const lasted = this.now() - this.sessionStarted;
      const wasSingle = this.singleSession;
      this.sessionActive = false; this.singleSession = false; this.ending = false;
      if (!this.enabled || this.fatal) return;
      if (this.wantSingle && !this.speaking && !this.hidden) {
        if (!wasSingle) { this.scheduleStart(250); return; } // push-to-talk pressed while another session was closing
        this.wantSingle = false;
        if (this.snap.state === "listening") this.update("ready", "Stopped listening. Press Speak a command to try again.");
      }
      if (!this.continuous || this.speaking || this.hidden) {
        if (this.snap.state === "listening") this.update("ready", this.idleMessage());
        return;
      }
      // Guard against restart loops: sessions that end immediately back off and finally stop.
      this.rapidEnds = lasted < 1000 ? this.rapidEnds + 1 : 0;
      if (this.rapidEnds > MAX_RAPID_RESTARTS) {
        this.continuous = false;
        this.update("error", "Continuous listening stopped because recognition kept ending. Use Speak a command instead.");
        return;
      }
      this.scheduleStart(this.rapidEnds ? Math.min(8000, 500 * 2 ** this.rapidEnds) : 300);
    };
  }

  private handleResult(alts: Alternative[]) {
    if (!this.enabled || this.fatal) return;
    const heard = pickCommand(alts);
    const t = this.now();
    // Results from a session that overlapped app speech, or arriving with no session open, may be our own voice.
    if (this.speaking || this.sessionTainted || !this.sessionActive) return;
    this.wantSingle = false;
    if (!heard.command) {
      this.update(this.snap.state, heard.reason === "low-confidence" ? "Not sure what was said. Nothing was changed." : "Not a GuideWing command. Nothing was changed.", heard);
      return;
    }
    if (this.last && this.last.command === heard.command && t - this.last.at < DUPLICATE_WINDOW_MS) return; // repeated final result
    if (this.processing) { this.update(this.snap.state, "Still finishing the previous command.", heard); return; }
    this.last = { command: heard.command, at: t };
    this.processing = true;
    this.update("processing", `Heard "${heard.transcript.trim()}". Working on it...`, heard);
    Promise.resolve()
      .then(() => this.o.onCommand(heard.command!, heard.transcript))
      .catch(() => undefined) // handlers report their own outcomes
      .finally(() => {
        this.processing = false;
        if (this.last) this.last.at = this.now();
        if (this.enabled && !this.fatal && this.snap.state === "processing") this.update(this.speaking ? "speaking" : this.sessionActive ? "listening" : "ready", this.idleMessage());
      });
  }

  private scheduleStart(ms: number) {
    this.cancelRestart();
    this.restartTimer = this.setTimer(() => { this.restartTimer = null; this.startNow(); }, ms);
  }

  private cancelRestart() { if (this.restartTimer !== null) { this.clearTimer(this.restartTimer); this.restartTimer = null; } }

  private startNow() {
    if (!this.recognizer || !this.enabled || this.fatal || this.speaking || this.hidden || this.sessionActive) return;
    if (!this.continuous && !this.wantSingle) return;
    this.recognizer.continuous = this.continuous && !this.wantSingle;
    this.sessionActive = true; this.sessionStarted = this.now(); this.sessionTainted = false;
    this.singleSession = this.wantSingle; this.ending = false;
    try { this.recognizer.start(); }
    catch { this.sessionActive = false; /* already started (InvalidStateError): its onend will reschedule */ }
  }

  /** Ask the open session to end, at most once per session (no repeated aborts). */
  private endSession(kind: "stop" | "abort") {
    if (!this.sessionActive || this.ending || !this.recognizer) return;
    this.ending = true;
    if (kind === "stop") this.recognizer.stop(); else this.recognizer.abort();
  }

  private fail(message: string) {
    this.fatal = message; this.enabled = false; this.continuous = false; this.wantSingle = false;
    this.cancelRestart();
    this.update("error", message);
  }

  private idleMessage() { return this.continuous ? "Listening for GuideWing commands." : "Voice on. Press Speak a command, then say a GuideWing command."; }

  private update(state: VoiceState, message: string, heard?: Heard) {
    this.snap = { state, enabled: this.enabled, continuous: this.continuous, lastHeard: heard ?? this.snap?.lastHeard ?? null, message };
    this.o.onChange(this.snap);
  }
}

/** Ask for the microphone once so permission problems surface clearly; the stream is released at once. */
export async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) return; // recognition will prompt by itself
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach(t => t.stop());
}
