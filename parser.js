/* 数式パーサ: 文字列 -> (x, y, v) => number のクロージャ
 *  変数: x, y, y'(=v)   定数: pi, π, e
 *  極座標モード (opts.polar): θ / theta / t が角度変数 (x の代わり)。x, y は使用不可
 *  暗黙の乗算: 2x, 3sin(x), (x+1)(x-1), x/5x = (x/5)*x
 */
(function (g) {
  const FN = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    abs: Math.abs, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, cbrt: Math.cbrt,
    exp: Math.exp, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  };
  const FNAMES = Object.keys(FN).sort((a, b) => b.length - a.length);

  function tokenize(src, polar) {
    const s = src.replace(/\s+/g, '').replace(/π/g, 'pi').replace(/√/g, 'sqrt')
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/’/g, "'");
    const t = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      // 極座標モード: θ / theta / t を角度変数として扱う (内部的には x スロットに入れる)
      if (c === 'θ' || s.startsWith('theta', i) || (c === 't' && !FNAMES.some((n) => s.startsWith(n, i)))) {
        if (!polar) throw new Error('θ は極座標モード (r = f(θ)) でのみ使えます');
        t.push({ k: 'var', v: 'x' }); i += c === 'θ' ? 1 : s.startsWith('theta', i) ? 5 : 1;
        continue;
      }
      if (polar && (c === 'x' || c === 'y')) throw new Error('極座標モードでは x, y ではなく θ を使ってください');
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const str = s.slice(i, j);
        const n = Number(str);
        if (!isFinite(n)) throw new Error('数値が不正です: ' + str);
        t.push({ k: 'num', v: n });
        i = j;
        continue;
      }
      if ('+-*/^()'.includes(c)) { t.push({ k: c }); i++; continue; }
      if (/[a-zA-Z]/.test(c)) {
        const rest = s.slice(i);
        const f = FNAMES.find((n) => rest.startsWith(n));
        if (f) { t.push({ k: 'fn', v: f }); i += f.length; continue; }
        if (rest.startsWith('pi')) { t.push({ k: 'num', v: Math.PI }); i += 2; continue; }
        if (c === 'e') { t.push({ k: 'num', v: Math.E }); i++; continue; }
        if (c === 'x') { t.push({ k: 'var', v: 'x' }); i++; continue; }
        if (c === 'y') {
          if (s[i + 1] === "'") { t.push({ k: 'var', v: 'v' }); i += 2; }
          else { t.push({ k: 'var', v: 'y' }); i++; }
          continue;
        }
        throw new Error('使えない文字: ' + c);
      }
      throw new Error('使えない文字: ' + c);
    }
    return t;
  }

  function compile(src, opts) {
    if (!src || !src.trim()) throw new Error('関数を入力してください');
    const tk = tokenize(src, !!(opts && opts.polar));
    let p = 0;
    const peek = () => tk[p];
    const startsPrimary = (t) => t && (t.k === 'num' || t.k === 'var' || t.k === 'fn' || t.k === '(');

    function expr() {
      let l = term();
      while (peek() && (peek().k === '+' || peek().k === '-')) {
        const op = tk[p++].k;
        const a = l, b = term();
        l = op === '+' ? (x, y, v) => a(x, y, v) + b(x, y, v) : (x, y, v) => a(x, y, v) - b(x, y, v);
      }
      return l;
    }
    function term() {
      let l = unary();
      for (;;) {
        const t = peek();
        let op = null;
        if (t && (t.k === '*' || t.k === '/')) { op = t.k; p++; }
        else if (startsPrimary(t)) op = '*';
        else break;
        const a = l, b = unary();
        l = op === '*' ? (x, y, v) => a(x, y, v) * b(x, y, v) : (x, y, v) => a(x, y, v) / b(x, y, v);
      }
      return l;
    }
    function unary() {
      const t = peek();
      if (t && t.k === '-') { p++; const a = unary(); return (x, y, v) => -a(x, y, v); }
      if (t && t.k === '+') { p++; return unary(); }
      return power();
    }
    function power() {
      const base = primary();
      if (peek() && peek().k === '^') {
        p++;
        const e = unary();
        return (x, y, v) => Math.pow(base(x, y, v), e(x, y, v));
      }
      return base;
    }
    function primary() {
      const t = tk[p++];
      if (!t) throw new Error('式が途中で終わっています');
      if (t.k === 'num') { const n = t.v; return () => n; }
      if (t.k === 'var') {
        if (t.v === 'x') return (x) => x;
        if (t.v === 'y') return (x, y) => y;
        return (x, y, v) => v;
      }
      if (t.k === 'fn') {
        const f = FN[t.v];
        const a = peek() && peek().k === '(' ? primary() : power();
        return (x, y, v) => f(a(x, y, v));
      }
      if (t.k === '(') {
        const e = expr();
        if (!peek() || peek().k !== ')') throw new Error('")" が閉じていません');
        p++;
        return e;
      }
      throw new Error('式が不正です: "' + t.k + '"');
    }

    const f = expr();
    if (p < tk.length) throw new Error('式が不正です (余分な "' + tk[p].k + '")');
    return f;
  }

  g.compileExpr = compile;
})(window);
