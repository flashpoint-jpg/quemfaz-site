const fs=require('node:fs'),zlib=require('node:zlib');
module.exports=function readRgba(path){
 const b=fs.readFileSync(path);if(b.subarray(1,4).toString()!=='PNG')throw Error('Not PNG');
 const width=b.readUInt32BE(16),height=b.readUInt32BE(20);if(b[24]!==8||b[25]!==6)throw Error('Expected RGBA8');
 const chunks=[];for(let i=8;i<b.length;){const n=b.readUInt32BE(i),type=b.toString('ascii',i+4,i+8);if(type==='IDAT')chunks.push(b.subarray(i+8,i+8+n));i+=n+12;}
 const data=zlib.inflateSync(Buffer.concat(chunks)),stride=width*4,out=Buffer.alloc(height*stride);let offset=0;
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<height;y++){
  const filter=data[offset++];if(filter>4)throw Error('Invalid PNG filter');
  for(let x=0;x<stride;x++){
   const a=x>=4?out[y*stride+x-4]:0,b=y?out[(y-1)*stride+x]:0,c=y&&x>=4?out[(y-1)*stride+x-4]:0;
   const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
   out[y*stride+x]=(data[offset++]+predictor)&255;
  }
 }
 return {width,height,pixels:out};
};
