// Подготовка node --test: голый импорт "three" (как в importmap страниц) ведёт на копию three.js
// из public/vendor — так тесты могут проверять GameObject, Scene и компоненты без браузера.
// @ts-check
import { register } from "node:module";

register("./test-hooks.js", import.meta.url);
