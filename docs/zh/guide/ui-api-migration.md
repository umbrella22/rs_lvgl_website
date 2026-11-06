---
title: UI 0.6.0 迁移
description: 从 rs_lvgl_ui 0.5.0 迁移到 0.6.0，使用统一命名、明确的变换单位、独立 Flex 对齐与语义部件样式。
---

# UI 0.6.0 迁移

0.6.0 对 0.5.0 的 UI 接口作了破坏性调整。安装 `rs_lvgl_ui = "0.6.0"`，
并按下文迁移名称、单位、布局与控件部件。网站的 `source/` 固定到同一版本。
Studio 运行完整编译的库；在线演练场支持有限 Rust 子集，包含新的容器/进度条名称、
plain 样式与独立对齐。完整示例中的 typed 构造、变换单位与部件样式需要原生 Rust 编译器。

从网站目录验证固定的发布源码：

```sh
npm run check-development-ui -- --source ./source
```

命令记录选定源码身份，使用真实 Rust/LVGL 编译下面的示例，渲染明暗主题，
并验证故意使用错误单位、控件能力的编译反例。结果与图片位于 `target/development-ui/`。

## 名称迁移

| 0.5.0 | 0.6.0 |
| --- | --- |
| obj、bar、msgbox、anim_image | container、progress_bar、message_box、animated_image；普通和 typed 入口一致 |
| typed::kind::Obj/Bar/Msgbox/AnimImage | Container/ProgressBar/MessageBox/AnimatedImage |
| ScrollDir / scroll_dir / HOR / VER | ScrollDirection / scroll_direction / HORIZONTAL / VERTICAL |
| TopMid / BottomMid / LeftMid / RightMid | TopCenter / BottomCenter / CenterLeft / CenterRight |
| LabelLongMode / Dots / ScrollCircular | TextOverflow / Ellipsis / ScrollLoop；使用 label.text_overflow |
| Style::neutral | Style::plain；显式基础值相同 |
| msgbox_title/buttons / spinner_anim / anim_duration | message_box_title/buttons / spinner_animation / animation_duration |
| bg_grad_color/dir、bg_main_stop/bg_grad_stop | background_gradient_color/direction、background_gradient_start/end |
| bg_main_opacity/bg_grad_opacity | background_gradient_start_opacity/end_opacity |
| text_letter_space/text_line_space / outline_pad | letter_spacing/line_spacing / outline_offset |
| image_recolor/image_recolor_opacity | image_tint/image_tint_opacity |
| Part / part_style / part_state_style | NativePart / native_part_style / native_part_state_style |

旧路径全部移除，没有兼容别名。原生 feature 名和低层 rs_lvgl 名称保持原有接口。
message_box 仍是内联消息框。普通容器和标签已经应用基础样式，局部属性直接写在节点上。
显式去除控件原生外观、重置前面写入的字段时，仍保留 plain 补丁。
plain 不是空补丁，也不是完整重置；扩展样式和文字继承等字段仍未设置。

## 单位、布局和部件

Scale::percent(50) 表达一半大小，Scale::ratio(n,d) 表达精确比例，
Angle::degrees(90) 和 Angle::tenths(455) 分别表达 90 度和 45.5 度。
缩放舍入到原生 1/256，恰好一半时向上舍入；ratio 拒绝零分母和原生溢出。
原生缩放范围是 0..=65535，图片另外拒绝零值；旋转在修改原生界面前验证
-32768..=32767 十分之一度的范围。Animation::rotation/scale_x/scale_y 接收明确单位，
替代原始 Rotation/ScaleX/ScaleY 端点；普通标量动画保留。Spinner 扫过角度仍用整度。
库源码中的 `docs/ui-api-migration.md` 另有常量、过渡属性和诊断变体的完整映射。

旧 flex_align(main,cross) 应迁移为 justify_content(main)、
align_items(cross 对应的 ItemAlign)、align_content(cross 对应的 FlexAlign)，才能保持原位置。
三个字段分别合并；ItemAlign 只允许 Start/Center/End。align_content 对应原生 track 位置，
包括单行容器。floating 同时退出父布局和父滚动，不隐含 CSS 的 stretch 或 absolute 语义。

thumb 样式适用于 Slider/Switch，progress 样式适用于 Slider/ProgressBar。
其他部件明确使用 NativePart，例如 Arc 的 Indicator 仍有自己的含义。
typed 用错控件会在编译时失败，擦除类型后的用法遵循 diagnostics/strict 策略。
同部件、同状态的后一个补丁整体替换前一个补丁；需要同时生效的字段写在同一个补丁中。
移除补丁会恢复原生或基础样式。

## 本地编译示例

```rust
// rs_lvgl_ui 0.6.0; validate with check-development-ui against the pinned source.
use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Fan settings").font(theme.title_font).text_color(theme.text)
            .text_overflow(TextOverflow::Ellipsis),
        row([
            typed::slider(0, 100, 50).width(px(240)).height(px(16))
                .thumb_style(style().background(theme.accent))
                .progress_style(style().background(theme.accent)).into_view(),
            typed::switch(true).into_view(),
        ]).width(percent(100)).padding(16)
            .justify_content(FlexAlign::SpaceBetween)
            .align_items(ItemAlign::Center).align_content(FlexAlign::Center),
        progress_bar(0, 100, 50).width(percent(100))
            .progress_style(style().background(theme.accent)),
        container().width(px(64)).height(px(64)).child(
            container().width(px(24)).height(px(24)).align(Align::Center)
                .background(theme.accent)
                .transform_scale_x(Scale::percent(150))
                .transform_scale_y(Scale::percent(150))
                .transform_pivot_x(12).transform_pivot_y(12)
                .transform_rotation(Angle::degrees(45)),
        ),
        message_box("Changes apply after Save.").message_box_title("Inline message"),
    ]).width(percent(100)).height(percent(100))
        .background(theme.background).text_color(theme.text).padding(24).gap(16)
        .scroll_direction(ScrollDirection::VERTICAL)
}
```

手柄只修改颜色，保留 LVGL 原生的圆形轮廓。固定圆角半径可能在宽高不变时把圆形变成圆角方块。
方块的两个轴都缩放到 150%，围绕中心旋转；外层 64 px 容器为四个旋转后的角预留空间，
避免裁切或与下面的消息框重叠。两个缩放轴仍可独立设置，以支持确实需要拉伸的设计。
