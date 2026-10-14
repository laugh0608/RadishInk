// 旧备份产品恢复与原生事务负向验证；只使用隔离上下文和合成记录。
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

  const context=await page.context().browser().newContext({acceptDownloads:true}); const checks=[];let target;
  const ensure=(v,m)=>{if(!v)throw new Error(m);};
  try {
    target=await context.newPage();await target.goto(new URL("/",page.url()).href);
    await target.getByRole("heading",{name:"文章 1 / 30",exact:true}).waitFor();
    const current=await target.evaluate(async()=>{const s=(await import("/src/store/historyStore.ts")).useHistoryStore.getState();return s.history.find(r=>r.id===s.activeId);});
    const rows=Array.from({length:31},(_,i)=>({id:`restore-${i}`,title:`恢复合成文 ${i}`,markdown:`\uFEFF---\r\ncustomFlag: retained\r\n---\r\n\r\n# 备份合成正文 ${i}\r\n`,theme:"default",themeName:"默认主题",customCSS:"",savedAt:"2026-10-14T00:00:00.000Z",extra:{preserved:i}}));
    const backup={format:"p2a-history-backup/1",databaseName:"wemd-history",version:2,records:[...rows,{...current,markdown:"不得覆盖当前文"}].map(value=>({key:value.id,value}))};
    await target.locator("body").ariaSnapshot();
    const chooser=target.waitForEvent("filechooser");await target.getByRole("button",{name:"恢复旧 JSON 备份",exact:true}).click();
    await(await chooser).setFiles({name:"synthetic-v2.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))});
    await target.getByText("备份 32 篇，将新增 31 篇，跳过 1 篇同 ID 文章。").waitFor();
    ensure(await target.getByRole("button",{name:"确认恢复缺失文章",exact:true}).isDisabled(),"未确认就能恢复");
    await target.getByRole("checkbox").check();await target.getByRole("button",{name:"确认恢复缺失文章",exact:true}).click();
    await target.getByText("已恢复 31 篇，保留现有同 ID 文章 1 篇。当前编辑未切换。").waitFor();
    await target.getByRole("heading",{name:"文章 32 / 30",exact:true}).waitFor();
    await target.waitForFunction(() => {const panel=document.querySelector(".modal-panel");return panel && getComputedStyle(panel).opacity === "1" && !document.querySelector('[role="status"][aria-live="polite"]');});
    await target.getByRole("dialog").screenshot({path:"output/playwright/p2a-backup-restore.png"});
    await target.getByRole("button",{name:"关闭",exact:true}).click();
    const result=await target.evaluate(async()=>{const s=(await import("/src/store/historyStore.ts")).useHistoryStore.getState();return {id:s.activeId,rows:s.history};});
    ensure(result.id===current.id&&!result.rows.find(r=>r.id===current.id).markdown.includes("不得覆盖"),"恢复覆盖或切走当前文");
    ensure(result.rows.find(r=>r.id==="restore-0").markdown===rows[0].markdown,"恢复改变源文");
    await target.getByText("恢复合成文 0",{exact:true}).click();await target.locator(".cm-content").fill("# 恢复后继续写\n");await target.locator(".cm-content").press("ControlOrMeta+s");
    await waitForAsync(target, async()=> (await import("/src/store/historyStore.ts")).useHistoryStore.getState().history.find(r=>r.id==="restore-0")?.markdown.includes("恢复后继续写"));
    await target.reload();await target.waitForFunction(()=>document.querySelector(".cm-content")?.textContent.includes("恢复后继续写"));ensure((await target.locator(".cm-content").innerText()).includes("恢复后继续写"),"恢复条目不能正常保存刷新");
    checks.push("真实文件选择器恢复预览/确认，31 旧文超限保留，同 ID 跳过，恢复后可编辑保存并刷新");
    const native=await target.evaluate(async()=>{
      const {openBrowserArticleDatabase}=await import("/src/storage/articles/browserArticleDatabase.ts");
      const name="radishink-p2a-prototype-restore-"+crypto.randomUUID(); const db=await openBrowserArticleDatabase(name);
      const entry=(id)=>({id,title:id,markdown:"synthetic "+id,theme:"default",themeName:"默认主题",customCSS:"",savedAt:"2026-10-14T00:00:00.000Z",createdAt:"2026-10-14T00:00:00.000Z"});
      const backup={format:"p2a-history-backup/1",databaseName:name,version:2,records:["one","two"].map(id=>({key:id,value:entry(id)}))};
      const ensure=(v,m)=>{if(!v)throw new Error(m);};const reject=async(fn)=>{try{await fn();}catch{return;}throw new Error("应失败却成功");};
      try {
        const original=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(value,key){if(this.name==="history"&&key==="two")throw new DOMException("synthetic quota","QuotaExceededError");return original.call(this,value,key);};
        try {await reject(()=>db.mergeBackup(backup,new Map()));} finally {IDBObjectStore.prototype.put=original;}
        ensure((await db.list()).length===0,"恢复配额异常未回滚全部记录");
        await db.article("existing").commit({article:entry("existing"),assets:[]},null);
        await reject(()=>db.mergeBackup(backup,new Map()));ensure((await db.list()).length===1,"过期列表恢复有部分写入");
        const expected=new Map([["existing",0]]); await db.article("existing").commit({article:{...entry("existing"),markdown:"new"},assets:[]},0);
        await reject(()=>db.mergeBackup(backup,expected));ensure((await db.list()).length===1,"过期版本恢复有部分写入");
        await db.mergeBackup(backup,new Map([["existing",1]]));ensure((await db.list()).length===3,"恢复重试失败");
        await reject(()=>db.mergeBackup({...backup,records:[backup.records[0],backup.records[0]]},new Map()));
        await reject(()=>db.mergeBackup(null,new Map()));
        return "原生 IndexedDB 恢复事务：配额故障全回滚、列表/版本变化拒绝、重试成功、重复 ID/非法备份拒绝";
      } finally {db.close();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
    });checks.push(native);return {checks};
  } catch(error){throw new Error(String(error)+"\n"+(target?await target.locator("body").innerText():""));} finally {await context.close();}
}
