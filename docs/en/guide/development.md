---
title: Contribute
description: Build and test the workspace, and maintain generators, native configuration, bilingual guides and interactive examples.
---

# Contribute

Start in the directory for the Rust wrapper, native configuration or documentation you are changing. The sections below locate generated code, list checks for each layer and describe how to update documentation examples.

## Repository map

The workspace contains four crates with one shared dependency resolution:

| Path | Responsibility | Main entrypoints |
| --- | --- | --- |
| `rs_lvgl_sys` | Compiles vendored LVGL 9.6 and shims, generates raw bindgen bindings, exposes configuration inputs | `build.rs`, `src/lib.rs`, `shims/`, `vendor/` |
| `rs_lvgl_codegen` | Parses bindgen output and generates Rust widget wrappers at build time | `src/lib.rs`, `src/analysis.rs` |
| `rs_lvgl` | Public wrappers for widgets, displays, input, styles, memory and timers | `build.rs`, `src/lib.rs`, `src/widgets/` |
| `rs_lvgl_ui` | Declarative `App`/`View`/`Ui`, components, features and the native examples | `src/lib.rs`, `src/node.rs`, `examples/` |

`Cargo.toml` defines the library workspace; `.cargo/config.toml` defines the Xtensa target settings and the `cargo test-lvgl` alias. The Rspress site is maintained in [rs_lvgl_website](https://github.com/umbrella22/rs_lvgl_website), with the library fixed by its `source/` submodule. The library commands in this guide run from the library checkout; the site commands below run from the website checkout.

## Build and generation path

```text
rs_lvgl_sys/build.rs
  effective lv_conf.h + vendored C + shims
    -> cc -> native LVGL library
    -> bindgen -> OUT_DIR/bindings.rs
  cargo:bindings / widgets / optional_widgets / fonts
    -> DEP_LVGL_* metadata for dependents

rs_lvgl/build.rs
  DEP_LVGL_BINDINGS (from the linked rs_lvgl_sys)
    -> rs_lvgl_codegen::CodeGen -> OUT_DIR/generated.rs
  DEP_LVGL_WIDGETS -> cfg(lv_use_<widget>)

rs_lvgl/src/widgets/mod.rs
  include!(OUT_DIR/generated.rs) -> generated public wrappers
```

`rs_lvgl_sys` reads the vendored `vendor/include-9.6/lv_conf.h` or an application-supplied header, writes any patched copy under `OUT_DIR`, compiles the C and optional ThorVG sources, and runs bindgen. It publishes the bindings path, enabled widgets, optional widget inventory and enabled fonts as Cargo metadata. The crate has `links = "lvgl"`, so those outputs reach dependents as `DEP_LVGL_BINDINGS`, `DEP_LVGL_WIDGETS`, `DEP_LVGL_OPTIONAL_WIDGETS` and `DEP_LVGL_FONTS`.

`rs_lvgl/build.rs` reads `DEP_LVGL_BINDINGS` from the linked dependency and regenerates wrappers with `rs_lvgl_codegen`. When that metadata is absent it falls back to `rs_lvgl_sys::_bindgen_raw_src()`. The distinction matters because `rs_lvgl_sys` is both a normal and a build dependency: the build-dependency copy can have a different feature set, including `minimal-config`, so it may see a different widget set. Do not generate from an arbitrary host artifact or scan `target/` for bindings.

Generated `bindings.rs` and `generated.rs` belong to `OUT_DIR`. Change the C inputs, configuration or generator instead; the generated pointer-taking APIs retain their `unsafe` boundary.

`rs_lvgl_ui` adds a handwritten declarative layer on top of `rs_lvgl`. It selects widgets and fonts through its own additive features, depends on `rs_lvgl` with `default-features = false`, and asks `rs_lvgl_sys` for `minimal-config` so disabled widgets are not compiled into the native library.

## Configuration and feature selection

Without application inputs, the vendored configuration is authoritative and `widget-*`/`font-*` features add capabilities. With `minimal-config`, optional widgets and Montserrat sizes are off unless their feature enables them; widget dependencies such as slider-to-bar and keyboard-to-buttonmatrix are enabled automatically.

An application can supply its own header through `LVGL_CONFIG_PATH`. That header is authoritative and is not patched; requested Cargo capabilities must already be enabled in it or the build fails. `LVGL_EXTRA_C_DIR`, `LVGL_EXTRA_HEADERS` and `LVGL_CFLAGS` extend the C and bindgen inputs. See [Native integration](./native-integration.mdx) for the input contracts and [Features](./features.mdx) for the selection model.

Do not use `--all-features` as a general validation command. The matrix includes nightly-only and application-supplied paths; CI selects explicit feature sets instead.

## CI validation

`.github/workflows/rust.yml` contains four jobs. The workspace build and test job runs on Ubuntu 24.04 and macOS 15. The UI, native-contract and heap jobs run on Ubuntu 24.04.

`Cargo.lock` is ignored in this repository. CI resolves it first, then passes `--locked` to every later Cargo command:

```sh
cargo generate-lockfile
cargo build --workspace --locked
cargo test --workspace --locked -- --test-threads=1
cargo check -p rs_lvgl_ui --locked --examples --features showcase,rust_timer
cargo check -p rs_lvgl --locked --no-default-features --lib
cargo test -p rs_lvgl --locked --no-default-features --features lvgl_alloc,rust_timer -- --test-threads=1
```

The UI job runs the component and native example checks:

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

The native-contract job runs the configuration and packaged-consumer suite, plus the installed-skill check:

```sh
python3 scripts/check-native-inputs.py --locked --artifacts target/native-input-audit
python3 scripts/check-skills.py --locked --artifacts target/skill-audit
```

The heap job runs the strict Rust and LVGL allocation balance suite:

```sh
python3 scripts/check-ui-leaks.py --locked --artifacts target/leak-audit
```

LVGL tests share native global state, so they run with `-- --test-threads=1`. The alias records the same setting:

```sh
cargo test-lvgl
```

Targeted source checks used when changing a specific layer:

```sh
cargo test -p rs_lvgl_sys --test build_script -- --test-threads=1
cargo test -p rs_lvgl_codegen
```

The native input runner needs Python 3.12+; its interruption check needs POSIX process groups. The UI example runner needs SDL2 and, on headless Linux, `xvfb-run`. macOS may need the SDL2 library path shown in [Run examples](./examples.mdx).

## Local documentation and playground

The site is a separate Node package with its own lockfile. Clone the website and initialize its pinned library source, then run these commands from the website root. Building the browser runtimes also requires Rust, libclang and Emscripten; the [website README](https://github.com/umbrella22/rs_lvgl_website#build-from-a-clean-checkout) lists the toolchains and dependency preparation.

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

`npm ci` installs the locked dependency set. `dev` serves authored pages through Rspress; `build` generates the static site. `typecheck` validates the theme and documentation components, while the source and built documentation checks cover route, metadata, link and asset consistency. The static site includes a browser interpreter that runs the examples and supported Rust edits without compilation endpoints.

Start the interactive playground separately. See [Try code in the browser](./browser-playground.mdx) for Emscripten and other toolchain setup:

```sh
npm run playground
```

This command builds the site and provides an optional local Rust compiler. Open its printed URL, go to the [playground](../playground.mdx), and select **Local Rust compiler** under **Run settings** to use that service. Embedded guide examples run directly in the browser. The service runs on loopback. Submitted code compiles against the pinned `source/` revision; the compiled WebAssembly is associated with that source and handles real input, messages and animation in a browser Worker. Compilation errors, invalid views, runtime failures and timeouts remain separate results.

### Maintain code and image pairs

Canonical Rust examples live under `playground/`. The documentation panels and playground presets use the same examples. After changing an example, regenerate its native rendering and verify the source/image manifest:

```sh
npm run examples:render
npm run examples:check
npm run check-playground
npm run playground:wasm:build
npm run check-interactive
```

`examples:render` compiles and renders the canonical snippets; it needs the native Rust/C/libclang toolchain. `examples:check` checks that the recorded source and image identities still agree. `check-playground` exercises real compilation, rendering, diagnostics and cancellation. These checks cover the local host workflow; they do not certify board rendering, operating-system input or another native provider.

Guide articles live in `docs/zh/guide` and `docs/en/guide`. Both locales use the same route suffixes. Interactive articles use `.mdx` and shared components from `components/`; cross-article links use the actual relative `.md` or `.mdx` file path. Shared diagrams translate labels with the current language. Page descriptions follow the page language, and paired articles retain the same commands and feature contracts.

## AI development skills

The repository bundles two skills for coding assistants: `rs-lvgl-ui` for declarative screens and `rs-lvgl-native` for configuration, C sources and fonts. Install them into a user or project skill directory:

```sh
python3 scripts/install-skills.py --dest ~/.agents/skills
python3 scripts/install-skills.py --dest ../application/.agents/skills --skill rs-lvgl-ui
```

The installer refuses to overwrite an existing skill folder. CI validates the packaged skills with `scripts/check-skills.py`; see [AI development skills](https://github.com/umbrella22/rs_lvgl/blob/main/docs/ai-skills.md) for discovery and maintenance details.

## Host testing and target limits

Host builds and tests compile and run the vendored LVGL on the development machine, using the host toolchain, the generated bindings and in-memory displays. They do not validate a cross-compilation toolchain, ESP-IDF integration, rendering on a physical panel, DMA/GPU completion during teardown, or ABI compatibility with an external LVGL provider. The Xtensa runner in `.cargo/config.toml` invokes `espflash flash --monitor`, so a cross-target `cargo run` or test writes to attached hardware. A local run does not reproduce the CI environment.
