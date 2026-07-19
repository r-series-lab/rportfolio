export type WindowSize = {
  height: number;
  width: number;
};

export type WindowLayout = {
  defaultSize: WindowSize;
  minimumSize: WindowSize;
};

const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1000;
const MINIMUM_WIDTH_FLOOR = 800;
const MINIMUM_HEIGHT_FLOOR = 620;

export function windowLayoutForWorkArea(workArea: WindowSize): WindowLayout {
  const width = validDimension(workArea.width, 1280);
  const height = validDimension(workArea.height, 800);
  const minimumSize = {
    width: Math.min(width, Math.max(MINIMUM_WIDTH_FLOOR, Math.round(width * 0.58))),
    height: Math.min(height, Math.max(MINIMUM_HEIGHT_FLOOR, Math.round(height * 0.68))),
  };
  return {
    minimumSize,
    defaultSize: {
      width: Math.min(width, DEFAULT_MAX_WIDTH, Math.max(minimumSize.width, Math.round(width * 0.92))),
      height: Math.min(height, DEFAULT_MAX_HEIGHT, Math.max(minimumSize.height, Math.round(height * 0.9))),
    },
  };
}

export async function configureDesktopWindow() {
  if (!isTauriRuntime()) return null;
  const [{ LogicalSize }, { currentMonitor, getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/dpi"),
    import("@tauri-apps/api/window"),
  ]);
  const appWindow = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const scaleFactor = monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
  const layout = windowLayoutForWorkArea({
    width: monitor.workArea.size.width / scaleFactor,
    height: monitor.workArea.size.height / scaleFactor,
  });
  await appWindow.setMinSize(new LogicalSize(layout.minimumSize.width, layout.minimumSize.height));
  if (!(await appWindow.isMaximized())) {
    await appWindow.setSize(new LogicalSize(layout.defaultSize.width, layout.defaultSize.height));
    await appWindow.center();
  }
  return layout;
}

function validDimension(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
