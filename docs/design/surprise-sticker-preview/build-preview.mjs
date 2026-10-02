import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/Users/nikabot/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const out=path.dirname(new URL(import.meta.url).pathname);
const original='/Users/nikabot/.dsh/attachments/v1/objects/11/117a05aff259f7eb24afae9df5c5415391530367568b7c38fa2c7eed73eed785';
await fs.copyFile(original,path.join(out,'generated-original.png'));
const source='data:image/png;base64,'+(await fs.readFile(original)).toString('base64');
const variants=[{id:'A',name:'软紫',rgb:[165,143,213]},{id:'B',name:'莓粉',rgb:[226,137,164]},{id:'C',name:'晴蓝',rgb:[104,185,212]}];
const browser=await chromium.launch({headless:true});
try {
 const artPage=await browser.newPage();
 for(const v of variants){
  const data=await artPage.evaluate(async({source,rgb})=>{
   const image=new Image();image.src=source;await image.decode();
   const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
   x.drawImage(image,44,44,424,424);
   const p=x.getImageData(0,0,512,512);
   for(let i=0;i<p.data.length;i+=4){const r=p.data[i],g=p.data[i+1],b=p.data[i+2];
    if(p.data[i+3] && b>g+12 && b>r+8){const shade=(r+g+b)/3/184; for(let k=0;k<3;k++)p.data[i+k]=Math.min(255,Math.round(rgb[k]*shade));}
   }
   x.putImageData(p,0,0);return c.toDataURL('image/png');
  },{source,rgb:v.rgb});
  v.data=data;
  await fs.writeFile(path.join(out,`${v.id}.png`),Buffer.from(data.split(',')[1],'base64'));
  await fs.writeFile(path.join(out,`${v.id}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>惊喜答题配色${v.id}（评审稿）</title><image width="512" height="512" href="${data}"/></svg>\n`);
 }
 await artPage.close();
 const metrics=[];
 for(const size of [{id:'mobile',width:390,height:844},{id:'desktop',width:1280,height:900}]){
  const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:2,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('sq_data_version','9');localStorage.setItem('sq_entry_visibility',JSON.stringify({'mini-garage-prototype':true,'builtin-trivia':false}));localStorage.setItem('sq_stars',JSON.stringify([{id:'preview-only',timestamp:1700000000000,type:'earn',amount:28,source:'预览模拟',kind:'main',childId:'default'}]));});
  await context.route('**/api/**',r=>r.abort());
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173/#/',{waitUntil:'networkidle'});await page.locator('.game-sticker').waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{
   const original=document.querySelector('.game-sticker');const clone=original.cloneNode(true);clone.classList.add('surprise-preview');clone.setAttribute('aria-label','惊喜答题（视觉预览）');clone.style.right='calc(var(--touch-sm) + var(--space-sm))';original.before(clone);
  });
  for(const v of variants){
   await page.evaluate(data=>document.querySelector('.surprise-preview img').src=data,v.data);await page.locator('.surprise-preview img').evaluate(img=>img.decode());
   await page.screenshot({path:path.join(out,`${size.id}-${v.id}.png`),animations:'disabled'});
  }
  metrics.push(await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {viewport:innerWidth,car:box('.game-sticker:not(.surprise-preview)'),surprise:box('.surprise-preview'),balance:box('.home-big-star'),overflow:document.documentElement.scrollWidth>innerWidth};}));
  await context.close();
 }
 await fs.writeFile(path.join(out,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
 console.log(JSON.stringify(metrics,null,2));
} finally {await browser.close();}
