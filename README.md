# 🔍 LensFlow — Google Lens OCR Studio

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
3. Environment Variables: `IMGBB_KEY` = your key
4. Deploy ✅

**Option B: Vercel CLI**
```bash
npm i -g vercel
vercel --prod
# Add env var when prompted: IMGBB_KEY
```

---

## 📖 How to Use

1. Upload image(s) or PDF
2. Click "সব Upload করুন" → pages get public URLs (imgbb)
3. Click "Google Lens এ সব খুলুন" → Lens opens per page
4. In Lens: text auto-highlighted → copy it
5. Paste back in LensFlow → "Save & Next"
6. Download or copy all text at the end

---

## 📁 Files

```
lensflow/
├── index.html        ← Main app
├── api/upload.js     ← Vercel serverless proxy (fixes CORS)
├── vercel.json       ← Deploy config
├── .env.example      ← Env var template
└── README.md
```

## ⚙️ Env Vars

| Variable    | Get it from          |
|-------------|----------------------|
| IMGBB_KEY   | api.imgbb.com (free) |
