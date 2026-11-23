const {chromium}=require('playwright');
const fs=require('node:fs');
const base=process.argv[2]||'http://127.0.0.1:8743/';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
 const page=await browser.newPage({viewport:{width:1380,height:820}});
 fs.mkdirSync('exterior-qa',{recursive:true});
 const prefix='https://cdn.jsdelivr.net/npm/three@0.160.0/';
 const threeRoot=require('node:path').resolve(require.resolve('three'),'../..');
 await page.route(prefix+'**',route=>route.fulfill({path:require('node:path').join(threeRoot,route.request().url().slice(prefix.length)),contentType:'text/javascript'}));
 await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure().errorText));
 await page.goto(base+'?view=left&body=solid',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__sim && document.querySelector('#loading').hidden,{},{timeout:22000}).catch(e=>{throw Error(e.message+' '+errors.join(' | '))});
 const assert = require('node:assert/strict');
 await page.evaluate(()=>{window.__sim.setPlaying(false);window.__sim.seek(0)});
 const slider = page.locator('#bodyT');
 const dot = () => page.evaluate(() => {
   const i = [...document.querySelectorAll('#overlay .lbl')].findIndex(e=>e.textContent==='Trigger');
   const c = document.querySelectorAll('#leaders circle')[i];
   return [Number(c.getAttribute('cx')),Number(c.getAttribute('cy'))];
 });
 for (const side of ['left','right']) {
   await page.click('button[data-view="'+side+'"]');await page.waitForTimeout(850);
   await slider.fill('0');await page.waitForTimeout(250); const solid=await dot();
   await slider.fill('50');await page.waitForTimeout(250); const blend=await dot();
   assert.ok(Math.hypot(blend[0]-solid[0],blend[1]-solid[1])<2);
   await page.screenshot({path:'exterior-qa/trigger-'+side+'.png'});
   await slider.fill('100');await page.waitForTimeout(250);const schematic=await dot();
   assert.ok(Math.hypot(schematic[0]-solid[0],schematic[1]-solid[1])>10);
   await slider.fill('50');await page.waitForTimeout(250);const restored=await dot();
   assert.ok(Math.hypot(restored[0]-solid[0],restored[1]-solid[1])<2);
   console.log(side, {solid,blend,schematic,restored});
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{ console.error(e.message.replace(/<launching>[^\n]+/g,'<launch command>'));process.exitCode=1;});
