/** Retired training URLs stay usable without restoring the old dashboard. */
export type AppView = "play" | "import" | "settings";

export function resolveAppView(pathname: string): AppView {
  const part = pathname.split("/").filter(Boolean)[0];
  return part === "settings" ? "settings" : part === "import" ? "import" : "play";
}

export function appViewPath(view: AppView): string {
  return view === "play" ? "/" : `/${view}`;
}
