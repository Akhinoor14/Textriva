# Textriva — Master Plan (hand-off to any AI / developer)

> **Bangla summary (Banglish):** Ei file-ta onno kono AI (ba developer) ke dile se phase onujayi kaj korte parbe.
> Protita phase-er shesh-e **copy-paste prompt** ache. Phase 1 theke shuru koro, ek ek phase shesh hole test kore tarpor porer ta.
> Sobar age **Phase 0 (security + test base)** kora uchit.

---

## 0. How to use this file

1. Give the AI: the project zip (`Textriva.zip`) + this file.
2. Paste the **"Global rules"** block (section 2) first, once.
3. Then paste one phase prompt at a time. Do not ask for several phases in one message.
4. After each phase: run the acceptance checks, deploy to a preview URL, test with a real PDF (20+ pages, Bangla text), then continue.

---

## 1. Current state (what already exists)

**What the app is:** a static web app (single `index.html`, no build step) that turns images/PDF pages into text using Google Lens.
Flow: PDF → pages (pdf.js) → each page uploaded to imgbb (temporary public URL) → `lens.google.com/uploadbyurl?url=…` opens in a popup → user copies the text → pasted back per page → export `.txt`.

**Stack / files**

| File | Purpose |
|---|---|
| `index.html` | Everything: CSS, markup, one `<script type="module">` (~1.9k lines) |
| `sw.js` | Service worker (cache `textriva-v5`, network-first for shell) |
| `api/upload.js` | Vercel serverless imgbb proxy (currently **unused** by the client) |
| `functions/api/upload.js` | Cloudflare Pages Function version of the same (has debug output — remove) |
| `vercel.json`, `wrangler.toml`, `site.webmanifest` | Deploy / PWA config |

**Already implemented (do not rebuild, extend):**

- `state` object: `pages[]`, `current`, `projectId`, `proj{}`, workflow flags.
- **Upload-expiry fix:** imgbb `expiration=1800`; `REMOTE_TTL` = 20 min; `isFresh(pg)`; `prefetchAhead()` uploads only the next 3 pages; `openLens()` re-uploads stale links.
- **Local Library (IndexedDB `textriva-db`)**: stores `projects`, `pages` (index `byProject`), `blobs`. Functions: `saveNow()` (snapshot is synchronous), `scheduleSave()` (hooked inside `updateStats()`), `localList()`, `localLoad()`, `openLocalProject()`, `deleteLocalProject()`, `downloadLocalText()`, resume card, Library modal (`#libModal`).
- **Google sign-in + Drive** (`drive.file` scope, GIS token client): `GOOGLE_CLIENT_ID` const (empty = feature off), `driveToken()`, `dfetch()`, `syncToDrive()`, `openDriveProject()`, `trashDriveProject()`, auto-sync via `queueDriveSync()`. Drive layout: `Textriva/<project> · <id4>/{page-001.jpg…, project.json, text.txt}`; folder `appProperties` hold `pages` / `done`.
- **Space workflow** (`runWorkflowStep()`): Space = start / paste → save → next → open Lens. `K` kept as alias. Skips pages that already have text. Rejects a paste identical to the previous page's clipboard (`state.lastClip`). `⚡ Auto Step` button for mobile.
- Themes (dark / light / milki), EN/Bangla toggle (`i18n` dict + `L(bn,en)` helper for new strings), zoom/pan, PDF DPI selector, `.txt` re-import.

**Known weak spots**

1. `IMGBB_KEYS` are hard-coded in client JS → publicly visible, quota can be stolen.
2. Page images are public on imgbb for up to 30 min (privacy).
3. Only a *consecutive-clipboard* duplicate check exists.
4. No automated tests in the repo.
5. Everything is in one 2.7k-line HTML file → hard to maintain.
6. `functions/api/upload.js` leaks key preview in error JSON.
7. No undo for a bad paste.

---

## 2. Global rules (paste this first, once)

```text
You are working on "Textriva", a static, build-less web app (single index.html + sw.js).
Rules for every task:
1. Read index.html fully before changing anything. Do not rewrite from scratch; extend the existing functions.
2. Keep it build-less unless the task explicitly says to introduce a build step. External scripts only from cdnjs/jsdelivr with pinned versions.
3. Never break these working features: PDF split, imgbb→Lens flow, prefetchAhead/isFresh, IndexedDB Library, Drive sync (GOOGLE_CLIENT_ID may be empty — then Drive must stay gracefully disabled), Space workflow (runWorkflowStep), themes, EN/Bangla toggle.
4. All new user-facing strings must work in both languages (use the existing L(bn,en) helper or the i18n dict).
5. Bangla text must be preserved exactly (UTF-8, no normalisation side effects).
6. Never log or display secrets. Never put API keys in client code.
7. After each task: (a) run `node --check` on the extracted module script, (b) run/extend the jsdom + fake-indexeddb tests (tests/ folder), (c) bump the service-worker CACHE name, (d) update README.md, (e) give me a short changelog + manual test steps.
8. Mobile (≤600px) must stay usable; keep tap targets ≥44px.
9. Ask me before adding any paid service or new dependency.
```

---

## 3. Roadmap

Order matters. Effort: S ≈ hours, M ≈ a day, L ≈ several days.

### Phase 0 — Safety & test base  (S–M) ⭐ do first
- [ ] Move imgbb upload behind the server proxy (`/api/upload`), remove `IMGBB_KEYS` from client; client calls `/api/upload` with fallback message if it fails.
- [ ] Remove debug fields (`keyPreview`, `stack`) from `functions/api/upload.js`; add basic rate limit + max body size + origin check.
- [ ] Add `tests/` with the jsdom + `fake-indexeddb` harness (page save/restore, prefetch window, Space flow, Drive sync with a fake Drive). Add `npm test`.
- [ ] Add `vercel.json` security headers (`X-Content-Type-Options`, `Referrer-Policy`, a CSP that allows only the needed hosts: cdnjs, fonts, `accounts.google.com`, `www.googleapis.com`, `lens.google.com`).
- [ ] **Acceptance:** `npm test` passes; no API key string anywhere in `index.html`; upload still works on a deployed preview.

### Phase 1 — Duplicate protection (total)  (M)
- [ ] **Content fingerprint per page:** compute SHA-256 of the image blob (`crypto.subtle`) on `addPage`; store `pg.hash`.
- [ ] **Same file uploaded twice:** if a page hash already exists in the *current* project → ask "Skip duplicates?" (default skip). If it exists in another Library project → banner "Already in *<project>* — Open it?".
- [ ] **Near-duplicate pages** (same page scanned twice, slightly different): perceptual hash (8×8 average/dHash on a 32×32 canvas); flag pages with Hamming distance ≤ 5 as "possible duplicate" with a side-by-side compare dialog (Keep both / Remove one).
- [ ] **Duplicate *text* guard (extends existing `lastClip` check):** on Space/paste compare the new text with **all** saved pages of the project using normalised text (lowercase, collapse whitespace, strip punctuation). Similarity ≥ 90 % (Jaccard on word 3-grams, or Dice on character bigrams) → warn, don't paste; show "Looks like page N — paste anyway? (Enter = yes, Esc = no)".
- [ ] **Same Lens result copied twice** (user pressed Space twice): already blocked; add a visible "Waiting for new copy…" state on the Auto Step button.
- [ ] **Library duplicates:** project-level check by (file name + page count + first-page hash); "Merge / Delete duplicate" action in Library.
- [ ] **Acceptance:** upload the same PDF twice → second import is flagged; paste page 3's text onto page 7 → blocked with the warning; unit tests for the similarity function (identical, slightly edited, different, Bangla text).

### Phase 2 — Undo, validation, review mode  (M)
- [ ] **Undo/Redo for text per page** (stack in memory, last 20 changes per page, `Ctrl+Z` outside the textarea = undo last *workflow paste*; toast with "Undo" button for 6 s after each Space paste).
- [ ] **Auto-validation** on each saved page: empty, < 20 chars, too many weird chars (`�`, `□`, long runs of the same char), mostly Latin when the project is Bangla (and vice-versa) → set `pg.flags = [...]` and show ⚠️ on the thumbnail + Lens grid.
- [ ] **Review mode:** button "Review ⚠️ pages" steps through only flagged pages (←/→), with Accept / Redo-with-Lens / Edit.
- [ ] Per-page **status model** clean-up: `pending → uploading → ready → done → reviewed`; persist `reviewed` in IndexedDB + Drive `project.json`.
- [ ] **Acceptance:** vague paste → ⚠️ appears; Review mode lists only flagged pages; undo restores exact previous text.

### Phase 3 — Page tools  (M)
- [x] Drag-to-reorder thumbnails (touch + mouse); persists `order`.
- [x] Rotate 90°/180° (re-encode blob, reset `driveFileId` + `remoteUrl`).
- [x] Crop/trim margins (simple rectangle tool) and "split two-page spread" into two pages.
- [x] Auto-enhance toggle (contrast/brightness/sharpen via canvas) applied *only to the copy sent to Lens* by default, original kept.
- [x] Merge/split projects (move selected pages into another project).
- [x] **Acceptance:** rotated page goes to Lens upright; reorder survives refresh and Drive reopen.

### Phase 4 — Text quality tools  (M)
- [x] **Cleanup pipeline** (toggle + preview diff): fix broken line wraps, remove repeated headers/footers/page numbers (detect lines that repeat on >40 % of pages), de-hyphenate, normalise spaces/quotes.
- [x] **Bangla fixes** list (user-editable rules in IndexedDB): common OCR confusions, `।` vs `|`, digits (০-৯ ↔ 0-9 option), zero-width joiner handling.
- [x] **Find & Replace across all pages** (plain + regex, preview count, undo).
- [x] **Search across all Library projects** (build a simple inverted index on save).
- [x] **Per-page notes / bookmarks** and a "go to page N" box.
- [x] **Acceptance:** cleanup preview shows a diff; replace-all can be undone; search finds a word in another project.

### Phase 5 — Export & import  (M)
- [ ] Export: `.txt` (existing), **`.docx`** (page breaks, optional page headings), **`.pdf`**, **`.md`**, **`.json` (full project)**; choose "merged" vs "page-wise".
- [ ] **Project backup/restore:** Library → "Export all (.zip)" containing `project.json` + images + text; "Import backup" (works without Google).
- [ ] Import: images folder / ZIP of images, `.txt` (existing), `.docx` text.
- [ ] Copy options: Copy page / Copy all / Copy merged (existing) + "Copy as Markdown".
- [ ] **Acceptance:** export → delete project → import → identical pages/text; docx opens in Word with correct Bangla.

### Phase 6 — Optional automatic OCR engines (no manual Lens)  (L)
Keep Lens as default (free). Engines are *optional* per project:
- [ ] **Tesseract.js** in a Web Worker (free, offline, Bangla `ben` + English). Lower accuracy; show confidence; "re-do with Lens" for low-confidence pages.
- [ ] **Vision-LLM OCR** (Claude / Gemini) via **server proxy only** (key in env vars), with per-day page limit, cost estimate before running, and per-page retry. Off by default.
- [ ] Engine selector + "Auto: try Tesseract, flag low confidence for Lens".
- [ ] **Acceptance:** same 5-page sample processed by each engine; confidence stored; engine name saved per page.

### Phase 7 — Replace imgbb with own temporary storage  (M)
- [ ] Cloudflare R2 (or S3) bucket with **lifecycle rule = delete after 1 h**; Worker issues a short-lived signed upload URL (random unguessable key); page image URL passed to Lens.
- [ ] Delete the object right after the page is marked done (privacy).
- [ ] Fall back to imgbb proxy if R2 is unavailable.
- [ ] **Acceptance:** no public image persists > 1 h; images are not listed anywhere.

### Phase 8 — Sync & multi-device hardening  (M)
- [ ] Conflict handling: compare `updatedAt` local vs Drive → "Use Drive / Use this device / Merge texts page-by-page".
- [ ] Per-page incremental sync (don't re-send whole `project.json` for one text edit — optional split `texts.json`).
- [ ] Silent token refresh strategy (re-prompt gracefully when expired; "☁️ Reconnect" chip).
- [ ] Storage meter + "Free up space" (delete blobs of finished projects but keep text; re-download from Drive on open).
- [ ] **Acceptance:** edit the same project on two browsers → conflict dialog appears and resolves without data loss.

### Phase 9 — PWA, mobile, performance  (M)
- [ ] Offline: Library + editing work offline; queue Drive sync until online.
- [ ] **Web Share Target** (share images/PDF from phone gallery into Textriva) + camera capture button ("scan page").
- [ ] Large PDFs: render pages lazily/in a worker, limit concurrent canvases, memory guard (warn > 300 pages).
- [ ] Virtualised thumbnail strip for 500+ pages.
- [ ] **Acceptance:** 300-page PDF loads without the tab crashing on a mid-range phone.

### Phase 10 — Code health  (M–L)
- [ ] Split `index.html` into `css/`, `js/modules` (`state.js`, `db.js`, `drive.js`, `lens.js`, `ocr.js`, `ui.js`, `i18n.js`) using native ES modules (still build-less) — or Vite if approved.
- [ ] Remove dead code (`uploadAllPages` bulk path where unused, duplicate CSS).
- [ ] Accessibility pass (focus order, aria labels, contrast in all 3 themes, keyboard-only use).
- [ ] Error reporting (opt-in, no page content), `console` cleanup.
- [ ] Docs: `ARCHITECTURE.md`, `CONTRIBUTING.md`.

---

## 4. Ready-to-paste prompts (one per phase)

> Always paste **Global rules** (section 2) first. Attach `Textriva.zip`.

### Prompt — Phase 0
```text
Task: Phase 0 (safety & test base) from TEXTRIVA_PLAN.md.
1) Remove IMGBB_KEYS from index.html. Make uploadToImgbb() POST the base64 image to /api/upload (existing Vercel function api/upload.js; also keep functions/api/upload.js for Cloudflare). Keep the retry/backoff logic and the 1800s expiration.
2) Harden both server functions: no debug info in responses, max body size ~8MB, reject non-POST, check Origin against an ALLOWED_ORIGINS env var, simple per-IP rate limit if feasible, and read IMGBB_KEY from env only.
3) Add a tests/ folder with a jsdom + fake-indexeddb harness covering: save/restore of a project, prefetchAhead only uploading 3 pages, stale-link re-upload, Space workflow (start, paste, duplicate clipboard rejected, skip already-done pages), and Drive sync/open/trash against an in-memory fake Drive. Add package.json with `npm test`.
4) Add security headers to vercel.json including a CSP allowing only the hosts the app needs.
Deliver: changed files, how to set env vars, test output, manual test checklist.
```

### Prompt — Phase 1
```text
Task: Phase 1 (duplicate protection) from TEXTRIVA_PLAN.md — implement ALL bullets.
Implementation notes: SHA-256 via crypto.subtle for exact image duplicates; a dHash perceptual hash for near-duplicates; normalised-text similarity (word 3-gram Jaccard) for pasted text against all saved pages. Store hashes in IndexedDB page records and in Drive project.json. Thresholds must be constants at the top of the script. Add unit tests for the similarity functions with Bangla and English samples. Keep the existing lastClip check.
Show the warnings as non-blocking toasts/dialogs that work with the keyboard (Enter/Esc) so the Space workflow stays fast.
```

### Prompt — Phase 2
```text
Task: Phase 2 (undo, validation, review mode). Implement a per-page undo stack (max 20), a 6-second "Undo" toast after every workflow paste, automatic validation flags (empty, too short, garbage characters, wrong script), ⚠️ badges on thumbnails and the Lens grid, and a Review mode that cycles only flagged pages. Persist `flags` and `reviewed` in IndexedDB and Drive project.json. Add tests.
```

### Prompt — Phase 3
```text
Task: Phase 3 (page tools): drag-reorder (mouse + touch), rotate, crop, split two-page spread, optional enhance-for-Lens (applies only to the copy sent to Lens), move pages between projects. Any change to a page image must invalidate remoteUrl/remoteAt and driveFileId and set blobSaved=false. Persist order. Add tests for reorder persistence.
```

### Prompt — Phase 4
```text
Task: Phase 4 (text quality): cleanup pipeline with preview diff and undo, editable Bangla fix rules stored in IndexedDB, Find & Replace across all pages (plain/regex), search across all Library projects (simple inverted index updated in saveNow), per-page notes and bookmarks, go-to-page box. Do not alter text without a preview/confirm step.
```

### Prompt — Phase 5
```text
Task: Phase 5 (export/import): add .docx, .pdf, .md and full-project .json export (merged or page-wise), Library backup/restore as a .zip (images + project.json + text), and import from an images ZIP and .docx. Use pinned CDN libraries (e.g. docx, jsPDF/pdf-lib, JSZip) and make sure Bangla renders correctly in docx and pdf (embed a Bangla font such as Noto Sans Bengali / Hind Siliguri). Add a round-trip test: export → delete → import → identical.
```

### Prompt — Phase 6
```text
Task: Phase 6 (optional OCR engines). Keep Google Lens as the default. Add Tesseract.js (ben+eng) running in a Web Worker with confidence per page, and an OPTIONAL vision-LLM engine that is called ONLY through a server proxy (key in env vars, daily page limit, cost estimate shown before running). Add an engine selector, store the engine and confidence per page, and flag low-confidence pages for Review mode. Ask me before choosing the paid provider.
```

### Prompt — Phase 7
```text
Task: Phase 7 (own temporary image storage). Replace imgbb with Cloudflare R2 using a Worker that issues short-lived signed upload URLs with random keys, a 1-hour lifecycle delete rule, and immediate deletion after a page is marked done. Keep imgbb proxy as fallback. Provide step-by-step Cloudflare setup instructions.
```

### Prompt — Phase 8
```text
Task: Phase 8 (sync hardening): conflict detection and resolution dialog (Use Drive / Use this device / Merge page-by-page), incremental sync, graceful token expiry with a Reconnect chip, a storage meter, and "free up space" that deletes image blobs of finished projects but keeps text (re-download from Drive on open). Add tests with the fake Drive including a conflict scenario.
```

### Prompt — Phase 9
```text
Task: Phase 9 (PWA/mobile/performance): offline editing with a queued Drive sync, Web Share Target in site.webmanifest, a camera capture button, lazy PDF page rendering with a concurrency limit, a memory guard for very large PDFs, and a virtualised thumbnail strip. Provide a performance test plan for a 300-page PDF.
```

### Prompt — Phase 10
```text
Task: Phase 10 (code health): split index.html into native ES modules (state, db, drive, lens, ocr, ui, i18n) and separate CSS, still without a build step; remove dead code; accessibility pass in all 3 themes; write ARCHITECTURE.md and CONTRIBUTING.md. Behaviour must stay identical — run the full test suite before and after.
```

---

## 5. Even more ideas (pick what you like)

**Workflow / speed**
- Clipboard watcher: when new text appears in the clipboard while the app is focused-again, offer auto-advance without pressing Space.
- Hands-free mode: after Space, auto-close the Lens popup when text is detected on the clipboard (where the browser allows).
- Progress bar with ETA ("38/120 done · ~25 min left") and a daily words-typed/pages-done counter.
- Customisable shortcuts (Space / K / R / L remappable) and a visible cheat-sheet overlay (`?`).
- "Next ⚠️ page" and "Next empty page" shortcuts.
- Sound/vibration feedback on save (optional).

**Organisation**
- Folders/tags/colours for projects, favourites, "pinned" project on top.
- Project templates (e.g. "Bangla textbook": DPI 3×, cleanup on, Bangla fixes on).
- Per-project settings (language, DPI, engine, cleanup rules).
- Soft-delete (Trash with 30-day restore) inside the local Library too.

**Quality**
- Language detection per page (Bangla/English/mixed) and auto script check.
- Table & column detection hints; math/equation pages flagged for manual typing.
- Handwriting pages flagged; separate workflow.
- Spell-check (Bangla dictionary, e.g. Hunspell) with suggestions.
- Side-by-side "image vs text" proofreading view with synchronised zoom and line highlighting.
- Diff view between two OCR engines' results for the same page.

**Sharing / collaboration**
- Read-only share link of a project's text (Drive share) and a "copy link" button.
- Split a big book among friends: export page ranges, import and merge results.
- Phone → desktop: QR code on desktop; scan with the phone, take photos, pages appear on desktop (via Drive or a tiny relay).

**Platform**
- Installable desktop app wrapper (Tauri/Electron) for guaranteed popup/shortcut behaviour.
- Browser extension to send the current image/selection straight to Textriva.
- Notifications ("OCR complete") via Web Push.

**Privacy & trust**
- "Privacy mode": never upload to third-party hosting, Tesseract only.
- Auto-delete remote image as soon as a page is marked done.
- Clear data buttons ("Delete everything on this device"), data-use explanation in Help.

**Analytics (optional, privacy-safe)**
- Local-only stats page (pages/day, words/day, time per page) to help estimate big jobs.

---

## 6. Suggested order for you

1. **Phase 0** (security, tests) → 2. **Phase 1** (duplicates) → 3. **Phase 2** (undo + review) → 4. **Phase 5** (export) → 5. **Phase 4** (text tools) → 6. **Phase 3** (page tools) → 7. **Phase 7** (own storage) → 8. **Phase 6** (auto OCR) → 9. **Phase 8–10**.

Each phase should end with a deploy to a *preview* URL and a manual test using a real, long Bangla PDF before moving on.

---

## 7. Progress Log (read this first before continuing work)

> **If you are an AI/developer picking this up:** read this section top-to-bottom before touching code.
> It tells you exactly what's done, what changed from the original plan, how to verify it, and where to resume.

### ✅ Phase 0 — Safety & test base — **DONE** (2026-10-30)

**What changed in the code:**

| File | Change |
|---|---|
| `index.html` | Removed the hard-coded `IMGBB_KEYS` array entirely. `uploadToImgbb(b64)` now `fetch('/api/upload', { method:'POST', body: JSON.stringify({image:b64}) })` instead of calling `api.imgbb.com` directly. Same function signature/name kept, so both call sites (`uploadImageWithRetry` and the retry-with-backoff path around line ~2820) needed **no changes**. Error messages are now bilingual via `L(bn,en)`. |
| `api/upload.js` (Vercel) | Rewritten. Reads `IMGBB_KEY` from `process.env` only. Added: origin check via `ALLOWED_ORIGINS` env var (comma-separated; **skipped if unset**, so it won't block you before you configure it), in-memory per-IP rate limit (30 req/min/instance — best-effort, resets on cold start), max body size guard (12 MB base64), `X-Content-Type-Options: nosniff`. Response shape standardized to `{success: bool, url?, error?}`. No stack traces or key info ever returned to the client. |
| `functions/api/upload.js` (Cloudflare) | Same hardening applied (origin check, rate limit, size guard). **Removed the debug leak**: `keyPreview`, `keyLength`, `keyPresent`, `err.stack` are gone — these used to be returned in the JSON error body. |
| `vercel.json` | Added a `headers` block for `/(.*)`: `Content-Security-Policy` (allows only `cdnjs.cloudflare.com`, `fonts.googleapis.com`/`gstatic.com`, `accounts.google.com`, `apis.google.com`, `www.googleapis.com`, `lens.google.com`, `api.imgbb.com`, plus `'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. |
| `sw.js` | `CACHE` bumped `textriva-v5` → `textriva-v6` (required any time client JS changes, per global rule 7c). |
| `package.json` | **New.** `type:module`, `devDependencies`: `fake-indexeddb`, `jsdom`. `npm test` → `node --test tests/**/*.test.mjs`. |
| `tests/` | **New folder**, 5 files, 17 tests total, all passing. See below. |
| `README.md` | Added: rotate-your-key warning (old hard-coded keys are burned), `ALLOWED_ORIGINS` env var doc, `tests/` in the file tree, "🧪 Tests" section, pointer to this Progress Log. |
| `.gitignore` | **New** (`node_modules/`, `.env`, `.vercel/`) — wasn't in the original zip. |

**Deliberate deviations from the plan's literal wording (and why):**

- The plan said "client calls `/api/upload` with fallback message if it fails" — implemented, but fallback message is bilingual (project rule 4), not just English.
- Rate limiting is **in-memory per serverless instance**, not a durable/shared store. This is explicitly a soft guard (stops a runaway loop/bug, not a determined attacker) because Vercel serverless functions don't share memory across instances. If you need real rate limiting, wire this to Vercel KV / Upstash Redis — flagged here per global rule 9 (ask before adding a paid dependency), **not done without asking**.
- `ALLOWED_ORIGINS` defaults to "allow everything" when unset, so existing preview deployments don't break on first deploy. **Action for Mou:** set `ALLOWED_ORIGINS=https://your-prod-domain.vercel.app` in both Vercel and Cloudflare dashboards once the prod domain is fixed, otherwise the origin check is a no-op.
- The jsdom+fake-indexeddb harness does **not** load the full `index.html` module script as-is, because it does a **top-level remote import of pdf.js from cdnjs** (`import * as pdfjs from 'https://cdnjs.../pdf.min.mjs'`), which fails under plain Node/jsdom without network access or heavy mocking. Instead:
  - `tests/_extract.mjs` pulls the raw module source out of `index.html` and extracts individual small, pure declarations (by name) for isolated testing (used for `isFresh`/`REMOTE_TTL`).
  - `tests/indexeddb.test.mjs` recreates the exact `textriva-db` schema (`projects`, `pages` + `byProject` index, `blobs`) that `idb()` in `index.html` creates, using `fake-indexeddb`, and round-trips Bangla text through it to confirm no normalisation/mangling.
  - `tests/security.test.mjs` does static source checks against `index.html` + both proxy files (no leaked key strings, no direct `api.imgbb.com` calls, no debug fields, CSP present).
  - `tests/upload-proxy.test.mjs` imports `api/upload.js`'s handler directly and calls it with a mock `req`/`res` (method/origin/size/rate-limit guards, no key leak on 500).
  - **If you extend this in later phases:** keep using `extractDeclaration()` for new small pure functions (duplicate-hash, similarity scoring, etc. in Phase 1) rather than trying to load the whole script — it will keep failing on the pdf.js import until/unless Phase 10 splits the code into real ES modules.

**Test results (last run 2026-10-30):**
```
npm test
...
# tests 17
# suites 0
# pass 17
# fail 0
```

**Acceptance checklist (from the plan, §3 Phase 0):**
- [x] `npm test` passes (17/17)
- [x] No API key string anywhere in `index.html` (`grep` verified — both old imgbb keys absent)
- [ ] **Upload still works on a deployed preview** — **NOT VERIFIED YET.** This requires an actual Vercel deployment with `IMGBB_KEY` set, which I cannot do from here. **→ Mou must deploy and test this manually before calling Phase 0 fully accepted.**

**Manual test steps for Mou (do this before starting Phase 1):**
1. `vercel --prod` (or push to the connected GitHub repo) from the updated `Textriva/` folder.
2. In Vercel dashboard → Settings → Environment Variables: confirm `IMGBB_KEY` is set (your old keys still work as values, they were only removed from client code, not revoked by imgbb).
3. Open the deployed URL, upload a real PDF (20+ pages, Bangla text), run the Space workflow for at least 3–4 pages.
4. Confirm: pages upload, Lens opens with the image, no errors in the browser console mentioning `/api/upload`.
5. Open browser devtools → Network tab → confirm the request goes to `/api/upload` (same-origin), not `api.imgbb.com`.
6. If using Cloudflare Pages instead/also: repeat with `wrangler pages deploy`, confirm `IMGBB_KEY` secret is set there too.
7. Rotate the imgbb API key at api.imgbb.com (old keys were publicly exposed in git history — treat them as burned even though they still technically work) and update `IMGBB_KEY` in both Vercel and Cloudflare once rotated.

**Resume point (superseded — see Phase 1 entry below):** Phase 1 was started in the same session. Read the Phase 1 entry next.

---

### 🟢 Phase 1 — Duplicate protection — **CODE COMPLETE (2026-10-30); manual browser test still pending**

**Done this session:**
- `textSimilarity()` switched from word-3-gram Jaccard to **Dice on character bigrams** (`charBigrams()` helper added). Test assertions were *not* loosened — all 6 similarity tests pass as written. `wordNGrams` kept (unused by similarity now; remove in Phase 10 if still unused).
- `toast(msg, type, dur, action)` now accepts an optional `{label, fn}` action button (backwards compatible).
- Cross-project exact-duplicate banner now has a real **Open it** button (`openLocalProject`).
- Near-duplicate **side-by-side compare dialog** (`openDupCompare`): *Keep both* (Esc) / *Remove page A* / *Remove page B*; opened by clicking the ⚠️ dup? badge or the **Compare** toast button.
- Library "Merge" button renamed **🗑 Remove duplicate** (it only deletes the other copy — no page-level merge exists; implement real merge in Phase 3's "merge/split projects" if wanted).
- `sw.js` cache `textriva-v8`; README has a Phase 1 section; 4 new wiring tests.

**Checks:** `npm test` → 44/44 pass; `node --check` on the extracted module script OK.

**Still NOT done (needs a human in a browser):** Phase 1 acceptance — upload the same 20+ page Bangla PDF twice (second import flagged), paste page 3's text onto page 7 (blocked with warning), click a ⚠️ dup? badge and test the compare dialog, test "Open it" from another project. Phase 0 deploy/key-rotation checks above are also still pending.

**Resume point:** after the manual tests pass, start **Phase 2 — Undo, validation, review mode** (see §4 prompt).

---

### 🟢 Phase 2 — Undo, validation, review mode — **CODE COMPLETE (2026-10-30); manual browser test pending**

**Code (all in `index.html`, block `PHASE 2 — UNDO, VALIDATION, REVIEW MODE`, before `addPage`):**
- Pure helpers (unit-tested): `newHist/histPush/histUndo/histRedo` (limit 20), `detectScript`, `projectScriptOf`, `baseTextFlags`; thresholds are constants (`UNDO_LIMIT`, `UNDO_TOAST_MS`, `MIN_TEXT_CHARS`, `GARBAGE_RATIO`, `MAX_CHAR_RUN`, `SCRIPT_MIN_LETTERS`, `SCRIPT_MIN_PAGES`).
- Glue: `recordUndo/undoPage/redoPage/undoLast/redoLast`, `refreshFlags()` (cached per text; called from `renderAll`, `updateStats`, `saveNow`), Review mode (`startReview/reviewStep/reviewAccept/exitReview/renderReviewUI`).
- Undo snapshot is taken **before** every Space paste, 📋 Paste, ✕ Clear and `R`; Space paste shows an Undo toast for 6 s; `Ctrl+Z` is handled before the existing `Z` = zoom shortcut.
- Persistence: `flags` + `reviewed` in IndexedDB page records, restore (`pushRestoredPage`), Drive `project.json` write/read, and `syncSig` (so Accept triggers a Drive sync). `sw.js` → `textriva-v9`.

**Deliberate deviations from the plan text:**
- The plan's `pending → uploading → ready → done → reviewed` status chain is implemented as a **separate `reviewed` boolean** on a `done` page, not a new `status` value — many existing code paths test `status === 'done'`, and a new value would have broken them. Revisit in Phase 10.
- Undo history is in memory only (not persisted), as the plan specifies.
- Wrong-script detection needs 3+ judged pages before it flags anything (avoids false alarms at the start of a project).

**Checks:** `npm test` → 57/57; `node --check` OK. **Not run in a browser.**

**Manual test (Phase 2 acceptance):** (1) Paste a vague/short text via Space → ⚠️ appears on the thumbnail and Lens grid. (2) Click **Review ⚠️** → only flagged pages are listed; ←/→ move between them; Accept removes the ⚠️. (3) Space-paste onto a page that already has text, press **↩ Undo** within 6 s → exact old text returns; also try `Ctrl+Z` with the cursor outside the text box. (4) Reload / reopen from Library and from Drive → ⚠️ and ✔ still there. (5) Check the Bangla project with one English page → "Wrong script?" flag.

**Resume point:** after the manual tests, next in the suggested order (§6) is **Phase 5 — Export & import**.

---

### 🟢 Phase 5 — Export & import — **CODE COMPLETE (2026-10-30); manual browser/Word test pending**

**Code (`index.html`, block `PHASE 5 — EXPORT & IMPORT`, before `addPage`):**
- Pure, unit-tested: `buildMarkdown`, `buildProjectJson/parseProjectJson`, `buildDocxFiles` + `parseDocxPages` (hand-built WordprocessingML, no docx library), `buildBackupZip/readBackupZip`, helpers (`xmlEscape`, `backupDirName`, `naturalCompare`, …). Note: `extractDeclaration()` can't parse functions whose signature has a default `{}` — use `opts = opts || {}` inside instead.
- Glue: Export dialog (`openExportDlg`, `doExport`), `printAsPdf`, `exportAllBackup`, `importBackupFiles`, `importProjectToLibrary`, `loadDocx`, `loadZip`, folder import, Library buttons (Export all / Import backup), `handleFiles` now accepts `.zip/.docx/.json`. `sw.js` → `textriva-v10`. i18n keys added for the two new top-level buttons.
- Tests: 73/73 (`tests/phase5.test.mjs` adds ZIP round trip with real JSZip, docx XML well-formedness via jsdom DOMParser, Bangla + `& < > "` + tabs + control chars).

**Deliberate deviations from the plan text (ask Mou if any should change):**
1. **PDF = browser print → "Save as PDF"**, not jsPDF. jsPDF cannot shape Bengali conjuncts, so a generated PDF would render broken Bangla; the print path uses the browser's text shaper and a Noto Sans Bengali web font. Trade-off: one extra click, no downloadable file generated by the app.
2. **DOCX built by hand + JSZip** (no `docx` library → one dependency instead of two). Fonts are *referenced* (Nirmala UI via the complex-script slot), not embedded; Word substitutes if missing.
3. **JSZip added as the only new dependency** (named in the plan; lazy-loaded, pinned 3.10.1 from cdnjs, no SRI hash yet — add one when you can fetch the file). Rule 9: tell Mou.
4. `.json` import creates text-only pages (no images). "Import backup" always creates **new** Library projects (never overwrites).
5. Merged docx/md import back as a single page (page boundaries aren't recoverable by design); page-wise docx round-trips exactly (empty trailing page is dropped).
6. "Import images folder" uses `webkitdirectory` (desktop Chrome/Edge/Firefox; limited on iOS).

**Not run in a browser / Word.** Manual acceptance: (1) Export → **Backup .zip** of a project, delete it from the Library, **Import backup** → same pages/text/⚠️/✔ and images. (2) Export `.docx`, open in Word → Bangla renders correctly, page breaks match pages; re-import that `.docx` → same page texts. (3) PDF → print dialog → Save as PDF → check Bangla conjuncts. (4) Drop a ZIP of images and a folder of images → pages appear in natural order. (5) `.md` opens correctly; Copy as Markdown pastes.

**Resume point:** next in §6 order is **Phase 4 — Text quality tools** (cleanup pipeline, Bangla fix rules, Find & Replace, search across Library, notes/bookmarks).

---

### 🟢 Phase 4 — Text quality tools — **DONE (manual browser test passed, 2026-10-30)**

**Code (`index.html`, block `PHASE 4 — TEXT QUALITY TOOLS`, before `PHASE 5`):**
- **Text tools…** dialog (`openTextTools`), 3 tabs, each with **Preview (diff) → Apply → Undo** (`planCleanup/planBangla/planReplace`, `diffTokens/diffToHtml`, `applyTextChanges`, `undoBulk`). Nothing changes without a preview/confirm.
  - **Cleanup:** join broken line wraps, remove repeated headers/footers/page numbers (>40 % of pages), de-hyphenate, normalise spaces/quotes.
  - **Bangla fixes:** editable rules (`|` → `।`, zero-width, ো/ৌ/য়/ড়/ঢ় recompose, digit convert). Rules live in the IndexedDB `settings` store.
  - **Find & Replace:** plain or regex, case / whole-word, live match count.
- **Library search:** search box in the Library over all projects; hit → opens that project at that page (`searchLibrary`, `runLibSearch`).
- **Notes / bookmarks / go-to:** per-page `note` and `bookmark` (saved in IndexedDB + Drive `project.json`, part of `syncSig`); `G` = go-to box, `B` = toggle bookmark. Thumbnail 🔖/📝 icon position adjusted by hand.

**⚠ Schema change: IndexedDB is now `DB_VERSION = 2`** (new `search` and `settings` stores, `upgradeSchema`). On the first open, `ensureSearchIndexes()` indexes existing projects automatically. Never go back to a lower version.

**Checks:** 121/121 tests passed after Phase 4 (re-verified after the last two hand edits: thumbnail icon position + `sw.js` → `textriva-v11`).

---

### 🟢 Phase 3 — Page tools — **CODE COMPLETE (2026-10-30); manual browser test pending**

**Code (`index.html`, block `PHASE 3 — PAGE TOOLS`, between Phase 4 and Phase 5; button 🛠 *Page tools…* in the action row):**
- Pure, unit-tested: `moveItem`, `normRotation`, `rotatedSize`, `cropRectFromMargins`, `spreadRects`, `parsePageRange`, `enhanceImageData` (auto-levels + unsharp mask).
- Canvas I/O is isolated in the `imgIO` seam (`size`, `render({rotate, crop, enhance})`) so tests can replace it (jsdom has no canvas).
- **Single choke point `setPageBlob(pg, blob)`:** swaps the image and invalidates `remoteUrl/remoteAt/driveFileId`, sets `blobSaved=false`, clears hashes/`possibleDupOf`/`pdfPage`, bumps `imgRev`, re-hashes silently (no duplicate prompts while editing). `imgRev` is part of `syncSig`, so an edit alone triggers a Drive sync.
- **Reorder:** thumbnails are `draggable` (HTML5 DnD for the mouse + a long-press touch drag, delegated on `#strip`), plus ◀ ▶ ⏮ ⏭ / *Move to #* in the dialog and **Alt+←/→**. Order = index in `state.pages` → saved as `order`; Drive `project.json` lists pages in that order.
- **Rotate / Crop / Split spread** over a page range (`editPages`, `splitSpreads`). Crop margins are fractions, applied per page size. Split: the first-read half keeps id/text/note/bookmark, the second half is a new pending page; RTL option; confirm if text exists.
- **Enhance for Lens:** `lensCopyBlob()` is used by both upload paths (`uploadImageWithRetry`, `openLens`); the stored page is untouched. Global setting in localStorage (`textriva-enhance-lens`); toggling drops cached Lens links.
- **Move/merge projects:** `movePagesToProject` (target written in one transaction first, then pages removed here; new page ids; target search index rebuilt) and `mergeProjectIntoCurrent` (Library button *➕ Merge into open*, offers to delete the source).
- **Undo:** in-memory, 10 steps (`takeImgSnap/commitImgSnap/undoPageEdit`); refused once the page list changed after the edit (checked via an id signature). Moving to another project is not undoable.
- **Race fix:** `uploadPage` and `openLens` now drop an upload result if the page image changed while it was in flight (otherwise Lens would open the *old* image).
- `sw.js` → `textriva-v12`. README has Phase 3 + Phase 4 sections.

**Deliberate deviations / things to know:**
1. Rotate/crop/split re-encode as **JPEG q0.92** (PNG sources stay PNG) → one extra lossy generation for JPEG pages.
2. Enhance is a **global** setting, not per project.
3. Edited pages get a **new Drive file**; the old file stays in the folder until a non-silent *Drive-এ Save* cleans it. Drive file names (`page-001.jpg`) reflect creation order, not the new order — the order lives in `project.json`.
4. Moved/merged pages get new ids and `driveFileId=null`; a Drive-linked target gets them on its next sync.
5. Touch drag is untested on a real device (jsdom only covers the mouse DnD events).

**Checks:** `npm test` → **146/146** (25 new in `tests/phase3.test.mjs`: pure helpers, reorder persistence through the real IndexedDB save + reopen, `syncSig` changes on reorder, DnD events, rotate/crop/split invalidation, undo guard, enhance only on the Lens copy, move/merge between projects, stale-upload discard, dialog + shortcuts). `node --check` on the module script OK. **Canvas rendering (`imgIO.render`) and touch drag were not run in a real browser.**

**Manual test (Phase 3 acceptance):** (1) Open a 10+ page PDF; rotate page 3 by 90°, press Lens on it → Lens receives the upright image. (2) Drag page 5 before page 2 (mouse), then on a phone long-press + drag; refresh → same order; open from Drive → same order. (3) Crop one page with the drawn rectangle and again with the sliders over pages `2-4`. (4) Split a two-page spread scan (also RTL); check text/bookmark stays on the first half; ↩ Undo restores. (5) Turn on *Enhance for Lens*, open Lens → text should be easier to read; the page preview stays unchanged. (6) Move pages `4-6` to a new project, open it, search a word from them in the Library; use *➕ Merge into open* to bring them back. (7) Edit a page while its upload is running → Lens must show the edited image.

**Resume point:** next in §6 order is **Phase 7 — Replace imgbb with own temporary storage** (then Phase 6 auto-OCR, then Phases 8–10).
