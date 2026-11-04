import QRCode from 'qrcode';
import { useMemo } from 'react';

/**
 * A QR code drawn as SVG: one path, dark modules on white with the standard
 * 4-module quiet zone (wallet scanners need the contrast and the margin).
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const margin = 4;
    let d = '';
    for (let row = 0; row < modules.size; row++) {
      for (let column = 0; column < modules.size; column++) {
        if (modules.get(row, column)) d += `M${column + margin},${row + margin}h1v1h-1z`;
      }
    }
    return { size: modules.size + margin * 2, path: d };
  }, [text]);

  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
