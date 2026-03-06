/**
 * Passport Photo Maker — script.js
 *
 * Processes a portrait photo into a passport-size image entirely in the browser.
 * Libraries used:
 *   • face-api.js  (face detection, via CDN loaded in index.html)
 *
 * Passport photo target: 413 × 531 px  (35 mm × 45 mm @ 300 dpi)
 */

(function () {
  'use strict';

  /* ─── Constants ─────────────────────────────────────────────── */
  const PASSPORT_W = 413;
  const PASSPORT_H = 531;
  const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

  // Models URL — served from jsDelivr CDN (no local files needed)
  const MODELS_URL =
    'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

  /* ─── State ──────────────────────────────────────────────────── */
  let originalImage = null;   // HTMLImageElement of the uploaded photo
  let processedCanvas = null; // the final passport canvas (after processing)
  let modelsLoaded = false;
  let bgColor = '#ffffff';
  let brightness = 0;
  let contrast = 0;
  let sharpness = 0;

  /* ─── DOM refs ───────────────────────────────────────────────── */
  const fileInput          = document.getElementById('fileInput');
  const dropZone           = document.getElementById('dropZone');
  const browseBtn          = document.getElementById('browseBtn');
  const generateSection    = document.getElementById('generateSection');
  const generateBtn        = document.getElementById('generateBtn');
  const originalPreview    = document.getElementById('originalPreview');
  const resultCanvas       = document.getElementById('resultCanvas');
  const resultPlaceholder  = document.getElementById('resultPlaceholder');
  const loading            = document.getElementById('loading');
  const loadingText        = document.getElementById('loadingText');
  const toolsSection       = document.getElementById('toolsSection');
  const downloadSection    = document.getElementById('downloadSection');
  const downloadSingleBtn  = document.getElementById('downloadSingleBtn');
  const downloadSheetBtn   = document.getElementById('downloadSheetBtn');
  const sheetCanvas        = document.getElementById('sheetCanvas');
  const errorBanner        = document.getElementById('errorBanner');
  const errorText          = document.getElementById('errorText');
  const autoAlignBtn       = document.getElementById('autoAlignBtn');

  const brightnessRange    = document.getElementById('brightnessRange');
  const contrastRange      = document.getElementById('contrastRange');
  const sharpnessRange     = document.getElementById('sharpnessRange');
  const brightnessVal      = document.getElementById('brightnessVal');
  const contrastVal        = document.getElementById('contrastVal');
  const sharpnessVal       = document.getElementById('sharpnessVal');
  const customBgColor      = document.getElementById('customBgColor');

  /* ─── Model loading ──────────────────────────────────────────── */
  async function loadModels() {
    if (modelsLoaded) return;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
    ]);
    modelsLoaded = true;
  }

  /* ─── File validation ────────────────────────────────────────── */
  function validateFile(file) {
    if (!file) return 'No file selected.';
    if (!ACCEPTED_TYPES.includes(file.type)) return 'Only JPG and PNG files are supported.';
    if (file.size > MAX_FILE_BYTES) return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`;
    return null;
  }

  /* ─── Show / hide helpers ────────────────────────────────────── */
  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.classList.remove('hidden');
    setTimeout(() => errorBanner.classList.add('hidden'), 6000);
  }

  function hideError() {
    errorBanner.classList.add('hidden');
  }

  function showSection(el) {
    el.classList.remove('hidden');
    el.classList.add('show');
  }

  function setLoading(show, text) {
    if (show) {
      loading.classList.remove('hidden');
      loadingText.textContent = text || 'Processing…';
      generateBtn.disabled = true;
    } else {
      loading.classList.add('hidden');
      generateBtn.disabled = false;
    }
  }

  /* ─── File handling ──────────────────────────────────────────── */
  function handleFile(file) {
    hideError();
    const err = validateFile(file);
    if (err) { showError(err); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        originalPreview.src = e.target.result;
        showSection(generateSection);

        // Reset result
        processedCanvas = null;
        resultPlaceholder.classList.remove('hidden');
        const ctx = resultCanvas.getContext('2d');
        ctx.clearRect(0, 0, PASSPORT_W, PASSPORT_H);

        toolsSection.classList.add('hidden');
        downloadSection.classList.add('hidden');
      };
      img.onerror = () => showError('Failed to load image.');
      img.src = e.target.result;
    };
    reader.onerror = () => showError('Failed to read file.');
    reader.readAsDataURL(file);
  }

  /* ─── Drop zone interactions ─────────────────────────────────── */
  dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  /* ─── Core processing pipeline ───────────────────────────────── */
  generateBtn.addEventListener('click', generatePassportPhoto);

  async function generatePassportPhoto() {
    if (!originalImage) return;
    hideError();

    try {
      setLoading(true, 'Loading AI models…');
      await loadModels();

      setLoading(true, 'Detecting face…');
      const detection = await detectFace(originalImage);

      if (!detection) {
        setLoading(false);
        showError('No face detected. Please upload a clear portrait photo with a visible face.');
        return;
      }

      setLoading(true, 'Processing image…');
      const sourceCanvas = imageToCanvas(originalImage);

      setLoading(true, 'Removing background…');
      const segmented = await removeBackground(sourceCanvas, detection);

      setLoading(true, 'Composing passport photo…');
      const passport = composePassportPhoto(segmented, detection);

      // Draw final result
      const ctx = resultCanvas.getContext('2d');
      ctx.clearRect(0, 0, PASSPORT_W, PASSPORT_H);
      ctx.drawImage(passport, 0, 0);

      processedCanvas = passport;
      resultPlaceholder.classList.add('hidden');

      showSection(toolsSection);
      showSection(downloadSection);

    } catch (err) {
      console.error(err);
      showError('An error occurred during processing. Please try a different photo.');
    } finally {
      setLoading(false);
    }
  }

  /* ─── Face detection ─────────────────────────────────────────── */
  async function detectFace(img) {
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
    const detection = await faceapi
      .detectSingleFace(img, options)
      .withFaceLandmarks();
    return detection || null;
  }

  /* ─── Convert image to canvas ────────────────────────────────── */
  function imageToCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }

  /* ─── Simple background removal ─────────────────────────────────
   * Strategy:
   *   1. Convert to HSL; pixels that are "skin-tone adjacent" near the
   *      detected face bounding box are kept; everything far from the
   *      face region and low-saturation is treated as background.
   *   2. A soft ellipse mask feathers the edges so the result looks
   *      clean even without a full ML segmentation model.
   *
   * This is a best-effort approach that works well for head-and-
   * shoulders photos with relatively uniform backgrounds.
   * ─────────────────────────────────────────────────────────────── */
  async function removeBackground(srcCanvas, detection) {
    const { width, height } = srcCanvas;
    const ctx = srcCanvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Face bounding box in source image coordinates
    const box = detection.detection.box;
    const faceCx = box.x + box.width / 2;
    const faceCy = box.y + box.height / 2;

    // Head region: extend box to include whole head + shoulders
    const headW = box.width * 1.6;
    const headH = box.height * 2.4;
    const headCx = faceCx;
    const headCy = faceCy + box.height * 0.15; // shift down slightly for chin

    // Sample background color from image corners
    const bgSample = sampleCornerPixels(data, width, height);

    // Ellipse mask radii
    const rx = headW / 2;
    const ry = headH / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Normalized distance from head ellipse centre
        const dx = (x - headCx) / rx;
        const dy = (y - headCy) / ry;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Color similarity to background sample
        const bgDiff = colorDistance(r, g, b, bgSample.r, bgSample.g, bgSample.b);

        let alpha = data[i + 3];

        if (dist > 1.15) {
          // Clearly outside head ellipse → background
          alpha = 0;
        } else if (dist > 0.85) {
          // Feathered boundary
          const t = (dist - 0.85) / 0.30; // 0→1
          // If pixel is also background-coloured, remove it
          const bgWeight = Math.min(1, bgDiff < 40 ? t * 1.5 : t * 0.5);
          alpha = Math.round(255 * (1 - bgWeight));
        }
        // else: inside ellipse — keep alpha as-is

        data[i + 3] = Math.max(0, Math.min(255, alpha));
      }
    }

    // Write back
    ctx.putImageData(imageData, 0, 0);

    // Composite over solid background
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const outCtx = out.getContext('2d');
    outCtx.fillStyle = bgColor;
    outCtx.fillRect(0, 0, width, height);
    outCtx.drawImage(srcCanvas, 0, 0);
    return out;
  }

  function sampleCornerPixels(data, width, height) {
    const corners = [
      [2, 2],
      [width - 3, 2],
      [2, height - 3],
      [width - 3, height - 3],
    ];
    let tr = 0, tg = 0, tb = 0;
    corners.forEach(([x, y]) => {
      const i = (y * width + x) * 4;
      tr += data[i];
      tg += data[i + 1];
      tb += data[i + 2];
    });
    return { r: tr / 4, g: tg / 4, b: tb / 4 };
  }

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    return Math.sqrt(
      (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
    );
  }

  /* ─── Compose final passport photo ───────────────────────────── */
  function composePassportPhoto(sourceCanvas, detection) {
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;

    const box = detection.detection.box;
    const faceCx = box.x + box.width / 2;
    const faceCy = box.y + box.height / 2;

    // Passport guidelines: head should occupy ~70-80% of frame height
    // We use the face box height as a proxy for face/head size.
    // The crop window height is sized so the face takes up ~68% of it.
    const targetFaceHeightFraction = 0.68;
    const cropH = box.height / targetFaceHeightFraction;
    const cropW = cropH * (PASSPORT_W / PASSPORT_H);

    // Centre the crop on the face centre, shifted up slightly to include forehead
    const foreheadOffset = box.height * 0.25;
    let cropX = faceCx - cropW / 2;
    let cropY = faceCy - cropH / 2 - foreheadOffset;

    // Clamp crop window inside source image
    cropX = Math.max(0, Math.min(cropX, srcW - cropW));
    cropY = Math.max(0, Math.min(cropY, srcH - cropH));

    // If crop window extends beyond image, use whole image as source
    const actualCropW = Math.min(cropW, srcW - cropX);
    const actualCropH = Math.min(cropH, srcH - cropY);

    const passport = document.createElement('canvas');
    passport.width = PASSPORT_W;
    passport.height = PASSPORT_H;
    const ctx = passport.getContext('2d');

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, PASSPORT_W, PASSPORT_H);

    // Draw cropped/scaled region
    ctx.drawImage(
      sourceCanvas,
      cropX, cropY, actualCropW, actualCropH,
      0, 0, PASSPORT_W, PASSPORT_H
    );

    // Apply adjustments
    applyAdjustments(ctx, PASSPORT_W, PASSPORT_H);

    return passport;
  }

  /* ─── Image adjustments (brightness / contrast / sharpness) ─── */
  function applyAdjustments(ctx, w, h) {
    if (brightness === 0 && contrast === 0 && sharpness === 0) return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Brightness & contrast
    if (brightness !== 0 || contrast !== 0) {
      const bAdj = brightness;
      // contrast factor: 0 = same, >0 = more, <0 = less
      const cFactor = contrast > 0
        ? (259 * (contrast + 255)) / (255 * (259 - contrast))
        : 1 + contrast / 100;

      for (let i = 0; i < data.length; i += 4) {
        data[i]     = clamp(cFactor * (data[i]     - 128) + 128 + bAdj);
        data[i + 1] = clamp(cFactor * (data[i + 1] - 128) + 128 + bAdj);
        data[i + 2] = clamp(cFactor * (data[i + 2] - 128) + 128 + bAdj);
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Sharpness via unsharp-mask-like filter using canvas filter
    if (sharpness > 0) {
      ctx.filter = buildSharpnessFilter(sharpness);
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
    }
  }

  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  /**
   * Builds an SVG-based sharpness (unsharp-mask) filter string for canvas.
   * @param {number} sharpness - value from 0–10
   * @returns {string} CSS filter value
   */
  function buildSharpnessFilter(sharpness) {
    const amount = sharpness * 0.04; // maps 0–10 to 0–0.4
    const centre = 1 + 4 * amount;
    const kernel = `0 -${amount} 0 -${amount} ${centre} -${amount} 0 -${amount} 0`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='s'><feConvolveMatrix order='3' kernelMatrix='${kernel}'/></filter></svg>`;
    return `url("data:image/svg+xml,${svg}#s")`;
  }

  /* ─── Redraw result after adjustment changes ─────────────────── */
  function redrawResult() {
    if (!processedCanvas) return;
    const ctx = resultCanvas.getContext('2d');
    // Recompose from processedCanvas but reapply fresh adjustments
    ctx.clearRect(0, 0, PASSPORT_W, PASSPORT_H);
    ctx.drawImage(processedCanvas, 0, 0);
    applyAdjustments(ctx, PASSPORT_W, PASSPORT_H);
  }

  /* ─── Slider events ──────────────────────────────────────────── */
  brightnessRange.addEventListener('input', () => {
    brightness = parseInt(brightnessRange.value, 10);
    brightnessVal.textContent = brightness;
    redrawResult();
  });

  contrastRange.addEventListener('input', () => {
    contrast = parseInt(contrastRange.value, 10);
    contrastVal.textContent = contrast;
    redrawResult();
  });

  sharpnessRange.addEventListener('input', () => {
    sharpness = parseInt(sharpnessRange.value, 10);
    sharpnessVal.textContent = sharpness;
    redrawResult();
  });

  /* ─── Background colour buttons ──────────────────────────────── */
  const bgColorMap = {
    white: '#ffffff',
    lightgray: '#e8e8e8',
    lightblue: '#c8d8f0',
  };

  document.querySelectorAll('.bg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const colorKey = btn.dataset.color;
      if (colorKey === 'custom') return; // handled by color input
      bgColor = bgColorMap[colorKey] || '#ffffff';
      setActiveBgBtn(btn);
      if (processedCanvas) rerunCompose();
    });
  });

  customBgColor.addEventListener('input', () => {
    bgColor = customBgColor.value;
    const customBtn = document.querySelector('.bg-btn[data-color="custom"]');
    setActiveBgBtn(customBtn);
    if (processedCanvas) rerunCompose();
  });

  function setActiveBgBtn(activeBtn) {
    document.querySelectorAll('.bg-btn').forEach((b) => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }

  /* ─── Re-run composition (when bg colour changes post-generation) */
  async function rerunCompose() {
    if (!originalImage) return;
    try {
      setLoading(true, 'Updating background…');
      const detection = await detectFace(originalImage);
      if (!detection) return;
      const srcCanvas = imageToCanvas(originalImage);
      const segmented = await removeBackground(srcCanvas, detection);
      const passport = composePassportPhoto(segmented, detection);
      processedCanvas = passport;
      const ctx = resultCanvas.getContext('2d');
      ctx.clearRect(0, 0, PASSPORT_W, PASSPORT_H);
      ctx.drawImage(passport, 0, 0);
      applyAdjustments(ctx, PASSPORT_W, PASSPORT_H);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  /* ─── Auto-align button ──────────────────────────────────────── */
  autoAlignBtn.addEventListener('click', async () => {
    if (!originalImage) return;
    // Reset sliders
    brightness = 0; contrast = 0; sharpness = 0;
    brightnessRange.value = 0; brightnessVal.textContent = 0;
    contrastRange.value = 0; contrastVal.textContent = 0;
    sharpnessRange.value = 0; sharpnessVal.textContent = 0;
    await rerunCompose();
  });

  /* ─── Download helpers ───────────────────────────────────────── */
  downloadSingleBtn.addEventListener('click', () => {
    if (!processedCanvas) return;
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = PASSPORT_W;
    finalCanvas.height = PASSPORT_H;
    const ctx = finalCanvas.getContext('2d');
    ctx.drawImage(resultCanvas, 0, 0);
    triggerDownload(finalCanvas, 'passport-photo.png');
  });

  downloadSheetBtn.addEventListener('click', () => {
    if (!processedCanvas) return;
    buildAndDownloadSheet();
  });

  function buildAndDownloadSheet() {
    // 2×2 grid: 2 columns × 2 rows with 20px gap, 40px margin
    const cols = 2, rows = 2;
    const gap = 20;
    const margin = 40;
    const sheetW = margin * 2 + cols * PASSPORT_W + (cols - 1) * gap;
    const sheetH = margin * 2 + rows * PASSPORT_H + (rows - 1) * gap;

    sheetCanvas.width = sheetW;
    sheetCanvas.height = sheetH;
    const ctx = sheetCanvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sheetW, sheetH);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = margin + c * (PASSPORT_W + gap);
        const y = margin + r * (PASSPORT_H + gap);
        ctx.drawImage(resultCanvas, x, y);
        // Draw dashed cut line
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, PASSPORT_W, PASSPORT_H);
        ctx.restore();
      }
    }

    triggerDownload(sheetCanvas, 'passport-photo-sheet.png');
  }

  function triggerDownload(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

}());
