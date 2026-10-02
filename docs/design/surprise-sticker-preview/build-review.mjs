import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/Users/nikabot/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const out=path.dirname(new URL(import.meta.url).pathname);
const tokens=await fs.readFile(new URL('../../../src/styles/variables.css',import.meta.url),'utf8');
const data=async name=>'data:image/png;base64,'+(await fs.readFile(path.join(out,name))).toString('base64');
const variants=[['A','软紫'],['B','莓粉'],['C','晴蓝']];
let sections='';
for(const [id,name] of variants) sections+=`<section><h2>${id} · ${name}</h2><img class="detail" src="${await data(id+'.png')}" alt="${name}问号星星放大图，无宿主描边"><p>原画细节 · 下方为首屏实际 44px 效果</p><img class="screen" src="${await data('mobile-'+id+'.png')}" alt="${name}贴纸在实际手机首屏中的效果"></section>`;
let desktops='';for(const [id,name] of variants)desktops+=`<details><summary>${id} · ${name} · 桌面首屏</summary><img class="screen" src="${await data('desktop-'+id+'.png')}" alt="${name}桌面首屏"></details>`;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>惊喜答题贴纸 · 三色评审</title><style>${tokens}
*{box-sizing:border-box}body{margin:0;padding:var(--space-md);background:var(--color-bg-night);color:var(--color-text);font-family:system-ui,sans-serif;font-size:var(--font-size-body)}h1{font-size:var(--font-size-headline);margin:0 0 var(--space-base)}h2{font-size:var(--font-size-topbar);margin:0}p{color:var(--color-text-secondary);font-size:var(--font-size-caption);margin:var(--space-base) 0 var(--space-md)}main{display:flex;gap:var(--space-md);align-items:flex-start}section{flex:1;min-width:0;text-align:center;background:var(--color-bg)}section h2{padding-top:var(--space-md)}.detail{width:calc(var(--size-star-hero) + var(--space-xl));height:auto;display:block;margin:0 auto}.screen{display:block;width:100%;height:auto}footer{padding-top:var(--space-md)}details{margin-top:var(--space-sm)}summary{cursor:pointer;padding:var(--space-sm);background:var(--color-surface)}summary:focus-visible{outline:var(--border-thin) solid var(--color-primary)}@media(max-width:600px){main{flex-direction:column}section{width:100%}}
</style><header><h1>惊喜答题 · 先看首屏，再选颜色</h1><p>同一造型，仅换配色。基于当前 App 源码的真实页面截图，临时注入入口作视觉预览；28 星为模拟数据。未改正式资源或入口逻辑。</p></header><main>${sections}</main><footer>${desktops}</footer></html>`;
await fs.writeFile(path.join(out,'review.html'),html);
const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:1266,height:1300},deviceScaleFactor:1});await page.goto('file://'+path.join(out,'review.html'));await page.evaluate(()=>document.fonts.ready);await page.locator('main').screenshot({path:path.join(out,'color-comparison.png')});}finally{await browser.close();}
