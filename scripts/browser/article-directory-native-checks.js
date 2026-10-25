// 原生 OPFS 文章资源与整包恢复验证；无系统目录或真实用户数据。
// prettier-ignore
async (page) => {
  const context=await page.context().browser().newContext();const target=await context.newPage();
  try {await target.goto(new URL("/",page.url()).href);return await target.evaluate(async()=>{
    const {DirectoryArticleWorkspace}=await import("/src/storage/articles/directoryArticleWorkspace.ts");
    const {DirectoryArticleStore}=await import("/src/storage/articles/directoryArticleStore.ts");
    const {writeFile}=await import("/src/storage/articles/directoryArticleIO.ts");
    const {digest}=await import("/src/storage/articles/articleContract.ts");
    const opfs=await navigator.storage.getDirectory();const name="radishink-p2a-prototype-native-"+crypto.randomUUID();const root=await opfs.getDirectoryHandle(name,{create:true});
    const checks=[];const ensure=(v,m)=>{if(!v)throw new Error(m);};const bytes=new Blob([new Uint8Array([0,1,255,3])],{type:"image/png"});
    const article={id:crypto.randomUUID(),title:"native",markdown:"# 合成原文\n![合成](asset/synthetic.png)",theme:"default",themeName:"默认主题",customCSS:"",createdAt:"2026-10-14T00:00:00.000Z",savedAt:"2026-10-14T00:00:00.000Z"};
    let phase="create";
    try {
      await new DirectoryArticleStore(root,"native-package",article.id).commit({article,assets:[{path:"asset/synthetic.png",bytes}]},null);
      const w=new DirectoryArticleWorkspace(root);await w.read("native-package/index.md");await root.getDirectoryHandle("target",{create:true});
      phase="move";const path=await w.operate("native-package/index.md","target");phase="save moved resources";await w.write(path,"# 移动后更新\n![合成](asset/synthetic.png)");
      const moved=await root.getDirectoryHandle("target");const movedFolder=await moved.getDirectoryHandle("native-package");
      const file=await(await(await movedFolder.getDirectoryHandle("asset")).getFileHandle("synthetic.png")).getFile();
      ensure(await digest(file)===await digest(bytes),"移动后资源字节变化");checks.push("原生二进制资源整包移动，随后保存与哈希校验通过");
      phase="conflict copy";await writeFile(movedFolder,"index.md","external");const copy=await w.saveConflictCopy(path,"# 当前合成编辑");
      const reread=await new DirectoryArticleWorkspace(root).read(copy.path);ensure(reread.includes("当前合成编辑"),"冲突副本正文缺失");
      ensure(await(await(await movedFolder.getFileHandle("index.md")).getFile()).text()==="external","另存覆盖外部原件");checks.push("原生已读资源快照随冲突副本保存，原包外部版本保留");
      phase="delete recovery";await w.read(copy.path);
      const originalRemove=FileSystemDirectoryHandle.prototype.removeEntry;
      FileSystemDirectoryHandle.prototype.removeEntry=async function(child,options){if(child===copy.path.split("/")[0])throw new DOMException("synthetic denied","NotAllowedError");return originalRemove.call(this,child,options);};
      try{let rejected=false;try{await w.operate(copy.path,null);}catch{rejected=true;}ensure(rejected,"删除故障未上报");}finally{FileSystemDirectoryHandle.prototype.removeEntry=originalRemove;}
      const reopened=new DirectoryArticleWorkspace(root);const op=(await reopened.operations()).find(o=>!o.complete);ensure(!!op,"删除故障无持久日志");await reopened.recoverOperation(op.id);ensure((await reopened.operations()).find(o=>o.id===op.id).complete,"重开未恢复删除");
      await reopened.cleanupOperation(op.id);ensure(!(await reopened.operations()).some(o=>o.id===op.id),"已完成副本未显式清理");checks.push("原生删除权限故障保留副本，重建实例恢复并显式清理");
      return {checks};
    }catch(error){throw new Error(phase+": "+String(error));}finally{await opfs.removeEntry(name,{recursive:true});}
  });}finally{await context.close();}
}
