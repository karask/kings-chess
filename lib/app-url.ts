/** Vite supplies the hosting directory; Node-based tests default to local root. */
export function appBasePath(base = import.meta.env?.BASE_URL ?? "/"): string {
  const directory = base.split("/").filter(Boolean).join("/");
  return directory ? `/${directory}/` : "/";
}

export function assetUrl(path: string, base?: string): string {
  return `${appBasePath(base)}${path.replace(/^\/+/, "")}`;
}
