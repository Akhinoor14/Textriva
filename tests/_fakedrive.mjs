// In-memory Google Drive (just the v3 endpoints Textriva uses) installed as window.fetch.
// Lets tests run real syncToDrive / openDriveProject / conflict flows without any network.
export function installFakeDrive(w) {
  const files = new Map();          // id -> { id, name, mimeType, parents, trashed, appProperties, bytes, mod }
  let seq = 1, tick = 1;
  const state = { failMatching: null, calls: [] };
  const nid = () => 'f' + (seq++);
  const toLatin1 = ab => { const u = new Uint8Array(ab); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s; };
  const bytesOf = str => Uint8Array.from(str, c => c.charCodeAt(0));
  const readBlob = blob => new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(blob); });
  const utf8 = u8 => new TextDecoder().decode(u8);
  const reply = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, blob: async () => { throw new Error('not a blob'); } });
  const pub = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: new Date(1.7e12 + f.mod * 1000).toISOString(), appProperties: f.appProperties || {}, trashed: !!f.trashed });
  const touch = f => { f.mod = tick++; return f; };

  w.fetch = async (url, opts = {}) => {
    url = String(url); const method = (opts.method || 'GET').toUpperCase();
    state.calls.push(method + ' ' + url.replace(/^https:\/\/www\.googleapis\.com/, ''));
    if (state.failMatching && state.failMatching.test(method + ' ' + url)) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const isUpload = u.pathname.startsWith('/upload/drive/v3/files');
    const m = /\/files(?:\/([^/?]+))?$/.exec(u.pathname);
    if (!m) return reply({ error: { message: 'no route' } }, 404);
    const id = m[1];
    if (!id && method === 'GET') {                                  // list
      const q = u.searchParams.get('q') || '';
      const par = /'([^']+)' in parents/.exec(q);
      let out = [...files.values()].filter(f => !f.trashed);
      if (par) out = out.filter(f => (f.parents || []).includes(par[1]));
      const nm = /name='([^']+)'/.exec(q); if (nm) out = out.filter(f => f.name === nm[1]);
      out.sort((a, b) => b.mod - a.mod);
      return reply({ files: out.map(pub) });
    }
    if (!id && method === 'POST' && !isUpload) {                    // create folder
      const b = JSON.parse(opts.body); const f = touch({ id: nid(), name: b.name, mimeType: b.mimeType, parents: b.parents || [], appProperties: b.appProperties || {} });
      files.set(f.id, f); return reply({ id: f.id, name: f.name });
    }
    if (isUpload) {                                                  // multipart create / update
      const ct = (opts.headers || {})['Content-Type'] || ''; const bd = /boundary=(.+)$/.exec(ct)[1];
      const raw = toLatin1(await readBlob(opts.body));
      const parts = raw.split('--' + bd).filter(x => x.trim() && x.trim() !== '--');
      const meta = JSON.parse(utf8(bytesOf(parts[0].slice(parts[0].indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))));
      const mime = /Content-Type: ([^\r\n]+)/.exec(parts[1])[1];
      const content = bytesOf(parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
      let f = id ? files.get(id) : null;
      if (id && !f) return reply({ error: { message: 'not found' } }, 404);
      if (!f) { f = { id: nid(), name: meta.name, parents: meta.parents || [], appProperties: {} }; files.set(f.id, f); }
      if (meta.name) f.name = meta.name; f.mimeType = mime; f.bytes = content; touch(f);
      return reply({ id: f.id });
    }
    const f = files.get(id);
    if (!f) return reply({ error: { message: 'File not found' } }, 404);
    if (method === 'GET') {
      if (u.searchParams.get('alt') === 'media') {
        const bytes = f.bytes || new Uint8Array(0);
        return { ok: true, status: 200, json: async () => JSON.parse(utf8(bytes)), blob: async () => new w.Blob([bytes], { type: f.mimeType }) };
      }
      return reply(pub(f));
    }
    if (method === 'PATCH') {
      const b = JSON.parse(opts.body);
      if (b.name != null) f.name = b.name; if (b.trashed != null) f.trashed = b.trashed;
      if (b.appProperties) f.appProperties = { ...f.appProperties, ...b.appProperties };
      touch(f); return reply({ id: f.id });
    }
    return reply({ error: { message: 'unsupported' } }, 400);
  };

  const api = {
    files, state,
    folders: () => [...files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.appProperties && f.appProperties.textriva === 'project'),
    child: (folderId, name) => [...files.values()].find(f => (f.parents || []).includes(folderId) && f.name === name && !f.trashed),
    readJson: f => JSON.parse(utf8(f.bytes)),
    // Simulates ANOTHER device/tab saving the project: rewrites project.json and bumps the folder revision.
    remoteEdit(folderId, mutate) {
      const f = api.child(folderId, 'project.json'); const meta = api.readJson(f);
      mutate(meta); meta.updatedAt = Date.now() + 1000;
      f.bytes = new TextEncoder().encode(JSON.stringify(meta)); touch(f);
      const folder = files.get(folderId); folder.appProperties = { ...folder.appProperties, rev: 'zz' + tick + '-other', dev: 'other' }; touch(folder);
      return meta;
    },
    addImage(folderId, name, bytes) { const f = touch({ id: nid(), name, mimeType: 'image/jpeg', parents: [folderId], appProperties: {}, bytes: Uint8Array.from(bytes) }); files.set(f.id, f); return f.id; },
  };
  return api;
}
