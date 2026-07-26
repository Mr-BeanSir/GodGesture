/**
 * 颜色工具:配置存储格式为 #AARRGGBB(WGestures 兼容),
 * Element Plus 取色器(hex + alpha)使用 #RRGGBBAA。
 */

const ARGB_RE = /^#([0-9A-Fa-f]{8})$/;
const RGBA_HEX_RE = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

/** #AARRGGBB -> #RRGGBBAA(供取色器) */
export function argbToRgbaHex(argb: string): string {
  const m = ARGB_RE.exec(argb);
  if (!m) return "#FFFFFFFF";
  const hex = m[1].toUpperCase();
  return `#${hex.slice(2)}${hex.slice(0, 2)}`;
}

/** #RRGGBBAA / #RRGGBB -> #AARRGGBB(写回配置) */
export function rgbaHexToArgb(rgba: string | null | undefined): string {
  if (!rgba) return "#FFFFFFFF";
  const m = RGBA_HEX_RE.exec(rgba.trim());
  if (!m) return "#FFFFFFFF";
  const rgb = m[1].toUpperCase();
  const alpha = (m[2] ?? "FF").toUpperCase();
  return `#${alpha}${rgb}`;
}

/** #AARRGGBB -> css rgba(),用于预览 */
export function argbToCss(argb: string): string {
  const m = ARGB_RE.exec(argb);
  if (!m) return "transparent";
  const hex = m[1];
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  const r = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const b = parseInt(hex.slice(6, 8), 16);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
