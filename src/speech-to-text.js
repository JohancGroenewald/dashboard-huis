import { HTTP_STATUS, SPEECH_TO_TEXT_LIMITS } from './constants.js';

function textHeader(headers, name) {
  return headers?.[name] || headers?.[name.toLowerCase()] || '';
}

function publicError(status, message, detail = {}) {
  return { status, body: { error: message, ...detail } };
}

function upstreamError(status, body) {
  const detail = body?.error && typeof body.error === 'object' ? body.error : {};
  const requestId = typeof detail.request_id === 'string' ? detail.request_id : undefined;
  const code = typeof detail.code === 'string' ? detail.code : undefined;
  const suffix = requestId ? ` (request ${requestId})` : '';
  return publicError(status, `${detail.message || 'Speech-to-text failed.'}${suffix}`, {
    ...(code ? { code } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  });
}

export async function forwardTranscription(req, {
  baseUrl,
  token,
  timeoutMs = SPEECH_TO_TEXT_LIMITS.timeoutMs,
  maxUploadBytes = SPEECH_TO_TEXT_LIMITS.maxUploadBytes,
  fetchImpl = fetch,
} = {}) {
  if (!token) {
    return publicError(HTTP_STATUS.serviceUnavailable, 'Speech-to-text is not configured on the dashboard server.');
  }
  const contentType = textHeader(req.headers, 'content-type');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return publicError(HTTP_STATUS.badRequest, 'Speech-to-text expects a multipart audio upload.');
  }
  const contentLength = Number(textHeader(req.headers, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
    return publicError(HTTP_STATUS.payloadTooLarge, 'Audio upload is too large for speech-to-text.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${String(baseUrl || '').replace(/\/$/, '')}/v1/transcriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': contentType,
      },
      body: req,
      duplex: 'half',
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return upstreamError(res.status, body);
    if (typeof body?.text !== 'string') {
      return publicError(HTTP_STATUS.badGateway, 'Speech-to-text returned an unreadable response.');
    }
    return { status: HTTP_STATUS.ok || 200, body };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return publicError(HTTP_STATUS.gatewayTimeout, 'Speech-to-text timed out.');
    }
    return publicError(HTTP_STATUS.badGateway, 'Speech-to-text service could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
