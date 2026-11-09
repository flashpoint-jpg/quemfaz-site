// Conteúdo complementar para buscas com impressões e posição baixa no Search Console.
// Aplicado somente a páginas que já existem, são indexáveis e possuem cobertura cadastrada.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','dist','servicos');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'" : '&#39;'}[c]));
const rows=[
 ['eletricista/santo-andre','Eletricista em Santo André','Para uma instalação elétrica, descreva se precisa trocar tomadas, instalar luminárias, avaliar disjuntores ou verificar uma falha. Informe se é residência, comércio ou apartamento e quais pontos serão afetados.','Em caso de tomada aquecida, cheiro de queimado ou faíscas, evite utilizar o circuito e peça avaliação segura. A visita, as peças e o reparo podem ser cobrados separadamente.',['eletricista/diadema','diarista/santo-andre']],
 ['eletricista/diadema','Eletricista em Diadema','Se a luz cai ou o disjuntor desarma, informe quando acontece, quais aparelhos estavam ligados e se o defeito afeta um cômodo ou todo o imóvel. Não tente abrir o quadro elétrico sem qualificação.','O eletricista pode precisar diagnosticar a origem antes de indicar substituição. Confirme cobrança da visita, materiais, testes e condições de garantia.',['eletricista/santo-andre','encanador/sao-bernardo-do-campo']],
 ['limpeza-de-sofa/santo-andre','Limpeza de sofá em Santo André','Descreva se o sofá é retrátil, reclinável, de dois ou três lugares, o tecido e se existem manchas, odores ou pelos de animais. Essas informações ajudam a definir o método adequado.','Antes de contratar, pergunte se o produto é compatível com o tecido, o prazo estimado de secagem, o valor do deslocamento e o que pode ou não ser removido.',['limpeza-de-sofa/sao-bernardo-do-campo','diarista/santo-andre']],
 ['limpeza-de-sofa/sao-bernardo-do-campo','Limpeza de sofá em São Bernardo do Campo','Para lavagem ou higienização de sofá, informe a quantidade de lugares, o bairro e a natureza das manchas. Se possível, indique a etiqueta do tecido e as condições de ventilação do local.','Compare preço por peça, método de higienização, cuidados após o atendimento e tempo de secagem, sem presumir remoção total de manchas.',['limpeza-de-sofa/santo-andre','encanador/sao-bernardo-do-campo']]
];
let updated=[];
for(const [slug,name,brief,check,related] of rows){
 const f=path.join(root,slug,'index.html');
 if(!fs.existsSync(f)){console.log('Sem página para melhoria:',slug);continue}
 let html=fs.readFileSync(f,'utf8');
 if(!/<meta name="robots" content="index,follow">/.test(html)){console.log('Página não indexável:',slug);continue}
 if(html.includes('data-qf-gsc-20261109'))continue;
 const links=related.filter(x=>{const q=path.join(root,x,'index.html');return fs.existsSync(q)&&fs.readFileSync(q,'utf8').includes('content="index,follow"')}).map(x=>'<li><a href="/servicos/'+x+'/">'+esc(x.split('/')[0].replaceAll('-',' '))+' em '+esc(x.split('/')[1].replaceAll('-',' '))+'</a></li>').join('');
 const section='<section class="seo-practical" data-qf-gsc-20261109><h2>'+esc(name)+': o que informar no pedido?</h2><p>'+esc(brief)+'</p><h2>O que conferir antes de fechar o serviço?</h2><p>'+esc(check)+'</p><p>Informe seu CEP no formulário desta página para consultar profissionais cadastrados que atendam a região. Publicar o pedido é gratuito e você pode comparar até quatro orçamentos, conforme disponibilidade.</p>'+(links?'<h2>Veja serviços em regiões próximas</h2><ul>'+links+'</ul>':'')+'</section>';
 if(!html.includes('</article>'))throw Error('Estrutura SEO inválida: '+slug);
 html=html.replace('</article>',section+'</article>');
 fs.writeFileSync(f,html);updated.push(slug);
}
console.log('SEO Search Console: '+updated.length+' páginas aprofundadas');
