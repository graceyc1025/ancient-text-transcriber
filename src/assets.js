export function assetURL(path, base = import.meta.env?.BASE_URL ?? './', documentBase = document.baseURI) {
  return new URL(`${base}${path}`, documentBase).href;
}
