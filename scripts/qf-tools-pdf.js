import { createQuotePdf } from './qf-tools-quote-layout.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function download(title, entries, filename) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('QuemFaz Serviços');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page;
  let y;
  function newPage() {
    page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 760, width: 595, height: 82, color: rgb(.027, .086, .184) });
    page.drawText('QuemFaz Serviços', { x: 44, y: 799, font: bold, size: 18, color: rgb(1, 1, 1) });
    y = 727;
  }
  function clean(text) {
    return Array.from(String(text)).map(char => {
      try { regular.encodeText(char); return char; } catch (_) { return ' '; }
    }).join('');
  }
  function write(text, font, size) {
    const options = { x: 44, font, size, color: rgb(.027, .086, .184) };
    let line = '';
    for (const char of clean(text)) {
      if (font.widthOfTextAtSize(line + char, size) > 507) {
        if (y < 45) newPage();
        page.drawText(line.trimEnd(), { ...options, y });
        y -= size + 6;
        line = '';
      }
      line += char;
    }
    if (y < 45) newPage();
    page.drawText(line, { ...options, y });
    y -= size + 11;
  }
  newPage();
  write(title, bold, 22);
  entries.forEach(text => write(text, regular, 13));
  saveFile(await pdf.save(), filename);
}

export async function downloadQuote(quote, filename) {
  saveFile(await createQuotePdf(quote), filename);
}

function saveFile(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
