/* PROTOTYPE: one coordinated material kit, three route-context samples, not new gameplay.
 * The existing garage selectors remain the review controls. All art is locally addressable.
 * This renderer only composes art; it does not read/write GarageModel or simulate a race.
 */
(() => {
 const root='../../../public/games/mini-garage-prototype/art-assets/track-kit/';
 const titles={sprint:'直道快线',gravel:'碎石小径',workshop:'跳台工坊'};
 const asset=file=>root+file+(['ramp.png','slow-strip.png'].includes(file)?'?rev=road-fit-02':'');
 const image=(file,x,y,w,h,extra='')=>`<image href="${asset(file)}" x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
 const center=y=>195+15*Math.sin((y+20)/130);
 const points=[];for(let y=-40;y<=700;y+=10)points.push([center(y),y]);
 const path=offset=>points.map(([x,y],i)=>`${i?'L':'M'}${(x+offset).toFixed(2)} ${y}`).join(' ');
 const roadShape=points.map(([x,y],i)=>`${i?'L':'M'}${x-124} ${y}`).join(' ')+points.slice().reverse().map(([x,y])=>`L${x+124} ${y}`).join(' ')+'Z';
 function piece(name,x,y,w,h){return `<g filter="url(#kit-contact)">${image(name,x-w/2,y-h/2,w,h)}</g>`}
 function scene(route='workshop',tire='offroad',gadget='boost',includeCar=true){
  const mixed=route!=='sprint',laneOffset=route==='gravel'?64:-64;
  const bandY=239,rampY=344,rampX=center(rampY)+laneOffset,targetX=center(bandY)+laneOffset;
  // Aim along this lane towards its intersection with the band, not straight up the screen.
  const rampAngle=Math.atan2(targetX-rampX,rampY-bandY),degrees=rampAngle*180/Math.PI;
  const bandAngle=-Math.atan(15/130*Math.cos((bandY+20)/130))*180/Math.PI;
  // Shadow displacement is in WORLD space: the high lip casts farther right/down,
  // the entry remains in contact, even when the ramp rotates with the lane.
  const projectShadow=(x,y,height)=>`${(rampX+x*Math.cos(rampAngle)-y*Math.sin(rampAngle)+height*.85).toFixed(2)},${(rampY+x*Math.sin(rampAngle)+y*Math.cos(rampAngle)+height).toFixed(2)}`;
  const rampShadow=[[-27,-62,21],[24,-62,21],[38,-4,10],[42,49,1],[30,60,.3],[-32,60,.3],[-42,49,1],[-36,-4,10]].map(p=>projectShadow(...p.map(v=>v*.9))).join(' ');
  let curbs='';for(let y=-44;y<700;y+=78){
   const tilt=-Math.atan(15/130*Math.cos((y+59)/130))*180/Math.PI;
   for(const side of [-1,1]){const x=center(y+39)+side*134;curbs+=`<g transform="rotate(${tilt} ${x} ${y+39})" filter="url(#kit-curb-shadow)">${image('curb.png',x-8,y,16,80)}</g>`}
  }
  const surfaces=mixed?`<rect x="38" y="-40" width="314" height="300" fill="url(#kit-${route==='gravel'?'gravel':'sand'})" mask="url(#kit-feather)"/><path d="${path(0)}" fill="none" stroke="#e4d3a5" stroke-width="245" opacity=".04"/>`:'';
  const installation=mixed?`<g>
   <!-- The open-ended rubber spans beyond both road edges; clip to the actual curved
        carriageway AFTER rotation. No inset tablet frame or road-colored side gaps. -->
   <g id="kitSlowBand" clip-path="url(#kit-road-clip)">
    <g transform="rotate(${bandAngle} ${center(bandY)} ${bandY})">
     <path d="M${center(bandY)-168} ${bandY-35}H${center(bandY)+168}" stroke="#283e34" stroke-width="4" opacity=".24"/>
     ${image('slow-strip.png',center(bandY)-168,bandY-34,336,68,'preserveAspectRatio="none"')}
     <path d="M${center(bandY)-168} ${bandY+34}H${center(bandY)+168}" stroke="#eddfef" stroke-width="1.5" opacity=".6"/>
    </g>
   </g>
   <polygon id="kitRampHeightShadow" points="${rampShadow}" fill="#24372f" opacity=".34" filter="url(#kit-ramp-height-shadow)"/>
   <g id="kitJumpRamp" data-angle="${degrees}" data-target-x="${targetX}" data-target-y="${bandY}" transform="translate(${rampX} ${rampY}) rotate(${degrees})">
    ${image('ramp.png',-45,-61.2,90,122.4,'filter="url(#kit-contact)"')}
   </g>
  </g>`:'';
  const obstacles=mixed?[[center(100)+56,100],[rampX,445]]:[[center(106)+59,106],[center(230)-55,230],[center(357)+55,357],[center(452)-50,452]];
  let roadside='';for(const y of [125,385,605])for(const side of [-1,1]){
   const x=center(y)+side*155;
   roadside+=`<g transform="translate(${x} ${y})"><rect x="-4" y="-11" width="8" height="22" rx="3" fill="#c5b394" opacity=".24"/><rect x="-3" y="-12" width="6" height="20" rx="2" fill="#f5ecda" stroke="#b8ad94" stroke-width=".6"/><path d="M-2-7H2" stroke="#df9572" stroke-width="3"/></g>`;
  }
  return `<defs>
   <symbol id="kit-boost-icon" viewBox="0 0 128 128">${image('icon-boost.png',0,0,128,128)}</symbol>
   <symbol id="kit-jump-icon" viewBox="0 0 128 128">${image('icon-jump.png',0,0,128,128)}</symbol>
   <pattern id="kit-wood" patternUnits="userSpaceOnUse" width="390" height="390">${image('surface-wood.webp',0,0,390,390)}</pattern>
   <pattern id="kit-road" patternUnits="userSpaceOnUse" width="230" height="230">${image('surface-road.webp',0,0,230,230)}</pattern>
   <pattern id="kit-sand" patternUnits="userSpaceOnUse" width="170" height="170">${image('surface-sand.webp',0,0,170,170)}</pattern>
   <pattern id="kit-gravel" patternUnits="userSpaceOnUse" width="110" height="110">${image('surface-gravel.webp',0,0,110,110)}</pattern>
   <clipPath id="kit-road-clip"><path d="${roadShape}"/></clipPath>
   <linearGradient id="kit-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="white"/><stop offset=".77" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>
   <mask id="kit-feather"><rect x="0" y="-40" width="390" height="300" fill="url(#kit-fade)"/></mask>
   <filter id="kit-contact" x="-20%" y="-20%" width="145%" height="150%"><feDropShadow dx="1" dy="2.3" stdDeviation="1.5" flood-color="#223d33" flood-opacity=".35"/></filter>
   <filter id="kit-ramp-height-shadow" x="-30%" y="-30%" width="170%" height="170%"><feGaussianBlur stdDeviation="2.8"/></filter>
   <filter id="kit-curb-shadow" x="-70%" y="-10%" width="270%" height="130%"><feDropShadow dx="1.7" dy="2" stdDeviation="1.6" flood-color="#575640" flood-opacity=".25"/></filter>
  </defs>
  <rect width="390" height="650" fill="url(#kit-wood)"/><rect width="390" height="650" fill="#fcf8ed" opacity=".26"/>
  <path d="${path(2)}" fill="none" stroke="#716e52" stroke-width="284" opacity=".19" transform="translate(1 4)"/>
  <path d="${path(0)}" fill="none" stroke="#d1c9ae" stroke-width="280"/>
  <path d="${path(0)}" fill="none" stroke="#fff8e6" stroke-width="273"/>
  <path d="${path(0)}" fill="none" stroke="#5c7167" stroke-width="253"/>
  <g clip-path="url(#kit-road-clip)">
   <rect width="390" height="650" fill="url(#kit-road)"/>
   <rect width="390" height="650" fill="#82968a" opacity=".18"/>
   ${surfaces}
   <path d="${path(-115)} ${path(115)}" fill="none" stroke="#f7f1d8" stroke-width="2" opacity=".75"/>
   <path d="${path(0)}" fill="none" stroke="#f5eed5" stroke-width="2" stroke-dasharray="11 22" opacity=".5"/>
   <path d="${path(-79)} ${path(79)}" fill="none" stroke="#30473c" stroke-width="11" opacity=".045"/>
  </g>
  ${curbs}${roadside}
  ${route==='sprint'?image('finish-line.svg',center(21)-119,8,238,38):''}
  ${installation}
  ${obstacles.map(([x,y])=>piece('barrier.png',x,y,81,29)).join('')}
  ${includeCar?`<g transform="translate(${center(550)} 552)"><g id="carSteer" class="car-steer">
   ${image('shadow.svg',-42,-47,88,104,'id="floorShadow" class="floor-shadow"')}
   <g id="kitLanding" class="kit-landing">${image('landing-ring.svg',-48,-24,96,60)}</g>
   <g id="carAir" class="car-air">
    <g id="carFlame" class="car-flame">${image('boost-flame.svg',-19,34,38,56)}</g>
    ${image(`car-${tire}-${gadget}.png`,-33,-45,66,90,'id="kitRaceCar"')}
   </g>
  </g></g>`:''}`;
 }
 function board(){
  const carNames=[['road-boost','公路胎 × 加速'],['road-jump','公路胎 × 弹跳'],['offroad-boost','越野胎 × 加速'],['offroad-jump','越野胎 × 弹跳']];
  const partNames=[['barrier.png','橙白路障','橡胶端帽 · 烤漆斜纹'],['ramp.png','蓝色跳台','抬高坡面 · 渐薄侧壁'],['slow-strip.png','紫色缓速带','横贯道路 · 连续肋条'],['curb.png','象牙白路沿','倒角 · 接头 · 螺钉']];
  return `<header class="topbar"><div class="brand"><div><strong>同一套，才像同一个世界。</strong><small>COORDINATED TRACK KIT</small></div></div></header>
   <div class="materials kit-materials"><div class="eyebrow">正俯视 / 左上柔光 / 精致桌面玩具</div><h1>小车与赛道，<br>一起做精致。</h1><p>这里每件素材都能独立取用。赛道预览也是用这些零件拼装，不是一张不能拆的背景画。</p>
   <div class="kit-note"><b>本轮评审重点</b><span>看实际手机尺寸下的材质、部件与道路接缝，以及小车是否属于这个场景。不是新玩法或正式版验收。</span></div>
   <h2>01 / 四种赛中车</h2><div class="kit-cars">${carNames.map(([key,label])=>`<a class="kit-car-card" href="${root}car-${key}.png" target="_blank" rel="noopener"><div><img src="${root}car-${key}.png" alt="${label}俯视透明精灵" width="296" height="400"></div><b>${label}</b><small>透明 PNG · 统一画布</small></a>`).join('')}</div>
   <h2>02 / 路面与桌面</h2><div class="kit-surfaces">${[['road','硬地'],['sand','沙地'],['gravel','碎石'],['wood','木质桌面']].map(([key,label])=>`<a href="${root}surface-${key}.webp" target="_blank" rel="noopener"><i style="background-image:url('${root}surface-${key}.webp')"></i><b>${label}</b><small>边缘匹配纹理</small></a>`).join('')}</div>
   <h2>03 / 配套赛道组件</h2><div class="kit-parts">${partNames.map(([file,label,detail])=>`<a href="${asset(file)}" target="_blank" rel="noopener"><div><img src="${asset(file)}" alt="${label}" loading="lazy"></div><b>${label}</b><small>${detail}</small></a>`).join('')}</div>
   <h2>04 / 独立效果层</h2><div class="kit-effects">${[['shadow.svg','离地阴影'],['boost-flame.svg','加速尾焰'],['landing-ring.svg','落地气圈'],['finish-line.svg','起终点标线']].map(([file,label])=>`<a href="${asset(file)}" target="_blank" rel="noopener"><img src="${asset(file)}" alt="${label}"><small>${label}</small></a>`).join('')}</div>
   <div class="kit-note"><b>怎样查看配套效果？</b><span>回配车首页选择路线、轮胎和装置，再进入赛道预览。三条路线展示各自的代表性路面与避障构图；不是完整关卡地图。</span></div>
   <div class="option-grid"><button class="steer-btn" id="tryJump">看弹跳反馈 ↑</button><button class="steer-btn gadget-btn" id="tryBoost">看加速反馈 ↗</button></div>
   <p class="design-note">四配置车与组件是 AI 原图派生素材，已做裁切、透明边缘处理和手机尺寸检查。没有共享的可编辑 3D 模型；首页与俯视车仍有几何细节差异，尚待品质评审。原始图、处理脚本及资源清单均保留；玩法、授权和宿主未改动。</p></div>`;
 }
 const sceneNode=document.querySelector('.race-stage > .scene');
 function update(selection){
  sceneNode.innerHTML=scene(selection.route,selection.tire,selection.gadget);
  sceneNode.setAttribute('aria-label',`${titles[selection.route]}代表性赛段：同套俯视车、细纹路面、路沿和赛道组件`);
  document.querySelector('.race-heading strong').textContent=titles[selection.route];
  document.querySelector('.race-heading small').textContent='配套素材组装 · 非游玩画面';
  document.querySelector('.distance-chip b').textContent=selection.route==='sprint'?'前方 · 连续避障':'前方 · 绕障后对准跳台';
  document.querySelector('.surface-chip').textContent=selection.route==='sprint'?'硬地 / 代表性赛段':selection.route==='gravel'?'硬地 → 碎石 / 代表段':'硬地 → 沙地 / 代表段';
 }
 document.getElementById('materialsView').innerHTML=board();
 update({route:'workshop',tire:'offroad',gadget:'boost'});
 window.TrackKitPreview={update,scene};
})();
