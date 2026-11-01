# rs_lvgl documentation and interactive playground

The bilingual Rspress 2.0.23 site serves Chinese at `/` and English at `/en/`.
The published guides are at [Chinese](https://umbrella22.github.io/rs_lvgl_website/)
and [English](https://umbrella22.github.io/rs_lvgl_website/en/).
It covers LVGL integration for embedded Rust: native builds, typed widgets,
display and input, and the optional declarative `View` API. Each guide has a
matching translation.

## Build from a clean checkout

This repository publishes its own GitHub Pages site at `/rs_lvgl_website/`.
The `source/` submodule pins the library, vendored LVGL, native configuration and
desktop studio used by the browser consumers. Builds use that revision without
requiring a separate library checkout next to this repository.

Install Node.js 24, Rust 1.99.1 with rustfmt, a C/C++ compiler, libclang and
Emscripten 6.0.13, then run:

```sh
git clone --recurse-submodules https://github.com/umbrella22/rs_lvgl_website.git
cd rs_lvgl_website
rustup component add rustfmt
rustup target add wasm32-unknown-emscripten
npm ci
cargo fetch --locked --manifest-path wasm/Cargo.toml
cargo fetch --locked --manifest-path browser-engine/Cargo.toml
cargo generate-lockfile --manifest-path source/Cargo.toml
cargo fetch --locked --manifest-path source/Cargo.toml
npm run build
npm run check-docs -- --built
npm run preview
```

For an existing clone, `git submodule update --init --recursive` restores its
recorded source revision. Updating `source` is a reviewed dependency change:
regenerate and inspect native example images, rebuild all browser runtimes,
and run the checks below before committing the new submodule revision.
Generated binaries, dependency caches and `doc_build/` remain ignored.

Source receipts retain their original logical names: `website/...` resolves
inside this repository, while library paths such as `rs_lvgl_ui/...` resolve
inside `source/`. `scripts/paths.mjs` defines this mapping. Existing diagram
provenance remains verifiable across the directory move.

## Guide structure and presentation

The guides move from host setup to widget layout, input and component reuse,
then device integration, feature selection and application lifetime. Existing
route names remain stable; `guide/ui-runtime` contains mounting, update errors,
allocation and teardown. Source snippets and runtime behavior are shared with
the existing examples.

Use a short task introduction, show the smallest useful example, explain its
visible result, and put configuration or lifetime rules beside the relevant
operation. Detailed reference material follows the common path. Keep commands,
API names and safety conditions equivalent in both languages.

Rspress Steps and keyboard-accessible PlatformTabs format setup instructions.
GuideLinks supplies localized
continuation links; native details elements fold optional explanations and long
examples. The theme adds hover/focus and anchor feedback without moving reading
content during scrolling. Presentation animations honor reduced motion. Diagram
and example runtimes retain their own existing lifecycle behavior.

## Component preview

`/studio` (English: `/en/studio`) runs the complete Rust/LVGL component studio
in WebAssembly. All nine categories share their views and update functions with
`rs_lvgl_ui/examples/studio.rs`. The native sidebar, Reset and Dark mode controls
operate the application directly. Source excerpts follow the selected category;
there is no duplicate HTML toolbar. Closing the studio or a load failure reveals
a restart action. Esc leaves canvas keyboard focus.

The preview includes pointer input, physical keyboard focus, native timers,
custom-widget animation, GIF, Lottie and LVGL's on-screen Pinyin keyboard.
Browser/OS IME composition is not bridged. Its fixed 1280×860 display scales with
the page, including pointer coordinates. Open the separate tab for more room on
a narrow screen. Hardware drivers and physical screens require target acceptance.

## Interactive playground

`/playground` (English: `/en/playground`) pairs editable Rust UI source with a
real LVGL canvas. Browser mode is the default and works on static hosting, including
source edits, input and state updates. It sends no session or compilation requests.
A precompiled Rust/syn interpreter evaluates the documented subset and calls the
existing `rs_lvgl_ui` constructors, `App` and `Ui`; it is not rustc or a borrow checker.
The [supported syntax guide](docs/en/guide/browser-playground.mdx) defines its scope.

The entry is `fn app() -> impl rs_lvgl_ui::App`. Keep state in a struct, implement
`App::update` and `App::view`, and return the initial app. The switch source is
complete and copyable; layout examples include their visible `view-app.rs` wrapper.
No new configuration language is required. The runtime supplies display, input,
timers, `Ui::drain` and `Ui::tick`.

`LiveExample` and `useRustPlayground` share the same engine and Worker with the full
playground. Each visible example owns its source, cancellation and preview state.
Run with the button or Cmd/Ctrl+Enter; the full playground also debounces automatic
runs by 650 ms. Only the first valid frame replaces the active preview. Failed
source or initialization retains its last successful image, and pending Workers
are terminated when cancelled, superseded or unmounted. Restart preview resets
the current application. Every successful source run starts fresh state.

Syntax, unsupported operations, range/type errors and execution limits report
source locations. Native validation failures point to the view entry. Event
closures enqueue data in native callbacks; the interpreter evaluates them in
`App::update`. Updates commit only when evaluation succeeds. A Worker watchdog
terminates nonresponsive execution after five seconds.

The independent `browser-engine/` crate owns its parser dependencies and lockfile.
It rejects unsupported syntax across the whole file and bounds source size,
parser depth, call depth, operations, collections, value expansion, text, nodes
and key identities. It exposes no filesystem, network, unsafe or external-crate
execution. Embedded examples always use the browser engine. In the full
playground, open **Run settings** and select **Local Rust compiler** to compile
complete Rust through the loopback service.
Unsupported browser code never triggers a compiler request automatically.

```sh
cargo test --locked --manifest-path browser-engine/Cargo.toml -- --test-threads=1
npm run browser-engine:build
npm run browser-engine:check -- --passes 3
```

The checker compares all seven preset images, including switch state updates,
pixel-for-pixel against compiled modules. It also covers edited layout, slider
input, diagnostics, native mount rejection, teardown, recovery and isolated
instances. `browser-engine:assets` verifies input/output hashes without compiling.
`prebuild` ensures the engine assets exist and match the current sources.

## Visual explanations

The declarative UI, input/events, native integration and feature guides include
four bilingual Archify diagrams. Animated overviews follow the site theme. Explore
diagram opens a reader with node/relationship inspection. Every diagram uses
Classic, starts live and follows the supplied document theme; native toolbars are
omitted, and reduced-motion preferences remain respected. Keyboard zoom,
a separate-tab link and adjacent text remain available.

The switch data model and message flow use the same Settings, Message and App
code as the playground. Build and capability diagrams are traced to the current
build scripts, manifests and runtime entry points. Source/candidate/output hashes
are checked by `npm run diagrams:check` and the build pre-hook.
See [diagram maintenance](diagrams/README.md) for evidence and regeneration.

## Local setup and commands

Use Rust/Cargo, a C compiler and libclang from the
[getting started guide](docs/en/guide/getting-started.mdx), plus Emscripten and
Node/npm. Verified versions are Rust 1.99.1, Emscripten 6.0.13, Node 24 and npm 11
on macOS arm64. Linux can use the [official emsdk](https://emscripten.org/docs/getting_started/downloads.html);
activate its environment before invoking the build. From the repository root:

```sh
# macOS SDK installation; use emsdk on other hosts.
brew install emscripten
rustup component add rustfmt
rustup target add wasm32-unknown-emscripten
npm ci
cargo fetch --locked --manifest-path wasm/Cargo.toml
cargo fetch --locked --manifest-path browser-engine/Cargo.toml
cargo generate-lockfile --manifest-path source/Cargo.toml
cargo fetch --locked --manifest-path source/Cargo.toml
npm run playground
```

Open the printed URL, normally `http://127.0.0.1:4173/rs_lvgl_website/playground.html`. The first build
compiles the studio, seven reference presets and browser engine; later local-mode
edits reuse the dependency cache. Cargo uses its offline cache for snippet builds. Missing dependencies or
SDK tools produce toolchain diagnostics. `emcc`, `em++`, `embuilder` and `em-config`
must be on PATH. The target libc sysroot is initialized before bindgen runs.

`dev` provides Rspress hot reload and browser interpretation after the engine
assets are built; it has no local compiler endpoint. `playground` adds the optional
local compiler endpoint. Rebuild and reload after changing the site source. Static
visitors can edit supported syntax without installing tools. Full Rust compilation
still needs the local compiler mode.

## Compiler and runtime ownership

```text
Complete Rust app + display size + theme
  -> same-origin loopback HTTP service
  -> isolated locked Cargo consumer -> Emscripten -> JS/Wasm
  -> dedicated browser Worker -> LVGL input/timers -> App update/view
  -> copied RGBA frame -> canvas
```

Compilation sessions live in `target/rspress-wasm/sessions/`; dependency outputs
remain in `target/rspress-wasm/`. Each service has a distinct package and output
name. Requests are serialized per service. A newer request cancels and waits for
the previous process group before replacing its source; client revisions discard
late responses. The successful result contains the generated module and binary,
not an arbitrary file URL. Ctrl+C stops the server, cancels builds and removes its
session source directory. Root Cargo.lock and embedded library defaults stay intact.

A new runtime replaces the old one only after it produces a valid first frame.
Workers own their native state and Wasm memory. Replacing or leaving the preview
terminates its worker, including blocked user code. Keyboard input is active only
while the canvas is focused; Esc exits it. Pinyin uses LVGL's on-screen keyboard;
OS IME composition is not bridged.

Playground animation, display refresh and input timers are serviced by the
browser's animation frames. The preview runtime uses a 1 ms eligibility period
for those native timers so LVGL's default 33 ms interval does not cap a 60 Hz or
120 Hz browser preview. No additional timer loop is started, and unchanged pixels
are not transferred. This setting belongs to the website consumer; embedded
library defaults are unchanged.

The service binds only to `127.0.0.1`, checks Host and Origin, and requires a session
token. Trusted local Rust compilation runs with the current account's privileges.
A Worker isolates runtime execution; it does not sandbox compiler macros or build
scripts. Do not expose this local compiler through a public proxy. Source is not
sent to an external compiler. URLs select known examples rather than executing
arbitrary source. Source is limited to 64 KiB, compilation to 120 seconds, and
runtime calls to 5 seconds. Dimensions are integer pixels: width 240–960, height
160–720. Other hosts need their own native/process acceptance.

## Verify and regenerate

```sh
npm test
npm run typecheck
npm run check-docs
npm run wasm:build
npm run wasm:check
npm run check-wasm
npm run playground:wasm:build
npm run playground:wasm:check
npm run check-interactive -- --passes 3
npm run build
npm run check-docs -- --built
npm run check-playground -- --passes 3
```

`build` checks native source/image pairs and ensures current studio/preset Wasm
assets. Generated binaries are ignored under `docs/public/{wasm,playground-wasm}`;
source, toolchain and output hashes reject stale or modified assets. Preset source
is generated from canonical inputs into `playground/generated/apps.json`.
`check-interactive` executes real Wasm controls, messages, pixel changes, validation,
cleanup, cancellation and compiler isolation. Browser acceptance additionally
checks Worker loading, input, edits, failures/timeouts, recovery and navigation.
`check-playground` retains the native snapshot pipeline used for guide fallbacks
and source/render verification.

Source checks cover metadata, links, fences, navigation and locale parity. Built
checks include routes, assets, anchors, locale alternates and search indexes.
These checks do not certify hardware, other native providers or other hosts.

## Keep examples and fallback images together

```text
playground/examples/*.rs                 canonical Rust source
playground/catalog.mjs                   localized titles and descriptions
scripts/render-examples.mjs              real native rendering and identity check
playground/generated/examples.json       source, image hashes and native identity
docs/public/playground/*.png            corresponding LVGL snapshots
components/NativeExample.tsx             localized guide example adapter
components/LiveExample.tsx               inline source editor and Wasm preview
components/useRustPlayground.ts          browser/local runs and preview state
browser-engine/                         bounded Rust syntax interpreter and Wasm bridge
components/Playground.tsx                full playground with size/theme options
```

After changing an example or relevant native implementation:

```sh
npm run examples:render
npm run examples:check
```

Review both the generated image and source, then retain the Rust file, manifest
and PNG together. `build` runs `examples:check` first and rejects stale native
input identities, code, captions or image hashes. The example identity check validates existing
receipts without invoking Cargo; missing or stale Wasm assets are built by prebuild. The identity check does not certify a different
target, external provider, font configuration or dependency resolution.

Use `<NativeExample id="column" />` in MDX for a complete editable App and real
Wasm preview, with the native image as its initial loading fallback. Use
`<AppExample id="switch" />` for stateful applications. The complete displayed
source comes from `playground/generated/apps.json`, including the visible wrapper
for pure view examples. Copy copies exactly that source. Reset restores the
bundled source and runtime. Static pages run supported source edits in the browser and link to the supported
syntax guide; full Rust compilation remains an explicit local mode.
`ConceptDiagram` explains tree order, keyed identity, messages, native builds,
capabilities and error stages. These diagrams summarize contracts; they are not
screenshots. Original component-studio images in `docs/public/images/` remain
copies of `docs/images/`; their provenance is in `docs/images/studio-receipt.json`.

## Site structure and conventions

- `docs/{zh,en}/_nav.json` controls top navigation; `guide/_meta.json` controls
  sidebar order. Add paired routes when adding or renaming a page.
- Every page has a title, description and exactly one H1. Guide links use relative
  source paths, such as `./declarative-ui.mdx`.
- Paired pages contain the same commands, examples and limitations. API claims
  come from current Rust sources, manifests and CI.
- React assets and links use Rspress `withBase`; Markdown assets use public paths.
- Theme changes use public CSS variables and Layout slots. `theme/index.tsx`
  reexports the original theme; no component ejection is needed.
- Dependencies, generated site output and native build artifacts stay ignored.
  Canonical examples, their small images and the source/hash manifest are inputs.

## Static hosting and subpaths

`doc_build/` can be hosted as a static site, including interactive WebAssembly
components, editable supported Rust examples, diagrams and recorded native
examples. Browser mode requires no compiler service. Only full Rust compilation
requires a local checkout and the local command above.

For a subpath and a different local port, use matching build/server options:

```sh
RSPRESS_BASE=/rs-lvgl/ npm run build
RSPRESS_BASE=/rs-lvgl/ npm run check-docs -- --built
node scripts/playground-server.mjs --base /rs-lvgl/ --port 4174
```

For a static preview without the compiler, use
`npm run preview -- --port 4174`. Neither preview command
rebuilds the site.

The default build base and documentation workflow use `/rs_lvgl_website/`. The workflow validates both
languages and all browser runtimes, then uploads `doc_build/` as a Pages artifact.
Successful builds on `main` deploy through the `github-pages` environment;
pull requests and other branches only build and validate. Configure the repository's
Pages source as **GitHub Actions** in `umbrella22/rs_lvgl_website`. The workflow
checks out the pinned submodule recursively. A manual run of **Documentation and WebAssembly
studio** on `main` rebuilds and deploys the same pipeline.

The public site is `https://umbrella22.github.io/rs_lvgl_website/`. GitHub Pages serves
the browser interpreter, compiled component studio and static assets; full Rust
compilation remains available through the optional local service.
