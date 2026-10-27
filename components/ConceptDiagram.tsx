import { useId } from "react";
import { useLang } from "@rspress/core/runtime";
import "./ConceptDiagram.css";

type DiagramKind =
  | "tree"
  | "update"
  | "keys"
  | "native"
  | "features"
  | "errors";
type Step = { label: string; code: string; detail: string };

const copy = {
  en: {
    eyebrow: "CONCEPT MAP",
    tree: {
      title: "The child collection becomes the layout order",
      description:
        "A column places children in its normal flex flow from top to bottom.",
      source: "Child collection",
      result: "Normal column flow",
      labels: ["Title", "Content", "Actions"],
      note: "Variables name the parts. Their order inside column determines placement; styles determine sizes and spacing.",
    },
    update: {
      title: "One message travels from input to a new view",
      description:
        "Application updates happen when the platform drains the UI queue.",
      steps: [
        {
          label: "Native input",
          code: "LVGL event",
          detail: "A pointer, key or control changes.",
        },
        {
          label: "Queue a message",
          code: "EventQueue",
          detail: "The callback copies data and posts Msg.",
        },
        {
          label: "Drain the queue",
          code: "Ui::drain",
          detail: "The platform processes a message batch.",
        },
        {
          label: "Change state",
          code: "App::update",
          detail: "Each message updates application state.",
        },
        {
          label: "Describe the screen",
          code: "App::view",
          detail: "The updated state produces a View tree.",
        },
        {
          label: "Apply the difference",
          code: "reconciler → LVGL",
          detail: "Native objects are reused, updated or replaced.",
        },
      ],
      note: "All steps run on one UI thread. LVGL also runs layout, rendering and native animations outside this message path.",
    },
    keys: {
      title: "A stable key follows the item when its position changes",
      description:
        "The colors identify the same siblings before and after a reorder.",
      before: "Before",
      after: "After",
      connections: "Stable identities across a reorder",
      connectionsDescription:
        "Item A moves from first to third. B moves from second to first. C moves from third to second. Their keys stay the same.",
      note: "The collection sets the new order. Stable keys and compatible widget kinds allow native objects to survive the move. Auto keys match positions among Auto siblings.",
    },
    native: {
      title: "One target configuration reaches C and Rust",
      description:
        "The native build and target bindings must describe the same capabilities.",
      configuration: "Effective target configuration",
      configDetail: "Header, selected capabilities and target defines",
      c: "C compilation",
      cDetail: "Vendored LVGL, shims and application C sources",
      bindings: "Target bindgen",
      bindingsDetail:
        "Bindings generated from the same effective configuration",
      metadata: "Linked provider metadata",
      generated: "Generate Rust widget wrappers",
      result: "Public Rust APIs and declarative views",
      note: "rs_lvgl/build.rs reads the linked provider’s bindings and capability metadata. Platform display, input and timer registration remain application responsibilities.",
    },
    features: {
      title: "One capability has a Rust side and a native side",
      description:
        "The selected Cargo features must agree with the native configuration.",
      feature: "Cargo capability",
      rust: "Public Rust constructor",
      native: "Native compilation",
      nativeDetail: "LV_USE_SLIDER and its native dependencies",
      rustDetail: "Available when widget-slider is selected",
      note: "Cargo features add capabilities. Slider needs native bar, but the typed bar constructor still needs widget-bar. An application-supplied LVGL_CONFIG_PATH header is validated without rewriting it.",
    },
    errors: {
      title: "Locate an error at the stage that rejects the input",
      description:
        "Compiler diagnostics and UI validation errors describe different contracts.",
      steps: [
        {
          label: "Rust compilation",
          code: "rustc",
          detail: "Syntax, types, imports and feature-gated APIs.",
        },
        {
          label: "Descriptor validation",
          code: "Ui::mount / update",
          detail: "Duplicate keys, invalid properties and values.",
        },
        {
          label: "Native creation and drawing",
          code: "LVGL / snapshot",
          detail: "Native allocation or rendering failures.",
        },
      ],
      note: "A valid Rust program can still describe an invalid UI. Fix the reported stage, then render the current source again.",
    },
  },
  zh: {
    eyebrow: "概念图",
    tree: {
      title: "子节点集合决定布局顺序",
      description: "column 将参与正常 flex 布局的子节点从上到下排列。",
      source: "子节点集合",
      result: "正常列布局",
      labels: ["标题", "内容", "操作区"],
      note: "变量为界面区块命名；它们在 column 中的顺序决定先后，样式决定尺寸与间距。",
    },
    update: {
      title: "一条消息从输入走到新视图",
      description: "平台处理 UI 消息队列时，应用状态才进入这一轮更新。",
      steps: [
        {
          label: "原生输入",
          code: "LVGL event",
          detail: "指针、按键或控件发生变化。",
        },
        {
          label: "消息入队",
          code: "EventQueue",
          detail: "回调复制输入数据并提交 Msg。",
        },
        {
          label: "处理队列",
          code: "Ui::drain",
          detail: "平台在回调之外处理一批消息。",
        },
        {
          label: "更新状态",
          code: "App::update",
          detail: "每条消息修改应用状态。",
        },
        {
          label: "描述界面",
          code: "App::view",
          detail: "从更新后的状态构造 View 树。",
        },
        {
          label: "应用差异",
          code: "reconciler → LVGL",
          detail: "复用、更新或替换原生对象。",
        },
      ],
      note: "所有步骤位于同一个 UI 线程。LVGL 的布局、绘制和原生动画也会在这条消息路径之外运行。",
    },
    keys: {
      title: "位置变化时，稳定的键跟随条目",
      description: "相同颜色表示重排前后的同一个兄弟节点。",
      before: "重排前",
      after: "重排后",
      connections: "重排前后的稳定身份",
      connectionsDescription:
        "A 从第一项移动到第三项，B 从第二项移动到第一项，C 从第三项移动到第二项；它们的键不变。",
      note: "集合给出新顺序。键保持稳定且控件类型兼容时，原生对象可以随条目保留。Auto 键在 Auto 兄弟之间按位置匹配。",
    },
    native: {
      title: "一份目标配置，同时进入 C 与 Rust",
      description: "原生构建与目标绑定需要描述同一组能力。",
      configuration: "目标的有效配置",
      configDetail: "头文件、选择的能力与目标宏定义",
      c: "C 编译",
      cDetail: "仓库中的 LVGL、shim 与应用 C 源码",
      bindings: "目标 bindgen",
      bindingsDetail: "由同一份有效配置生成绑定",
      metadata: "链接的原生提供方元数据",
      generated: "生成 Rust 控件封装",
      result: "公开 Rust API 与声明式视图",
      note: "rs_lvgl/build.rs 读取实际链接提供方的绑定与能力元数据。平台的显示、输入与计时器注册仍由应用负责。",
    },
    features: {
      title: "一个能力，同时对应 Rust 接口与原生配置",
      description: "Cargo 选择的能力需要与原生构建的有效配置一致。",
      feature: "Cargo 能力",
      rust: "公开的 Rust 构造函数",
      native: "原生编译",
      nativeDetail: "LV_USE_SLIDER 及其原生依赖",
      rustDetail: "选择 widget-slider 后可用",
      note: "Cargo feature 追加能力。slider 需要原生 bar，但类型化的 bar 构造函数仍需 widget-bar。应用通过 LVGL_CONFIG_PATH 提供的头文件只做校验，不会被改写。",
    },
    errors: {
      title: "按拒绝输入的阶段定位错误",
      description: "编译器诊断与 UI 校验错误分别检查不同的契约。",
      steps: [
        {
          label: "Rust 编译",
          code: "rustc",
          detail: "语法、类型、导入与受特性控制的 API。",
        },
        {
          label: "描述校验",
          code: "Ui::mount / update",
          detail: "重复键、无效属性与越界数值。",
        },
        {
          label: "原生创建与绘制",
          code: "LVGL / snapshot",
          detail: "原生分配或绘制失败。",
        },
      ],
      note: "能编译的 Rust 程序仍可能描述无效的 UI。先修复报错阶段的问题，再渲染当前代码。",
    },
  },
};

function Arrow() {
  return (
    <svg className="concept-arrow" viewBox="0 0 40 24" aria-hidden="true">
      <path d="M2 12h33m-8-8 8 8-8 8" />
    </svg>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="concept-steps">
      {steps.map((step, index) => (
        <li className="concept-step" key={step.code}>
          <span className="concept-step__number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <strong>{step.label}</strong>
          <code>{step.code}</code>
          <p>{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function ConceptDiagram({ kind }: { kind: DiagramKind }) {
  const language = useLang() === "zh" ? "zh" : "en";
  const text = copy[language];
  const content = text[kind];
  const id = useId();

  return (
    <figure
      className={`concept-figure concept-figure--${kind}`}
      aria-labelledby={`${id}-title`}
    >
      <figcaption className="concept-heading">
        <span className="concept-eyebrow">{text.eyebrow}</span>
        <strong id={`${id}-title`}>{content.title}</strong>
        <p>{content.description}</p>
      </figcaption>

      {kind === "tree" && (
        <div className="concept-tree">
          <div className="concept-tree__source">
            <span className="concept-label">{text.tree.source}</span>
            <pre>
              <code>
                {"column([\n    title,\n    content,\n    actions,\n])"}
              </code>
            </pre>
          </div>
          <Arrow />
          <div className="concept-tree__result">
            <span className="concept-label">{text.tree.result}</span>
            <ol>
              {text.tree.labels.map((label, index) => (
                <li key={label}>
                  <span>{index}</span>
                  <strong>{label}</strong>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {(kind === "update" || kind === "errors") && (
        <Steps steps={text[kind].steps} />
      )}

      {kind === "native" && (
        <div className="concept-native">
          <div className="concept-native__configuration">
            <strong>{text.native.configuration}</strong>
            <code>lv_conf.h + Cargo capabilities</code>
            <p>{text.native.configDetail}</p>
          </div>
          <div className="concept-native__branches">
            <div>
              <strong>{text.native.c}</strong>
              <code>rs_lvgl_sys → native library</code>
              <p>{text.native.cDetail}</p>
            </div>
            <div>
              <strong>{text.native.bindings}</strong>
              <code>bindings.rs</code>
              <p>{text.native.bindingsDetail}</p>
            </div>
          </div>
          <div className="concept-native__metadata">
            <span>{text.native.metadata}</span>
            <code>DEP_LVGL_*</code>
          </div>
          <div className="concept-native__generation">
            <strong>{text.native.generated}</strong>
            <code>rs_lvgl/build.rs → rs_lvgl_codegen → generated.rs</code>
          </div>
          <div className="concept-native__result">
            <span>{text.native.result}</span>
            <code>rs_lvgl · rs_lvgl_ui</code>
          </div>
        </div>
      )}

      {kind === "keys" && (
        <div className="concept-keys">
          <div className="concept-keys__column">
            <span className="concept-label">{text.keys.before}</span>
            {["A", "B", "C"].map((item, index) => (
              <div
                className={`concept-key concept-key--${item.toLowerCase()}`}
                key={item}
              >
                <strong>{item}</strong>
                <code>Id({(index + 1) * 10})</code>
              </div>
            ))}
          </div>
          <svg
            className="concept-key-links"
            viewBox="0 0 120 216"
            role="img"
            aria-labelledby={`${id}-links-title ${id}-links-desc`}
          >
            <title id={`${id}-links-title`}>{text.keys.connections}</title>
            <desc id={`${id}-links-desc`}>
              {text.keys.connectionsDescription}
            </desc>
            <path
              className="concept-key-link--a"
              d="M0 36C60 36 60 180 120 180"
            />
            <path
              className="concept-key-link--b"
              d="M0 108C60 108 60 36 120 36"
            />
            <path
              className="concept-key-link--c"
              d="M0 180C60 180 60 108 120 108"
            />
          </svg>
          <div className="concept-keys__column">
            <span className="concept-label">{text.keys.after}</span>
            {["B", "C", "A"].map((item) => (
              <div
                className={`concept-key concept-key--${item.toLowerCase()}`}
                key={item}
              >
                <strong>{item}</strong>
                <code>Id({(item.charCodeAt(0) - 64) * 10})</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {kind === "features" && (
        <div className="concept-feature">
          <div className="concept-feature__input">
            <span className="concept-label">{text.features.feature}</span>
            <code>widget-slider</code>
          </div>
          <Arrow />
          <div className="concept-feature__outputs">
            <div>
              <strong>{text.features.rust}</strong>
              <code>slider(0, 100, value)</code>
              <p>{text.features.rustDetail}</p>
            </div>
            <div>
              <strong>{text.features.native}</strong>
              <code>LV_USE_SLIDER = 1</code>
              <p>{text.features.nativeDetail}</p>
            </div>
          </div>
        </div>
      )}

      <p className="concept-note">{content.note}</p>
    </figure>
  );
}
