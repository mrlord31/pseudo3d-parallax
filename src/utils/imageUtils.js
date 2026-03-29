/**
 * Load an image from a URL and return an HTMLImageElement.
 * Cross-origin is set to 'anonymous' for canvas read-back.
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Resize an image element to fit within maxDim while preserving aspect ratio.
 * Returns a data URL of the resized image.
 */
export function resizeImage(img, maxDim = 1024) {
  const ratio = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
  const w = Math.round(img.naturalWidth * ratio);
  const h = Math.round(img.naturalHeight * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return { url: canvas.toDataURL('image/jpeg', 0.92), width: w, height: h };
}

/**
 * Generate a procedural demo image (colorful geometric shapes at varying depths).
 * Returns a data URL.
 */
export function generateDemoImage(width = 800, height = 600) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0d1b3e');
  sky.addColorStop(1, '#1a3a6e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.6;
    const r = Math.random() * 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distant mountain silhouette
  ctx.fillStyle = '#0f2244';
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 20) {
    const y = height * 0.55 + Math.sin(x * 0.015) * 60 + Math.sin(x * 0.04) * 25;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Mid mountains
  ctx.fillStyle = '#1a3355';
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 15) {
    const y = height * 0.65 + Math.sin(x * 0.02 + 1) * 45 + Math.sin(x * 0.055) * 20;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Ground
  const ground = ctx.createLinearGradient(0, height * 0.7, 0, height);
  ground.addColorStop(0, '#0d2b1a');
  ground.addColorStop(1, '#061508');
  ctx.fillStyle = ground;
  ctx.fillRect(0, height * 0.7, width, height * 0.3);

  // Trees (foreground)
  const treePositions = [60, 150, 680, 740, 790];
  treePositions.forEach((tx) => {
    const th = 120 + Math.random() * 60;
    ctx.fillStyle = '#041a0c';
    ctx.beginPath();
    ctx.moveTo(tx, height * 0.7);
    ctx.lineTo(tx - 30, height * 0.7 - th * 0.5);
    ctx.lineTo(tx, height * 0.7 - th);
    ctx.lineTo(tx + 30, height * 0.7 - th * 0.5);
    ctx.closePath();
    ctx.fill();
  });

  // Moon
  const moonGrad = ctx.createRadialGradient(width * 0.72, height * 0.15, 5, width * 0.72, height * 0.15, 48);
  moonGrad.addColorStop(0, '#fffde7');
  moonGrad.addColorStop(0.7, '#fff9c4');
  moonGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = moonGrad;
  ctx.beginPath();
  ctx.arc(width * 0.72, height * 0.15, 40, 0, Math.PI * 2);
  ctx.fill();

  // Foreground rock
  ctx.fillStyle = '#0a1a0a';
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.88, 90, 35, 0, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL('image/jpeg', 0.92);
}
