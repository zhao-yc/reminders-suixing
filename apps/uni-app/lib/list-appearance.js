const COLOR_NAMES = ['红色','橙色','黄色','绿色','浅蓝','蓝色','靛蓝','粉色','紫色','棕色','灰色','玫瑰色'];
const COLOR_VALUES = ['255, 59, 48','255, 149, 0','255, 204, 0','52, 199, 89','81, 170, 242','0, 122, 255','88, 86, 214','234, 66, 106','192, 119, 219','162, 132, 94','91, 103, 112','217, 166, 159'];

export function appearanceColorLabel(value,index) {
  const found=COLOR_VALUES.indexOf(String(value).replace(/^rgb\(|\)$/g,''));
  return found>=0?COLOR_NAMES[found]:'颜色 '+(index+1);
}

/** 几何已在适配器白名单投影；仅作为图片装载，不插入 HTML 或创建可导航页面。 */
export function listIconURL(icon) {
  if(!icon || typeof icon.svg!=='string' || icon.svg.length>60000 || !icon.svg.startsWith('<svg viewBox="0 0 64 64">'))return '';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(icon.svg.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" '));
}
