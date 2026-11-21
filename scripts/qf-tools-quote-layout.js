import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import logoBytes from '../assets/qf-logo-pdf.png';

const width = 595.276;
const height = 841.89;
const left = 52;
const right = width - left;
const span = right - left;
const color = hex => rgb(...hex.match(/../g).map(pair => parseInt(pair, 16) / 255));
const navy = color('071932');
const orange = color('FF7900');
const ink = color('142640');
const muted = color('465975');
const line = color('CCD8E6');
const soft = color('F3F7FC');
const white = rgb(1, 1, 1);

export async function createQuotePdf(quote) {
  const pdf = await PDFDocument.create();
  const title = 'Orçamento nº ' + quote.number;
  pdf.setTitle(title);
  pdf.setCreator('QuemFaz Serviços');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(logoBytes);
  let page;
  let cursor;

  function supported(value) {
    return Array.from(String(value ?? '').normalize('NFC')).map(char => {
      try { regular.encodeText(char); return char; }
      catch (_) { return ' '; }
    }).join('');
  }

  function write(value, x, top, size, font = regular, fill = ink, align = 'left') {
    const text = supported(value);
    page.drawText(text, {
      x: align === 'right' ? x - font.widthOfTextAtSize(text, size) : x,
      y: height - top, size, font, color: fill
    });
  }

  function box(x, y, w, h, radius, fill, stroke) {
    const r = radius;
    const path = [
      `M ${r} 0 H ${w-r} Q ${w} 0 ${w} ${r}`,
      `V ${h-r} Q ${w} ${h} ${w-r} ${h} H ${r}`,
      `Q 0 ${h} 0 ${h-r} V ${r} Q 0 0 ${r} 0 Z`
    ].join(' ');
    page.drawSvgPath(path, { x, y: height-y, ...(fill ? {color:fill} : {}),
      ...(stroke ? {borderColor:stroke,borderWidth:.8} : {}) });
  }

  function rule(y) {
    page.drawLine({start:{x:left,y:height-y},end:{x:right,y:height-y},color:line,thickness:.75});
  }

  function wrap(value, max, size, font = regular) {
    const lines = [];
    for (const paragraph of supported(value).split(/\r?\n/)) {
      let current = '';
      for (let word of paragraph.trim().split(/\s+/)) {
        const joined = current ? current + ' ' + word : word;
        if (font.widthOfTextAtSize(joined, size) <= max) {
          current = joined;
          continue;
        }
        if (current) lines.push(current);
        while (font.widthOfTextAtSize(word, size) > max) {
          let end = 1;
          while (font.widthOfTextAtSize(word.slice(0,end+1), size) <= max) end++;
          lines.push(word.slice(0,end));
          word = word.slice(end);
        }
        current = word;
      }
      lines.push(current);
    }
    return lines;
  }

  function newPage(first = false) {
    page = pdf.addPage([width,height]);
    box(27,27,width-54,height-54,13,white,line);
    box(42,42,width-84,106,9,navy);
    box(56,144,width-112,3,1,orange);
    const logoHeight = 199 * logo.height / logo.width;
    page.drawImage(logo,{x:61,y:height-69-logoHeight,width:199,height:logoHeight});
    write('ORÇAMENTO',width-62,88,10,bold,color('FFAD66'),'right');
    write('Nº ' + String(quote.number).padStart(4,'0'),width-62,116,23,bold,white,'right');
    cursor = first ? 203 : 189;
  }

  function ensure(space) {
    if (cursor + space <= 730) return false;
    newPage();
    return true;
  }

  function tableHead() {
    write('Serviços e valores',left,cursor,15,bold);
    cursor += 15;
    box(left,cursor,span,33,6,navy);
    write('DESCRIÇÃO',left+16,cursor+21,9,bold,white);
    write('VALOR',right-16,cursor+21,9,bold,white,'right');
    cursor += 33;
  }

  newPage(true);
  write('Proposta de serviço',left,cursor,25,bold);
  if (quote.validUntil) write('Validade até ' + quote.validUntil,left,cursor+23,10.5,regular,muted);
  cursor += 50;

  const cardWidth = (span - 13)/2;
  const people = [
    ['CLIENTE',wrap(quote.customer,cardWidth-26,13,bold)],
    ['PROFISSIONAL',wrap(quote.provider,cardWidth-26,13,bold)]
  ];
  const cardHeight = 71 + (Math.max(...people.map(([,names])=>names.length))-1)*16;
  people.forEach(([caption,names],i)=>{
    const x = left + i*(cardWidth+13);
    box(x,cursor,cardWidth,cardHeight,7,soft,line);
    write(caption,x+13,cursor+23,9,bold,muted);
    names.forEach((name,j)=>write(name,x+13,cursor+50+j*16,13,bold));
  });
  cursor += cardHeight + 46;
  tableHead();

  quote.items.forEach(({description,amount},index)=>{
    const lines = wrap(description,span-155,11);
    const rowHeight = Math.max(43,lines.length*14+22);
    if (ensure(rowHeight)) tableHead();
    box(left,cursor,span,rowHeight,0,index%2 ? soft : white,line);
    lines.forEach((text,i)=>write(text,left+16,cursor+27+i*14,11));
    write(amount,right-16,cursor+27,11,bold,ink,'right');
    cursor += rowHeight;
  });

  cursor += 24;
  ensure(69);
  box(left,cursor,span,63,8,color('FFF2E7'));
  box(left,cursor+13,3,37,1,orange);
  write('TOTAL DO ORÇAMENTO',left+16,cursor+37,10,bold,color('753600'));
  write(quote.total,right-16,cursor+41,24,bold,navy,'right');
  cursor += 111;

  const terms = [
    ['Prazo de execução',wrap(quote.deadline || 'Não informado',cardWidth-8,10.5)],
    ['Materiais',wrap(quote.materials || 'Não informado',cardWidth-8,10.5)]
  ];
  ensure(60 + Math.max(...terms.map(([,texts])=>texts.length))*14);
  write('Condições do orçamento',left,cursor,15,bold);
  rule(cursor+13);
  terms.forEach(([caption,texts],i)=>{
    const x = left + i*(cardWidth+13);
    write(caption,x,cursor+36,9.5,bold,muted);
    texts.forEach((text,j)=>write(text,x,cursor+54+j*14,10.5));
  });

  const pages = pdf.getPages();
  pages.forEach((entry,i)=>{
    page = entry;
    rule(753);
    write('quemfazservico.com.br',left,778,9.1,bold,navy);
    write((i+1)+' / '+pages.length,right,778,8.9,regular,muted,'right');
  });
  return pdf.save();
}
