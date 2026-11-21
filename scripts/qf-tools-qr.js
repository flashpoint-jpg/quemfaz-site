import QRCode from 'qrcode';

export function draw(canvas, value) {
  return QRCode.toCanvas(canvas, value, { width: 272, margin: 4, errorCorrectionLevel: 'M' });
}
