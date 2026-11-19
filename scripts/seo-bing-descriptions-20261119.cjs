// Melhora descrições de páginas indexáveis já existentes, sem criar URLs ou prometer disponibilidade.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dist');
const descriptions = {
  'encanador/maua': 'Precisa de encanador em Mauá? Explique se há vazamento, entupimento ou instalação, informe o bairro e publique seu pedido grátis para receber contatos da região.',
  'pedreiro/sao-bernardo-do-campo': 'Procurando pedreiro em São Bernardo do Campo? Descreva a reforma, alvenaria ou assentamento, informe o bairro e solicite contatos de profissionais no Quem Faz.',
  'eletricista/maua': 'Precisa de eletricista em Mauá? Descreva o problema em tomadas, chuveiro, iluminação ou disjuntores, informe seu bairro e publique o pedido grátis no Quem Faz.',
  'diarista/diadema': 'Procurando diarista em Diadema? Informe o tamanho do imóvel, o tipo de limpeza, o bairro e a data desejada. Publique seu pedido grátis no Quem Faz.',
  'pintor/sao-paulo': 'Precisa de pintor em São Paulo? Informe o bairro, os ambientes e se há preparação de paredes. Publique seu pedido grátis e compare contatos de profissionais.',
  'encanador/diadema': 'Precisa de encanador em Diadema? Conte se é vazamento, torneira, descarga ou tubulação, informe seu bairro e solicite contatos de profissionais no Quem Faz.',
  'baba': 'Precisa contratar babá? Informe a região, os dias, os horários e a faixa etária das crianças. Publique o pedido grátis e consulte profissionais disponíveis no Quem Faz.',
  'diarista/sao-bernardo-do-campo': 'Precisa de diarista em São Bernardo do Campo? Explique quantos cômodos serão limpos, o bairro e a data desejada. Publique seu pedido grátis no Quem Faz.',
  'diarista/sao-paulo': 'Procurando diarista em São Paulo? Informe o bairro, o tamanho da casa e a frequência da faxina. Publique seu pedido grátis e receba contatos pelo Quem Faz.',
  'pedreiro/sao-paulo': 'Precisa de pedreiro em São Paulo? Descreva a obra, reforma, reboco ou assentamento, informe o bairro e publique seu pedido grátis para receber contatos.',
  'encanador/sao-paulo': 'Procurando encanador em São Paulo? Conte se precisa reparar vazamentos, descarga, pia ou tubulação, informe o bairro e publique seu pedido grátis.',
  'pintor': 'Procurando pintor para sua casa ou comércio? Descreva os ambientes, a área aproximada e o prazo. Publique seu pedido grátis e converse com profissionais da região.',
  'guincho': 'Precisa de serviço de guincho? Informe a localização do veículo, o destino, o tipo de veículo e a urgência. Publique seu pedido grátis no Quem Faz.'
};
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
let changed = 0;
for (const [slug, description] of Object.entries(descriptions)) {
  const url = `https://quemfazservico.com.br/servicos/${slug}/`;
  const file = path.join(root, 'servicos', slug, 'index.html');
  if (!sitemap.includes(`<loc>${url}</loc>`) || !fs.existsSync(file)) throw new Error(`URL não indexável: ${slug}`);
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes(`rel="canonical" href="${url}"`) || /<meta name="robots" content="noindex/i.test(html)) throw new Error(`Canonical/robots inválidos: ${slug}`);
  if (description.length < 115 || description.length > 175 || /["<>]/.test(description)) throw new Error(`Descrição inválida: ${slug}`);
  const regex = /<meta name="description" content="[^"]*">/i;
  if (!regex.test(html)) throw new Error(`Meta description ausente: ${slug}`);
  html = html.replace(regex, `<meta name="description" content="${description}">`);
  fs.writeFileSync(file, html);
  changed++;
}
console.log(`SEO Bing: ${changed} descrições específicas de páginas indexáveis atualizadas.`);
