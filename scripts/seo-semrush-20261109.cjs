// Complementa páginas identificadas na auditoria Semrush de 09/11/2026.
// É executado após a geração principal. Preserva o formulário, canonicals, schema e cobertura cadastrada.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const advice={
 'automacao-industrial': ['Automação industrial','painéis de comando, sensores, controladores e integração de equipamentos','Informe o tipo de equipamento, fabricante, modelo, mensagens de erro e se precisa de instalação, configuração ou diagnóstico. Não tente intervir em circuitos energizados.','Confirme qual etapa envolve diagnóstico, quais materiais ou peças estão incluídos e se há necessidade de parada de máquina. Solicite avaliação de profissional habilitado para a atividade.'],
 'baba':['Babá','cuidados infantis em horários combinados','Informe idade das crianças, rotina, dias, turnos, atividades esperadas e se há adultos responsáveis no imóvel. Evite compartilhar dados sensíveis das crianças na descrição pública.','Converse sobre experiência, referências, responsabilidades, transporte, condições de trabalho e cuidados em situações de emergência antes de contratar.'],
 'guincho':['Guincho','remoção e transporte de veículo imobilizado','Informe tipo e modelo do veículo, localização aproximada de origem e destino, condições de acesso e se o carro pode ser movimentado. Não compartilhe informações pessoais desnecessárias no anúncio.','Confirme tipo de plataforma, distância incluída, pedágios, horário, valor total e procedimentos de carregamento e entrega do veículo.'],
 'professor-particular':['Professor particular','reforço escolar e aulas individuais','Informe matéria, série ou nível, objetivos de aprendizagem, formato online ou presencial, frequência e horários preferidos. Evite publicar dados pessoais de estudantes menores.','Combine duração de cada aula, material didático, experiência, cancelamentos, preço por encontro e como será acompanhado o progresso.'],
 'tecnico-de-maquina-de-lavar':['Técnico de máquina de lavar','diagnóstico e reparo de lavadoras','Informe marca, modelo, idade aproximada, sintomas, códigos no visor e quando a falha acontece. Se houver vazamento próximo à tomada, não manuseie o aparelho energizado.','Pergunte sobre taxa de visita, diagnóstico, peças, mão de obra, garantia do reparo e prazo para atendimento.']
};
const cities={
 caieiras:'Caieiras', 'duque-de-caxias':'Duque de Caxias', 'embu-guacu':'Embu-Guaçu',
 'ferraz-de-vasconcelos':'Ferraz de Vasconcelos',guaruja:'Guarujá',mairinque:'Mairinque',
 'mogi-das-cruzes':'Mogi das Cruzes','sao-jose-dos-campos':'São José dos Campos',
 'taboao-da-serra':'Taboão da Serra'
};
let updated=[];
function patch(url,section){
 const file=path.join(root,url,'index.html');
 if(!fs.existsSync(file))return;
 let html=fs.readFileSync(file,'utf8');
 if(html.includes('data-semrush-seo="20261109"'))return;
 const anchor='</article>';
 if(!html.includes(anchor))throw Error('Sem article SEO em '+url);
 html=html.replace(anchor,'<section class="seo-practical" data-semrush-seo="20261109">'+section+'</section>'+anchor);
 fs.writeFileSync(file,html);updated.push(url);
}
for(const [slug,a] of Object.entries(advice)){
 const [name,context,prepare,compare]=a;
 const section='<h2>Quando procurar '+esc(name.toLowerCase())+'?</h2><p>Você pode publicar um pedido de '+esc(name.toLowerCase())+' quando precisa de '+esc(context)+'. O objetivo do Quem Faz é permitir que você descreva sua necessidade com clareza e consulte profissionais conforme a região e o raio de atendimento cadastrados. A publicação do pedido é gratuita e não obriga a contratar.</p>'+
 '<h2>O que informar para receber propostas mais adequadas?</h2><p>'+esc(prepare)+'</p>'+
 '<h2>Como avaliar uma proposta?</h2><p>'+esc(compare)+'</p>'+
 '<h2>Como funciona o pedido no Quem Faz?</h2><p>Escolha o serviço, informe o CEP e bairro, descreva o que precisa e indique o prazo. Você pode receber até quatro orçamentos, conforme profissionais interessados e disponíveis na região. Compare as condições e negocie diretamente com quem decidir contratar.</p>';
 patch('servicos/'+slug,section);
}
for(const [slug,name] of Object.entries(cities)){
 const section='<h2>Como contratar serviços em '+esc(name)+'?</h2><p>Para encontrar um profissional em '+esc(name)+', comece pela profissão que corresponde ao problema: instalação elétrica, reparo hidráulico, limpeza, pintura ou outra especialidade exibida no catálogo desta página. Cada categoria tem sua própria descrição e formulário. A existência da página não significa que todos os serviços tenham profissionais disponíveis para todos os bairros.</p>'+
 '<h2>Quais informações ajudam a localizar atendimento?</h2><p>Ao publicar um pedido em '+esc(name)+', informe o CEP do imóvel e o bairro, pois a cobertura depende do raio escolhido pelos profissionais cadastrados. Descreva o serviço, o tipo de imóvel e o prazo desejado. Se for necessário levar ferramentas, subir escadas, entrar em condomínio ou acessar uma área técnica, explique essas condições sem divulgar seus dados privados no texto público.</p>'+
 '<h2>Como comparar orçamentos na sua região?</h2><p>Antes de contratar, confirme se o profissional atende o endereço informado, qual é o valor total, se há taxa de deslocamento, quem fornece materiais e quando o serviço poderá ser realizado. Para reparos, pergunte se o diagnóstico é cobrado separadamente. Para limpeza ou pintura, descreva a área e as tarefas incluídas. Comparar propostas com o mesmo escopo ajuda a evitar surpresas.</p>'+
 '<h2>O pedido tem custo?</h2><p>Publicar o pedido no Quem Faz é grátis. A plataforma pode encaminhá-lo a profissionais interessados conforme a especialidade e o local informados, até o limite de quatro orçamentos. Você escolhe se deseja contratar e pode acompanhar as respostas pelo site. Não há promessa de resposta imediata ou disponibilidade em todos os bairros.</p>';
 patch('servicos/cidades/'+slug,section);
}
console.log('SEO Semrush: '+updated.length+' páginas aprofundadas: '+updated.join(', '));
