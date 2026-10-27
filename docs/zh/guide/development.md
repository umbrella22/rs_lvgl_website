---
title: 参与开发
description: 构建并测试工作区，维护生成器、原生配置、双语文档和交互示例。
---

# 参与开发

修改 Rust 封装、原生配置或文档时，从对应目录开始。下面列出代码生成的位置、各层检查命令，以及文档示例的更新方式。

## 仓库结构

工作区包含四个 crate，共用一套依赖解析：

| 路径 | 职责 | 主要入口 |
| --- | --- | --- |
| `rs_lvgl_sys` | 编译随仓库提供的 LVGL 9.6 与兼容层，生成原始 bindgen 绑定，暴露配置输入 | `build.rs`、`src/lib.rs`、`shims/`、`vendor/` |
| `rs_lvgl_codegen` | 解析 bindgen 输出，在构建期生成 Rust 控件封装 | `src/lib.rs`、`src/analysis.rs` |
| `rs_lvgl` | 控件、显示、输入、样式、内存与计时器的公共封装 | `build.rs`、`src/lib.rs`、`src/widgets/` |
| `rs_lvgl_ui` | 声明式 `App`/`View`/`Ui`、组件、特性与原生示例 | `src/lib.rs`、`src/node.rs`、`examples/` |

`Cargo.toml` 定义库工作区；`.cargo/config.toml` 定义 Xtensa 目标设置与 `cargo test-lvgl` 别名。Rspress 站点在 [rs_lvgl_website](https://github.com/umbrella22/rs_lvgl_website) 中维护，通过 `source/` 子模块固定库源码。本指南中的库命令从库仓库运行，下面的站点命令从网站仓库运行。

## 构建与生成路径

```text
rs_lvgl_sys/build.rs
  生效的 lv_conf.h + vendored C + shims
    -> cc -> 原生 LVGL 库
    -> bindgen -> OUT_DIR/bindings.rs
  cargo:bindings / widgets / optional_widgets / fonts
    -> 供依赖方读取的 DEP_LVGL_* 元数据

rs_lvgl/build.rs
  DEP_LVGL_BINDINGS（来自被链接的 rs_lvgl_sys）
    -> rs_lvgl_codegen::CodeGen -> OUT_DIR/generated.rs
  DEP_LVGL_WIDGETS -> cfg(lv_use_<widget>)

rs_lvgl/src/widgets/mod.rs
  include!(OUT_DIR/generated.rs) -> 生成的公共封装
```

`rs_lvgl_sys` 读取 `vendor/include-9.6/lv_conf.h` 或应用提供的头文件，把修改后的副本写入 `OUT_DIR`，编译 C 与可选的 ThorVG 源码，并运行 bindgen。它通过 Cargo 元数据发布绑定路径、已启用控件、可选控件清单与已启用字体。该 crate 声明了 `links = "lvgl"`，因此这些输出以 `DEP_LVGL_BINDINGS`、`DEP_LVGL_WIDGETS`、`DEP_LVGL_OPTIONAL_WIDGETS` 与 `DEP_LVGL_FONTS` 的形式提供给依赖方。

`rs_lvgl/build.rs` 从被链接的依赖读取 `DEP_LVGL_BINDINGS`，再调用 `rs_lvgl_codegen` 生成封装。缺少该元数据时，它回退到 `rs_lvgl_sys::_bindgen_raw_src()`。这一区分很重要：`rs_lvgl_sys` 同时是普通依赖和构建依赖，构建依赖副本可能启用不同特性（包括 `minimal-config`），从而看到不同的控件集合。不要从任意宿主产物生成，也不要在 `target/` 中扫描绑定。

生成的 `bindings.rs` 与 `generated.rs` 属于 `OUT_DIR`。需要修改时应改 C 输入、配置或生成器；生成的接收裸指针的 API 保留 `unsafe` 边界。

`rs_lvgl_ui` 在 `rs_lvgl` 之上增加手写的声明式层。它通过自身的追加特性选择控件与字体，以 `default-features = false` 依赖 `rs_lvgl`，并向 `rs_lvgl_sys` 请求 `minimal-config`，使未启用的控件不进入原生库。

## 配置与特性选择

没有应用输入时，随仓库提供的配置是权威来源，`widget-*`/`font-*` 特性追加能力。启用 `minimal-config` 后，未启用的控件与 Montserrat 字号默认关闭；slider 依赖 bar、keyboard 依赖 buttonmatrix 等原生依赖会自动补齐。

应用可以通过 `LVGL_CONFIG_PATH` 提供自己的头文件。该头文件是权威来源，不会被修补；请求的 Cargo 能力必须已在其中启用，否则构建失败。`LVGL_EXTRA_C_DIR`、`LVGL_EXTRA_HEADERS` 与 `LVGL_CFLAGS` 扩展 C 与 bindgen 输入。输入契约见[接入设备](./native-integration.mdx)，选择模型见[特性](./features.mdx)。

不要把 `--all-features` 当作通用验证命令。特性矩阵包含仅限 nightly 与应用自行提供的路径；CI 使用显式特性集合。

## CI 验证

`.github/workflows/rust.yml` 包含四个任务。工作区构建与测试任务运行在 Ubuntu 24.04 和 macOS 15 上；UI、原生契约与堆任务运行在 Ubuntu 24.04 上。

本仓库忽略 `Cargo.lock`。CI 先解析锁文件，之后所有 Cargo 命令都传入 `--locked`：

```sh
cargo generate-lockfile
cargo build --workspace --locked
cargo test --workspace --locked -- --test-threads=1
cargo check -p rs_lvgl_ui --locked --examples --features showcase,rust_timer
cargo check -p rs_lvgl --locked --no-default-features --lib
cargo test -p rs_lvgl --locked --no-default-features --features lvgl_alloc,rust_timer -- --test-threads=1
```

UI 任务运行组件与原生示例检查：

```sh
cargo test -p rs_lvgl_ui --locked --features showcase,font-cjk-14,rust_timer -- --test-threads=1
xvfb-run -a python3 scripts/check-ui-examples.py --locked --artifacts target/ui-audit
python3 scripts/render-studio.py --locked --artifacts target/studio-audit
python3 scripts/check-ui-api.py --locked --artifacts target/ui-api-audit
cargo test -p rs_lvgl_ui --locked --no-default-features --features alloc,components -- --test-threads=1
cargo check -p rs_lvgl_ui --locked --no-default-features --lib
cargo check -p rs_lvgl_ui --locked --no-default-features --features alloc,no-autoinit --lib
for capability in input-keypad input-gridnav widget-canvas widget-qrcode widget-barcode widget-gif widget-lottie widget-ime-pinyin font-cjk-14 font-cjk-16; do
  cargo check -p rs_lvgl_ui --locked --no-default-features --features "alloc,$capability" --lib
done
```

原生契约任务运行配置与已打包消费者检查，以及已安装 skill 的检查：

```sh
python3 scripts/check-native-inputs.py --locked --artifacts target/native-input-audit
python3 scripts/check-skills.py --locked --artifacts target/skill-audit
```

堆任务运行严格的 Rust 与 LVGL 分配平衡检查：

```sh
python3 scripts/check-ui-leaks.py --locked --artifacts target/leak-audit
```

LVGL 测试共享原生全局状态，因此使用 `-- --test-threads=1` 串行运行。别名记录了同样的设置：

```sh
cargo test-lvgl
```

修改某一层时可使用对应的定向检查：

```sh
cargo test -p rs_lvgl_sys --test build_script -- --test-threads=1
cargo test -p rs_lvgl_codegen
```

原生输入运行器需要 Python 3.12+；其中断检查需要 POSIX 进程组。UI 示例运行器需要 SDL2，无显示器的 Linux 上还需要 `xvfb-run`。macOS 可能需要[运行示例](./examples.mdx)中给出的 SDL2 库路径。

## 本地文档与演练场

站点是独立的 Node 包，带有自己的锁文件。克隆网站并初始化固定版本的库源码后，在网站根目录运行以下命令。构建浏览器运行时还需要 Rust、libclang 和 Emscripten；[网站 README](https://github.com/umbrella22/rs_lvgl_website#build-from-a-clean-checkout) 列出了工具链和依赖准备步骤。

```sh
npm ci
git submodule update --init --recursive
npm run dev
npm test
npm run typecheck
npm run examples:check
npm run check-docs
npm run build
npm run check-docs -- --built
```

`npm ci` 安装锁定的依赖集合，`dev` 通过 Rspress 提供正在编写的页面，`build` 生成静态站点。`typecheck` 校验主题与文档组件，源码和构建产物检查覆盖路由、元信息、链接与资源的一致性。静态站点包含浏览器解释器，支持直接运行文档示例和范围内的 Rust 修改，无需编译端点。

单独启动交互演练场（Emscripten 等工具链的准备步骤见[在浏览器中试写](./browser-playground.mdx)）：

```sh
npm run playground
```

该命令构建站点，并提供可选的本地 Rust 编译器。打开服务打印的地址，进入[演练场](../playground.mdx)，在“运行设置”中选择“本地 Rust 编译器”后才会使用该服务。文档内嵌示例直接在浏览器中运行。服务监听本机回环地址；提交的代码针对 `source/` 固定的版本编译，编译出的 WebAssembly 与该次提交的源码关联，在浏览器 Worker 中处理实际输入、消息和动画。编译错误、非法视图、运行失败和超时分别报告。

### 维护代码与图片对照

共用的 Rust 示例位于 `playground/`。文档代码面板与演练场预设使用同一组示例。修改示例后，重新生成原生画面并核对源码与图片清单：

```sh
npm run examples:render
npm run examples:check
npm run check-playground
npm run playground:wasm:build
npm run check-interactive
```

`examples:render` 编译并渲染共用片段，需要 Rust、C 与 libclang 原生工具链；`examples:check` 核对记录的源码与图片身份；`check-playground` 实际执行编译、渲染、诊断与取消检查。这些检查覆盖本机工作流程，不证明物理面板渲染、操作系统输入或其他原生提供方兼容性。

指南文章位于 `docs/zh/guide` 与 `docs/en/guide`，两种语言使用相同的路由后缀。交互文章采用 `.mdx`，复用 `components/` 中的组件；文章间链接使用实际文件对应的相对 `.md` 或 `.mdx` 路径。共享图示按当前语言切换标签；页面描述与正文语言一致，成对文章保留相同命令和能力契约。

## AI 开发 skill

仓库为编程助手提供两个 skill：用于声明式界面的 `rs-lvgl-ui`，以及用于配置、C 源码与字体的 `rs-lvgl-native`。可以安装到用户级或项目级目录：

```sh
python3 scripts/install-skills.py --dest ~/.agents/skills
python3 scripts/install-skills.py --dest ../application/.agents/skills --skill rs-lvgl-ui
```

安装脚本拒绝覆盖已存在的 skill 目录。CI 通过 `scripts/check-skills.py` 校验打包后的 skill；发现与维护方式见 [AI 开发 skill](https://github.com/umbrella22/rs_lvgl/blob/main/docs/ai-skills.md)。

## 宿主测试与目标限制

宿主构建与测试在开发机上编译并运行随仓库提供的 LVGL，使用宿主工具链、生成的绑定和内存显示。它们不验证交叉编译工具链、ESP-IDF 集成、物理面板渲染、卸载期间的 DMA/GPU 完成，也不证明与外部 LVGL 提供方的 ABI 兼容。`.cargo/config.toml` 中的 Xtensa 运行器调用 `espflash flash --monitor`，因此对交叉目标执行 `cargo run` 或测试会写入已连接的硬件。本地运行不能复现 CI 环境。
