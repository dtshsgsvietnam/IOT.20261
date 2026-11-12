const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request('/health'),
  summary: () => request('/summary'),
  slots: () => request('/slots'),
  devices: () => request('/devices'),
  sessions: (params) => request(`/sessions${qs(params)}`),
  events: (params) => request(`/events${qs(params)}`),
  cards: () => request('/cards'),
  createCard: (card) => request('/cards', { method: 'POST', body: JSON.stringify(card) }),
  updateCard: (uid, patch) => request(`/cards/${uid}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  sendCommand: (deviceId, command, params = {}) =>
    request(`/devices/${deviceId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command, params }),
    }),
};

