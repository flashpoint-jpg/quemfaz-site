export function gerarCodigo(cryptoApi=globalThis.crypto) {
 const n=new Uint32Array(1), limite=Math.floor(2**32/1000000)*1000000;
 do {cryptoApi.getRandomValues(n);} while(n[0]>=limite);
 return String(n[0]%1000000).padStart(6,'0');
}
export async function hashCodigo(token,finalidade,codigo,segredo,cryptoApi=globalThis.crypto) {
 const enc=new TextEncoder();
 const key=await cryptoApi.subtle.importKey('raw',enc.encode(segredo),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const out=await cryptoApi.subtle.sign('HMAC',key,enc.encode(token+':'+finalidade+':'+codigo));
 return Array.from(new Uint8Array(out),n=>n.toString(16).padStart(2,'0')).join('');
}
export function telefoneBR(v) {
 let d=String(v||'').replace(/\D/g,'');
 if(d.length===10||d.length===11)d='55'+d;
 if(!/^55[1-9][0-9]{9,10}$/.test(d))throw Error('telefone_invalido');
 return '+'+d;
}
