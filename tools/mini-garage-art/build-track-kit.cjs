// PROTOTYPE art processing, not a runtime dependency.
// SHARP_MODULE=/absolute/path/to/sharp node tools/mini-garage-art/build-track-kit.cjs
const sharp=require(process.env.SHARP_MODULE||'sharp');
const path=require('node:path');
const root=path.resolve(__dirname,'../../public/games/mini-garage-prototype/art-assets/track-kit');
const originals=path.resolve(__dirname,'../../docs/game/mini-garage/art-assets/track-kit/originals');
const input=name=>path.join(originals,name+'.png');
const output=name=>path.join(root,name);

async function cutCar(name,left,top){
 const {data,info}=await sharp(input('cars')).extract({left,top,width:627,height:627}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {width:w,height:h}=info,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let start=0,end=0;
 const pink=i=>{const n=i*4,r=data[n],g=data[n+1],b=data[n+2];return data[n+3]<30||(r-g>22&&b-g>7&&r-b<85)};
 function visit(i){if(!seen[i]&&pink(i)){seen[i]=1;queue[end++]=i}}
 for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x)}for(let y=0;y<h;y++){visit(y*w);visit(y*w+w-1)}
 while(start<end){const i=queue[start++],x=i%w,y=Math.floor(i/w);if(x)visit(i-1);if(x<w-1)visit(i+1);if(y)visit(i-w);if(y<h-1)visit(i+w)}
 for(let i=0;i<w*h;i++)if(seen[i])data[i*4+3]=0;
 // Remove key-color spill at silhouette edges, without changing internal paint.
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,n=i*4;if(seen[i]||![i-1,i+1,i-w,i+w].some(j=>seen[j]))continue;
  const spill=Math.max(0,Math.min(data[n]-data[n+1]-12,data[n+2]-data[n+1]));
  data[n]=Math.max(0,data[n]-spill);data[n+2]=Math.max(0,data[n+2]-spill);
 }
 // Same crop and output canvas for all four: no independent auto-trim / anchor wobble.
 await sharp(data,{raw:{width:w,height:h,channels:4}}).extract({left:98,top:14,width:432,height:584}).resize(296,400).png().toFile(output('car-'+name+'.png'));
}
async function cutPiece(name,rect,width){
 const {data,info}=await sharp(input('components')).extract(rect).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const w=info.width,h=info.height;
 // Keep only the main opaque connected component; generated alpha contains floating edge noise.
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let largest=[];
 for(let i=0;i<w*h;i++){
  if(seen[i]||data[i*4+3]<180)continue;
  let start=0,end=1;queue[0]=i;seen[i]=1;
  while(start<end){const p=queue[start++],x=p%w,y=Math.floor(p/w);for(const q of [x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1])if(q>=0&&!seen[q]&&data[q*4+3]>=180){seen[q]=1;queue[end++]=q}}
  if(end>largest.length)largest=Array.from(queue.subarray(0,end));
 }
 const keep=new Uint8Array(w*h);largest.forEach(i=>keep[i]=1);
 for(let i=0;i<w*h;i++)data[i*4+3]=keep[i]?255:0;
 // Slight erosion removes chromatic fringe baked into AI silhouette, then downsampling antialiases.
 const copy=Buffer.from(data);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x;if([i-1,i+1,i-w,i+w].some(j=>!keep[j]))copy[i*4+3]=0;
 }
 await sharp(copy,{raw:{width:w,height:h,channels:4}}).trim({background:'#00000000',threshold:1}).resize({width}).extend({top:4,bottom:4,left:4,right:4,background:'#00000000'}).png().toFile(output(name+'.png'));
}
async function tile(name,left,top){
 // Use interior material patch; mirrored repeats have equal opposing edges and no cut seam.
 const source=await sharp(input('materials')).extract({left:left+12,top:top+12,width:600,height:600}).resize(256,256).removeAlpha().png().toBuffer();
 const flip=await sharp(source).flop().toBuffer(),down=await sharp(source).flip().toBuffer(),both=await sharp(source).flip().flop().toBuffer();
 await sharp({create:{width:512,height:512,channels:3,background:'#ffffff'}}).composite([{input:source,left:0,top:0},{input:flip,left:256,top:0},{input:down,left:0,top:256},{input:both,left:256,top:256}]).webp({quality:92}).toFile(output('surface-'+name+'.webp'));
}
(async()=>{
 for(const [name,x,y] of [['road-boost',0,0],['road-jump',627,0],['offroad-boost',0,627],['offroad-jump',627,627]])await cutCar(name,x,y);
 for(const [name,rect] of [['boost',{left:90,top:290,width:118,height:96}],['jump',{left:90,top:270,width:118,height:116}]])await sharp(output(`car-road-${name}.png`)).extract(rect).resize(128,128,{fit:'contain',background:'#00000000'}).png().toFile(output(`icon-${name}.png`));
 await cutPiece('barrier',{left:40,top:205,width:712,height:275},384);
 await cutPiece('ramp',{left:778,top:45,width:380,height:525},240);
 await cutPiece('slow-strip',{left:45,top:713,width:700,height:356},512);
 await require('./refine-track-pieces.cjs')(sharp,root);
 await cutPiece('curb',{left:890,top:598,width:145,height:610},64);
 for(const [name,x,y] of [['road',0,0],['sand',627,0],['gravel',0,627],['wood',627,627]])await tile(name,x,y);
 console.log('Built 4 anchored cars, 4 isolated components and 4 edge-matched material tiles.');
})().catch(e=>{console.error(e);process.exitCode=1});
