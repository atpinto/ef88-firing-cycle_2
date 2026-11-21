const {chromium}=require('playwright');
const fs=require('node:fs');
const base=process.argv[2]||'http://127.0.0.1:8743/';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1380,height:820}});
 fs.mkdirSync('exterior-qa',{recursive:true});
 const prefix='https://cdn.jsdelivr.net/npm/three@0.160.0/';
 const threeRoot=require('node:path').resolve(require.resolve('three'),'../..');
 await page.route(prefix+'**',route=>route.fulfill({path:require('node:path').join(threeRoot,route.request().url().slice(prefix.length)),contentType:'text/javascript'}));
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure().errorText));
 await page.goto(base+'?view=left&body=solid',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__sim && document.querySelector('#loading').hidden,{},{timeout:22000}).catch(e=>{throw Error(e.message+' '+errors.join(' | '))});
 await page.evaluate(()=>window.__sim.setPlaying(false));await page.click('button[data-l="off"]');
 await page.screenshot({path:'exterior-qa/live-left.png'});
 await page.click('button[data-view="right"]');
 await page.waitForTimeout(750);await page.screenshot({path:'exterior-qa/live-right.png'});
 await page.click('button[data-view="top"]');
 await page.waitForTimeout(750);await page.screenshot({path:'exterior-qa/live-top.png'});
 await page.click('button[data-view="left"]');await page.click('button[data-b="see"]');
 await page.waitForTimeout(750);await page.screenshot({path:'exterior-qa/live-see.png'});
 const active=await page.locator('button[data-view="left"]').getAttribute('aria-pressed');
 const see=await page.locator('button[data-b="see"]').getAttribute('aria-pressed');
 console.log(JSON.stringify({active,see,errors}));
 if(active!=='true'||see!=='true'||errors.length) process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{ console.error(e.message.replace(/<launching>[^\n]+/g,'<launch command>'));process.exitCode=1;});
