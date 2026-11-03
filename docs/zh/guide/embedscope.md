---
title: 使用 EmbedScope 调试
description: 为 rs_lvgl 应用按需开启 EmbedScope，检查真实对象树和显示画面，并在正式构建中关闭诊断入口。
---

# 使用 EmbedScope 调试

[EmbedScope](https://umbrella22.github.io/EmbedScope_website/) 提供桌面 Inspector、`escope` 命令行和 Rust 主机 SDK，可以读取设备身份、日志、指标、UI 树和屏幕，并通过应用输入通道复现点击。rs_lvgl 应用复用已有 LVGL 实例，在 UI 线程处理检查请求。

调试由应用显式开启。`rs_lvgl` 和 `rs_lvgl_ui` 的默认配置不会创建 Agent、启动通信服务或枚举诊断 USB 接口。

## 什么时候开启，什么时候关闭

| 场景 | 推荐配置 | 结果 |
| --- | --- | --- |
| 日常界面开发、布局与交互排查 | 为应用开启 `embedscope` | Inspector 可以读取应用已实现的能力 |
| 需要复现优化后才出现的问题 | `--release --features embedscope` | 保留 release 优化，同时保留诊断入口 |
| 正式交付的固件或程序 | `--release`，不选择 `embedscope` | 应用不编译 Agent、诊断传输和对应采集缓冲 |
| 测试结束，但仍运行诊断构建 | 断开 Inspector 或 CLI | 会话资源被清理；已编译的 Agent 仍在程序内 |

**`--release` 不会自动关闭调试。** Cargo feature 和优化 profile 独立控制，而且 feature 会在依赖图中合并。正式构建不要使用 `--all-features`；检查是否有其他依赖、构建脚本或工作区命令重新启用了诊断。

关闭编译开关后，设备仍运行原来安装的镜像。只有安装并启动不带诊断功能的新固件，设备上的 Agent 和诊断 USB 接口才会消失。

## 先运行原生接入示例

仓库中的 [examples/embedscope](https://github.com/umbrella22/rs_lvgl/tree/main/examples/embedscope) 是一个独立应用，使用 crates.io 上的 `rs_lvgl` / `rs_lvgl_ui` 0.3.1 和 EmbedScope 0.1.0。它在 320 × 240 内存显示上运行真实 LVGL 计数器，**没有独立的模拟器窗口**；可以从 Inspector 查看实际 LVGL 刷新出的画面。

从 [EmbedScope Releases](https://github.com/umbrella22/EmbedScope/releases/latest) 下载 CLI ZIP，解压并将可执行文件所在目录加入 PATH。运行示例还需准备 Rust/Cargo、原生 C 编译器和 libclang，不需要 SDL。在 rs_lvgl 仓库根目录执行：

```sh
cargo run --manifest-path examples/embedscope/Cargo.toml --features embedscope
```

默认监听 `tcp://127.0.0.1:9338`。在另一个终端检查身份与 UI：

```sh
escope -d tcp://127.0.0.1:9338 --json info
escope -d tcp://127.0.0.1:9338 --json ui tree
escope -d tcp://127.0.0.1:9338 display capture counter-before.png
escope -d tcp://127.0.0.1:9338 input tap 100 140 --hold-ms 60
escope -d tcp://127.0.0.1:9338 display capture counter-after.png
```

使用尚不存在的截图文件名。确认 model 为 `LVGL 9.6 / memory display`；点击后计数和画面会变化。对象树来自真实 native 对象，通用适配器提供 `lv_obj`、几何和状态，名称为空。需要控件语义、label 文本或声明式路径时，由应用实现自定义 `TreeSource`。

在桌面 Inspector 中输入同一个 TCP 地址。默认点击画面用于选择对象，开启发送点击选项后才会注入输入。示例只监听本机回环地址，同一时间服务一个连接；CLI 与 Inspector 轮流使用，SDK 的并发请求复用同一个 Session。

## 在应用中保留一个明确开关

`embedscope` 是示例和团子 OS 的**应用 feature**，不是 `rs_lvgl_ui` 的内置 feature。自己的应用可以采用相同写法：

```toml
[features]
default = []
embedscope = [
  "dep:escope-protocol",
  "dep:escope-agent",
  "dep:escope-lvgl",
  "rs_lvgl_ui/diagnostics",
]

[dependencies]
escope-protocol = { version = "0.1.0", optional = true }
escope-agent = { version = "0.1.0", optional = true }
escope-lvgl = { version = "0.1.0", features = ["native"], optional = true }
```

应用仍需正常依赖和配置 `rs_lvgl_ui`。把诊断模块、初始化、缓冲、日志 fan-out 和传输入口放在 `#[cfg(feature = "embedscope")]` 后。启用依赖只提供接口，应用还需要实现 Backend 与字节传输。

几个相关开关的职责不同：

| Feature / API | 作用 |
| --- | --- |
| 应用的 `embedscope` | 选择 Agent、传输、平台 Backend 和相关缓冲 |
| `rs_lvgl_ui/diagnostics` | 提供结构化 UI 诊断事件和 `set_diagnostic_sink`；不会自己开启端口 |
| `rs_lvgl_ui/strict-properties` | 拒绝应用到了不支持控件上的属性；会改变错误处理行为 |
| `rs_lvgl_ui/update-metrics` | 增加 UI 更新统计；不是远程诊断连接 |

## 接到真实设备

复用现有执行器、显示和输入驱动：通信任务负责收发帧，把请求通过有界队列投递到 UI 线程；UI loop 在布局、更新与回调完成后的安全点执行 Backend。

- 对象树与 LVGL 的全部访问留在 UI 线程。原生根对象销毁前停止读取并销毁树适配器；对象变化后更新 revision，旧节点和 cursor 不能跨 session/revision 复用。
- 适配器和应用必须使用同一个 native provider、ABI 和配置。示例统一使用 registry 依赖；混合 path 与 registry 来源时，先统一依赖来源，或使用不链接 LVGL 的默认 `escope-lvgl` 与自定义 `TreeSource`。
- 捕获保存独立的固定帧，明确来源是 LVGL 子树、最终显示提交还是面板读回。显示含直接绘制和转场时，优先接到平台最终输出。
- 注入输入经过统一路由，配对发送 press/release。断线、取消和关闭时释放按压、捕获与旧会话队列。
- 日志复用既有 logger，在格式化前分流；指标缺测返回 `null`。只声明已实现的能力。

完整协议与平台接口见 [EmbedScope Rust 接入](https://umbrella22.github.io/EmbedScope_website/integration/rust.html)和 [LVGL 接入](https://umbrella22.github.io/EmbedScope_website/integration/lvgl.html)。

### 团子 OS

[团子 OS](https://github.com/umbrella22/dangoOS) 是面向 ESP-Mosaico 的 Rust 嵌入式系统，包含团子主页、原生设置和 Lua 应用。其适配器在第二路 USB CDC 上提供 EmbedScope，保留原控制台、应用安装和 OTA。

在含接入模块的团子工程中：

```sh
# 诊断固件：release 优化，保留 EmbedScope
cargo fw --features embedscope

# 正常交付固件：release 优化，不包含 EmbedScope
cargo fw
```

`cargo fw` 已包含 `--release`。诊断固件需要通过团子工具安装，再使用实际枚举出的第二路 CDC 和 `--dtr on` 连接；官方 v0.4.0 镜像没有诊断 Agent。接入、端口选择和原生/Lua 页面调试见 [EmbedScope 团子 OS 指南](https://umbrella22.github.io/EmbedScope_website/integration/dango.html)。

## 验证正式构建

对原生示例执行：

```sh
cargo build --manifest-path examples/embedscope/Cargo.toml --release
cargo tree --manifest-path examples/embedscope/Cargo.toml --edges normal,build
```

关闭诊断时，正常与构建依赖图中应没有 `escope-*`。设备工程还应检查最终链接产物、USB 描述符和实际启动后的接口，而不能只凭 Inspector 已断开判断调试已移除。再次启用 feature 可以复用 Cargo 的缓存，不需要先 `cargo clean`。

接入示例的原生验收命令：

```sh
cargo test --manifest-path examples/embedscope/Cargo.toml --features embedscope -- --test-threads=1
```

该检查覆盖真实 native 树和像素、输入后的状态变化、日志、固定捕获、坏帧、断线重连和有序退出。物理显示、触摸与设备传输需要在目标工程单独验证。
