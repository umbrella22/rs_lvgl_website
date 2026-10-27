import type { ReactNode } from "react";
import { useLang, withBase } from "@rspress/core/runtime";
import { AppExample } from "./AppExample";
import { GuideLinks } from "./GuideLinks";
import "./DocsHome.css";

export function DocsHome({ children }: { children: ReactNode }) {
  const en = useLang() === "en";
  const link = (route: string) => withBase(`${en ? "/en" : ""}${route}.html`);
  const capabilities = en ? [
    ["Cargo", "Build LVGL with your project", "Cargo compiles the included LVGL 9.6 source and generates Rust bindings. Add your own lv_conf.h, C sources and fonts to the same build.", "Configure the build", "/guide/native-integration"],
    ["Rust", "Work with familiar Rust types", "Call typed widget APIs directly, or add rs_lvgl_ui to describe screens with functions and handle input with messages.", "Arrange widgets", "/guide/declarative-ui"],
    ["Features", "Choose the widgets you need", "Enable widgets, fonts and media support through Cargo features. Start with the defaults, then select a smaller set for your device.", "Choose features", "/guide/features"],
    ["no_std + alloc", "Connect your display and input", "Use the library in a no_std application with an allocator. Supply display refresh, input and timing from your platform code.", "Connect a device", "/guide/native-integration"],
  ] : [
    ["Cargo", "原生库，随项目一起构建", "Cargo 编译仓库内的 LVGL 9.6 并生成 Rust 绑定。项目自己的 lv_conf.h、C 源码和字体，也可以加入这次构建。", "配置原生构建", "/guide/native-integration"],
    ["Rust", "使用熟悉的 Rust 类型", "直接调用控件 API，或添加 rs_lvgl_ui，用函数组合页面、用消息处理输入。应用状态保存在自己的结构体中。", "开始排列控件", "/guide/declarative-ui"],
    ["Features", "按设备选择控件与字体", "通过 Cargo features 选择控件、字体和媒体扩展。先用默认配置运行示例，再为设备选择需要的部分。", "选择所需特性", "/guide/features"],
    ["no_std + alloc", "接上自己的显示与输入", "库支持带分配器的 no_std 应用。把屏幕刷新、触摸或按键输入、时钟接入平台代码，就可以驱动 LVGL。", "接入设备", "/guide/native-integration"],
  ];

  return <div className="docs-home">
    <section className="docs-home__hero">
      <div className="docs-home__eyebrow">rs_lvgl <span aria-hidden="true">/</span> LVGL 9.6</div>
      {children}
      <p className="docs-home__lead">{en
        ? "Bring LVGL widgets, layouts and animations to your embedded Rust application. Build with Cargo, try your interface on the desktop, then connect your device's display and input."
        : "把 LVGL 的控件、布局和动画接入 Rust 嵌入式项目。用 Cargo 构建，在桌面调试，再连接设备的显示与输入。"}</p>
      <div className="docs-home__actions">
        <a className="docs-button" href={link("/guide/getting-started")}>{en ? "Get started" : "快速开始"}<span aria-hidden="true">→</span></a>
        <a className="docs-button docs-button--quiet" href={link("/studio")}>{en ? "Try the components" : "体验组件"}<span aria-hidden="true">↗</span></a>
      </div>
    </section>

    <figure className="docs-home__display">
      <div className="docs-home__display-bar"><span><span className="status-dot" />{en ? "Component studio" : "组件工作台"}</span><span>Rust + LVGL</span></div>
      <a href={link("/studio")} aria-label={en ? "Open the interactive component preview" : "打开可交互的组件预览"}>
        <img src={withBase("/images/studio-controls.png")} width="1280" height="860" alt={en ? "LVGL studio showing sliders, switches and selection controls" : "LVGL 工作台中的滑块、开关与选择控件"} fetchPriority="high" />
      </a>
      <figcaption><span>{en ? "The desktop studio, also available in your browser." : "桌面组件工作台，也可以在浏览器中操作。"}</span><a href={link("/studio")}>{en ? "Open preview" : "打开预览"} <span aria-hidden="true">↗</span></a></figcaption>
    </figure>

    <section className="docs-home__capabilities">
      <div className="docs-home__section-title"><h2>{en ? "From the build to the board" : "从构建到设备接入"}</h2></div>
      <div className="docs-home__capability-list">{capabilities.map(([label, title, description, action, route]) => <article key={label}>
        <span className="docs-home__index">{label}</span><h3>{title}</h3><p>{description}</p><a href={link(route)}>{action} <span aria-hidden="true">→</span></a>
      </article>)}</div>
    </section>

    <section className="docs-home__try">
      <div className="docs-home__section-title"><h2>{en ? "Try a settings switch" : "先试一个设置开关"}</h2><p>{en
        ? "Toggle notifications and watch the state and count change. The code alongside it is the Rust application running in the preview. Edit the title or event handling and select Run to try it in your browser."
        : "切换通知开关，看看状态文字和计数如何变化。旁边的 Rust 代码就是这个应用；修改标题或事件处理后点击运行，就能在浏览器中试用。"}</p></div>
      <AppExample id="switch" />
    </section>

    <section className="docs-home__path">
      <div className="docs-home__section-title"><h2>{en ? "Continue with your project" : "接下来，接入你的项目"}</h2><p>{en ? "Start with a screen, connect it to your platform, or look through the complete examples." : "开始编写页面，接入已有的板级工程，或找一个完整示例运行。"}</p></div>
      <GuideLinks items={["views", "device", "examples"]} />
    </section>
  </div>;
}
