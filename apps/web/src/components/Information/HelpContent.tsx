import { useInformationDialogStore } from "../../store/informationDialogStore";

const syntaxRows = [
  ["标题", ["# 一级标题", "## 二级标题"]],
  ["强调", ["**粗体**", "*斜体*", "~~删除线~~"]],
  ["扩展标记", ["++下划线++", "==高亮==", "H~2~O", "x^2^"]],
  ["引用与提示", ["> 引用", "> [!NOTE]"]],
  ["列表", ["- 无序项", "1. 有序项", "- [ ] 任务"]],
  ["链接", ['[文字](https://example.com "脚注说明")']],
  ["图片", ["![说明](https://example.com/image.png)"]],
  ["行内代码", ["`代码`"]],
  ["数学公式", ["$E=mc^2$", "$$ 独立公式 $$"]],
  ["属性", ["**文字**{.class}", "{.class #id}"]],
] as const;

export function HelpContent() {
  const open = useInformationDialogStore((state) => state.open);
  return (
    <>
      <h2 tabIndex={-1} data-information-heading>
        从写作到公众号
      </h2>
      <p className="information-lead">
        在左侧编辑，右侧预览，选择喜欢的排版后复制。
      </p>
      <ol>
        <li>输入或粘贴 Markdown，选择主题、字体和字号。</li>
        <li>点击“复制到公众号”，在公众号编辑器中粘贴并检查格式。</li>
        <li>
          保存发布前，检查图片、表格、公式和代码块，并用微信预览确认效果。
        </li>
      </ol>
      <h2>草稿与备份</h2>
      <p>
        浏览器模式的草稿保存在当前站点，清理浏览器数据、切换域名或设备可能无法继续读取。
        本地文件夹模式保存到已授权目录。Web 顶栏“文件”菜单（手机在“更多功能”中）
        提供文章 ZIP 与 Markdown
        导入、导出；导入总是新建文章，导出包含点击时尚未自动保存的最新编辑。
      </p>
      <p>
        文章 ZIP 包含一篇文章的 index.md 和 asset/ 图片，支持两种存储往返；
        包体与展开总量各不超过 64 MiB、最多 128 条目，正文不超过 5 MiB。
        支持本产品的单文章格式，不支持批量、加密包或任意附件。
        缺图或读取失败会停止 ZIP 导出，外链保留且仍需网络。
      </p>
      <p>
        仅 Markdown 导出支持 UTF-8 的 .md / .markdown、最大 5 MiB，
        不包含图片。两种文件格式都不包含自定义主题样式、全部历史或站点设置，
        不是整个工作区备份。下载发起后请在浏览器中确认文件已保存。
      </p>
      <h2 id="information-syntax" tabIndex={-1}>
        Markdown 语法速查
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col">用途</th>
            <th scope="col">写法</th>
          </tr>
        </thead>
        <tbody>
          {syntaxRows.map(([label, examples]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                {examples.map((example, index) => (
                  <span key={example}>
                    {index > 0 && "、"}
                    <code>{example}</code>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        独立公式的上下各放一行 <code>$$</code>；块级属性放在块尾。
      </p>
      <p>
        代码块使用三反引号围起，并在开头注明语言；Mermaid 图使用{" "}
        <code>mermaid</code>。
      </p>
      <pre>{"```javascript\nconsole.log('Hello, RadishInk!');\n```"}</pre>
      <h2>文章图片</h2>
      <p>
        在浏览器文章或本地文章目录中，可粘贴图片文件或点击“选择图片”。支持
        PNG、JPEG、WebP、GIF，保存原字节；单图最多 10 MiB、1600 万像素，每次最多
        10 张、合计 32
        MiB。拖入图片暂未开放，旧单文件请先从“目录维护与恢复”复制为文章目录。
      </p>
      <p>
        图片写入成功后才插入相对引用；处理中可继续输入或取消，删除引用不会立即删除图片字节。含本地图片时，HTML
        和公众号复制会明确停止，避免复制无法访问的临时地址；不会自动上传。
        请先导出文章
        ZIP、解压保留原图，再在公众号编辑器中手工插入；真实公众号转存效果仍需逐次检查。
      </p>
      <h2>复制后的检查</h2>
      <p>
        复制成功表示浏览器完成了复制操作，公众号可能继续清洗样式或转存图片。代码块装饰图与内置示例图由当前站点提供；本机地址无法供公众号下载，正式使用须在公众号可访问的部署地址上验收。
      </p>
      <p>
        遇到问题可先复制并保存草稿源文，再通过{" "}
        <a
          href="https://github.com/laugh0608/RadishInk/issues/new"
          target="_blank"
          rel="noopener noreferrer"
        >
          问题反馈
        </a>{" "}
        提供脱敏示例。不要在反馈中附上密钥或真实私密文章。
      </p>
      <button
        type="button"
        className="information-text-link"
        onClick={() => open("about")}
      >
        来源、许可与数据说明
      </button>
    </>
  );
}
