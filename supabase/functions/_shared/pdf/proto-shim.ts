// Deno يعطّل Object.prototype.__proto__، بينما يعتمد fontkit (المبني بـ Babel) عليه لوراثة
// الدوال الثابتة بين الأصناف (ArabicShaper ← DefaultShaper). نعيده قبل تحميل fontkit.
// في Deno الخاصية موجودة لكن ضابطها لا يفعل شيئاً، لذا نستبدلها دائماً (سلوك Node الطبيعي).
{
  Object.defineProperty(Object.prototype, '__proto__', {
    get() { return Object.getPrototypeOf(this); },
    set(v) { Object.setPrototypeOf(this, v); },
    configurable: true,
  });
}
export {};
