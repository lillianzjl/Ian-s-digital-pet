// Continuous conversation with live (streaming) speech recognition from Azure.
// Words are recognized while Ian speaks, and Azure decides when a sentence is done,
// so nothing is cut off and nobody has to press a button for every sentence.

const SDK_URL = "/vendor/speech-sdk/microsoft.cognitiveservices.speech.sdk.bundle-min.js";
let sdkPromise = null;

function loadSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  sdkPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.onload = () => resolve(window.SpeechSDK);
    s.onerror = () => reject(new Error("speech: could not load"));
    document.head.append(s);
  });
  return sdkPromise;
}

async function getToken() {
  const res = await fetch("/api/speech-token");
  if (!res.ok) throw new Error(`speech: token ${res.status}`);
  return res.json();
}

// How long a pause ends a sentence. Children pause while thinking, so this is generous.
const PAUSE_MS = 1300;

export class Conversation {
  // micPromise: the page's shared microphone. hints: words to listen for.
  // onPartial(text): words so far. onFinal(text): a finished sentence.
  constructor({ micPromise, hints = [], onPartial, onFinal, onError }) {
    Object.assign(this, { micPromise, hints, onPartial, onFinal, onError });
    this.muted = false;
    this.listenFrom = 0; // ignore speech that started before this moment (Ginger was talking)
  }

  async start() {
    const [SDK, tok, stream] = await Promise.all([loadSdk(), getToken(), this.micPromise]);
    const config = SDK.SpeechConfig.fromAuthorizationToken(tok.token, tok.region);
    config.speechRecognitionLanguage = "en-US";
    config.setProperty(SDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(PAUSE_MS));
    config.setProfanity(SDK.ProfanityOption.Masked);
    const recognizer = new SDK.SpeechRecognizer(config, SDK.AudioConfig.fromStreamInput(stream));
    if (this.hints.length) SDK.PhraseListGrammar.fromRecognizer(recognizer).addPhrases(this.hints);

    recognizer.recognizing = (_s, e) => {
      if (!this.muted && this.startedAfterMute(e.result)) this.onPartial?.(e.result.text);
    };
    recognizer.recognized = (_s, e) => {
      const r = e.result;
      if (r.reason !== SDK.ResultReason.RecognizedSpeech || !r.text?.trim()) return;
      if (this.muted || !this.startedAfterMute(r)) return; // that was Ginger's own voice or old speech
      this.onFinal?.(r.text.trim());
    };
    recognizer.canceled = (_s, e) => {
      if (e.reason === SDK.CancellationReason.Error) this.onError?.(`speech: ${e.errorDetails || e.errorCode}`);
    };

    await new Promise((resolve, reject) => recognizer.startContinuousRecognitionAsync(resolve, (err) => reject(new Error(`speech: ${err}`))));
    this.recognizer = recognizer;
    this.t0 = performance.now(); // offsets in results count from about here
    // Tokens last 10 minutes: refresh them while talking.
    this.refresh = setInterval(async () => {
      try {
        recognizer.authorizationToken = (await getToken()).token;
      } catch {}
    }, 8 * 60 * 1000);
  }

  // Result offsets are in 100-nanosecond ticks from the start of listening.
  startedAfterMute(result) {
    const startedAt = this.t0 + result.offset / 10000;
    return startedAt >= this.listenFrom - 200;
  }

  // While Ginger is thinking or speaking, don't listen (she'd hear herself).
  mute(on) {
    this.muted = on;
    if (!on) this.listenFrom = performance.now() + 300;
  }

  async stop() {
    clearInterval(this.refresh);
    const r = this.recognizer;
    this.recognizer = null;
    if (!r) return;
    await new Promise((resolve) => r.stopContinuousRecognitionAsync(resolve, resolve));
    r.close();
  }
}
