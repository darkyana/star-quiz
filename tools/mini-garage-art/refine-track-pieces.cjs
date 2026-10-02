// Keep the reviewed metal/rubber materials; remove mounting flanges and rebuild height cues.
// Called after the original atlas cutouts are rebuilt, never on already-refined outputs.
const path=require('node:path');
module.exports=async function refineTrackPieces(sharp,root){
 const rampPath=path.join(root,'ramp.png'),stripPath=path.join(root,'slow-strip.png');
 const ramp=await sharp(rampPath).toBuffer(),strip=await sharp(stripPath).toBuffer();
 // Interior of the purple rubber: open ends, no screws, no rounded tablet frame.
 // All three rib crests retain their source material and light, across the complete width.
 await sharp(strip).extract({left:108,top:18,width:304,height:207}).resize(520,160,{fit:'fill'}).png().toFile(stripPath);
 // Isolate the existing blue metal slope instead of regenerating a different material.
 const mask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="248" height="354"><path d="M49 5H199L226 299Q227 307 211 314L208 346H40L37 316Q21 309 22 299Z" fill="white"/></svg>`);
 const top=await sharp(ramp).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
 // A tapered wedge sidewall, not a flat plate bolted into the road. The raised end
 // has depth, while both sidewalls taper into the thin ground-level entry lip.
 const body=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="380" viewBox="0 0 280 380"><defs>
 <linearGradient id="right" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#c6cfca"/><stop offset=".38" stop-color="#728c8b"/><stop offset="1" stop-color="#294c56"/></linearGradient>
 <linearGradient id="left" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#e2ece3"/><stop offset=".55" stop-color="#b5cec7"/><stop offset="1" stop-color="#6d8e8e"/></linearGradient>
 <linearGradient id="edge" x2="0" y2="1"><stop stop-color="#d1e1d7"/><stop offset="1" stop-color="#60818a"/></linearGradient>
 </defs>
 <path d="M61 15L48 33L31 332L52 358L55 346L46 306Z" fill="url(#left)" stroke="#65808a" stroke-width="1"/>
 <path d="M211 15L236 41L257 327L224 358L217 344L237 306Z" fill="url(#right)" stroke="#3b6270" stroke-width="1"/>
 <path d="M61 15H211L236 41H48Z" fill="url(#edge)"/>
 <path d="M213 22L239 315L224 351" fill="none" stroke="#dce9df" stroke-opacity=".7" stroke-width="1.5"/>
 <path d="M238 84L249 291M243 166L253 313" stroke="#264c59" stroke-width="2" stroke-opacity=".45"/>
 <path d="M52 357H224" stroke="#a8c7c7" stroke-width="4"/>
 </svg>`);
 await sharp(body).composite([{input:top,left:12,top:10}]).png().toFile(rampPath);
};
