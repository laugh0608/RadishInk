import { useUITheme } from "../../hooks/useUITheme";
import { resolveAppAssetPath } from "../../utils/assetPath";
import { PRODUCT_VERSION } from "../../config/productVersion";

export function AboutContent() {
  const theme = useUITheme((state) => state.theme);
  return (
    <>
      <header className="information-brand">
        <img
          src={resolveAppAssetPath(
            theme === "dark" ? "favicon-light.svg" : "favicon-dark.svg",
          )}
          alt=""
        />
        <div>
          <h2 tabIndex={-1} data-information-heading>
            RadishInk · 萝卜墨笺
          </h2>
          <p className="information-lead">专注写作，轻松排版。</p>
          <p>当前版本：{PRODUCT_VERSION}</p>
        </div>
      </header>
      <p>
        在浏览器中写
        Markdown、选择主题并复制到微信公众号。草稿保存在当前站点的浏览器里，无需登录；换设备、域名或浏览器不会自动同步，请及时备份源文。
      </p>
      <h2>数据与外部服务</h2>
      <ul>
        <li>
          页面不加载统计或广告脚本。内置字体、公式引擎、示例图和装饰图随站点提供。
        </li>
        <li>
          图片上传默认关闭。自行配置并启用图床后，上传操作会将图片发送到该服务。文章里已有的外链图片仍会向其所在网站请求内容。
        </li>
        <li>
          AI
          默认关闭。开启后，执行写作操作会将相应文本发送到你选择的服务商；测试连接、打开及刷新模型列表也会联系该服务商。
        </li>
        <li>
          图床凭据与 AI Key
          保存在当前浏览器中。浏览器本地存储不等于加密保险箱，请使用权限受限的凭据，勿在公共设备保存长期密钥。
        </li>
      </ul>
      <h2>来源与许可</h2>
      <p>
        RadishInk 基于{" "}
        <a
          href="https://github.com/tenngoxars/WeMD"
          target="_blank"
          rel="noopener noreferrer"
        >
          WeMD
        </a>{" "}
        演进，保留上游版权与许可。上游导入基线为 <code>70835e1</code>，其 Web
        包版本为 1.5.3；这不是 RadishInk 的发布版本。
      </p>
      <p>
        RadishInk 新增自有内容采用{" "}
        <a
          href={resolveAppAssetPath("licenses/RadishInk-LICENSE.txt")}
          target="_blank"
          rel="noopener noreferrer"
        >
          源码可见许可
        </a>
        ：允许查看学习，修改、再分发、自行部署或提供软件服务需另行授权。切换前内容保留原许可，WeMD
        与第三方内容不受新增限制。
      </p>
      <p>
        你可以正常使用官方或获授权站点写作、排版并发布自己的文章，包括商业文章，也可使用应用复制或导出的排版结果；文章内容归你所有，其中第三方材料仍遵守各自许可。
      </p>
      <p>
        <a
          href={resolveAppAssetPath("licenses/WeMD-LICENSE.txt")}
          target="_blank"
          rel="noopener noreferrer"
        >
          WeMD MIT 许可证原文
        </a>{" "}
        · Copyright (c) 2025 WeMD Team
      </p>
      <p>
        应用还使用 React、Vite、CodeMirror、KaTeX、MathJax、Mermaid、Lucide
        等项目，以及 Maple Mono、JetBrains Mono、Space Grotesk
        字体；感谢这些项目的贡献。第三方组件沿用各自许可。
      </p>
      <p>
        <a
          href={resolveAppAssetPath("fonts/maple-mono/LICENSE")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Maple Mono 许可
        </a>{" "}
        ·{" "}
        <a
          href={resolveAppAssetPath("licenses/third-party-notices.txt")}
          target="_blank"
          rel="noopener noreferrer"
        >
          第三方许可与声明
        </a>
      </p>
      <h2>联系与反馈</h2>
      <p>
        <a
          href="https://github.com/laugh0608/RadishInk"
          target="_blank"
          rel="noopener noreferrer"
        >
          项目仓库
        </a>{" "}
        ·{" "}
        <a
          href="https://github.com/laugh0608/RadishInk/issues/new"
          target="_blank"
          rel="noopener noreferrer"
        >
          问题反馈
        </a>{" "}
        · <a href="mailto:luobo@radishx.com">luobo@radishx.com</a>
      </p>
    </>
  );
}
