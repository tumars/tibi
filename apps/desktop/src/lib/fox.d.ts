/** 原型的 SVG 小狐狸（docs/prototypes/v2-fox.js 的副本，挂在 window.Fox 上） */
export {};
declare global {
  interface FoxHandle { set(state: string): FoxHandle; pulse(state: string, ms?: number): FoxHandle }
  interface Window { Fox: { mount(el: Element, opt?: { state?: string; size?: number; interactive?: boolean }): FoxHandle } }
}
