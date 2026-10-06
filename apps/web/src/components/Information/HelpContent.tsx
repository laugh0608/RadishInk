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
        草稿保存在当前站点的浏览器本地。清理浏览器数据、切换域名或设备可能无法继续读取原草稿。Web
        文件栏提供“导入 Markdown”和“导出”：支持 UTF-8 的 .md / .markdown
        单文件，最大 5
        MiB；导入新建文章，同名自动编号，导出包含尚未自动保存的最新编辑。
      </p>
      <p>
        Markdown
        文件只携带正文和文章元数据，不包含图片、附件、自定义主题样式、全部历史或设置。相对路径可能无法显示图片；请另行备份资源，使用目录工作区时另行备份原目录。下载发起后请在浏览器中确认文件已保存。
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
      <h2>图片与图床</h2>
      <p>
        默认不上传图片。已有图片链接可以直接插入；要粘贴、拖入或选择本地图片，先打开“图床设置”，填写自己的服务配置并启用。关闭上传会保留图床设置，方便下次使用。
      </p>
      <p>
        图片会直接发往所选图床。对象存储的连接测试可能写入并删除测试文件。自定义接口只检查地址格式，实际可用性以首次上传为准。
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
