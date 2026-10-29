// Modern desktop Chromium supplies microtasks; legacy script-element fallbacks are unnecessary.
export default function immediate(callback:()=>void):void { queueMicrotask(callback); }
