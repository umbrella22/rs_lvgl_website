---
title: UI 0.7.0 迁移
description: 从 rs_lvgl_ui 0.6.0 迁移到 0.7.0，更新 ChartSpec、稳定序列标识和自定义控件属性接口，并使用受控双端滑块与文本编辑选项。
---

# UI 0.7.0 迁移

0.7.0 替换了图表和自定义控件构造接口。项目中直接依赖的 `rs_lvgl`、
`rs_lvgl_sys`、`rs_lvgl_codegen` 和 `rs_lvgl_ui` 应一起升级。
调用方统一迁移到各控件的新接口。

```toml
[dependencies]
rs_lvgl = { version = "0.7.0", default-features = false, features = ["alloc"] }
rs_lvgl_ui = "0.7.0"
```

原生提供方仍为仓库自带的 LVGL 9.6。默认 feature、显式单位、独立 Flex 对齐和语义部件命名继续有效。
从 0.5.0 或更早版本升级时，先应用
[历史 0.6.0 迁移说明](https://github.com/umbrella22/rs_lvgl/blob/v0.6.0/docs/ui-api-migration.md)。

## 替换图表描述

| 0.6.0 | 0.7.0 |
| --- | --- |
| `chart(kind, min, max, series)` | `chart(ChartSpec::new(kind, axes, series))`；也可用 `typed::chart(spec)` |
| `ChartSeries { color, values }` | `ChartSeries::new(stable_id, color, ChartData::values(values))` |
| 构造函数的 min/max 参数 | 用 `ChartAxes` 明确提供主次 X/Y 轴的 `ChartRange` |
| 按位置隐含识别序列 | 用稳定 ID 标识同一逻辑信号；`.axes(x_axis, y_axis)` 分别选择两个坐标轴 |

使用采样槽位的图表也要提供明确的 X 范围。Line、Bar、Stacked、Curve 使用 Y 数据，
Scatter 使用 XY 数据。Curve 需要生效的原生 `LV_USE_VECTOR_GRAPHIC` 能力。
`ChartValue::Missing` 表达空点，`i32::MAX` 是保留值。重复 ID、无效范围、长度不一致或样本类型不匹配，
会在修改原生界面前拒绝本次渲染。Bar 要求完整数据；Stacked 还拒绝负值、混合 Y 轴和累计溢出。

流式数据由应用状态持有 `ChartHistory`，通过 `ChartData::History(history.snapshot())` 提交。
历史记录具有明确的 epoch、非零容量和样本类型，Shift 与 Circular 决定显示顺序。
增量追加需要元数据匹配且保留数据的重叠部分一致；出现缺口、容量变化、替换或重新挂载时执行完整同步。
创建快照会复制保留的数据，应按应用的批次大小测量成本。`ChartCursor` 使用独立稳定 ID，
目标可以是像素坐标或序列中的点。

## 使用受控范围与文本输入

`range_slider(min, max, SliderRange::new(lower, upper))` 通过 `on_range_changed`
同时返回两个端点，typed 构造也接受 `binding`。端点无序或越界时拒绝渲染，构造函数不会排序或钳制。
应用忽略输入后，下次协调会根据模型恢复原生值。

Textarea 通过 `accepted_chars`、`input_max_length(Option<NonZeroU32>)`、
`cursor_position(Option<u32>)` 和 `cursor_click_position(bool)` 配置编辑行为。
长度和光标位置以 Unicode 标量计数。长度上限的 `None` 表示无限制，没有用零表达上限的接口。
应用模型是权威值，协调时过滤器不会截断完整模型文本。手写 `WidgetKind::Textarea` 字面量需新增
`input: Option<Box<TextareaInputOptions>>` 字段；不透明的选项内容应通过 builder 配置。

Flex 的 `.flex_wrap(bool)` 与 `.flex_reverse(bool)` 分别选择原生换行和反向排列。
稳定 key 与描述中的子节点顺序保持原有含义。下面的完整视图片段会使用固定的 0.7.0 源码编译：

```rust
// rs_lvgl_ui 0.7.0; validate with check-development-ui against the pinned source.
use core::num::NonZeroU32;
use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Sensor controls").font(theme.title_font),
        row([
            typed::range_slider(0, 100,
                binding(SliderRange::new(20, 70), |_: SliderRange| ()))
                .width(px(220)).height(px(18)).into_view(),
            typed::textarea(binding("42", |_: &str| ()))
                .accepted_chars("0123456789")
                .input_max_length(NonZeroU32::new(4))
                .cursor_position(Some(2)).cursor_click_position(false)
                .width(px(160)).height(px(52)).into_view(),
        ]).flex_wrap(true).flex_reverse(false)
            .align_items(ItemAlign::Center).gap(24).padding(16),
        chart(ChartSpec::new(
            ChartType::Line,
            ChartAxes::new(ChartRange::new(0, 100), ChartRange::new(0, 100)),
            vec![ChartSeries::new(
                7, theme.accent, ChartData::values([20, 45, 30, 70]),
            )],
        )).width(px(420)).height(px(140)).key(Key::Named("readings")),
    ]).width(percent(100)).height(percent(100)).padding(24).gap(16)
        .background(theme.background).text_color(theme.text)
}
```

关闭默认 feature 时，启用对应的 `widget-slider`、`widget-textarea` 和 `widget-chart`。
这个示例由原生 Rust 编译器验证；在线演练场解释器支持的 Rust 子集更小。

## 显式传递自定义控件属性

| 0.6.0 | 0.7.0 |
| --- | --- |
| `custom(widget)` | `custom(widget, props)` |
| `create(parent)` | 关联类型 `type Props` 与 `create(parent, &Props)` |
| `update(object, elapsed_ms)` | 模型输入放在 `apply_props(object, &Props)`，时间推进放在 `tick(object, elapsed_ms)` |
| 共享状态或修改 key 来强制刷新 | 每次兼容协调都向已挂载实例传递当前属性 |

即使 `Props = ()` 也要实现 `apply_props`。纯函数 `validate` 在主树和覆盖层发生修改前执行。
key 与具体控件类型相同时保留实例，任一变化时替换。`Ui::tick` 仅调用 `tick`。

```rust
// rs_lvgl_ui 0.7.0 custom properties; native Rust compilation is required.
use core::ptr::NonNull;
use rs_lvgl::{sys, NativeObject};
use rs_lvgl_ui::prelude::*;

struct Gauge;
struct GaugeProps(i32);

impl CustomWidget for Gauge {
    type Props = GaugeProps;

    fn validate(props: &GaugeProps) -> Result<(), UiError> {
        if (0..=100).contains(&props.0) { Ok(()) }
        else { Err(UiError::InvalidProperty) }
    }

    fn create(&mut self, parent: &mut Obj<'_>, _: &GaugeProps)
        -> Result<CustomObject, UiError>
    {
        // SAFETY: this hook creates one live direct child for the mounted owner.
        unsafe {
            let child = NonNull::new(sys::lv_arc_create(parent.raw().as_ptr()))
                .ok_or(UiError::Allocation)?;
            CustomObject::new(parent, child)
        }
    }

    fn apply_props(&mut self, object: &mut CustomObject, props: &GaugeProps)
        -> Result<(), UiError>
    {
        // SAFETY: this hook exclusively borrows its live arc on the UI thread.
        unsafe { sys::lv_arc_set_value(object.raw().as_ptr(), props.0); }
        Ok(())
    }

    fn delete(&mut self, _: &mut CustomObject) {
        // No external registrations or retained buffers to retire in this widget.
    }
}

fn view(theme: &Theme) -> View<()> {
    column([custom(Gauge, GaugeProps(65)).key(Key::Named("gauge"))])
        .padding(24).width(percent(100)).height(percent(100))
        .background(theme.background).text_color(theme.text)
}
```

属性应用成功返回前，必须解除原生代码对旧属性的引用。部分应用失败时，新旧属性均保留到原生删除结束。
`delete` 在根对象仍存活时执行一次，用于注销外部资源；不得删除根对象或重入 `Ui`。
`create` 失败时自行清理已创建的部分子树。原生回调不得跨 C 边界展开 panic，原有裸指针和清理契约继续有效。

## 验证升级后的应用

串行运行原生测试，检查所用的裁剪控件、布局与 `no_std` 配置，并在实际目标环境检查接受和拒绝输入、
自定义控件删除等行为。网站通过 `check-development-ui` 针对固定版本验证上面两个示例，
并检查旧构造签名会被编译器拒绝。完整的内存显示原生程序与边界说明见
[capability-depth.rs](https://github.com/umbrella22/rs_lvgl/blob/v0.7.0/.agents/skills/rs-lvgl-ui/references/capability-depth.rs)
和[能力指南](https://github.com/umbrella22/rs_lvgl/blob/v0.7.0/docs/ui-capability-depth.md)。
