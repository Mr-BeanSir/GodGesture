/** 深浅色跟随系统:切换 <html> 的 dark class(Element Plus 暗色变量依赖它) */
export function setupSystemTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    document.documentElement.classList.toggle("dark", media.matches);
  };
  apply();
  media.addEventListener("change", apply);
}
