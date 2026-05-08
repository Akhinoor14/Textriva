# 🔍 LensOCR — 100% Free, No API, No Cost

ছবি থেকে text extract করুন — সম্পূর্ণ বিনামূল্যে।

## ✨ Features

- 🆓 **সম্পূর্ণ Free** — কোনো API key, কোনো payment, কোনো signup লাগবে না
- 🧠 **Tesseract.js OCR** — Browser-এই সব হয়, কোনো server নেই
- 🌐 **Google Lens বাটন** — একটা click-এ Google Lens-এ পাঠাবে
- 📸 **Multi-image** — একসাথে ২০টি ছবি
- 🖱 **Drag & Drop** — সহজে আপলোড, drag করে সাজান
- 🌍 **১৫+ ভাষা** — বাংলা, English, Arabic, Hindi, Chinese…
- 🌙 **Dark mode** — auto-detect
- 📋 **Copy & Download** — per-page বা সব একসাথে

---

## 🚀 Deploy করুন — ৩টি Option (সবই FREE)

### Option 1 — Vercel (Recommended, সবচেয়ে fast)

```bash
# Terminal-এ এই commands চালান:

npm install -g vercel   # একবারই করতে হবে
cd lens-ocr-free
vercel
```

- Project name দিন → Enter
- Done! একটা `xxx.vercel.app` URL পাবেন

**পরের বার update করতে:** `vercel --prod`

---

### Option 2 — GitHub Pages (Free, সহজ)

1. [github.com](https://github.com) — নতুন repository বানান
2. `index.html` file টি upload করুন
3. **Settings → Pages → Source: main branch → Save**
4. URL পাবেন: `https://username.github.io/repo-name`

---

### Option 3 — Netlify (Drag & Drop Deploy!)

1. [netlify.com](https://netlify.com) → Sign up (free)
2. Dashboard-এ `index.html` ফাইলটি **drag করে drop করুন**
3. Done! Live URL পাবেন সাথে সাথে

---

### Option 4 — Local (নিজের PC-তে)

শুধু `index.html` ফাইলটি browser-এ open করুন।
কোনো installation লাগবে না। ইন্টারনেট ছাড়াও কাজ করে (Tesseract CDN ছাড়া)।

---

## 💡 কীভাবে কাজ করে

```
আপনার ছবি
    ↓
Browser (Tesseract.js)  ←── সব এখানেই হয়, কোনো server নেই
    ↓
Extracted Text
```

**Tesseract.js** হলো Google-এর Tesseract OCR engine-এর JavaScript version।
এটি সম্পূর্ণ browser-এ চলে — আপনার ছবি কোনো server-এ যায় না।

---

## 📁 Files

```
lens-ocr-free/
└── index.html    ← এটাই সব! একটাই file।
```

---

## ⚡ Performance Tips

- **বাংলা text** ভালো extract করতে: Settings → Language → বাংলা (Bengali)
- **Mixed language** (বাংলা + English): Auto detect ব্যবহার করুন
- **Parallel mode**: Settings-এ চালু করলে সব ছবি একসাথে process হবে (দ্রুত কিন্তু বেশি memory)
- **ছবির quality** যত ভালো, OCR তত accurate

---

## License

MIT — যেভাবে খুশি use করুন।
