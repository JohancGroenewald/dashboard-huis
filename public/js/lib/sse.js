// SSE plumbing, both directions we use it:
// - listenEvents(): the long-lived GET /api/events broadcast channel
//   (EventSource reconnects itself; we surface drops so callers can resync).
// - streamSse(): parse an SSE-framed *POST response body* — EventSource can't
//   POST, so chat runs stream over fetch + ReadableStream instead.

export function listenEvents({ events = {}, onDrop } = {}) {
  const es = new EventSource('/api/events');
  es.onerror = () => onDrop?.();
  for (const [name, fn] of Object.entries(events)) {
    es.addEventListener(name, (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      fn(data);
    });
  }
  return es;
}

function parseFrame(frame) {
  let event = 'message';
  const datas = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) datas.push(line.slice(5).trim());
  }
  if (!datas.length) return null;
  try { return { event, data: JSON.parse(datas.join('\n')) }; } catch { return null; }
}

// POST and read the streamed SSE response, invoking onEvent(name, data) per
// frame. Resolves when the stream ends; throws on a non-OK (JSON) response.
export async function streamSse(path, opts, onEvent) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const ev = parseFrame(buf.slice(0, i));
      buf = buf.slice(i + 2);
      if (ev) onEvent(ev.event, ev.data);
    }
  }
}
