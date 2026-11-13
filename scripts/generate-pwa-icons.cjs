const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

/**
 * Draw the official STOQO application icon:
 * - Deep Navy Blue (#0D2149 -> #07132B) background
 * - Restaurant/store awning + isometric inventory cube in Electric Orange (#FF5A1F) & crisp White
 * - Bold "STOQO" wordmark with Electric Orange 'Q'
 * - Tagline "SMART STOCK. SMARTER BUSINESS." on larger sizes
 */
function drawStoqoIcon(ctx, size, isMaskable = false) {
  ctx.clearRect(0, 0, size, size);

  if (isMaskable) {
    // Full-bleed Deep Navy Blue gradient for maskable safe-zone
    const bgGrad = ctx.createLinearGradient(0, 0, size, size);
    bgGrad.addColorStop(0, '#132D5E');
    bgGrad.addColorStop(0.5, '#0D2149');
    bgGrad.addColorStop(1, '#07132B');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Keep all critical graphics inside central 72% safe zone
    const safeBox = size * 0.72;
    const offset = (size - safeBox) / 2;
    drawStoqoArtwork(ctx, offset, offset, safeBox, safeBox, size, true);
  } else {
    const padding = size * 0.035;
    const boxSize = size - padding * 2;
    const radius = size * 0.22;

    ctx.save();
    drawRoundedRect(ctx, padding, padding, boxSize, boxSize, radius);
    ctx.clip();

    const bgGrad = ctx.createLinearGradient(padding, padding, padding + boxSize, padding + boxSize);
    bgGrad.addColorStop(0, '#132D5E');
    bgGrad.addColorStop(0.5, '#0D2149');
    bgGrad.addColorStop(1, '#07132B');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(padding, padding, boxSize, boxSize);

    drawStoqoArtwork(ctx, padding, padding, boxSize, boxSize, size, false);
    ctx.restore();

    // Subtle Electric Orange border accent
    ctx.save();
    drawRoundedRect(ctx, padding, padding, boxSize, boxSize, radius);
    ctx.lineWidth = Math.max(1.5, size * 0.018);
    ctx.strokeStyle = 'rgba(255, 90, 31, 0.45)';
    ctx.stroke();
    ctx.restore();
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStoqoArtwork(ctx, x, y, w, h, canvasSize, isMaskable) {
  const centerX = x + w / 2;

  // 1. Restaurant / Store Awning at Top
  const awningWidth = w * 0.54;
  const awningHeight = h * 0.14;
  const awningX = centerX - awningWidth / 2;
  const awningY = y + h * (isMaskable ? 0.10 : 0.12);

  const orangeGrad = ctx.createLinearGradient(awningX, awningY, awningX + awningWidth, awningY + awningHeight);
  orangeGrad.addColorStop(0, '#FF7A29');
  orangeGrad.addColorStop(0.5, '#FF5A1F');
  orangeGrad.addColorStop(1, '#E04107');

  ctx.save();
  drawRoundedRect(ctx, awningX, awningY, awningWidth, awningHeight, awningHeight * 0.35);
  ctx.fillStyle = orangeGrad;
  ctx.fill();

  // Awning vertical stripes in Deep Navy
  ctx.strokeStyle = '#0D2149';
  ctx.lineWidth = Math.max(1.5, w * 0.02);
  ctx.beginPath();
  for (let i = 1; i <= 3; i++) {
    const sx = awningX + (awningWidth / 4) * i;
    ctx.moveTo(sx, awningY);
    ctx.lineTo(sx, awningY + awningHeight);
  }
  ctx.stroke();
  ctx.restore();

  // 2. Isometric Inventory Cube below Awning
  const cubeCenterY = awningY + awningHeight + h * 0.16;
  const rx = w * 0.19;
  const ry = h * 0.085;
  const ch = h * 0.14;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, w * 0.025);

  // Top face
  ctx.beginPath();
  ctx.moveTo(centerX, cubeCenterY - ry);
  ctx.lineTo(centerX + rx, cubeCenterY);
  ctx.lineTo(centerX, cubeCenterY + ry);
  ctx.lineTo(centerX - rx, cubeCenterY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 90, 31, 0.25)';
  ctx.fill();
  ctx.strokeStyle = '#FF7A29';
  ctx.stroke();

  // Left face
  ctx.beginPath();
  ctx.moveTo(centerX - rx, cubeCenterY);
  ctx.lineTo(centerX, cubeCenterY + ry);
  ctx.lineTo(centerX, cubeCenterY + ry + ch);
  ctx.lineTo(centerX - rx, cubeCenterY + ch);
  ctx.closePath();
  ctx.fillStyle = '#1E3A6E';
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();

  // Right face
  ctx.beginPath();
  ctx.moveTo(centerX + rx, cubeCenterY);
  ctx.lineTo(centerX, cubeCenterY + ry);
  ctx.lineTo(centerX, cubeCenterY + ry + ch);
  ctx.lineTo(centerX + rx, cubeCenterY + ch);
  ctx.closePath();
  ctx.fillStyle = orangeGrad;
  ctx.fill();
  ctx.strokeStyle = '#FF7A29';
  ctx.stroke();
  ctx.restore();

  // 3. STOQO Wordmark (or bold 'S' on tiny 32x32 favicon)
  if (canvasSize <= 48) {
    // On 32x32 favicon, keep the awning + cube large and crisp
    return;
  }

  const wordY = y + h * (isMaskable ? 0.75 : 0.74);
  const fontSize = Math.round(h * 0.21);
  ctx.save();
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';

  // Measure segments so 'Q' can be Electric Orange and 'STO' / 'O' crisp White
  const p1 = 'STO';
  const p2 = 'Q';
  const p3 = 'O';
  const w1 = ctx.measureText(p1).width;
  const w2 = ctx.measureText(p2).width;
  const w3 = ctx.measureText(p3).width;
  const totalW = w1 + w2 + w3;
  const startX = centerX - totalW / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(p1, startX, wordY);

  ctx.fillStyle = '#FF5A1F';
  ctx.fillText(p2, startX + w1, wordY);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(p3, startX + w1 + w2, wordY);
  ctx.restore();

  // 4. Tagline on 192+ icons
  if (canvasSize >= 180) {
    ctx.save();
    ctx.fillStyle = '#FF8A4C';
    const tagFontSize = Math.max(9, Math.round(h * 0.044));
    ctx.font = `700 ${tagFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SMART STOCK. SMARTER BUSINESS.', centerX, y + h * (isMaskable ? 0.90 : 0.89));
    ctx.restore();
  }
}

const targets = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'favicon-32x32.png', size: 32, maskable: false },
];

for (const target of targets) {
  const canvas = createCanvas(target.size, target.size);
  const ctx = canvas.getContext('2d');
  drawStoqoIcon(ctx, target.size, target.maskable);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(publicDir, target.file), buffer);
  console.log(`Generated STOQO ${target.file} (${target.size}x${target.size})`);
}

// Generate official STOQO SVG icon (/public/icon.svg)
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="stoqoNavyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#132D5E" />
      <stop offset="50%" stop-color="#0D2149" />
      <stop offset="100%" stop-color="#07132B" />
    </linearGradient>
    <linearGradient id="stoqoOrangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF7A29" />
      <stop offset="50%" stop-color="#FF5A1F" />
      <stop offset="100%" stop-color="#E04107" />
    </linearGradient>
    <filter id="badgeShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#000" flood-opacity="0.35" />
    </filter>
  </defs>
  <rect x="20" y="20" width="472" height="472" rx="108" fill="url(#stoqoNavyGrad)" stroke="#FF5A1F" stroke-width="8" stroke-opacity="0.45" filter="url(#badgeShadow)"/>
  <!-- Store Awning -->
  <rect x="128" y="76" width="256" height="62" rx="22" fill="url(#stoqoOrangeGrad)" />
  <path d="M192 76V138M256 76V138M320 76V138" stroke="#0D2149" stroke-width="9" stroke-linecap="round" />
  <!-- Isometric Store Cube -->
  <path d="M256 164L344 206L256 248L168 206Z" fill="#FF5A1F" fill-opacity="0.25" stroke="#FF7A29" stroke-width="11" stroke-linejoin="round" />
  <path d="M168 206V276L256 318V248Z" fill="#1E3A6E" stroke="#FFFFFF" stroke-width="11" stroke-linejoin="round" />
  <path d="M344 206V276L256 318V248Z" fill="url(#stoqoOrangeGrad)" stroke="#FF7A29" stroke-width="11" stroke-linejoin="round" />
  <!-- STOQO Wordmark -->
  <text x="256" y="405" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="102" font-weight="900" letter-spacing="-2">
    <tspan fill="#FFFFFF">STO</tspan><tspan fill="#FF5A1F">Q</tspan><tspan fill="#FFFFFF">O</tspan>
  </text>
  <!-- Tagline -->
  <text x="256" y="454" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="700" fill="#FF8A4C" letter-spacing="1.5">SMART STOCK. SMARTER BUSINESS.</text>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');
console.log('Generated STOQO icon.svg');
