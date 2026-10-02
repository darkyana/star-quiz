// PROTOTYPE capture utility. PLAYWRIGHT_MODULE points to an isolated Playwright install.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../public/games/mini-garage-prototype');
const archive=path.resolve(__dirname,'../../docs/game/mini-garage');
const assets=pathToFileURL(root+'/art-assets/track-kit/').href;
const img=(name,style='')=>`<img src="${assets}${name}" style="${style}" alt="">`;
const cars=[['road-boost','公路胎 × 加速'],['road-jump','公路胎 × 弹跳'],['offroad-boost','越野胎 × 加速'],['offroad-jump','越野胎 × 弹跳']];
const materials=[['road','细纹硬地'],['sand','细颗粒沙地'],['gravel','小粒碎石'],['wood','暖木桌面']];
const parts=[['barrier.png','橙白路障','橡胶端帽 / 倒角 / 嵌入斜纹'],['ramp.png','蓝色跳台','抬高坡面 / 渐薄侧壁 / 无螺钉'],['slow-strip.png','紫色缓速带','开放两端 / 横贯车道 / 连续肋条'],['curb.png','拼接路沿','象牙白边框 / 接头螺钉']];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1300},deviceScaleFactor:1});
  // Local file origin lets the contact sheet reuse exact shipped assets without embedding copies.
  await page.goto(pathToFileURL(archive+'/art-prototype.html').href+'?view=materials');
  await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
   *{box-sizing:border-box}body{margin:0;padding:42px 48px;background:#f7f4ed;color:#294a43;font:16px/1.5 system-ui,-apple-system,'PingFang SC',sans-serif}header{display:flex;align-items:end;justify-content:space-between;border-bottom:1px solid #d7ded1;padding-bottom:20px;margin-bottom:24px}h1{font-size:36px;margin:5px 0;letter-spacing:-1px}p{margin:0;color:#7a8679}.eyebrow{color:#c6684e;font-size:12px;letter-spacing:3px;font-weight:700}.right{text-align:right;font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}a{color:inherit;text-decoration:none}.card{border:1px solid #dde2d5;background:#fffdf8;border-radius:20px;text-align:center;padding:15px}b,small{display:block}small{font-size:12px;color:#7b8578;margin-top:4px}h2{font-size:16px;margin:24px 0 12px;letter-spacing:1px}.cars img{height:220px;width:auto;filter:drop-shadow(3px 6px 4px #294c3f22)}.cars b{margin-top:8px}.surface{height:95px;border-radius:14px;background-size:240px;border:1px solid #d4dacd;margin-bottom:8px}.parts .image{height:142px;display:grid;place-items:center}.parts img{max-height:137px;max-width:95%;filter:drop-shadow(2px 4px 2px #213e3226)}.parts b{margin-top:9px}.effects{display:flex;gap:20px;align-items:center;background:#e5ebdf;border-radius:18px;padding:13px 22px}.effects>div{display:flex;align-items:center;gap:12px;flex:1}.effects img{width:52px;height:52px;object-fit:contain}.effects b{font-size:13px}.foot{display:flex;justify-content:space-between;margin-top:22px;font-size:12px;color:#7b8578}
   </style><header><div><div class="eyebrow">MINI GARAGE / COORDINATED TRACK KIT 01</div><h1>不是一辆精致的车，是一整套精致的世界。</h1><p>四配置车辆 × 细纹路面 × 可拼装赛道部件</p></div><div class="right">正俯视 · 左上柔光<br>奶油白 / 珊瑚橙 / 深青 / 暖金属<br>素材小样 · 待美术评审</div></header>
   <div class="grid cars">${cars.map(([key,label])=>`<div class="card">${img('car-'+key+'.png')}<b>${label}</b><small>统一画布 / 独立透明 PNG</small></div>`).join('')}</div>
   <h2>01 / 材质连续，细节有分寸</h2><div class="grid">${materials.map(([key,label])=>`<div><div class="surface" style="background-image:url('${assets}surface-${key}.webp')"></div><b>${label}</b><small>512 × 512 / 边缘匹配纹理</small></div>`).join('')}</div>
   <h2>02 / 同一套玩具制造工艺</h2><div class="grid parts">${parts.map(([file,label,detail])=>`<div class="card"><div class="image">${img(file)}</div><b>${label}</b><small>${detail}</small></div>`).join('')}</div>
   <h2>03 / 效果独立于车辆，方便运动与腾空</h2><div class="effects">${[['shadow.svg','接触阴影'],['boost-flame.svg','双喷口尾焰'],['landing-ring.svg','落地气圈'],['finish-line.svg','起终点标线']].map(([file,label])=>`<div>${img(file)}<b>${label}</b></div>`).join('')}</div>
   <div class="foot"><span>这里展示的都是已导出的实际素材；赛道样板使用同一套文件拼装。</span><span>玩法冻结 / 非完整关卡 / 非真机最终验收</span></div></html>`);
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:archive+'/art-review/kit-contact-sheet.png',fullPage:true});
  console.log('Captured labeled contact sheet from exported assets.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
