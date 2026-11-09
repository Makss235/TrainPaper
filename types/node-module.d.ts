// Минимальные типы для tools/test-setup.js (без @types/node).
declare module "node:module" {
  export function register(specifier: string, parentURL?: string | URL): void;
}
