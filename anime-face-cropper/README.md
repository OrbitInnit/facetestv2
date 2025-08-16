# Anime Face & Portrait Cropper (Gwern-style)

Client-side anime face cropper with Gwern-style portrait margins. Embedded OpenCV.js is fetched during install and served locally from `/public/opencv.js`.

## Quick Start

```bash
npm install
npm run dev
```

## Deploy to Vercel
- Push this folder to GitHub
- Import into Vercel as a Vite project
- Build command: `npm run build`
- Output directory: `dist`

The `postinstall` script downloads:
- OpenCV.js (4.10.0) into `public/opencv.js`
- `lbpcascade_animeface.xml` into `public/`

## Notes
- All processing is in-browser; no server needed.
- If download of assets fails on your machine or Vercel, manually place the files in `public/` and re-run.
