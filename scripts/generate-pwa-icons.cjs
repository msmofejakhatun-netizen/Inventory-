const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Draw the exact Restaurant Store Control System logo:
// Amber rounded badge with Boxes icon + "RC" monogram
function drawLogo(ctx, size, isMaskable = false) {
  // Clear
  ctx.clearRect(0, 0, size, size);

  if (isMaskable) {
    // Maskable full bleed background: Rich amber gradient with safe-zone margin
    const bgGrad = ctx.createLinearGradient(0, 0, size, size);
    bgGrad.addColorStop(0, '#fbbf24'); // amber-400
    bgGrad.addColorStop(0.5, '#f59e0b'); // amber-500
    bgGrad.addColorStop(1, '#d97706'); // amber-600
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Inner icon content drawn within 70% safe zone (center = size/2)
    const iconBoxSize = size * 0.7;
    const offset = (size - iconBoxSize) / 2;

    drawInnerBadgeContent(ctx, offset, offset, iconBoxSize, iconBoxSize, true);
  } else {
    // Standard icon with rounded corners and subtle shadow/border
    const radius = size * 0.22;
    const padding = size * 0.04;
    const boxSize = size - padding * 2;

    ctx.save();
    // Rounded rect path
    drawRoundedRect(ctx, padding, padding, boxSize, boxSize, radius);
    ctx.clip();

    const bgGrad = ctx.createLinearGradient(padding, padding, padding + boxSize, padding + boxSize);
    bgGrad.addColorStop(0, '#fbbf24'); // amber-400
    bgGrad.addColorStop(0.5, '#f59e0b'); // amber-500
    bgGrad.addColorStop(1, '#d97706'); // amber-600
    ctx.fillStyle = bgGrad;
    ctx.fillRect(padding, padding, boxSize, boxSize);

    drawInnerBadgeContent(ctx, padding, padding, boxSize, boxSize, false);
    ctx.restore();

    // Subtle outline
    ctx.save();
    drawRoundedRect(ctx, padding, padding, boxSize, boxSize, radius);
    ctx.lineWidth = Math.max(1, size * 0.015);
    ctx.strokeStyle = 'rgba(254, 243, 199, 0.4)'; // amber-100/40
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

function drawInnerBadgeContent(ctx, x, y, width, height, isMaskable) {
  const centerX = x + width / 2;
  const darkColor = '#0c0a09'; // stone-950

  // 1. Draw Boxes icon (store boxes)
  // Drawn in the upper half of badge
  const boxAreaY = y + height * (isMaskable ? 0.22 : 0.20);
  const boxSize = height * 0.28;
  const strokeW = Math.max(2, height * 0.045);

  ctx.save();
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = strokeW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw 3 isometric boxes (Boxes lucide icon representation)
  // Center cube top:
  const bx = centerX;
  const by = boxAreaY;
  const s = boxSize * 0.46;

  // Box 1 (top):
  ctx.beginPath();
  // isometric cube top face
  ctx.moveTo(bx, by - s * 0.7);
  ctx.lineTo(bx + s * 0.7, by - s * 0.35);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx - s * 0.7, by - s * 0.35);
  ctx.closePath();
  ctx.stroke();

  // Box 1 vertical edges
  ctx.beginPath();
  ctx.moveTo(bx - s * 0.7, by - s * 0.35);
  ctx.lineTo(bx - s * 0.7, by + s * 0.15);
  ctx.lineTo(bx, by + s * 0.5);
  ctx.lineTo(bx + s * 0.7, by + s * 0.15);
  ctx.lineTo(bx + s * 0.7, by - s * 0.35);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx, by + s * 0.5);
  ctx.stroke();

  ctx.restore();

  // 2. Draw "RC" Monogram
  ctx.save();
  ctx.fillStyle = darkColor;
  const fontSize = Math.round(height * 0.34);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textY = y + height * (isMaskable ? 0.68 : 0.66);
  ctx.fillText('RC', centerX, textY);
  ctx.restore();

  // 3. Subtle subtext "STORE CONTROL" on large sizes if space permits
  if (width >= 400 && !isMaskable) {
    ctx.save();
    ctx.fillStyle = 'rgba(12, 10, 9, 0.75)';
    const subFontSize = Math.round(height * 0.055);
    ctx.font = `700 ${subFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STORE CONTROL', centerX, y + height * 0.88);
    ctx.restore();
  }
}

// Generate files
const sizes = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'favicon-32x32.png', size: 32, maskable: false },
];

for (const target of sizes) {
  const canvas = createCanvas(target.size, target.size);
  const ctx = canvas.getContext('2d');
  drawLogo(ctx, target.size, target.maskable);
  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(publicDir, target.file);
  fs.writeFileSync(filePath, buffer);
  console.log(`Generated ${target.file} (${target.size}x${target.size})`);
}

// Generate SVG icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="amberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="50%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <filter id="badgeShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.3" />
    </filter>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="104" fill="url(#amberGrad)" stroke="#fef3c7" stroke-width="6" stroke-opacity="0.4" filter="url(#badgeShadow)"/>
  <g transform="translate(256, 170) scale(4.2)" fill="none" stroke="#0c0a09" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <!-- Isometric Boxes -->
    <path d="M-14 -6 L0 -13 L14 -6 L0 1 Z"/>
    <path d="M-14 -6 L-14 8 L0 15 L14 8 L14 -6"/>
    <path d="M0 1 L0 15"/>
  </g>
  <text x="256" y="360" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="160" font-weight="900" fill="#0c0a09" letter-spacing="-4">RC</text>
  <text x="256" y="440" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="26" font-weight="800" fill="#0c0a09" opacity="0.8" letter-spacing="4">STORE CONTROL</text>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');
console.log('Generated icon.svg');
