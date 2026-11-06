---
title: 组合与受控表单
description: 在 rs_lvgl_ui 0.6.0 中使用条件子节点、语义事件、类型化控件、组件插槽和显式表单绑定。
---

# 组合与受控表单

`rs_lvgl_ui` 0.6.0 已提供以下接口。通过 crates.io 安装 `rs_lvgl_ui = "0.6.0"`，并启用表单所需的控件 feature。网站的 `source/` 固定到对应库版本。在线演练场解释器支持有限的 Rust 子集；本页的条件子节点、语义回调、插槽、typed 构造和 binding 需要使用原生 Rust 编译器。

## 用普通 Rust 组合子节点

`child_if(show, || view)` 仅在 `show` 为 true 时执行一次闭包。闭包可以借用局部数据；false 分支不会构造子节点。数组、`child`、`children` 和迭代器保持插入顺序。动态列表使用业务标识作为 key，让原生对象与仍有效的焦点跟随项目。

```rust
use rs_lvgl_ui::prelude::*;

fn devices(ids: &[u64], show_help: bool) -> View<()> {
    column([label("Devices")])
        .children(ids.iter().map(|id| button(format!("Device {id}")).key(Key::Id(*id))))
        .child_if(show_help, || label("Select a device"))
        .gap(8)
}
```

可复用组件仍是普通函数：参数提供状态和内容，返回的视图包含操作输出，`.map(ParentAction::Child)` 负责接入父级操作类型。函数不会增加独立状态或渲染缓存。

## 选择具有明确含义的回调

| 方法 | 参数 | 控件 |
| --- | --- | --- |
| `on_toggle` | `bool` | 开关、复选框 |
| `on_value_changed` | `i32` | 滑块、进度条、圆弧、数字输入 |
| `on_selection_changed` | `Option<u32>` | 下拉、滚轮、标签页、磁贴、按钮矩阵、消息框页脚 |
| `on_cell_selected` | `Option<TableCell>` | 表格，分别提供 row 与 column |
| `on_date_selected` | `Option<CalendarDate>` | 日历 |
| `on_text_changed` | 仅回调期间有效的 `&str` | 文本框 |

`None` 表示有效的“未选择”，例如没有按下按钮或点中日历的星期标题。无效的原生表示不会产生语义操作。数字与语义方法共用同一个值回调槽，后调用的覆盖前者；文本、点击、通用事件回调相互独立。类型擦除后的视图仍可显式选择原有数字编码。

## 在组合之前保留控件类型

`typed::switch(...)` 在样式、key、动画和 `map` 调用后仍保留开关标记。在它上面调用文本框的 `placeholder` 会由 Rust 编译器拒绝。通用样式修饰方法仍遵循原有的部件语义。

单个 `.child(typed::switch(...))` 或组件插槽可以直接接收 typed 节点。混合数组和迭代器元素通过 `.into_view()` 统一类型；返回 `View` 的函数、返回不同控件类型的条件分支也显式转换。转换后继续执行原有诊断与严格模式运行时检查。可选构造函数和类型标记使用相同的控件 feature。

```rust
use rs_lvgl_ui::prelude::*;

fn status(enabled: bool) -> View<()> {
    typed::column([
        typed::label("Power").into_view(),
        typed::switch(enabled).on_toggle(|_| ()).into_view(),
    ])
    .child_if(enabled, || typed::label("Enabled"))
    .into_view()
}
```

## 将当前值与操作映射放在一起

绑定在构造视图时就会被消费。它将当前值与输入回调组合，是否修改状态仍由 `update` 决定。

```rust
use rs_lvgl_ui::prelude::*;

#[derive(Clone)]
enum FanSettingsAction {
    SpeedChanged(i32),
    EnabledChanged(bool),
    NameChanged(String),
}

fn fields(speed: i32, enabled: bool, name: &str) -> View<FanSettingsAction> {
    typed::column([])
        .child(typed::slider(0, 100, binding(speed, FanSettingsAction::SpeedChanged)))
        .child(typed::switch(binding(enabled, FanSettingsAction::EnabledChanged)))
        .child(typed::textarea(binding(name, |text: &str| {
            FanSettingsAction::NameChanged(text.into())
        })).placeholder("Device name"))
        .padding(12)
        .gap(12)
        .into_view()
}
```

每层嵌套的表单容器都需要为绘制预留自己的内边距。滑块旋钮会超出轨道，焦点描边也会超出控件的布局框；外层容器的 padding 或兄弟节点的 gap 无法保护被内层容器裁掉的像素。这个例子针对内置默认样式预留 12 px。自定义旋钮、阴影或描边时，需要相应调整空间，并在滑块两端进行原生渲染检查。

数字控件接受 `i32` 或对应绑定，开关与复选框接受 `bool`，文本框接受 `String`、`&String` 或 `&str`。映射闭包满足 static 生命周期，当前文本的短借用会复制到现有描述中，不会留下模型的可变借用或自动字段 setter。原生输入仍按回调 → 队列 → update → view → 协调的路径处理。

如果滑块从 50 拖到 80，`update` 拒绝 80 并将模型保持为 50，仍需协调以恢复原生控件。程序纠正值时会抑制反馈事件。`RenderDecision::Skip` 要求原生状态不需要纠正，不能只根据模型没有变化就跳过。

## 提供组件插槽

ListItem 的 `leading` 替代 `icon`，`content` 替代默认文本，`trailing` 替代 `detail`。插槽保留显式 key、样式和经过 map 的回调；没有 key 的插槽根节点会得到稳定的插槽 key，默认样式的优先级低于显式值，不会增加原生容器。

Panel 的 `header_action`/`header_actions` 追加头部控件，原有 `action` 继续可用。Panel 与 Dialog 的 `content` 替换正文，之后的 `child`/`children` 继续追加。Dialog 的页脚操作与正文内容保持独立。

typed 标记不增大视图大小，类型擦除只移动现有字段；绑定使用现有的一个回调槽。子节点数组、拥有的字符串、捕获闭包、map 与显式列表插槽仍可能分配内存，LVGL 原生存储需要单独测量。

## 检查原生表单渲染

在网站仓库中，使用固定的库源码验证：

```sh
npm run check-development-ui -- --source ./source
```

检查器使用原生演练场渲染器编译 `playground/development/forms.rs`，验证明暗主题快照、滑块最小值、中间值和最大值的完整圆钮像素，修改模型值并核对像素变化，同时要求错误的 typed 属性由 rustc 拒绝。它还渲染库内 skill 表单和普通控件示例，并包含裁切反例。图像和源码记录写入 `target/development-ui/`。开发时可通过 `--source ../lv_binding_rust` 选择本地库源码；该命令也接受 `RS_LVGL_SOURCE`。

在线解释器尚不支持本页新增的组合与表单接口；原生快照使用完整 Rust 编译器验证这份表单。将操作映射为 `()` 的预览没有应用状态变化；库内可运行表单和绑定测试覆盖状态更新与拒绝输入后的回写。其余检查见[开发与贡献](./development.md)，平台接入见[挂载与更新](./ui-runtime.mdx)。
