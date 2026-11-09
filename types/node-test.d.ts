// Минимальные типы для тестов (node --test): без @types/node, чтобы в коде страниц
// setTimeout и прочее оставались браузерными.
declare module "node:test" {
  type Fn = (t: any) => any;
  const test: ((name: string, fn: Fn) => Promise<void>) & { describe: (name: string, fn: Fn) => void };
  export const describe: (name: string, fn: Fn) => void;
  export const beforeEach: (fn: Fn) => void;
  export const afterEach: (fn: Fn) => void;
  export const mock: any;
  export default test;
}
declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}
