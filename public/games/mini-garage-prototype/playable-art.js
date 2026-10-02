/* PROTOTYPE: real-race renderer for the reviewed toy kit. No model mutation, clocks,
 * collision decisions, persistence, host authorization or external dependencies here.
 * GarageModel remains the source of every surface / obstacle / ramp / band position.
 */
(() => {
 const root='./art-assets/track-kit/';
 const names=['car-road-boost.png','car-road-jump.png','car-offroad-boost.png','car-offroad-jump.png',
  'surface-road.webp','surface-sand.webp','surface-gravel.webp','surface-wood.webp','barrier.png',
  'ramp.png','slow-strip.png','curb.png','shadow.svg','boost-flame.svg','landing-ring.svg','finish-line.svg',
  'icon-boost.png','icon-jump.png'];
 const images=new Map(),textures=new Map();let loading=null,ready=false,lastState=null,lastHits=0,hitTime=-10;
 const fileURL=file=>root+file+(['ramp.png','slow-strip.png'].includes(file)?'?rev=road-fit-02':'');
 const heroURL=(tire,gadget)=>`./art-assets/hero-${tire}-${gadget}.webp`;
 function loadImage(key,url){
  if(images.has(key))return Promise.resolve();
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{images.set(key,img);resolve()};img.onerror=()=>reject(new Error(key));img.src=url});
 }
 function load(){
  if(ready)return Promise.resolve();if(loading)return loading;
  loading=Promise.all([...names.map(file=>loadImage(file,fileURL(file))),...['road','offroad'].flatMap(tire=>['boost','jump'].map(gadget=>loadImage(`hero-${tire}-${gadget}`,heroURL(tire,gadget))))])
   .then(()=>{ready=true}).finally(()=>{loading=null});return loading;
 }
 // Preserve the 160-world-unit forward/backward view and 76% car baseline.
 // A wider drawing projection is only art; the model's normalized coordinates do not change.
 function projection(w,h,z){const unit=w*.5,scale=h/160,carY=h*.76;return {unit,scale,carY,X:x=>w*.5+x*unit,Y:zz=>carY-(zz-z)*scale}}
 function texture(ctx,name,size){
  const key=name+':'+Math.round(size);if(textures.has(key))return textures.get(key);
  const tile=document.createElement('canvas');tile.width=tile.height=Math.max(32,Math.round(size));
  tile.getContext('2d').drawImage(images.get(`surface-${name}.webp`),0,0,tile.width,tile.height);
  const pattern=ctx.createPattern(tile,'repeat');textures.set(key,pattern);
  // Resize/orientation changes must not accumulate an unbounded family of canvases.
  if(textures.size>16)textures.delete(textures.keys().next().value);
  return pattern;
 }
 function fillTexture(ctx,name,w,size,shift,y,height){
  ctx.save();ctx.translate(0,shift);ctx.fillStyle=texture(ctx,name,size);ctx.fillRect(0,y-shift,w,height);ctx.restore();
 }
 function sprite(ctx,file,x,y,w,h,angle=0,contact=false){
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);
  if(contact){ctx.shadowColor='#223b3540';ctx.shadowBlur=2;ctx.shadowOffsetX=1;ctx.shadowOffsetY=2}
  ctx.drawImage(images.get(file),-w/2,-h/2,w,h);ctx.restore();
 }
 function stroke(ctx,path,color,width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke(path)}
 function roadPaths(model,trackId,project,w,h){
  const {X,scale,carY}=project,points=[],z=project.z;
  for(let y=-50;y<=h+58;y+=8){const zz=z+(carY-y)/scale;points.push([X(model.center(zz,trackId)),y])}
  const centerPath=new Path2D(),outline=new Path2D();
  points.forEach(([x,y],i)=>i?centerPath.lineTo(x,y):centerPath.moveTo(x,y));
  points.forEach(([x,y],i)=>i?outline.lineTo(x-project.unit*.55,y):outline.moveTo(x-project.unit*.55,y));
  points.slice().reverse().forEach(([x,y])=>outline.lineTo(x+project.unit*.55,y));outline.closePath();
  return {centerPath,outline};
 }
 // Read only simulated time: pausing freezes the attack, travel and release.
 // Extra parallax belongs exclusively to non-colliding foreground decorations.
 function boostMotion(s,model,reduced=false){
  const age=Number.isFinite(s.boostStartedAt)?Math.max(0,s.time-s.boostStartedAt):Infinity;
  const attack=1-Math.pow(1-Math.min(1,age/.12),3),release=Math.max(0,1-Math.max(0,age-model.tuning.boostDuration)/.28);
  const strength=attack*release;
  return {strength,streakStrength:reduced?0:strength*Math.min(1,s.speed/model.tuning.roadSpeed),travel:s.z*1.7};
 }
 function boostRoadside(ctx,p,outline,w,h,boost){
  const level=boost.streakStrength;if(level<=0)return {markers:0,streaks:0};
  // Exclude the actual curved road, not just a fixed centre rectangle. Keep all
  // obstacles and safe gaps crisp even when the track bends toward an edge.
  const outside=new Path2D();outside.rect(0,0,w,h);outside.addPath(outline);
  ctx.save();ctx.clip(outside,'evenodd');
  const span=h*1.4,travel=boost.travel*p.scale,counts={markers:0,streaks:0};
  for(const side of [-1,1]){
   ctx.globalAlpha=level*.65;
   for(let i=0;i<4;i++){
    const edge=.055+(i%2)*.07,x=w*(side<0?edge:1-edge);
    const y=(travel+i*span/4+(side>0?span/8:0))%span-h*.2;
    // Reuse the toy kit's wooden pieces; these are near-field scenery, not new barriers.
    sprite(ctx,'curb.png',x,y,w*.032,h*.065);counts.markers++;
   }
   ctx.globalAlpha=level*.7;
   for(let i=0;i<5;i++){
    const edge=.025+i*.028,x=w*(side<0?edge:1-edge);
    const y=(travel+i*span*.21+(side>0?span*.13:0))%span-h*.2;
    const tail=h*(.055+level*.09+(i%3)*.015),line=new Path2D();
    line.moveTo(x,y-tail);line.lineTo(x,y);
    stroke(ctx,line,'#486159',Math.max(1,w*.006));
    stroke(ctx,line,'#f5f0df',Math.max(1,w*.003));counts.streaks++;
   }
  }
  ctx.restore();return counts;
 }
 function draw(ctx,{w,h,state:s,model,motion:m,steer=0,reduced=false,label=''}){
  if(!ready||!s)return;
  if(lastState!==s){lastState=s;lastHits=s.hits;hitTime=-10}
  if(s.hits>lastHits){lastHits=s.hits;hitTime=s.time}
  const p={...projection(w,h,s.z),z:s.z},{unit,scale,carY,X,Y}=p;
  const track=model.trackFor(s.trackId),half=unit*.55,minZ=s.z-(h-carY+80)/scale,maxZ=s.z+(carY+80)/scale;
  const {centerPath,outline}=roadPaths(model,s.trackId,p,w,h),shift=carY+s.z*scale;
  const counts={barriers:0,ramps:0,bands:0,surfaces:new Set()};
  fillTexture(ctx,'wood',w,w,shift%w,0,h);ctx.fillStyle='#fff9e840';ctx.fillRect(0,0,w,h);
  const boost=boostMotion(s,model,reduced),roadside=boostRoadside(ctx,p,outline,w,h,boost);
  ctx.save();ctx.translate(2,3);stroke(ctx,centerPath,'#524e402b',half*2+20);ctx.restore();
  stroke(ctx,centerPath,'#c9c2ab',half*2+15);stroke(ctx,centerPath,'#f5f0df',half*2+12);stroke(ctx,centerPath,'#486159',half*2+2);
  ctx.save();ctx.clip(outline);
  let begin=0;
  for(const part of track.parts){
   const end=part.end,top=Y(end),bottom=Y(begin);
   if(bottom>=-2&&top<=h+2){const y=Math.max(-2,top),height=Math.min(h+2,bottom)-y;fillTexture(ctx,part.surface,w,w*({road:.6,sand:.48,gravel:.3}[part.surface]),shift,y,height+1);counts.surfaces.add(part.surface)}
   begin=end;
  }
  // Before the start and after the finish are the same hard track, not untextured voids.
  if(Y(0)<h)fillTexture(ctx,'road',w,w*.6,shift,Math.max(0,Y(0)),h-Math.max(0,Y(0))+1);
  if(Y(model.length)>0)fillTexture(ctx,'road',w,w*.6,shift,0,Math.min(h,Y(model.length))+1);
  ctx.fillStyle='#82968a18';ctx.fillRect(0,0,w,h);
  for(const side of [-1,1]){
   const edge=new Path2D();for(let y=-20;y<h+25;y+=8){const zz=s.z+(carY-y)/scale,x=X(model.center(zz,s.trackId))+side*(half-8);y===-20?edge.moveTo(x,y):edge.lineTo(x,y)}stroke(ctx,edge,'#f7f0d6b8',1.3);
  }
  for(let zz=Math.floor(minZ/8)*8;zz<=maxZ;zz+=8){
   const line=new Path2D();line.moveTo(X(model.center(zz,s.trackId)),Y(zz));line.lineTo(X(model.center(zz+3,s.trackId)),Y(zz+3));stroke(ctx,line,'#f5efd580',1.6);
  }
  // Each horizontal row covers EXACTLY the same model road span as the surface.
  // Texture is sampled by world progress; it neither swims nor reveals road at the ends.
  for(const start of track.bands){
   const top=Y(start+model.bandLength),bottom=Y(start);if(bottom<0||top>h)continue;counts.bands++;
   const img=images.get('slow-strip.png'),height=bottom-top;
   for(let y=Math.max(0,Math.floor(top));y<Math.min(h,Math.ceil(bottom));y+=1){
    const rowTop=Math.max(y,top),rowBottom=Math.min(y+1.1,bottom),zz=s.z+(carY-(rowTop+rowBottom)/2)/scale;
    const sourceY=Math.max(0,(rowTop-top)/height*img.height),sourceHeight=Math.min(img.height-sourceY,(rowBottom-rowTop)/height*img.height);
    if(sourceHeight>0)ctx.drawImage(img,0,sourceY,img.width,sourceHeight,X(model.center(zz,s.trackId))-half,rowTop,half*2,rowBottom-rowTop);
   }
  }
  if(Y(model.length)>-35&&Y(model.length)<h+35)sprite(ctx,'finish-line.svg',X(model.center(model.length,s.trackId)),Y(model.length),half*2,Math.max(14,half*.22));
  ctx.restore();
  // Low, continuous toy curb joints. This remains traversable scenery, not a new collider.
  for(let zz=Math.floor(minZ/15)*15;zz<=maxZ;zz+=15){
   const y=Y(zz),angle=Math.atan2(unit*(model.center(zz+1,s.trackId)-model.center(zz-1,s.trackId)),2*scale);
   for(const side of [-1,1])sprite(ctx,'curb.png',X(model.center(zz,s.trackId))+side*(half+5),y,9,15*scale+1,angle);
  }
  for(const r of track.ramps){
   const lipY=Y(r.z),x=X(model.center(r.z,s.trackId)+r.x);
   // Departure lip is anchored at the model trigger, with the slope trailing behind it.
   // Reduced kit size: 90% of the preceding review, independently of its trigger tolerance.
   const rw=unit*.34,rh=rw*380/280,cy=lipY+rh*.455;
   if(cy+rh/2<0||cy-rh/2>h)continue;counts.ramps++;
   const target=track.bands.find(z=>z>r.z),targetZ=target??r.z+8;
   const angle=Math.atan2(X(model.center(targetZ,s.trackId)+r.x)-x,Y(r.z)-Y(targetZ));
   const fac=rw/100,shadow=new Path2D();
   [[-27,-62,21],[24,-62,21],[38,-4,10],[42,49,1],[30,60,.3],[-32,60,.3],[-42,49,1],[-36,-4,10]].forEach(([a,b,height],i)=>{
    const px=x+(a*Math.cos(angle)-b*Math.sin(angle)+height*.85)*fac,py=cy+(a*Math.sin(angle)+b*Math.cos(angle)+height)*fac;
    i?shadow.lineTo(px,py):shadow.moveTo(px,py);
   });shadow.closePath();ctx.save();ctx.fillStyle='#263b3045';ctx.shadowColor='#263b3045';ctx.shadowBlur=3;ctx.fill(shadow);ctx.restore();
   sprite(ctx,'ramp.png',x,cy,rw,rh,angle,true);
  }
  for(const o of track.obstacles){
   const y=Y(o.z);if(y<-25||y>h+25)continue;counts.barriers++;
   const angle=Math.atan2(unit*(model.center(o.z+1,s.trackId)-model.center(o.z-1,s.trackId)),2*scale);
   sprite(ctx,'barrier.png',X(model.center(o.z,s.trackId)+o.x),y,unit*.20,unit*.20*130/392,angle,true);
  }
  const cw=unit*.25,ch=cw*400/296,x=X(s.x),lift=m.arc*Math.min(64,Math.max(36,h*.13));
  ctx.save();ctx.globalAlpha=1-m.arc*.58;sprite(ctx,'shadow.svg',x+2,carY+4,cw*1.25*(1-m.arc*.3),ch*1.05*(1-m.arc*.3));ctx.restore();
  if(s.landing>0&&!reduced){ctx.save();const t=1-s.landing/.28;ctx.globalAlpha=1-t;sprite(ctx,'landing-ring.svg',x,carY+6,cw*(1.1+t),cw*(.7+t*.3));ctx.restore()}
  ctx.save();ctx.translate(x,carY-lift);ctx.rotate(steer*.09);ctx.scale(1+m.arc*.12,1+m.arc*.12);
  if(boost.strength>0){
   const pulse=reduced?1:1+.035*Math.sin(s.time*18),flameHeight=ch*(reduced?.65:.6+boost.strength*.85)*pulse;
   ctx.save();ctx.globalAlpha=boost.strength;
   sprite(ctx,'boost-flame.svg',0,ch*.37+flameHeight*.5,cw*(reduced?.55:.55+boost.strength*.2),flameHeight);ctx.restore();
  }
  // Micro suspension pulses only; no gravel yaw. The whole raster squashes subtly,
  // while the independent ground shadow remains stable (no camera shake).
  ctx.translate(0,m.bump);ctx.scale(1+m.squash*.45,1-m.squash);
  sprite(ctx,`car-${s.tire}-${s.gadget}.png`,0,0,cw,ch);ctx.restore();
  const collision=s.time-hitTime<.6;
  if(collision){ctx.save();ctx.globalAlpha=(1-(s.time-hitTime)/.6)*.65;sprite(ctx,'landing-ring.svg',x,carY,cw*1.7,cw);ctx.restore()}
  const text=collision?'轻轻碰到，继续开':label;
  if(text){
   ctx.save();ctx.font='600 12px system-ui';ctx.textAlign='center';const tw=Math.min(w-20,ctx.measureText(text).width+24),left=(w-tw)/2;
   ctx.fillStyle='#fffdf3ed';ctx.beginPath();ctx.moveTo(left+10,12);ctx.arcTo(left+tw,12,left+tw,42,10);ctx.arcTo(left+tw,42,left,42,10);ctx.arcTo(left,42,left,12,10);ctx.arcTo(left,12,left+tw,12,10);ctx.closePath();ctx.fill();ctx.fillStyle='#294b43';ctx.fillText(text,w/2,32,w-32);ctx.restore();
  }
  // Read-only observability for browser verification, never used by game decisions.
  api.lastFrame={track:s.trackId,z:s.z,car:`${s.tire}-${s.gadget}`,barriers:counts.barriers,ramps:counts.ramps,bands:counts.bands,surfaces:[...counts.surfaces],boost:{...boost,...roadside}};
 }
 const api={load,draw,projection,boostMotion,heroURL,assetURL:fileURL,get isReady(){return ready},lastFrame:null};
 window.GarageArt=api;
})();
