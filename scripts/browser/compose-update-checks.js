// 配合 compose-smoke.mjs --serve；仅切换该脚本独有项目的前端配置。
// 临时 Chrome 需允许测试自签名证书；不改变系统信任或生产配置。
// prettier-ignore
async (page) => {
  const origin = "https://127.0.0.1:4185", url = origin + "/nested/";
  const context = await page.context().browser().newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
  context.setDefaultTimeout(20000);
  const errors = [], uploads = [], checks = [];
  let target, other, step = "prepare";
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const mode = async value => {
    const response = await context.request.post(`${origin}/__fixture/deployment/${value}`, { headers: { Origin: origin }, timeout: 60000 });
    ensure(response.ok(), `fixture mode ${value}: ${response.status()}`);
  };
  const inspect = () => target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r=indexedDB.open("wemd-history");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
    try {
      const read = store => new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const history=await read("history"), assets=await read("articleAssets");
      return { history, assets: await Promise.all(assets.map(async a=>({articleId:a.articleId,path:a.path,bytes:[...new Uint8Array(await a.bytes.arrayBuffer())]}))) };
    } finally { db.close(); }
  });
  try {
    await mode("static");
    target = await context.newPage();
    target.on("pageerror", e=>errors.push(e.message));
    target.on("request", r=>{if(r.method()==="PUT" && /\/api\//.test(r.url()))uploads.push(r.url());});
    await target.goto(url); await target.locator(".cm-content").waitFor();
    await target.locator(".cm-content").fill("# Runtime config update synthetic\n本地稿件");
    const png = await target.evaluate(()=>{const c=document.createElement("canvas");c.width=c.height=2;const x=c.getContext("2d");x.fillStyle="#112233";x.fillRect(0,0,2,2);return c.toDataURL().split(",")[1];});
    const choosing = target.waitForEvent("filechooser");
    await target.getByRole("button",{name:"选择图片",exact:true}).click();
    await (await choosing).setFiles({name:"synthetic.png",mimeType:"image/png",buffer:Buffer.from(png,"base64")});
    await target.waitForFunction(()=>{const i=document.querySelector('.preview-content img[src^="blob:"]');return i?.complete && i.naturalWidth===2;});
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存",{exact:true}).waitFor();
    step = "initial worker active";
    await target.evaluate(async()=>{ await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error("SW ready timeout")),20000))]); });
    await target.reload(); await target.locator(".cm-content").waitFor();
    step = "initial worker controller";
    await target.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const before = await inspect();
    ensure(before.assets.length===1,"initial asset missing");
    other=await context.newPage(); await other.goto(url); await other.locator(".cm-content").waitFor();
    await other.locator(".cm-content").press("ControlOrMeta+End"); await other.locator(".cm-content").pressSequentially(" other-unsaved");
    await target.bringToFront();
    step = "replace web runtime config";
    await mode("server");
    await target.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
    step = "new worker waiting";
    await target.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
    await target.getByText("新版本已准备好",{exact:true}).waitFor();
    await target.getByRole("button",{name:"稍后",exact:true}).click();
    ensure(await target.evaluate(()=>JSON.parse(document.getElementById("radishink-runtime-config").textContent).deployment)==="static","defer activated new config");
    await target.getByRole("button",{name:"有新版本，查看更新",exact:true}).click();
    await target.getByRole("button",{name:"保存并更新",exact:true}).click();
    await target.getByRole("alert").filter({hasText:"关闭其他"}).waitFor();
    ensure((await other.locator(".cm-content").innerText()).includes("other-unsaved"),"other tab lost input");
    await other.close(); other=null;
    checks.push("真实容器配置变化生成新 Worker；稍后不激活，多标签阻止更新且保留另一页输入");
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.locator(".cm-content").pressSequentially(" latest-before-runtime-update");
    await target.getByRole("button",{name:"保存并更新",exact:true}).click();
    step = "new runtime after reload";
    await target.waitForFunction(()=>JSON.parse(document.getElementById("radishink-runtime-config").textContent).deployment==="server");
    const after=await inspect();
    ensure(after.history.some(h=>h.markdown.includes("latest-before-runtime-update")),"latest input missing after update");
    ensure(JSON.stringify(before.assets)===JSON.stringify(after.assets),"original image bytes changed");
    ensure(uploads.length===0,"configuration change automatically uploaded local article");
    ensure(errors.length===0,errors.join(" | "));
    checks.push("确认后先保存再更新，server 配置从新缓存生效，最新正文与原图保留，无自动上传");
    await target.screenshot({path:"output/playwright/p4-runtime-update.png"});
    return {checks,errors,uploads};
  } catch(error) {
    if(target)await target.screenshot({path:"output/playwright/p4-runtime-update-failure.png"});
    const states = target ? await target.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {controller:!!navigator.serviceWorker.controller,active:r?.active?.state,waiting:r?.waiting?.state,installing:r?.installing?.state}}).catch(()=>null) : null;
    throw new Error(`${step}: ${error.message}; ${JSON.stringify(states)}; ${errors.join(" | ")}`);
  } finally { try { await mode("server"); } finally { await context.close(); } }
}
