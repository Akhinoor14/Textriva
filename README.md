# 🔍 LensFlow — Google Lens OCR Studio

**Image/PDF → Google Lens → Text Extract | 100% Free | No API | No Signup**

---

## ✨ Features

- **PDF Support** — PDF automatically splits into pages (up to 30)
- **Bulk Upload** — Multiple images at once  
- **Auto imgbb Upload** — Each page gets a free public link
- **Google Lens Integration** — Opens Lens with your image pre-loaded
- **Page-by-Page workflow** — Navigate pages, paste text, save & next
- **All-in-one results** — Copy all text or download as .txt
- **Dark/Light theme**
- **Keyboard shortcuts** (← → to navigate pages)

---

## 🚀 Deploy to Vercel (Free, Global)

```bash
# Method 1: Vercel CLI
npm install -g vercel
vercel --prod

# Method 2: Vercel Dashboard
# 1. Go to vercel.com → New Project
# 2. Upload this folder OR connect GitHub repo
# 3. Deploy — done! Global CDN, HTTPS, custom domain
```

## 🌐 Deploy to Netlify (Alternative)

```bash
# Drag & drop the project folder at netlify.com/drop
# Or: netlify deploy --prod --dir .
```

---

## 📖 How to Use

1. **Upload** — Drag image(s) or PDF onto the upload zone
2. **Upload to Cloud** — Click "সব Upload করুন" — pages go to imgbb.com (free)
3. **Open Google Lens** — Click "Google Lens এ সব খুলুন" — each page opens in a new tab
4. **Extract Text** — In the Lens tab, select all text → Copy
5. **Paste & Save** — Back in LensFlow, paste text → "Save & Next"
6. **Done!** — All pages' text collected, copy/download

---

## 🔧 Tech Stack

- **Vanilla HTML/CSS/JS** — No framework, no build step
- **PDF.js** — PDF rendering (CDN)
- **imgbb.com** — Free image hosting (anonymous uploads)
- **Google Lens** — OCR engine (via `lens.google.com/uploadbyurl`)

---

## 📁 Files

```
lensflow/
├── index.html      ← Main app (single file)
├── vercel.json     ← Vercel deployment config
└── README.md       ← This file
```

---

## ⚠️ Notes

- imgbb free tier allows uploads up to 32MB
- Google Lens may require being logged in for best results
- Pop-up blocker may block multiple Lens tabs — allow popups for the site
- Works best in Chrome/Edge (Google Lens is a Google product)
