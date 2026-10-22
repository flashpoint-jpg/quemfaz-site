// Favicon PNG e ICO derivado do mesmo ícone SVG aprovado do Quem Faz.
const fs=require('node:fs');
const path=require('node:path');
const png=fs.readFileSync(path.join(__dirname,'..','favicon.png'));
if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==48||png.readUInt32BE(20)!==48)throw Error('Favicon PNG inválido');
const folder=path.join(__dirname,'..','dist');
fs.writeFileSync(path.join(folder,'favicon.png'),png);
const dir=Buffer.alloc(22);
dir.writeUInt16LE(1,2);dir.writeUInt16LE(1,4);
dir[6]=48;dir[7]=48;dir.writeUInt16LE(1,10);dir.writeUInt16LE(32,12);
dir.writeUInt32LE(png.length,14);dir.writeUInt32LE(22,18);
fs.writeFileSync(path.join(folder,'favicon.ico'),Buffer.concat([dir,png]));
console.log('Favicon: PNG 48x48 e ICO gerados.');
