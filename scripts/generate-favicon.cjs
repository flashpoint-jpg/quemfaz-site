// Favicon PNG e ICO derivado do mesmo ícone SVG aprovado do Quem Faz.
const fs=require('node:fs');
const path=require('node:path');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAwFBMVEULHTngYw/+/v0AAAD549UKHDntp3dQNCvbYQ8LHDrOXRIzKjILHToLHTqWSx2tUhnu6OTkeDANITZBLy9oOyYOHDgLHToYITfmhUTzw6Py2cp7QSN2gJHql1/yvJgUFDvmgTzsnWgAAEAAMzNpdIaJRyGylIW5vsfvr4X21LwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABpRgjDAAAAQHRSTlP+//8A/9b///+M//9Grv////8U//8kaf//////////Df//BAX///////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA1jbK4AAAAXVJREFUeNrNltmWgyAQRFuRIEbFPSZO1tn//wenBTUmRpa3qSeO1g1dgKGBSBVNQkEjmsTvygnSzsEsGk9ATcFKfABqsFUigYJaA/0cQDg4KCZQuPiBEmicAIghcQM4vIpcdqkQaVe+qmn5aFdF3qCo2pnnLKU9b9tcIluTvwrR9pP5qGCDw5Dp/Qz9F2mXSG4itujP/buyntBVJbCIYAb4B3wgNIHx9XXu9/d98nIVSPHtryy+9byTSo1KV4F+ReUPyyVtp+1YjewNQOY9ai02GwFf+Q79cKMJIYFgdM2GTAec1Opcj8ejEZAZZvs2AVvdKnn7BRBp92HIOgfW94Gp1dk/AUx/llCXUzADhOG03qUA7WmFaglU+i+oC5+AL9M3ysJH4M34L7D7DN0ARFgqokikB1tg1HeG+oD/L+pq525AgjeEkxogbjUVQJym4P097ZCCnmUnYH/N1UOvYTkHrcfmhMQ2yfl56mYIucWm9qcplPMPTnAPIpEFaDIAAAAASUVORK5CYII=','base64');
if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==48||png.readUInt32BE(20)!==48)throw Error('Favicon PNG inválido');
const folder=path.join(__dirname,'..','dist');
fs.writeFileSync(path.join(folder,'favicon.png'),png);
const dir=Buffer.alloc(22);
dir.writeUInt16LE(1,2);dir.writeUInt16LE(1,4);
dir[6]=48;dir[7]=48;dir.writeUInt16LE(1,10);dir.writeUInt16LE(32,12);
dir.writeUInt32LE(png.length,14);dir.writeUInt32LE(22,18);
fs.writeFileSync(path.join(folder,'favicon.ico'),Buffer.concat([dir,png]));
console.log('Favicon: PNG 48x48 e ICO gerados.');
