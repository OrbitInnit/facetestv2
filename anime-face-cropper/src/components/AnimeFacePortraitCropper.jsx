import React, { useEffect, useRef, useState } from 'react';

const ensureOpenCV = () =>
  new Promise((resolve) => {
    const wait = () => {
      if (window.cv && window.cv.Mat) {
        if (!window.cv.ready) {
          // Some builds expose onRuntimeInitialized; set a ready flag
          if (typeof window.cv['onRuntimeInitialized'] === 'function') {
            const prev = window.cv['onRuntimeInitialized'];
            window.cv['onRuntimeInitialized'] = () => {
              window.cv.ready = true;
              prev();
              resolve(window.cv);
            };
          } else {
            window.cv.ready = true;
            resolve(window.cv);
          }
        } else {
          resolve(window.cv);
        }
      } else {
        setTimeout(wait, 100);
      }
    };
    wait();
  });

export default function AnimeFacePortraitCropper() {
  const [cvReady, setCvReady] = useState(false);
  const [classifier, setClassifier] = useState(null);
  const [cascadeName, setCascadeName] = useState('lbpcascade_animeface.xml');
  const [log, setLog] = useState('Loading OpenCV.js…');

  const [files, setFiles] = useState([]);
  const [minSize, setMinSize] = useState(250);
  const [scaleFactor, setScaleFactor] = useState(1.1);
  const [minNeighbors, setMinNeighbors] = useState(5);

  const [mode, setMode] = useState('portrait'); // 'face' | 'portrait'
  const [expandTop, setExpandTop] = useState(0.25);
  const [expandLeft, setExpandLeft] = useState(0.90);
  const [expandRight, setExpandRight] = useState(1.25);
  const [padSquare, setPadSquare] = useState(true);
  const [targetSize, setTargetSize] = useState(512);

  const [results, setResults] = useState([]);

  const cascadeFileInput = useRef(null);

  useEffect(() => {
    let mounted = true;
    ensureOpenCV().then(() => {
      if (!mounted) return;
      setCvReady(true);
      setLog('OpenCV.js ready. Load cascade or start cropping.');
    });
    return () => { mounted = false; }
  }, []);

  const loadCascadeFromUrl = async (urlPath) => {
    const cv = window.cv;
    if (!cvReady) return;
    try {
      const res = await fetch(urlPath);
      const buf = await res.arrayBuffer();
      const data = new Uint8Array(buf);
      const name = urlPath.split('/').pop();
      cv.FS_createDataFile('/', name, data, true, false, false);
      const cls = new cv.CascadeClassifier();
      const ok = cls.load(name);
      if (!ok) throw new Error('Cascade load returned false: ' + name);
      setClassifier(cls);
      setCascadeName(name);
      setLog(`Loaded cascade: ${name}`);
    } catch (e) {
      setLog('Error loading cascade: ' + e.message);
    }
  };

  const onUploadCascade = async (file) => {
    const cv = window.cv;
    if (!cvReady || !file) return;
    try {
      const buf = await file.arrayBuffer();
      const data = new Uint8Array(buf);
      const name = file.name || 'custom_animeface.xml';
      cv.FS_createDataFile('/', name, data, true, false, false);
      const cls = new cv.CascadeClassifier();
      const ok = cls.load(name);
      if (!ok) throw new Error('Cascade load returned false');
      setClassifier(cls);
      setCascadeName(name);
      setLog(`Loaded custom cascade: ${name}`);
    } catch (e) {
      setLog('Error loading custom cascade: ' + e.message);
    }
  };

  const onPickImages = (e) => {
    const list = [...(e.target.files || [])];
    setFiles(list);
  };

  const runCrop = async () => {
    const cv = window.cv;
    if (!cvReady) return setLog('OpenCV not ready yet.');
    if (!classifier) return setLog('Load an animeface cascade first (XML).');
    if (!files.length) return setLog('Select images to crop.');

    const out = [];
    for (const f of files) {
      const imgDataUrl = await readAsDataURL(f);
      const img = await loadImage(imgDataUrl);
      const src = cv.imread(img);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.equalizeHist(gray, gray);
      const faces = new cv.RectVector();
      const msize = new cv.Size(minSize, minSize);
      classifier.detectMultiScale(gray, faces, scaleFactor, minNeighbors, 0, msize);

      const previews = [];
      for (let i = 0; i < faces.size(); i++) {
        const r = faces.get(i);
        const cropMeta = { x: r.x, y: r.y, w: r.width, h: r.height };
        let roi = cropRect(src, cropMeta, mode, { expandTop, expandLeft, expandRight });
        if (padSquare) roi = padToSquare(roi, cv);
        const resized = new cv.Mat();
        const size = new cv.Size(targetSize, targetSize);
        cv.resize(roi, resized, size, 0, 0, cv.INTER_AREA);
        const png = cv.imencode('.png', resized);
        const dataUrl = `data:image/png;base64,${arrayBufferToBase64(png)}`;
        previews.push({ bbox: cropMeta, dataUrl, meta: { mode, targetSize, padSquare } });
        roi.delete(); resized.delete(); png.delete?.();
      }

      out.push({ name: f.name, previews, originalW: src.cols, originalH: src.rows });
      faces.delete(); msize.delete(); gray.delete(); src.delete();
    }

    setResults(out);
    setLog(`Processed ${out.length} file(s). Found ${out.reduce((a,b)=>a+b.previews.length,0)} face(s).`);
  };

  function cropRect(src, bbox, mode, params) {
    const cv = window.cv;
    const { x, y, w, h } = bbox;
    let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
    if (mode === 'portrait') {
      x0 = Math.floor(x * params.expandLeft);
      y0 = Math.floor(y * params.expandTop);
      x1 = Math.floor(x + w * params.expandRight);
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(src.cols, x1); y1 = Math.min(src.rows, y1);
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, y1 - y0);
    const rect = new cv.Rect(x0, y0, width, height);
    return src.roi(rect);
  }

  function padToSquare(mat, cv) {
    const side = Math.max(mat.cols, mat.rows);
    const out = new cv.Mat.zeros(side, side, mat.type());
    const x = Math.floor((side - mat.cols) / 2);
    const y = Math.floor((side - mat.rows) / 2);
    const roi = out.roi(new cv.Rect(x, y, mat.cols, mat.rows));
    mat.copyTo(roi);
    roi.delete();
    return out;
  }

  function arrayBufferToBase64(vec) {
    const arr = vec.data;
    let str = '';
    for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
    return btoa(str);
  }

  const downloadAll = () => {
    results.forEach((r) => {
      r.previews.forEach((p, j) => {
        const a = document.createElement('a');
        a.href = p.dataUrl;
        const baseName = r.name.replace(/\.[^.]+$/, '');
        a.download = `${baseName}__${mode}__${j + 1}_${targetSize}.png`;
        a.click();
      });
    });
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-6">
      <div className="max-w-6xl mx-auto grid gap-6">
        <header className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold">Anime Face & Portrait Cropper</h1>
          <div className="text-sm opacity-80">Client-side • OpenCV.js • No uploads</div>
        </header>

        <section className="bg-white rounded-2xl shadow p-4 grid gap-4">
          <h2 className="text-lg font-semibold">1) Load Anime Face Cascade</h2>
          <p className="text-sm opacity-80">
            Recommended: Nagadomi's <code>lbpcascade_animeface.xml</code>. It should be present in <code>/public</code> (auto-fetched on install),
            or you can upload it here.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => loadCascadeFromUrl('/' + cascadeName)} className="px-3 py-2 rounded-2xl shadow bg-black text-white">
              Load default: {cascadeName}
            </button>
            <input ref={cascadeFileInput} type="file" accept="text/xml,.xml" className="hidden" onChange={(e) => onUploadCascade(e.target.files?.[0])} />
            <button onClick={() => cascadeFileInput.current?.click()} className="px-3 py-2 rounded-2xl shadow border">Upload XML…</button>
            <span className="text-sm">Status: {cvReady ? (classifier ? 'Cascade loaded' : 'OpenCV ready') : 'Loading OpenCV…'}</span>
          </div>
          <p className="text-xs font-mono bg-neutral-100 rounded p-2 overflow-x-auto">{log}</p>
        </section>

        <section className="bg-white rounded-2xl shadow p-4 grid gap-3">
          <h2 className="text-lg font-semibold">2) Detection & Crop Settings</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Detection mode</label>
              <div className="flex gap-2">
                {(['face','portrait']).map(m => (
                  <button key={m} onClick={() => setMode(m)} className={`px-3 py-2 rounded-2xl shadow border ${mode===m?'bg-black text-white':''}`}>{m}</button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Minimum face size (px)</label>
              <input type="number" value={minSize} onChange={e=>setMinSize(parseInt(e.target.value||'0'))} className="border rounded-2xl px-3 py-2" />
              <p className="text-xs opacity-70">Try 250–300 to reduce false positives.</p>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">scaleFactor</label>
              <input type="number" step="0.1" value={scaleFactor} onChange={e=>setScaleFactor(parseFloat(e.target.value||'1.1'))} className="border rounded-2xl px-3 py-2" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">minNeighbors</label>
              <input type="number" value={minNeighbors} onChange={e=>setMinNeighbors(parseInt(e.target.value||'5'))} className="border rounded-2xl px-3 py-2" />
            </div>
          </div>

          {mode === 'portrait' && (
            <div className="grid sm:grid-cols-3 gap-4 mt-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Top multiplier (y*…)</label>
                <input type="number" step="0.05" value={expandTop} onChange={e=>setExpandTop(parseFloat(e.target.value||'0.25'))} className="border rounded-2xl px-3 py-2" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Left multiplier (x*…)</label>
                <input type="number" step="0.05" value={expandLeft} onChange={e=>setExpandLeft(parseFloat(e.target.value||'0.90'))} className="border rounded-2xl px-3 py-2" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Right width multiplier (x + w*…)</label>
                <input type="number" step="0.05" value={expandRight} onChange={e=>setExpandRight(parseFloat(e.target.value||'1.25'))} className="border rounded-2xl px-3 py-2" />
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-4 mt-2">
            <div className="flex items-center gap-2">
              <input id="padsq" type="checkbox" checked={padSquare} onChange={()=>setPadSquare(!padSquare)} />
              <label htmlFor="padsq" className="text-sm font-medium">Pad to square</label>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Export size (px)</label>
              <input type="number" value={targetSize} onChange={e=>setTargetSize(parseInt(e.target.value||'512'))} className="border rounded-2xl px-3 py-2" />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow p-4 grid gap-3">
          <h2 className="text-lg font-semibold">3) Upload Images</h2>
          <input type="file" multiple accept="image/*" onChange={onPickImages} className="border rounded-2xl px-3 py-2" />
          <div className="flex gap-3">
            <button onClick={runCrop} className="px-4 py-2 rounded-2xl shadow bg-black text-white">Run crop</button>
            <button onClick={downloadAll} disabled={!results.length} className={`px-4 py-2 rounded-2xl shadow ${results.length?'bg-neutral-800 text-white':'bg-neutral-200'}`}>Download all</button>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow p-4 grid gap-4">
          <h2 className="text-lg font-semibold">4) Results</h2>
          {!results.length && <p className="text-sm opacity-70">No crops yet. After running, previews appear here.</p>}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r, idx) => (
              <div key={idx} className="border rounded-2xl p-3 grid gap-2">
                <div className="text-sm font-semibold truncate" title={r.name}>{r.name}</div>
                <div className="text-xs opacity-70">Original: {r.originalW}×{r.originalH}</div>
                <div className="grid grid-cols-2 gap-2">
                  {r.previews.map((p, j) => (
                    <a key={j} href={p.dataUrl} download className="block">
                      <img src={p.dataUrl} alt="crop" className="w-full h-auto rounded-xl shadow" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="text-xs opacity-70 py-8">
          <p>Tip: If you see false positives, raise <em>Min face size</em> (try 300).</p>
        </footer>
      </div>
    </div>
  );
}

async function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
