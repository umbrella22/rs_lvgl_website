const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
const near = (a, b) => Math.abs(a - b) < 0.01;

function checkPort(rect, point, outside, edge, endpoint) {
  const { x, y, width, height } = rect;
  const ports = [
    [x, y + height / 2, -1, 0],
    [x + width, y + height / 2, 1, 0],
    [x + width / 2, y, 0, -1],
    [x + width / 2, y + height, 0, 1],
  ];
  const port = ports.find(([px, py]) => near(px, point[0]) && near(py, point[1]));
  if (!port) throw new Error(`Diagram edge ${edge} ${endpoint} misses the side midpoint.`);
  const dx = outside[0] - point[0];
  const dy = outside[1] - point[1];
  if (!near(dx * port[3] - dy * port[2], 0) || dx * port[2] + dy * port[3] <= 0) {
    throw new Error(`Diagram edge ${edge} ${endpoint} runs along or into the node border.`);
  }
}

// These modes expose canonical orthogonal points. Tree mode uses curved branch
// trunks, which keep their native topology and are reviewed visually.
export function verifyDiagramPorts(html, type) {
  if (!['class', 'dataflow'].includes(type)) return 0;
  const nodes = new Map();
  for (const match of html.matchAll(/<g\b([^>]*\bdata-node-id="[^"]+"[^>]*)>([\s\S]*?)<\/g>/g)) {
    const node = attributes(match[1]);
    const tag = [...match[2].matchAll(/<rect\b[^>]*>/g)].find(([tag]) => attributes(tag).class === 'c-mask');
    if (!tag) throw new Error(`Missing diagram node boundary: ${node['data-node-id']}.`);
    const rect = attributes(tag[0]);
    nodes.set(node['data-node-id'], Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Number(rect[key])])));
  }
  let count = 0;
  for (const [tag] of html.matchAll(/<path\b[^>]*\bdata-composition-points="[^"]+"[^>]*>/g)) {
    const edge = attributes(tag);
    if (!edge['data-edge-id']) continue;
    const points = edge['data-composition-points'].split(';').map((point) => point.split(',').map(Number));
    const from = nodes.get(edge['data-edge-from']);
    const to = nodes.get(edge['data-edge-to']);
    if (!from || !to || points.length < 2) throw new Error(`Missing diagram geometry: ${edge['data-edge-id']}.`);
    checkPort(from, points[0], points[1], edge['data-edge-id'], 'start');
    checkPort(to, points.at(-1), points.at(-2), edge['data-edge-id'], 'end');
    count += 1;
  }
  if (!count) throw new Error('No canonical diagram edges found.');
  return count;
}
