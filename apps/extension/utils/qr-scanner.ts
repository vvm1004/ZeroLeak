/**
 * QR Code Scanner Utility for ZeroLeak
 * Decodes QR codes from image sources or interactive screen selection using jsQR.
 */

import jsQR from 'jsqr';

export interface QrScanResult {
  data: string;
  location?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
  };
}

export interface ScreenCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio?: number;
}

/**
 * Decodes QR code from raw ImageData
 */
export function decodeQrFromImageData(imageData: ImageData): QrScanResult | null {
  try {
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (code) {
      return {
        data: code.data,
        location: {
          topLeft: code.location.topLeftCorner,
          topRight: code.location.topRightCorner,
          bottomLeft: code.location.bottomLeftCorner,
          bottomRight: code.location.bottomRightCorner,
        },
      };
    }
  } catch (err) {
    console.error('[ZeroLeak QR] jsQR decode error:', err);
  }
  return null;
}

/**
 * Decodes QR code from an Image source (Base64 data URL or HTMLImageElement)
 */
export async function decodeQrFromImageSource(imageSrc: string): Promise<QrScanResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(decodeQrFromImageData(imageData));
      } catch (e) {
        console.error('[PhishGuard QR] Image processing error:', e);
        resolve(null);
      }
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = imageSrc;
  });
}

/**
 * Crops a specific region from a full-page screenshot data URL and decodes QR
 */
export async function decodeQrFromCrop(
  fullScreenshotDataUrl: string,
  region: ScreenCropRegion
): Promise<QrScanResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const dpr = region.devicePixelRatio || window.devicePixelRatio || 1;
        const cropX = Math.round(region.x * dpr);
        const cropY = Math.round(region.y * dpr);
        const cropW = Math.round(region.width * dpr);
        const cropH = Math.round(region.height * dpr);

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const imageData = ctx.getImageData(0, 0, cropW, cropH);
        resolve(decodeQrFromImageData(imageData));
      } catch (err) {
        console.error('[ZeroLeak QR] Crop decode error:', err);
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = fullScreenshotDataUrl;
  });
}

/**
 * Interactive Screen Snippet Selector for QR scanning
 * Overlays an interactive crosshair selection box in the browser window
 */
export function activateInteractiveQrSnipper(): Promise<ScreenCropRegion | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'zeroleak-qr-snipper';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
      z-index: 2147483646;
      cursor: crosshair;
      user-select: none;
    `;

    // Instruction Banner
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: absolute;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #0f172a;
      color: #f8fafc;
      padding: 10px 20px;
      border-radius: 9999px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(16, 185, 129, 0.5);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
    `;
    banner.innerHTML = `
      <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#10b981; animation:pulse 1.5s infinite;"></span>
      <span>Kéo chuột để chọn vùng chứa mã QR (hoặc nhấn <b>ESC</b> để hủy)</span>
    `;
    overlay.appendChild(banner);

    // Selection box
    const selection = document.createElement('div');
    selection.style.cssText = `
      position: absolute;
      border: 2px solid #10b981;
      background: rgba(16, 185, 129, 0.15);
      display: none;
      pointer-events: none;
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
      border-radius: 4px;
    `;
    overlay.appendChild(selection);

    let startX = 0;
    let startY = 0;
    let isDragging = false;

    const cleanup = () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    overlay.onmousedown = (e) => {
      startX = e.clientX;
      startY = e.clientY;
      isDragging = true;
      selection.style.left = `${startX}px`;
      selection.style.top = `${startY}px`;
      selection.style.width = '0px';
      selection.style.height = '0px';
      selection.style.display = 'block';
    };

    overlay.onmousemove = (e) => {
      if (!isDragging) return;

      const currentX = e.clientX;
      const currentY = e.clientY;

      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      selection.style.left = `${x}px`;
      selection.style.top = `${y}px`;
      selection.style.width = `${width}px`;
      selection.style.height = `${height}px`;
    };

    overlay.onmouseup = (e) => {
      if (!isDragging) return;
      isDragging = false;

      const currentX = e.clientX;
      const currentY = e.clientY;

      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      cleanup();

      if (width < 20 || height < 20) {
        // Selection too small, cancel
        resolve(null);
      } else {
        resolve({
          x,
          y,
          width,
          height,
          devicePixelRatio: window.devicePixelRatio || 1,
        });
      }
    };

    document.body.appendChild(overlay);
  });
}
