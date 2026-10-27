import { useLang, withBase } from "@rspress/core/runtime";
import { Link } from "@rspress/core/theme";

const pages = {
  views: ["/guide/declarative-ui", "排列控件", "Arrange widgets", "用列、行和网格组织一个页面。", "Arrange a screen with columns, rows and grids."],
  events: ["/guide/input-and-events", "响应输入", "Handle input", "让开关、按钮和键盘更新应用状态。", "Connect switches, buttons and keypads to application state."],
  components: ["/guide/components", "复用组件", "Reuse components", "提取视图函数，组合列表、导航和对话框。", "Extract view functions and compose lists, navigation and dialogs."],
  device: ["/guide/native-integration", "接入设备", "Connect a device", "配置原生构建，接上显示、输入与时钟。", "Configure the native build, display, input and clock."],
  features: ["/guide/features", "选择控件与字体", "Choose widgets and fonts", "为设备选择需要的 Cargo features。", "Select the Cargo features your device needs."],
  runtime: ["/guide/ui-runtime", "挂载与更新", "Mount and update", "把 App 放入平台循环，处理更新与清理。", "Run an App in your platform loop and manage its lifetime."],
  examples: ["/guide/examples", "运行示例", "Run examples", "查找带显示初始化和事件循环的程序。", "Find programs with display setup and an event loop."],
  studio: ["/studio", "组件预览", "Component preview", "直接操作控件，看看布局和动画。", "Try the widgets, layouts and animations in your browser."],
  playground: ["/playground", "演练场", "Playground", "修改 Rust 示例，在浏览器中运行并操作控件。", "Edit a Rust example, run it in the browser and try the controls."],
} as const;

type Page = keyof typeof pages;

export function GuideLinks({ items }: { items: Page[] }) {
  const en = useLang() === "en";
  return <nav className="guide-links" aria-label={en ? "Related guides" : "继续阅读"}>
    {items.map((key) => {
      const [route, zhTitle, enTitle, zhDescription, enDescription] = pages[key];
      return <Link key={key} className="guide-links__item" href={withBase(`${en ? "/en" : ""}${route}.html`)}>
        <span className="guide-links__title">{en ? enTitle : zhTitle}<span aria-hidden="true">→</span></span>
        <span className="guide-links__description">{en ? enDescription : zhDescription}</span>
      </Link>;
    })}
  </nav>;
}
