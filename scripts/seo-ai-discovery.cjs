// Captura a origem antes do formulário e preserva a primeira página de entrada.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const tag='<script src="/qf-ai-origin.js?v=20261123-1"></script>';
function add(file){
  let html=fs.readFileSync(file,'utf8');
  if(!html.includes(tag)) fs.writeFileSync(file,html.replace(/<head(?:\s[^>]*)?>/i,m=>m+tag));
}
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(file);
    else if(entry.name==='index.html') add(file);
  }
}
add(path.join(root,'index.html'));
walk(path.join(root,'servicos'));
