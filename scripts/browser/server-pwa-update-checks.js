// Playwright CLI run-code --filename; compose-smoke --serve --pwa-builds <root>.
// Immutable Vite/Workbox builds; injected failures affect only this synthetic context.
// prettier-ignore
async (page) => {
  const browser=page.context().browser(), checks=[], errors=[];
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  context.setDefaultTimeout(25000);
  const target=await context.newPage(), origin='https://127.0.0.1:4185', url=origin+'/nested/';
  const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
  let step='setup', other;const title='P4 PWA '+Date.now();
  target.on('pageerror',e=>errors.push(e.message));
  const select=async build=>{const r=await context.request.post(origin+'/__fixture/build/'+build,{headers:{Origin:origin},timeout:90000});ensure(r.ok(),'build switch failed');};
  const ready=()=>target.locator('.cm-content').waitFor();
  const update=()=>target.getByRole('button',{name:'保存并更新',exact:true}).click();
  const alert=text=>target.getByRole('complementary',{name:'应用更新'}).getByRole('alert').filter({hasText:text}).waitFor();
  const menu=async name=>{await target.getByRole('button',{name:'文件',exact:true}).click();await target.getByRole('menuitem',{name,exact:true}).click();};
  const api=async path=>{
    const session=await(await context.request.get(url+'api/v1/auth/session')).json();
    return context.request.get(url+'api/v1'+path,{headers:{'X-RadishInk-Workspace':`${session.deploymentId}/${session.workspaceEpoch}`}});
  };
  const waiting=async()=>ensure(await target.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting),'failure activated Worker');
  const append=async text=>{await target.locator('.cm-content').press('ControlOrMeta+End');await target.locator('.cm-content').pressSequentially(text);};
  const imageReady=()=>target.waitForFunction(()=>{const image=document.querySelector('.preview-content img[src^="blob:"]');return image?.complete&&image.naturalWidth===2;});
  const paste=()=>target.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle=window.__pasteIndex?'#ff9900':'#3399aa';window.__pasteIndex=1;ctx.fillRect(0,0,2,2);
    const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'synthetic.png',{type:'image/png'}));
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));
  });
  try {
    await select('new');await target.goto(url);
    await target.getByRole('textbox',{name:'用户名',exact:true}).fill('alice');
    await target.getByRole('textbox',{name:'密码',exact:true}).fill('synthetic-web-password');
    await target.getByRole('button',{name:'登录',exact:true}).click();await ready();
    await target.evaluate(async()=>{await navigator.serviceWorker.ready;});await target.reload();await ready();
    await target.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const created=target.waitForResponse(r=>r.request().method()==='PUT'&&r.status()===201);
    await target.getByRole('button',{name:'新建文章',exact:true}).click();
    const id=new URL((await created).url()).pathname.split('/').at(-1);
    await target.locator('.cm-content').filter({hasText:'新文章'}).waitFor();
    await target.locator('.fs-item.active .fs-action-trigger').click();await target.getByRole('button',{name:'重命名',exact:true}).click();await target.locator('.fs-rename input').fill(title);await target.locator('.fs-rename').getByRole('button',{name:'确认',exact:true}).click();await target.locator('.fs-item.active .fs-title').filter({hasText:title}).waitFor();
    await target.locator('.cm-content').fill('---\ncustomFlag: server-pwa-preserved\n---\n# P4 server PWA\n');
    await target.locator('.cm-content').press('ControlOrMeta+s');await target.getByText('刚刚保存',{exact:true}).waitFor();
    await append('\n');await paste();await imageReady();
    await target.locator('.cm-content').press('ControlOrMeta+s');await target.getByText('刚刚保存',{exact:true}).waitFor();
    step='multi-tab';other=await context.newPage();await other.goto(url);await other.locator('.cm-content').waitFor();
    await other.locator('.cm-content').press('ControlOrMeta+End');await other.locator('.cm-content').pressSequentially(' second-tab-unsaved');
    await select('next');await target.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
    await target.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
    await target.getByText('新版本已准备好',{exact:true}).waitFor();await target.getByRole('button',{name:'稍后',exact:true}).click();
    ensure(await target.evaluate(()=>document.documentElement.dataset.pwaFixture)==='new','defer activated');
    await target.getByRole('button',{name:'有新版本，查看更新',exact:true}).click();await update();await alert('关闭其他');
    ensure((await other.locator('.cm-content').innerText()).includes('second-tab-unsaved'),'other input lost');
    await other.close();other=null;await target.bringToFront();await ready();checks.push('服务器文章：延后不激活，多标签阻断并保留输入');
    step='image busy';await target.evaluate(()=>{const original=window.createImageBitmap, pending=[];window.createImageBitmap=(...args)=>new Promise((resolve,reject)=>{pending.push(()=>original(...args).then(resolve,reject));window.__releaseImage=()=>pending.splice(0).forEach(run=>run());});window.__restoreImage=()=>{window.createImageBitmap=original;};});
    await append('\n');await paste();await target.waitForFunction(()=>!!window.__releaseImage);await update();await alert('图片或文件操作尚未结束');
    await target.evaluate(()=>{window.__restoreImage();window.__releaseImage();});
    await target.waitForFunction(()=>(document.querySelector('.cm-content')?.textContent.match(/asset\/image-/g)||[]).length===2);
    await target.getByText('刚刚保存',{exact:true}).waitFor();
    step='ZIP busy';await target.evaluate(()=>{const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){window.__releaseZip=()=>original.apply(this,args);};window.__restoreZip=()=>{Worker.prototype.postMessage=original;};});
    await menu('导出当前文章包（.zip）');await target.waitForFunction(()=>!!window.__releaseZip);await update();await alert('图片或文件操作尚未结束');
    await target.getByRole('button',{name:'取消文章包处理',exact:true}).click();await target.getByText(/文章包未导出/).waitFor();await target.evaluate(()=>window.__restoreZip());
    checks.push('图片解码及 ZIP Worker 进行中阻止更新；完成或取消后恢复');
    step='save 503';await append(' latest-server-unsaved');
    const failSave=route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'synthetic unavailable'}})}):route.continue();
    await target.route('**/api/v1/articles/**',failSave);await update();await alert('当前文章保存失败');await waiting();
    ensure((await target.locator('.cm-content').innerText()).includes('latest-server-unsaved'),'503 lost input');
    await target.unroute('**/api/v1/articles/**',failSave);
    step='offline';await context.setOffline(true);await update();await target.getByRole('heading',{name:'工作区暂不可用',exact:true}).waitFor();await waiting();
    const rescue=target.waitForEvent('download');await target.getByRole('region',{name:'服务器会话'}).getByRole('button',{name:'下载当前正文',exact:true}).click();
    const stream=await(await rescue).createReadStream(), chunks=[];for await(const chunk of stream)chunks.push(chunk);ensure(Buffer.concat(chunks).toString('utf8').includes('latest-server-unsaved'),'offline rescue lost input');
    ensure((await target.locator('.cm-content').innerText()).includes('latest-server-unsaved'),'offline lost input');
    await context.setOffline(false);await target.waitForFunction(()=>document.querySelector('.cm-content')?.getClientRects().length||[...document.querySelectorAll('.server-session-gate button')].some(b=>b.textContent==='重新验证会话'&&!b.disabled));if(!await target.locator('.cm-content').isVisible())await target.getByRole('button',{name:'重新验证会话',exact:true}).click();await ready();checks.push('保存 503 与断网：不激活、不刷新，最新输入保留');
    step='activation timeout';await target.evaluate(()=>{const original=ServiceWorker.prototype.postMessage;ServiceWorker.prototype.postMessage=function(message,...args){if(message?.type==='RADISHINK_ACTIVATE_UPDATE'){args[0][0].postMessage({ok:true});return;}return original.call(this,message,...args);};window.__restoreActivation=()=>{ServiceWorker.prototype.postMessage=original;};});
    await update();await alert('超时');await waiting();
    ensure((await target.locator('.cm-content').innerText()).includes('latest-server-unsaved'),'timeout lost input');
    await target.evaluate(()=>window.__restoreActivation());
    const before=await(await api('/articles/'+id)).json();
    const imageBytes=await Promise.all(before.assets.map(async a=>(await(await api(`/articles/${id}/assets/${encodeURIComponent(a.path.slice(6))}?revision=${before.revision}`)).body()).toString('base64')));
    await append(' retry-latest');await update();await target.waitForFunction(()=>document.documentElement.dataset.pwaFixture==='next');await ready();await target.locator('.fs-title').filter({hasText:title}).click();await target.locator('.cm-content').filter({hasText:'retry-latest'}).waitFor();await imageReady();
    const after=await(await api('/articles/'+id)).json();
    ensure(after.markdown.includes('retry-latest')&&after.markdown.includes('customFlag: server-pwa-preserved'),'update lost draft or body marker');
    ensure(JSON.stringify(after.assets)===JSON.stringify(before.assets),'asset manifest changed');
    const afterBytes=await Promise.all(after.assets.map(async a=>(await(await api(`/articles/${id}/assets/${encodeURIComponent(a.path.slice(6))}?revision=${after.revision}`)).body()).toString('base64')));
    ensure(JSON.stringify(imageBytes)===JSON.stringify(afterBytes),'original image bytes changed');
    const privateCache=await target.evaluate(async()=>{
      const api=[];for(const key of await caches.keys())for(const r of await(await caches.open(key)).keys())if(r.url.includes('/api/'))api.push(r.url);
      if(!(await indexedDB.databases()).some(db=>db.name==='wemd-history'))return {api,privateRows:0};
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wemd-history');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      if(!db.objectStoreNames.contains('history')){db.close();return {api,privateRows:0};}
      const rows=await new Promise((resolve,reject)=>{const r=db.transaction('history').objectStore('history').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
      return {api,privateRows:rows.filter(r=>r.markdown.includes('server-pwa-preserved')).length};
    });
    ensure(!privateCache.api.length&&!privateCache.privateRows,'private server content cached locally');
    checks.push('激活超时保留内容；恢复后重试先保存最新正文，再接管重载；正文标记与原图保留，API/浏览器文章无私有副本');
    ensure(!errors.length,errors.join(' | '));await target.screenshot({path:'output/playwright/p4-server-pwa.png'});
    return {checks,errors,browser:await browser.version(),assets:after.assets.length};
  } catch(error){await target.screenshot({path:'output/playwright/p4-server-pwa-failure.png'});throw new Error(step+': '+error.message+'\n'+(await target.locator('body').innerText()).slice(-1800));}
  finally {await context.setOffline(false);await other?.close();await context.close();}
}
