---
title: Debug with EmbedScope
description: Opt into EmbedScope for rs_lvgl applications, inspect real native objects and display pixels, and omit diagnostics from production builds.
---

# Debug with EmbedScope

[EmbedScope](https://umbrella22.github.io/EmbedScope_website/en/) provides a desktop Inspector, the `escope` CLI, and a Rust host SDK for device identity, logs, metrics, UI trees, display capture, and input reproduction. An rs_lvgl application reuses its existing LVGL instance and handles inspection on the UI thread.

Diagnostics require an explicit application choice. Default `rs_lvgl` and `rs_lvgl_ui` builds do not create an Agent, start a server, or enumerate a diagnostic USB interface.

## When to enable and disable diagnostics

| Scenario | Recommended configuration | Result |
| --- | --- | --- |
| UI development, layout and interaction diagnosis | Enable the application's `embedscope` feature | The Inspector can access implemented platform capabilities |
| Reproduce a problem that needs optimization | `--release --features embedscope` | Release optimization with diagnostics retained |
| Ship firmware or an application | `--release`, without selecting `embedscope` | Agent, diagnostic transport and associated capture buffers are omitted |
| Finish a session while keeping the diagnostic build running | Disconnect the Inspector or CLI | Session resources are released; the compiled Agent remains |

**`--release` does not disable diagnostics.** Cargo features and optimization profiles are independent, and features are unified across dependencies. Avoid `--all-features` for production. Check whether another dependency, build script, or workspace command enables diagnostics again.

A device continues running its installed image after a feature-disabled build. Install and boot that new image to remove the running Agent and diagnostic USB interface.

## Run the native integration example

[examples/embedscope](https://github.com/umbrella22/rs_lvgl/tree/main/examples/embedscope) is an independent application using published `rs_lvgl` / `rs_lvgl_ui` 0.3.1 and EmbedScope 0.1.0. It renders a real LVGL counter into a 320 × 240 memory display. **It does not open a simulator window**; the Inspector shows the actual LVGL flush output.

Download the CLI ZIP from [EmbedScope Releases](https://github.com/umbrella22/EmbedScope/releases/latest), extract it and add the executable directory to PATH. Running the example also requires Rust/Cargo, a native C compiler and libclang. SDL is not required. From the rs_lvgl repository root:

```sh
cargo run --manifest-path examples/embedscope/Cargo.toml --features embedscope
```

The default endpoint is `tcp://127.0.0.1:9338`. In another terminal:

```sh
escope -d tcp://127.0.0.1:9338 --json info
escope -d tcp://127.0.0.1:9338 --json ui tree
escope -d tcp://127.0.0.1:9338 display capture counter-before.png
escope -d tcp://127.0.0.1:9338 input tap 100 140 --hold-ms 60
escope -d tcp://127.0.0.1:9338 display capture counter-after.png
```

Choose unused capture filenames. Check the model is `LVGL 9.6 / memory display`; a tap changes the count and rendered pixels. The general native adapter exports real objects as generic `lv_obj` nodes with geometry/state and empty names. Semantic widget types, label text and declarative paths require an application `TreeSource`.

Connect the desktop Inspector to the same TCP endpoint. A canvas click selects an object by default; enable sending taps to reproduce input. The example accepts loopback addresses only and serves one connection at a time. Use the CLI and Inspector in turn; concurrent SDK requests share one Session.

## Give the application one explicit switch

`embedscope` is an **application feature** in the example and Dango OS. It is not a built-in `rs_lvgl_ui` feature. An application can use:

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

Keep the application's existing `rs_lvgl_ui` dependency/configuration. Gate the diagnostic modules, initialization, buffers, log fan-out and transport behind `#[cfg(feature = "embedscope")]`. Selecting dependencies makes APIs available; the application still implements Backend and byte transport.

These related switches have distinct purposes:

| Feature / API | Purpose |
| --- | --- |
| Application `embedscope` | Select Agent, transport, platform Backend and diagnostic buffers |
| `rs_lvgl_ui/diagnostics` | Structured UI events and `set_diagnostic_sink`; opens no port |
| `rs_lvgl_ui/strict-properties` | Reject modifiers unsupported by their widget; changes error behavior |
| `rs_lvgl_ui/update-metrics` | Additional UI update statistics; no remote connection |

## Connect a physical device

Reuse the application's executor, display and input drivers. Transport tasks exchange frames and queue bounded requests. The UI loop executes Backend operations at a safe point after layout, updates and native callbacks.

- Keep every LVGL access on the UI thread. Stop reads and drop the tree adapter before deleting its root. Advance revision after native changes; do not reuse node IDs or cursors across session/revision boundaries.
- Use one native provider, ABI and configuration. The example uses registry dependencies throughout. Unify sources before mixing path and registry providers, or use default `escope-lvgl` with an application `TreeSource` that does not link another LVGL.
- Capture an independently owned fixed frame. State whether it comes from a subtree, final display submission or panel readback. Direct drawing and transitions usually need the platform's final output path.
- Route injected input through system input arbitration with paired press/release. Disconnect, cancellation and shutdown release input, capture and stale-session queues.
- Fan out structured records from the existing logger before formatting. Keep unmeasured metrics `null` and advertise implemented capabilities only.

See [EmbedScope Rust integration](https://umbrella22.github.io/EmbedScope_website/en/integration/rust.html) and [LVGL integration](https://umbrella22.github.io/EmbedScope_website/en/integration/lvgl.html) for platform interfaces.

### Dango OS

[Dango OS](https://github.com/umbrella22/dangoOS) is a Rust embedded system for ESP-Mosaico with a companion Home screen, native settings and Lua applications. Its adapter uses a second USB CDC for EmbedScope while preserving the console, application installation and OTA.

In a Dango checkout containing the adapter:

```sh
# Diagnostic firmware: release optimization with EmbedScope
cargo fw --features embedscope

# Normal shipping firmware: release optimization without EmbedScope
cargo fw
```

`cargo fw` already includes `--release`. Install the diagnostic image with Dango tooling, then connect to the enumerated second CDC with `--dtr on`. The official v0.4.0 image has no diagnostic Agent. Follow the [EmbedScope Dango OS guide](https://umbrella22.github.io/EmbedScope_website/en/integration/dango.html) for integration, port selection, and native/Lua screen diagnosis.

## Verify a production build

For the native example:

```sh
cargo build --manifest-path examples/embedscope/Cargo.toml --release
cargo tree --manifest-path examples/embedscope/Cargo.toml --edges normal,build
```

The normal/build dependency graph should contain no `escope-*` when diagnostics are disabled. For firmware, also inspect the final linked artifact, USB descriptors and interfaces after boot. A disconnected Inspector does not establish removal. Switching features reuses Cargo's appropriate cached artifacts; `cargo clean` is unnecessary.

Run the native integration acceptance test with:

```sh
cargo test --manifest-path examples/embedscope/Cargo.toml --features embedscope -- --test-threads=1
```

It covers real native tree/pixels, input-driven state changes, logs, fixed capture, malformed frames, reconnect cleanup and ordered shutdown. Physical display, touch and device transport acceptance remain target-project checks.
