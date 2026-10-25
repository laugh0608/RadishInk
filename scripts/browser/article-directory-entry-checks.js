// 产品目录入口 + 原生 OPFS；目录选择器注入合成句柄，不作为系统授权证据。
// prettier-ignore
async (page) => {
  // 当前 CLI 的 waitForFunction 不等待 async 谓词；evaluate 显式 await 后轮询，失败仍超时抛错。
  const waitForAsync = async (targetPage, predicate, arg = null, options = {}) => {
    const deadline = Date.now() + (options.timeout || 30000);
    while (Date.now() < deadline) {
      if (await targetPage.evaluate(predicate, arg)) return;
      await targetPage.waitForTimeout(50);
    }
    throw new Error("异步状态等待超时：" + predicate.toString());
  };

  const context = await page.context().browser().newContext({acceptDownloads:true});
  const checks=[]; let target; let step="setup";
  const origin = new URL(page.url()).origin;
  const rootName = "radishink-p2a-prototype-product-" + Date.now();
  const ensure = (value, message) => {if(!value) throw new Error(message);};
  try {
    await context.addInitScript(name => {window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name,{create:true});},rootName);
    target = await context.newPage();
    await target.route(origin+"/",r=>r.fulfill({contentType:"text/html",body:"Synthetic setup"}));
    await target.goto(origin);
    await target.evaluate(async name => {
      const root=await (await navigator.storage.getDirectory()).getDirectoryHandle(name,{create:true});
      const handle=await root.getFileHandle("legacy.md",{create:true}); const writer=await handle.createWritable(); await writer.write("\uFEFF---\r\ncustomFlag: retained\r\n---\r\n\r\n# 旧文合成正文\r\n"); await writer.close();
      localStorage.setItem("wemd-storage-adapter",JSON.stringify({type:"filesystem",identifier:"synthetic-directory"}));
      // 启动恢复只查询已持久化句柄，不再自动弹选择器。
      const db = await new Promise((resolve,reject)=>{const request=indexedDB.open("wemd-fs-handles",1);request.onupgradeneeded=()=>request.result.createObjectStore("handles");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const tx=db.transaction("handles","readwrite");tx.objectStore("handles").put(root,"fs-handle-synthetic-directory");
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
    },rootName);
    await target.unroute(origin+"/"); await target.reload();
    await target.getByRole("button",{name:"目录维护与恢复",exact:true}).waitFor();
    await target.locator(".cm-content").waitFor();
    await target.waitForFunction(()=>document.querySelector(".cm-content")?.textContent.includes("旧文合成正文"));
    ensure((await target.locator(".cm-content").innerText()).includes("旧文合成正文"),"未读取旧文");
    await target.locator("body").ariaSnapshot();
    await target.getByRole("button",{name:"目录维护与恢复",exact:true}).click();
    await target.getByRole("button",{name:"复制为文章目录",exact:true}).click();
    await waitForAsync(target, async () => (await import("/src/store/fileStore.ts")).useFileStore.getState().files.some(f=>f.articlePackage));
    await target.getByRole("button",{name:"关闭",exact:true}).click();
    const legacy = await target.evaluate(async name => {const root=await (await navigator.storage.getDirectory()).getDirectoryHandle(name);return await (await (await root.getFileHandle("legacy.md")).getFile()).text();},rootName);
    ensure(legacy.includes("customFlag: retained")&&legacy.includes("旧文合成正文"),"旧文复制改变原件");
    checks.push("产品旧文复制入口，原件保留，新包进入文章列表");
    step="create";
    await target.getByRole("button",{name:"新建文章",exact:true}).click();
    await waitForAsync(target, async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile?.articlePackage);
    const path = await target.evaluate(async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile.path);
    await target.locator(".cm-content").fill("# 目录产品保存正文\n"); await target.locator(".cm-content").press("ControlOrMeta+s");
    await waitForAsync(target, async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().lastSavedContent.includes("目录产品保存正文"));
    ensure(await target.evaluate(()=>localStorage.getItem("wemd-last-file-path"))===path,"last path before reload does not match "+path);
    step="reload";
    await target.reload(); await target.locator(".cm-content").waitFor();
    await target.waitForFunction(()=>document.querySelector(".cm-content")?.textContent.includes("目录产品保存正文"));
    ensure((await target.locator(".cm-content").innerText()).includes("目录产品保存正文"),"原生目录重开未恢复保存");
    checks.push("产品新建目录包、快捷键实际写入、原生持久化句柄刷新重开");
    step="import";
    await target.getByRole("button",{name:"文件",exact:true}).click();
    const chooserEvent=target.waitForEvent("filechooser"); await target.getByRole("menuitem",{name:"导入 Markdown 为新文章…",exact:true}).click();
    await (await chooserEvent).setFiles({name:"synthetic-directory-import.md",mimeType:"text/markdown",buffer:Buffer.from("---\nunknownFlag: keep\n---\n\n# 目录导入合成正文\n")});
    await target.waitForFunction(()=>document.querySelector(".cm-content")?.textContent.includes("目录导入合成正文"));
    let importPath=await target.evaluate(async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile.path);
    ensure(importPath.endsWith("/index.md")&&importPath!==path,"导入没有形成独立文章包");
    // 原生 Writable close 注入故障，不修改真实磁盘和用户目录。
    await target.evaluate(()=>{const original=FileSystemFileHandle.prototype.createWritable;window.__originalWritable=original;FileSystemFileHandle.prototype.createWritable=async function(...args){const stream=await original.apply(this,args);if(this.name==="index.md")stream.close=async()=>{throw new DOMException("synthetic disk full","QuotaExceededError");};return stream;};});
    await target.locator(".cm-content").fill("# 未完成写入合成正文\n"); await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText(/目录操作未完成：synthetic disk full/).waitFor();
    ensure((await target.locator(".cm-content").innerText()).includes("未完成写入"),"失败丢失当前编辑");
    await target.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=window.__originalWritable;});
    await target.getByRole("button",{name:"目录维护与恢复",exact:true}).click();
    const card=target.locator(".directory-maintenance-item").filter({hasText:importPath});
    await card.getByRole("button",{name:"恢复未完成写入",exact:true}).click();
    await target.getByRole("checkbox").check(); await target.getByRole("button",{name:"重新读取当前文章",exact:true}).click();
    await waitForAsync(target, async()=>!(await import("/src/store/fileStore.ts")).useFileStore.getState().isDirty);
    await target.waitForFunction(() => {const panel=document.querySelector(".modal-panel");return panel && getComputedStyle(panel).opacity === "1" && !document.querySelector('[role="status"][aria-live="polite"]');});
    await target.getByRole("dialog").screenshot({path:"output/playwright/p2a-directory-recovery.png"});
    await target.getByRole("button",{name:"关闭",exact:true}).click();
    ensure((await target.locator(".cm-content").innerText()).includes("未完成写入"),"恢复未向前完成");
    checks.push("文件选择器导入成新包；原生 close 故障保持编辑、恢复界面向前完成写入");
    await target.locator(".fs-item.active .fs-action-trigger").click();
    await target.getByRole("button",{name:"重命名",exact:true}).click();
    await target.locator(".fs-rename input").fill("目录包改标题"); await target.locator(".fs-rename").getByRole("button",{name:"确认",exact:true}).click();
    await waitForAsync(target, async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile?.title === "目录包改标题");
    ensure(await target.evaluate(async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile.path) === importPath,"改标题改变存储身份");
    await target.getByRole("button",{name:"新建文件夹",exact:true}).click(); await target.getByPlaceholder("输入文件夹名称").fill("合成归档"); await target.getByRole("button",{name:"创建",exact:true}).click();
    await target.getByText("合成归档",{exact:true}).waitFor();
    await target.locator(".fs-item.active .fs-action-trigger").click(); await target.getByRole("button",{name:"移动到...",exact:true}).click();
    await target.locator(".fs-submenu").getByRole("button",{name:"合成归档",exact:true}).click();
    await waitForAsync(target, async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile?.path.startsWith("合成归档/"));
    importPath = await target.evaluate(async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile.path);
    await target.locator(".cm-content").fill("# 移动后保存正文\n"); await target.locator(".cm-content").press("ControlOrMeta+s");
    await waitForAsync(target, async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().lastSavedContent.includes("移动后保存正文"));
    checks.push("产品改标题保持目录身份，菜单整包移动后可以继续保存");
    step="external-write";
    await target.evaluate(async({name,path})=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle(name);let folder=root;for(const part of path.split("/").slice(0,-1)) folder=await folder.getDirectoryHandle(part);window.__externalFile=await folder.getFileHandle("index.md");const writer=await window.__externalFile.createWritable();await writer.write("# 外部改写合成正文\n");await writer.close();window.__externalInitial=await(await window.__externalFile.getFile()).text();},{name:rootName,path:importPath});
    await target.locator(".cm-content").fill("# 冲突中的当前编辑\n");await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText(/目录操作未完成：正文已被外部修改/).waitFor();
    ensure((await target.locator(".cm-content").innerText()).includes("冲突中的当前编辑"),"冲突覆盖编辑器");
    step="external-read";
    const disk=await target.evaluate(async()=> (await window.__externalFile.getFile()).text());
    ensure(disk.includes("外部改写"),"冲突覆盖磁盘");
    checks.push("外部编辑冲突保留磁盘和编辑器两份内容，提示可下载正文");
    await target.getByRole("button",{name:"目录维护与恢复",exact:true}).click();
    await target.getByRole("button",{name:"另存当前编辑并切换副本",exact:true}).click();
    await waitForAsync(target, async()=> (await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile?.title.endsWith("（冲突副本）"));
    await target.getByRole("button",{name:"关闭",exact:true}).click();
    ensure((await target.locator(".cm-content").innerText()).includes("冲突中的当前编辑"),"另存丢失编辑");
    await target.locator(".fs-item.active .fs-action-trigger").click();await target.getByRole("button",{name:"删除",exact:true}).click();
    await target.getByText(/正文、asset\/ 和控制记录将整包删除/).waitFor();await target.getByRole("button",{name:"确认删除",exact:true}).click();
    await waitForAsync(target, async()=>!(await import("/src/store/fileStore.ts")).useFileStore.getState().currentFile);
    checks.push("冲突另存并切换保留编辑；产品确认删除整包，保留恢复副本");
    return {checks};
  } catch(error) {throw new Error(step+": "+JSON.stringify(checks)+": "+String(error)+"\n"+(target?JSON.stringify(await target.evaluate(async()=>({externalInitial:window.__externalInitial,last:localStorage.getItem("wemd-last-file-path"),state:(await import("/src/store/fileStore.ts")).useFileStore.getState()})))+"\nTREE:"+JSON.stringify(await target.evaluate(async name=>{try{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle(name);const out=[];const scan=async(d,p)=>{for await(const e of d.values()){out.push(p+e.name);if(e.kind==="directory"&&!e.name.startsWith("."))await scan(await d.getDirectoryHandle(e.name),p+e.name+"/");}};await scan(root,"");return out;}catch(e){return String(e);}},rootName))+"\n"+await target.locator("body").innerText():""));}
  finally {if(target) await target.evaluate(async name=>{await(await navigator.storage.getDirectory()).removeEntry(name,{recursive:true});},rootName).catch(()=>{});await context.close();}
}
