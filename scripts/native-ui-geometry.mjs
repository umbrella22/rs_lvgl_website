// Compare rendered contours with original LVGL controls at identical dimensions.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeNativePng, sha256 } from "./playground-native.mjs";

const marker = "Color::rgb(255, 0, 255)";

function inkShape(pixels, color = "magenta") {
  const points = [];
  let left = pixels.width, top = pixels.height, right = -1, bottom = -1;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 4;
      const [r, g, b] = pixels.rgba.subarray(i, i + 3);
      // The opaque slot has square edges. Its exact marker excludes the native
      // blue switch, which also has more green/blue than red.
      const visible = color === "cyan" ? r === 0 && g === 255 && b === 255 : r - g > 32 && b - g > 32;
      if (!visible) continue;
      points.push([x, y]);
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  assert.ok(points.length, `native ${color} marker must be visible`);
  return {
    bounds: [left, top, right, bottom], width: right - left + 1, height: bottom - top + 1,
    ink: points.length, mask: sha256(points.map(([x, y]) => `${x - left},${y - top}`).join(";")),
  };
}

function fixture(control, state = "normal") {
  // The observer changes the first child's native state equally in both arms.
  const observer = state === "normal" ? "" : `, unsafe { raw(|parent| {
    use rs_lvgl::sys;
    sys::lv_obj_add_state(sys::lv_obj_get_child(parent.as_ptr(), 0), sys::lv_state_t_LV_STATE_${state.toUpperCase()});
    let note = core::ptr::NonNull::new(sys::lv_obj_create(parent.as_ptr()))?;
    sys::lv_obj_add_flag(note.as_ptr(), sys::lv_obj_flag_t_LV_OBJ_FLAG_HIDDEN);
    Some(note)
  }) }`;
  return `use rs_lvgl_ui::prelude::*;
fn view(t: &Theme) -> View<()> {
    ${control.includes("accent.") ? "let accent = t.accent;" : ""}
    // SAFETY: factories return direct children retained until Ui unmount; the
    // observer uses the already mounted first child on the same native thread.
    column([${control}${observer}]).width(percent(100)).height(percent(100))
        .padding(64).background(t.background)
}`;
}

function nativeControl(kind, width, height, value, accentProgress = false) {
  const setup = kind === "slider"
    ? `sys::lv_slider_set_range(p.as_ptr(), 0, 100); sys::lv_slider_set_value(p.as_ptr(), ${value}, false);`
    : kind === "arc"
      ? `sys::lv_arc_set_range(p.as_ptr(), 0, 100); sys::lv_arc_set_value(p.as_ptr(), ${value}); sys::lv_obj_set_style_pad_all(p.as_ptr(), 12, 0); sys::lv_obj_set_style_pad_all(p.as_ptr(), 6, sys::lv_part_t_LV_PART_KNOB);`
      : value ? "sys::lv_obj_add_state(p.as_ptr(), sys::lv_state_t_LV_STATE_CHECKED);" : "";
  return `unsafe { raw(move |parent| {
    use rs_lvgl::sys;
    let p = core::ptr::NonNull::new(sys::lv_${kind}_create(parent.as_ptr()))?;
    ${setup}
    sys::lv_obj_set_size(p.as_ptr(), ${width}, ${height});
    sys::lv_obj_set_style_bg_color(p.as_ptr(), sys::lv_color_hex(0xff00ff), sys::lv_part_t_LV_PART_KNOB);
    ${accentProgress ? "sys::lv_obj_set_style_bg_color(p.as_ptr(), sys::lv_color_t { red: accent.r, green: accent.g, blue: accent.b }, sys::lv_part_t_LV_PART_INDICATOR);" : ""}
    Some(p)
  }) }`;
}

function wrappedControl(kind, width, height, value, radius) {
  const create = kind === "switch" ? `typed::switch(${value})` : `${kind === "arc" ? "" : "typed::"}${kind}(0, 100, ${value})`;
  const patch = `style().background(${marker})${radius === undefined ? "" : `.radius(${radius})`}`;
  return `${create}.width(px(${width})).height(px(${height}))` + (kind === "arc"
    ? `.padding(12).native_part_style(NativePart::Knob, ${patch}.padding(6))`
    : `.thumb_style(${patch}).into_view()`);
}

function transformSlot(inner) {
  return `container().width(px(64)).height(px(64)).child(${inner})`;
}

function transformedSquare(scale, angle, native = false, scaleY = scale) {
  if (!native) return `container().width(px(24)).height(px(24)).align(Align::Center)
    .background(${marker}).transform_scale_x(Scale::percent(${scale}))
    .transform_scale_y(Scale::percent(${scaleY})).transform_pivot_x(12).transform_pivot_y(12)
    .transform_rotation(Angle::degrees(${angle}))`;
  return `unsafe { raw(|parent| {
    use rs_lvgl::sys;
    let p = core::ptr::NonNull::new(sys::lv_obj_create(parent.as_ptr()))?;
    sys::lv_obj_remove_style_all(p.as_ptr());
    sys::lv_obj_set_size(p.as_ptr(), 24, 24);
    sys::lv_obj_set_style_align(p.as_ptr(), sys::lv_align_t_LV_ALIGN_CENTER, 0);
    sys::lv_obj_set_style_bg_color(p.as_ptr(), sys::lv_color_hex(0xff00ff), 0);
    sys::lv_obj_set_style_bg_opa(p.as_ptr(), 255, 0);
    sys::lv_obj_set_style_transform_scale_x(p.as_ptr(), ${Math.round(scale * 256 / 100)}, 0);
    sys::lv_obj_set_style_transform_scale_y(p.as_ptr(), ${Math.round(scaleY * 256 / 100)}, 0);
    sys::lv_obj_set_style_transform_pivot_x(p.as_ptr(), 12, 0);
    sys::lv_obj_set_style_transform_pivot_y(p.as_ptr(), 12, 0);
    sys::lv_obj_set_style_transform_rotation(p.as_ptr(), ${angle * 10}, 0);
    Some(p)
  }) }`;
}

function sameShape(actual, reference, name) {
  assert.deepEqual([actual.width, actual.height, actual.ink, actual.mask],
    [reference.width, reference.height, reference.ink, reference.mask], `${name}: native contour changed`);
}

export async function verifyNativeGeometry({ renderer, claritySource, clarityRecipe, artifactRoot }) {
  const output = path.join(artifactRoot, "geometry");
  await fs.mkdir(output, { recursive: true });
  const cases = [], references = new Map();
  async function render(name, source, theme, color, dimensions = {}) {
    const result = await renderer.render({ source, theme, ...dimensions });
    assert.equal(result.ok, true, JSON.stringify(result));
    const png = Buffer.from(result.image.split(",")[1], "base64");
    await fs.writeFile(path.join(output, `${name}.png`), png);
    await fs.writeFile(path.join(output, `${name}.rs`), source);
    return { ...inkShape(decodeNativePng(png), color), sourceHash: sha256(source), pngHash: sha256(png) };
  }
  for (const theme of ["light", "dark"]) {
    for (const [kind, dimensions, values] of [
      ["slider", [[240, 16], [160, 8]], [0, 50, 100]],
      ["switch", [[52, 30], [32, 18]], [false, true]],
      ["arc", [[176, 176]], [0, 50, 100]],
    ]) {
      for (const [width, height] of dimensions) for (const value of values) {
        for (const state of kind === "arc" ? ["normal"] : ["normal", "pressed", "disabled"]) {
          const name = `${kind}-${width}-${height}-${value}-${state}-${theme}`;
          const reference = await render(`native-${name}`, fixture(nativeControl(kind, width, height, value), state), theme);
          const actual = await render(`wrapper-${name}`, fixture(wrappedControl(kind, width, height, value), state), theme);
          sameShape(actual, reference, name);
          references.set(name, reference);
          cases.push({ name: `native-geometry-${name}`, actual, reference });
        }
      }
    }
    for (const scale of [100, 150]) for (const angle of [0, 45, 90]) {
      const name = `square-${scale}-${angle}-${theme}`;
      const reference = await render(`native-${name}`, fixture(transformSlot(transformedSquare(scale, angle, true))), theme);
      const actual = await render(`wrapper-${name}`, fixture(transformSlot(transformedSquare(scale, angle))), theme);
      sameShape(actual, reference, name);
      references.set(name, reference);
      cases.push({ name: `native-geometry-${name}`, actual, reference });
    }
    const sliderPatch = ".thumb_style(style().background(theme.accent))";
    assert.ok(claritySource.includes(sliderPatch));
    for (const value of [0, 50, 100]) {
      const marked = claritySource.replace("typed::slider(0, 100, 50)", `typed::slider(0, 100, ${value})`)
        .replace(sliderPatch, `.thumb_style(style().background(${marker}))`);
      const name = `sample-slider-${value}-${theme}`;
      const actual = await render(name, marked, theme);
      const reference = await render(`native-sample-slider-${value}-${theme}`,
        fixture(nativeControl("slider", 240, 16, value, true)), theme);
      sameShape(actual, reference, name);
      cases.push({ name: `native-geometry-${name}`, actual, reference });
    }
    for (const value of [false, true]) {
      const name = `sample-switch-${value}-${theme}`;
      const marked = claritySource.replace("typed::switch(true)", `typed::switch(${value}).thumb_style(style().background(${marker}))`);
      const actual = await render(name, marked, theme);
      const reference = references.get(`switch-52-30-${value}-normal-${theme}`);
      sameShape(actual, reference, name);
      cases.push({ name: `native-geometry-${name}`, actual, reference });
    }
    const transformMarker = /\.background\(theme.accent\)(?=\s*\.transform_scale_x)/;
    assert.ok(transformMarker.test(claritySource));
    const marked = claritySource.replace(transformMarker, `.background(${marker})`);
    const actual = await render(`sample-square-${theme}`, marked, theme);
    const reference = references.get(`square-150-45-${theme}`);
    sameShape(actual, reference, `sample square ${theme}`);
    const slot = "container().width(px(64)).height(px(64))";
    assert.ok(marked.includes(slot));
    const frame = await render(`sample-square-frame-${theme}`,
      marked.replace(slot, slot + ".background(Color::rgb(0, 255, 255))"), theme, "cyan");
    assert.deepEqual([frame.width, frame.height], [64, 64], "measure only the allocated transform slot");
    const [l, t, r, b] = actual.bounds, [fl, ft, fr, fb] = frame.bounds;
    assert.ok(l > fl && t > ft && r < fr && b < fb, "all transformed corners must fit inside the layout slot");
    cases.push({ name: `native-geometry-sample-square-${theme}`, actual, reference, frame });
    const recipeMain = clarityRecipe.indexOf("fn main()");
    assert.ok(recipeMain > 0, "clarity skill must contain its standalone main");
    const recipe = clarityRecipe.slice(0, recipeMain).replace(/^\/\/!/gm, "//");
    const skillPage = (speed, enabled) => recipe + `
fn view(theme: &Theme) -> View<()> {
    Fan { speed: ${speed}, enabled: ${enabled} }.view(theme).map(|_| ())
}`;
    const skillDimensions = { width: 320, height: 240 };
    for (const value of [0, 50, 100]) {
      const name = `skill-slider-${value}-${theme}`;
      const markedSkill = skillPage(value, true).replace(sliderPatch, `.thumb_style(style().background(${marker}))`);
      const actual = await render(name, markedSkill, theme, undefined, skillDimensions);
      const reference = await render(`native-${name}`, fixture(nativeControl("slider", 240, 16, value, true)), theme);
      sameShape(actual, reference, name);
      cases.push({ name: `native-geometry-${name}`, actual, reference, display: skillDimensions });
    }
    const skillSwitch = "typed::switch(binding(self.enabled, FanAction::Enabled))";
    assert.ok(recipe.includes(skillSwitch));
    for (const value of [false, true]) {
      const name = `skill-switch-${value}-${theme}`;
      const markedSkill = skillPage(50, value).replace(skillSwitch,
        `${skillSwitch}.thumb_style(style().background(${marker}))`);
      const actual = await render(name, markedSkill, theme, undefined, skillDimensions);
      const reference = references.get(`switch-52-30-${value}-normal-${theme}`);
      sameShape(actual, reference, name);
      cases.push({ name: `native-geometry-${name}`, actual, reference, display: skillDimensions });
    }
    assert.ok(transformMarker.test(recipe));
    const skillSquare = await render(`skill-square-${theme}`,
      skillPage(50, true).replace(transformMarker, `.background(${marker})`), theme, undefined, skillDimensions);
    sameShape(skillSquare, reference, `skill square ${theme}`);
    cases.push({ name: `native-geometry-skill-square-${theme}`, actual: skillSquare, reference, display: skillDimensions });
    for (const kind of ["slider", "switch"]) {
      const [width, height, value] = kind === "slider" ? [240, 16, 50] : [52, 30, true];
      const distorted = await render(`negative-radius-${kind}-${theme}`,
        fixture(wrappedControl(kind, width, height, value, 8)), theme);
      const original = references.get(`${kind}-${width}-${height}-${value}-normal-${theme}`);
      assert.notEqual(distorted.mask, original.mask, "radius-8 control must detect changed contour despite identical bounds");
      assert.deepEqual([distorted.width, distorted.height], [original.width, original.height]);
      cases.push({ name: `native-geometry-detect-radius-${kind}-${theme}`, distorted, original });
    }
    const anisotropic = await render(`negative-scale-${theme}`,
      fixture(transformSlot(transformedSquare(150, 45, false, 100))), theme);
    assert.notEqual(anisotropic.mask, reference.mask, "single-axis scale must detect changed square proportions");
    cases.push({ name: `native-geometry-detect-single-axis-${theme}`, distorted: anisotropic, original: reference });
    const clipped = await render(`negative-transform-slot-${theme}`,
      marked.replace(slot, "container().width(px(24)).height(px(24))"), theme);
    assert.notEqual(clipped.mask, reference.mask, "undersized layout slot must expose clipped transformed corners");
    cases.push({ name: `native-geometry-detect-small-slot-${theme}`, distorted: clipped, original: reference });
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ passed: true, cases }, null, 2) + "\n");
  return cases;
}
