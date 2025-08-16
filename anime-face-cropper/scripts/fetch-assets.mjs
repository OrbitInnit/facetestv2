import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(__dirname, '..', 'public');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const assets = [
  {
    url: 'https://github.com/opencv/opencv/releases/download/4.10.0/opencv.js',
    file: 'opencv.js',
    sizeHint: '≈8–9 MB'
  },
  {
    url: 'https://raw.githubusercontent.com/nagadomi/lbpcascade_animeface/master/lbpcascade_animeface.xml',
    file: 'lbpcascade_animeface.xml',
    sizeHint: '≈100 KB'
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

for (const a of assets) {
  const target = path.join(outDir, a.file);
  if (fs.existsSync(target) && fs.statSync(target).size > 1024) {
    console.log(`[ok] ${a.file} already present (${(fs.statSync(target).size/1024/1024).toFixed(2)} MB)`);
    continue;
  }
  console.log(`[fetch] ${a.file} from ${a.url} (${a.sizeHint})`);
  try {
    await download(a.url, target);
    console.log(`[done] ${a.file}`);
  } catch (e) {
    console.error(`[warn] Failed to fetch ${a.file}:`, e.message);
    console.error('You can manually place it in public/ and re-run.');
  }
}
