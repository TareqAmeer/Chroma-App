import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
try {
 const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
 const original=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 try{
  for(const width of [1440,1024])for(const light of [false,true]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(light=>{document.getElementById('cs-modal-ov')?.remove();document.body.classList.toggle('light',light);fxSection('local');mskSel=0;mskRebuild()},light);
   for(const setting of ['Feather','Density']){
    const input=page.locator(`input[oninput*="mskBrush${setting}"]`);await input.scrollIntoViewIfNeeded();
    const geometry=await input.evaluate(el=>{const input=el.getBoundingClientRect(),row=el.closest('.fx-row'),label=row.querySelector('.fx-label').getBoundingClientRect();return {width:input.width,height:input.height,left:input.left,right:input.right,labelRight:label.right,labelBottom:label.bottom,top:input.top,viewport:innerWidth}});
    assert.ok(geometry.width>=28&&geometry.height>=28,`${setting} target floor ${JSON.stringify(geometry)}`);
    assert.ok(geometry.left>=0&&geometry.right<=geometry.viewport&&(geometry.labelRight<=geometry.left||geometry.labelBottom<=geometry.top),`${setting} label/viewport ${JSON.stringify(geometry)}`);
    await input.evaluate(el=>{el.value='37';el.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await page.evaluate(name=>name==='Feather'?mskBrushFeather:mskBrushDensity,setting),37);
   }
   await page.screenshot({path:`test/output/brush-settings-${width}-${light?'light':'dark'}.png`});
  }
  console.log('PASS native brush setting label order, target size, viewport fit and input wiring: 2 themes × 2 widths');
 }finally{await page.setViewportSize(original)}
}finally{await browser.close()}
