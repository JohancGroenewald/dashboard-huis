// Fetch wrapper. Every request carries a per-tab client id so the server's
// SSE broadcasts can mark which tab caused a change (echo suppression).
export const clientId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

export async function api(path, opts = {}) {
  const { data } = await apiWithRes(path, opts);
  return data;
}

// Variant that also exposes the Response (e.g. to read X-Dashboard-Rev).
export async function apiWithRes(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'x-client-id': clientId, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return { data, res };
}

export const jsonBody = (obj, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
