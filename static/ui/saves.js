// Talks to the server's saved-worlds API (see app.py). Worlds are kept in a
// SQLite file on the machine running the server, so they survive a refresh,
// a browser restart, and switching browsers.

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'The server answered ' + response.status);
  return result;
}

// Every save without its world: [{ id, name, autosave, seed, tick, updated_at }].
export const listSaves = () => request('GET', '/api/saves');

// One save with its world in `data`.
export const getSave = (id) => request('GET', '/api/saves/' + id);

// The autosave with its world in `data`, or null if there is none yet.
export async function getAutosave() {
  const autosave = (await listSaves()).find((save) => save.autosave);
  return autosave ? getSave(autosave.id) : null;
}

// Creates the save called `name`, or overwrites it. `data` is { sim, history }.
export const putSave = (name, data) =>
  request('PUT', '/api/saves', { name, seed: data.sim.seed, tick: data.sim.tick, data });

export const deleteSave = (id) => request('DELETE', '/api/saves/' + id);

export const AUTOSAVE_NAME = 'Autosave';
