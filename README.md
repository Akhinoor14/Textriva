# 🔍 Textriva — Google Lens OCR Studio

**Image/PDF → imgbb upload → Google Lens → Text Extract | Free | No Monthly Cost**

---

## 🚀 Quick Deploy (5 minutes)

### Step 1 — Get free imgbb API key
1. Go to **https://api.imgbb.com/**
2. Sign up free (just email)
3. Copy your API key

### Step 2 — Deploy to Vercel (recommended)

**Option A: Vercel Dashboard**
1. Push this folder to a GitHub repo (or zip upload)
2. vercel.com → New Project → Import
3. Environment Variables: `IMGBB_KEY` = your key (required). Optionally also set `ALLOWED_ORIGINS` (see below).
4. Deploy ✅

**Option B: Vercel CLI**
```bash
npm i -g vercel
vercel --prod
# Add env var when prompted: IMGBB_KEY
```

> **Since Phase 0:** the imgbb key lives only on the server (`IMGBB_KEY` env var). The client never sees it —
> all uploads go through `/api/upload`. If you deployed an older version with keys hard-coded in `index.html`,
> **rotate your imgbb key** (api.imgbb.com → account settings) since the old ones are considered burned.

---

## 📖 How to Use

1. Upload image(s) or PDF (PDF হলে প্রতিটি page আলাদা)
2. **Space** চাপুন → প্রথম (text-ছাড়া) page-এর Google Lens খুলবে
3. Lens-এ `Ctrl+A` → `Ctrl+C` → `Ctrl+W`
4. App-এ ফিরে আবার **Space** → paste + save + next + পরের page-এর Lens (পুরো workflow)
5. শেষে `.txt` download বা Copy All

> Space এখন আগের K-এর কাজ করে (K alias হিসেবে এখনও চলে)। Textarea-তে লেখা থাকলে Space সাধারণ space-ই থাকে;
> মোবাইলে action row-এর **⚡ Auto Step** বাটন একই কাজ করে।

---

## 💾 কাজ হারায় না — Library

- প্রতিটা upload/PDF **project** হিসেবে browser-এর IndexedDB-তে save হয় (ছবি + লেখা text + কোন page done)।
  Refresh/বন্ধ করলেও থাকে। হোমে **"চালিয়ে যান"** card আসে; header-এর **Library** থেকে সব project খোলা/`.txt` নামানো/মোছা যায়।
- Lens-এর জন্য imgbb link এখন **শুধু সামনের ৩ page** আগে থেকে upload হয় এবং ২০ মিনিটের বেশি পুরনো হলে নিজে থেকে নতুন করে upload হয় —
  তাই বড় PDF-এও পিছনের page-এর link আর মরে না।

## ☁️ Google Sign in + Drive

Sign in করলে project গুলো **Google Drive → Textriva → \<project\>/** folder-এ জমা হয়:
`page-001.jpg …`, `project.json` (text + status), `text.txt`।
Library → *Google Drive* ট্যাব থেকে সব দেখা, **খুলে কাজ চালিয়ে যাওয়া** (অন্য device থেকেও), ও **Trash-এ পাঠানো** যায়।
একবার Drive-এ save করলে পরে text বদলালে ~৮ সেকেন্ড পর নিজে থেকে sync হয় (Sign in থাকলে)।

Scope শুধু `drive.file` — অ্যাপ কেবল নিজের বানানো file-ই দেখতে পায়, আপনার বাকি Drive নয়।

### একবারের setup (৫ মিনিট)
1. https://console.cloud.google.com → নতুন project
2. **APIs & Services → Library → Google Drive API → Enable**
3. **OAuth consent screen** → External → App name, support email দিন →
   Scopes: `openid`, `email`, `profile`, `.../auth/drive.file` (সবই non-sensitive, verification লাগে না)
   → Publishing status **In production** করুন (Testing-এ থাকলে শুধু test user-রা ঢুকতে পারবে)
4. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins: `https://আপনার-domain` এবং (লাগলে) `http://localhost:3000`
5. Client ID কপি করে `index.html`-এ বসান:
   ```js
   const GOOGLE_CLIENT_ID = '1234-abcd.apps.googleusercontent.com';
   ```
6. Deploy। (Client ID গোপন কিছু না, public থাকাই নিয়ম।)

`GOOGLE_CLIENT_ID` ফাঁকা থাকলে Drive অংশ বন্ধ থাকে, কিন্তু local Library পুরোপুরি চলে।

---

## 📁 Files

```
textriva/
├── index.html           ← Main app (uploads now go through /api/upload, no client-side key)
├── api/upload.js        ← Vercel serverless proxy (key, origin check, rate limit, size limit)
├── functions/api/upload.js ← Cloudflare Pages Function equivalent (same hardening)
├── sw.js                 ← Service worker (cache name bumped each phase)
├── vercel.json           ← Deploy config + security headers (CSP, nosniff, referrer-policy)
├── .env.example          ← Env var template
├── tests/                ← node --test unit/smoke tests (jsdom + fake-indexeddb)
└── README.md
```

## ⚙️ Env Vars

| Variable         | Required | Get it from / purpose                                              |
|------------------|----------|----------------------------------------------------------------------|
| `IMGBB_KEY`      | yes      | api.imgbb.com (free) — read only on the server, never sent to client |
| `ALLOWED_ORIGINS`| optional | Comma-separated list of allowed origins for `/api/upload` (e.g. `https://textriva.vercel.app`). Leave unset during local/preview testing. |

## 🧪 Tests

```bash
npm install
npm test
```

Covers: upload-proxy guards (method/origin/size/rate-limit, no key leakage on error),
no hard-coded imgbb key anywhere in `index.html`, CSP header present, IndexedDB
schema (projects/pages/blobs + byProject index) round-trips Bangla text exactly,
and the `isFresh`/`REMOTE_TTL` freshness window logic.

## 🔁 Duplicate protection (Phase 1)

- **Exact same image** (SHA-256): same file added twice in a project → "Skip this duplicate?"; already in another Library project → toast with an **Open it** button.
- **Near-duplicate pages** (dHash, Hamming ≤ 5): thumbnail gets a **⚠️ dup?** badge; click it (or the **Compare** toast button) for a side-by-side dialog — *Keep both* (Esc) / *Remove page N*.
- **Duplicate text guard** (Space workflow): the pasted text is compared with all saved pages using Dice similarity on character bigrams; ≥ 90 % → "Looks like page N — paste anyway? (Enter = yes, Esc = no)". The old consecutive-clipboard check is kept.
- **Library**: projects with the same file name + page count + first-page hash get a **⚠️ duplicate** tag and a **🗑 Remove duplicate** button (it deletes the other copy; it does not merge pages).
- Thresholds are constants at the top of the Phase 1 block in `index.html` (`PHASH_HAMMING_THRESHOLD`, `TEXT_SIMILARITY_THRESHOLD`).

## ↩ Undo, validation & Review mode (Phase 2)

- **Undo / redo:** every Space-workflow paste (and 📋 Paste, ✕ Clear, `R`) saves the page's previous text first (last 20 per page, in memory only). After a Space paste a toast shows **↩ Undo** for 6 s. `Ctrl+Z` outside the text box undoes the last workflow paste, `Ctrl+Shift+Z` / `Ctrl+Y` redoes; inside the text box the browser's own undo is untouched. The ↶ ↷ buttons act on the current page.
- **Auto-validation:** each processed page gets `flags` — *empty*, *too short* (< 20 chars), *garbled* (�/□), *repeated chars* (8+ in a row; dot/dash leaders are ignored), *wrong script?* (Bangla vs Latin, judged against the project's dominant script once 3+ pages exist). ⚠️ shows on the thumbnail and the Lens grid card.
- **Review mode:** **Review ⚠️ (N)** steps through only flagged, un-reviewed pages (←/→, Esc exits) with **Accept**, **Redo with Lens** and **Edit**. Accept sets `reviewed` (shown as ✔).
- `flags` and `reviewed` are saved in IndexedDB and in Drive `project.json`. Thresholds are constants at the top of the Phase 2 block in `index.html`.

## ⬇ Export & import (Phase 5)

**Export…** (action row) → choose format + layout (page-wise / merged) + page headings:
`.docx` (Word; Bangla uses the complex-script font slot, Nirmala UI on Windows), **PDF** (opens the browser print dialog → *Save as PDF*, so Bangla conjuncts are shaped correctly), `.md`, `.txt` (existing format), `.json` (full project, no images), **Backup .zip** (project.json + text.txt + images). The dialog also has **Copy as Markdown**.

**Library → 📦 Export all (.zip)** backs up every local project; **📥 Import backup** restores them (works without Google). Imported projects are added as new Library projects.

**Import:** drop/choose a `.zip` (a Textriva backup → Library; any other ZIP → its images become pages, naturally sorted), a `.docx` (page breaks → pages), a `.json` project file, or use **📁 Import image folder**. The old `.txt` re-import is unchanged.

JSZip 3.10.1 is lazy-loaded from cdnjs (pinned) the first time a ZIP/DOCX feature is used; the rest of the app stays CDN-free at load time. It is also a devDependency for the tests only.

## 🧹 Text tools, Library search, notes (Phase 4)

**Text tools…** (action row) → one dialog, three tabs; every tab works **Preview (diff) → Apply → Undo** and never changes text without a preview:
- **Cleanup** — joins broken line wraps, removes repeated headers/footers and page numbers (lines that repeat on >40 % of pages), de-hyphenates, tidies spaces and quotes.
- **Bangla fixes** — editable rules (`|` → `।`, zero-width characters, ো/ৌ/য়/ড়/ঢ় recomposition, digit conversion ০-৯ ↔ 0-9). Your rules are stored in IndexedDB (`settings` store).
- **Find & Replace** — plain or regex, case / whole-word options, live match count, across all pages.

**Library search:** the Library has a search box that searches every project (inverted index in the `search` store, updated on every save); a hit opens that project on that page.
**Notes & bookmarks:** per-page note (📝) and bookmark (🔖); `B` toggles a bookmark, `G` jumps to the *Go to #* box.
**IndexedDB is now version 2** (new `search` + `settings` stores). On the first open, existing projects are indexed automatically.

## 🛠 Page tools (Phase 3)

**Page tools…** (action row) works on the pages you type in *Pages* (`3`, `2-5, 9`; Bangla digits OK):
- **Reorder** — drag thumbnails (mouse; on touch: press and hold ~0.4 s, then drag), the ◀ ▶ ⏮ ⏭ / *Move to #* buttons, or **Alt+←/→**. The order is saved (`order` in IndexedDB, page order in Drive `project.json`).
- **Rotate** 90° / 180°, **Crop** (draw a rectangle on the preview or use the margin sliders; the same margins apply to every page in the range) and **Split two-page spread** (cut position slider, optional RTL). The first half keeps the page's text, note and bookmark.
- **Enhance for Lens** — auto-contrast + light sharpening applied *only to the copy sent to Lens*; the stored page is never changed. It is a global setting; toggling it makes pages re-upload.
- **Move to another project** (existing or new) — and in the Library, **➕ Merge into open** appends a whole project to the open one (and offers to delete the source).
- **↩ Undo last page edit** (10 steps, in memory; works only while the page list is unchanged since that edit; *Move to project* cannot be undone).

Any change to a page image resets its Lens link, Drive file id and saved-blob flag, so the new image is re-saved, re-uploaded and re-synced. An upload that was already running when you edited the page is discarded.

## 📜 Changelog

See **TEXTRIVA_PLAN.md → §7 Progress Log** for the phase-by-phase changelog and
where to resume work if you're handing this off to another AI/developer.


## 🤖 Phase 6 — Optional Auto-OCR (Tesseract)

- Button **🤖 Auto-OCR…** opens a dialog: page range, *Auto* (only pages without text) or *Redo* (overwrite, undoable), language (বাংলা+English / বাংলা / English).
- **Google Lens stays the default**, and **imgbb stays the image host** — nothing changes unless you press Start.
- Tesseract.js `5.1.1` is pinned and lazy-loaded from cdnjs only on first Start; the language data is fetched from `tessdata.projectnaptha.com` and cached by the browser. `vercel.json` CSP was widened for exactly this (`cdn.jsdelivr.net`, `tessdata.projectnaptha.com`, `'wasm-unsafe-eval'`).
- Each OCR'd page stores `ocr = {engine, conf, hash}` (IndexedDB, Drive `project.json`, JSON/ZIP backups). Confidence below 70 gives the ⚠️ *Low OCR confidence* flag; after a run Review mode opens on those pages (→ **Redo with Lens**). If the text changes later, the OCR info stops applying (hash check).
- **Not implemented:** the paid vision-LLM engine (needs a provider decision) and a per-project engine setting (the dialog remembers the last choice on this device).


## ☁️ Sync hardening (Phase 8)

- **Conflict detection:** every successful Drive sync stamps the folder with a revision (`device-id` + time). If another device saved first, silent auto-sync **pauses and never overwrites**; a **⚠️ Sync conflict** chip appears → dialog: *Use Drive* / *Use this device* / *Merge page by page* (one-sided edits merge automatically; pages edited on both sides ask which text to keep).
- **Reconnect chip:** when the Google token expires, the app tries a silent refresh; if that needs a click, a **☁️ Reconnect** chip appears (only on a device that signed in before).
- **Storage meter + Free up space** (Library): deletes the image blobs of *finished, Drive-synced* projects but keeps their text; opening such a project re-downloads the images from Drive.
- Not done (marked optional in the plan): per-page incremental sync / split `texts.json` — `project.json` is still sent whole.

## 📱 PWA, mobile & performance (Phase 9)

- **Offline:** Library and editing already work from IndexedDB. The service worker now also caches the CDN libraries (pdf.js, JSZip, Tesseract, fonts) after their first online use, so the app **starts offline**. While offline the Drive chip shows **📴 Offline — sync queued**; auto-sync resumes when the browser fires `online` (a *Back online* toast).
- **Web Share Target:** after installing the PWA on Android/Chrome, share images or a PDF from the gallery/Files app → **Textriva**. The service worker parks the files in a cache (`textriva-share`) and the app imports them on start. (iOS Safari does not support Web Share Target.)
- **📷 Scan page:** opens the phone camera (`capture="environment"`); each photo is appended as a page named `scan-<time>.jpg`.
- **Big PDFs:** pages are rendered **one at a time** (concurrency 1), each canvas is released straight after encoding, and the UI yields every 5 pages. Above **300 pages** the app asks: load all, or choose a range (e.g. `1-100, 150-200`). Constants: `PDF_WARN_PAGES`, `PDF_YIELD_EVERY`.
- **Virtualised thumbnail strip:** from **150 pages** only the thumbnails near the viewport (±30) are in the DOM, with spacers keeping the scrollbar honest. Constants: `STRIP_VIRT_MIN`, `STRIP_OVERSCAN`, `STRIP_STEP`.
- **Performance test plan (300-page PDF, mid-range phone):** (1) Chrome → install the PWA. (2) Open a 300-page PDF at 2× quality; watch Chrome task manager / `chrome://inspect` memory — it should stay roughly flat after the first ~10 pages and the tab must not reload. (3) Scroll the strip end-to-end: frame rate stays smooth and DOM thumbs ≤ ~140. (4) Try a 500-page file → the range prompt appears. (5) Airplane mode → reload → app opens, Library works, edit a page → chip says Offline; turn the network on → it syncs.
