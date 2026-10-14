/** Retired training URLs stay usable without restoring the old dashboard. */
import { appBasePath } from "./app-url";

export type AppView = "play" | "import" | "settings";

export function resolveAppView(pathname: string): AppView {
  const part = pathname.split("/").filter(Boolean)[0];
  return part === "settings" ? "settings" : part === "import" ? "import" : "play";
}

export function resolveAppLocation(location: { pathname: string; hash: string }, base?: string): AppView {
  const root = appBasePath(base);
  const path = location.hash.startsWith("#/") ? location.hash.slice(1)
    : root !== "/" && location.pathname.startsWith(root) ? `/${location.pathname.slice(root.length)}` : location.pathname;
  return resolveAppView(path);
}

export function appViewPath(view: AppView, base?: string): string {
  const root = appBasePath(base);
  if (root !== "/") return view === "play" ? root : `${root}#/${view}`;
  return view === "play" ? "/" : `/${view}`;
}
