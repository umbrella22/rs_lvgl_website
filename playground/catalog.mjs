export const examples = [
  { id: 'column', title: { zh: '从一列开始', en: 'Start with a column' }, description: { zh: '子节点按集合顺序排列，gap 控制间距。', en: 'Children follow collection order; gap sets their spacing.' } },
  { id: 'row', title: { zh: '给内容留出空间', en: 'Make room for content' }, description: { zh: '用 flex_grow 分配剩余空间，组织一行操作。', en: 'Distribute remaining space with flex_grow in an action row.' } },
  { id: 'grid', title: { zh: '用网格指定位置', en: 'Place views in a grid' }, description: { zh: '轨道决定尺寸，grid_cell 决定位置和跨度。', en: 'Tracks set sizes; grid_cell sets position and span.' } },
  { id: 'title', title: { zh: '提取一个标题', en: 'Extract a title' }, description: { zh: '普通函数返回 View，复用结构与样式。', en: 'An ordinary function returns a View to share structure and style.' } },
  { id: 'controls', title: { zh: '组合设备控件', en: 'Compose device controls' }, description: { zh: '修改滑块、开关和按钮的初始外观。', en: 'Change the initial appearance of sliders, switches and buttons.' } },
  { id: 'keyed-list', title: { zh: '为条目保留身份', en: 'Give items an identity' }, description: { zh: '集合决定顺序，稳定的业务 ID 决定身份。', en: 'The collection determines order; stable business IDs determine identity.' } },
];
