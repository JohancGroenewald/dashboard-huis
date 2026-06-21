import { api } from '../lib/api.js';
import { toast } from '../lib/dom.js';
import { VOICE_UI } from '../constants.js';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

function preferredMime() {
  if (!window.MediaRecorder) return '';
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function extension(type) {
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  return 'webm';
}

function insertTranscript(input, text) {
  const transcript = String(text || '').trim();
  if (!transcript) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const joinBefore = before && !/\s$/.test(before) ? ' ' : '';
  const joinAfter = after && !/^\s/.test(after) ? ' ' : '';
  input.value = `${before}${joinBefore}${transcript}${joinAfter}${after}`;
  const pos = before.length + joinBefore.length + transcript.length;
  input.setSelectionRange(pos, pos);
}

export function initVoiceInput({ input, onText }) {
  const button = document.querySelector('#dock-voice');
  if (!button) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    button.disabled = true;
    button.title = 'Voice input is not supported in this browser';
    return;
  }

  let recorder = null;
  let stream = null;
  let chunks = [];
  let stopTimer = null;
  let transcribing = false;
  let available = false;

  const setState = (state) => {
    button.classList.toggle('recording', state === 'recording');
    button.classList.toggle('transcribing', state === 'transcribing');
    button.disabled = !available || state === 'transcribing';
    button.textContent = state === 'recording' ? '■' : '◉';
    button.title = state === 'recording' ? 'Stop recording' : state === 'transcribing' ? 'Transcribing…' : 'Record voice input';
  };

  const cleanup = () => {
    clearTimeout(stopTimer);
    stopTimer = null;
    for (const track of stream?.getTracks?.() || []) track.stop();
    stream = null;
    recorder = null;
  };

  async function transcribe(blob) {
    transcribing = true;
    setState('transcribing');
    try {
      const form = new FormData();
      const type = blob.type || preferredMime() || 'audio/webm';
      form.append('file', blob, `dashy-voice.${extension(type)}`);
      const out = await api('/api/speech-to-text/transcriptions', { method: 'POST', body: form });
      insertTranscript(input, out.text);
      onText?.();
      input.focus();
    } catch (err) {
      toast(err.message || 'Could not transcribe audio.', { error: true });
    } finally {
      transcribing = false;
      setState('idle');
    }
  }

  async function start() {
    if (!available || transcribing || recorder) return;
    try {
      chunks = [];
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMime();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data?.size) chunks.push(e.data);
      });
      recorder.addEventListener('stop', () => {
        const type = recorder?.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        cleanup();
        if (!blob.size) {
          toast('No audio was captured.', { error: true });
          setState('idle');
          return;
        }
        transcribe(blob);
      }, { once: true });
      recorder.start();
      stopTimer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), VOICE_UI.maxRecordMs);
      setState('recording');
    } catch (err) {
      cleanup();
      setState('idle');
      toast(err?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start microphone recording.', { error: true });
    }
  }

  button.addEventListener('click', () => {
    if (recorder?.state === 'recording') recorder.stop();
    else start();
  });

  button.disabled = true;
  button.title = 'Checking voice input…';
  api('/api/speech-to-text/status')
    .then((status) => {
      available = Boolean(status.enabled);
      if (available) setState('idle');
      else button.title = 'Voice input is not configured on the dashboard server';
    })
    .catch(() => {
      button.title = 'Voice input status could not be checked';
    });
}
