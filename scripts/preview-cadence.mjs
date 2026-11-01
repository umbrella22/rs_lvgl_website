import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const animatedPreviewSource = `use rs_lvgl_ui::prelude::*;
struct Example;
impl App for Example {
    type Msg = ();
    fn update(&mut self, _: ()) {}
    fn view(&self, _: &Theme) -> View<()> {
        spinner().style(Style::default().width(Size::Px(120)).height(Size::Px(120)))
    }
}
fn app() -> impl App { Example }
`;

// Count changed images rather than timer callbacks or flush generations: a
// refresh of unchanged animation state must not pass the cadence regression.
export function checkPreviewCadence(app, hz) {
  const image = () => {
    const pointer = app._studio_pixels();
    assert.ok(pointer);
    return createHash("sha256").update(app.HEAPU8.subarray(pointer, pointer + 640 * 400 * 4)).digest("hex");
  };
  let previous = image();
  let changed = 0;
  const frames = hz * 2;
  for (let frame = 1; frame <= frames; frame++) {
    const elapsed = Math.round(frame * 1000 / hz) - Math.round((frame - 1) * 1000 / hz);
    assert.equal(app._studio_frame(elapsed), 0);
    const next = image();
    if (next !== previous) changed++;
    previous = next;
  }
  assert.ok(changed >= frames * 0.95, `${hz} Hz preview changed only ${changed}/${frames} images`);
  return { hz, frames, changed };
}
