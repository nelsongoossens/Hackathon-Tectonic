// Local design-preview renderer. Templates are DOM nodes from this document;
// values are text, attributes, or callbacks from checked-in preview logic.
// There is deliberately no string-to-code, HTML-string, or import API.
"use strict";
(() => {
  const SCREEN_NAMES = new Set([
    "01 Components", "02 Home", "03 Understands", "04 Silence Log",
    "05 Budgets", "06 Dashboard", "KBC Moments",
  ]);
  const FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
  const TAGS = new Set("a abbr b br button div em h1 h2 h3 input label li nav ol p section small span strong ul".split(" "));
  const ATTRS = new Set("class title id role style type min max step value disabled checked tabindex".split(" "));
  const EVENTS = new Set(["onclick", "onchange", "oninput"]);
  const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

  function resolve(values, expression) {
    const name = expression.trim();
    if (name === "true") return true;
    if (name === "false") return false;
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name)) return undefined;
    let value = values;
    for (const key of name.split(".")) {
      if (BLOCKED_KEYS.has(key) || value == null || !Object.hasOwn(value, key)) return undefined;
      value = value[key];
    }
    return value;
  }

  function interpolate(text, values) {
    return text.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression) => {
      const value = resolve(values, expression);
      return value == null || typeof value === "function" ? "" : String(value);
    });
  }

  function binding(text, values) {
    const match = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(text);
    return match ? resolve(values, match[1]) : undefined;
  }

  function safeHref(raw) {
    // Navigation is restricted to the other checked-in preview files.
    return [...SCREEN_NAMES].some(name => raw === `${name}.dc.html`) ? raw : null;
  }

  function compileChildren(source, target) {
    const updates = [...source.childNodes].map(node => compileNode(node, target));
    return values => updates.forEach(update => update(values));
  }

  function compileNode(source, target) {
    if (source.nodeType === Node.TEXT_NODE) {
      const node = document.createTextNode("");
      target.appendChild(node);
      return values => { node.nodeValue = interpolate(source.nodeValue || "", values); };
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return () => {};
    const tag = source.localName;
    if (tag === "sc-for" || tag === "sc-if") {
      const start = document.createComment(tag);
      const end = document.createComment(`/${tag}`);
      target.append(start, end);
      return values => {
        while (start.nextSibling !== end) start.nextSibling.remove();
        const fragment = document.createDocumentFragment();
        if (tag === "sc-if") {
          if (binding(source.getAttribute("value") || "", values)) {
            compileChildren(source, fragment)(values);
          }
        } else {
          const list = binding(source.getAttribute("list") || "", values);
          const as = source.getAttribute("as") || "item";
          if (!BLOCKED_KEYS.has(as) && Array.isArray(list)) {
            list.forEach((item, index) => compileChildren(source, fragment)({ ...values, [as]: item, $index: index }));
          }
        }
        end.before(fragment);
      };
    }
    // Scripts, frames, imports, custom elements, and head markup never render.
    if (!TAGS.has(tag)) return () => {};
    const node = document.createElement(tag);
    target.appendChild(node);
    const attributes = [];
    for (const { name, value } of source.attributes) {
      const key = name.toLowerCase();
      if (EVENTS.has(key)) {
        let callback;
        // Range input updates while dragging, as React's onChange did.
        const event = key === "onchange" && source.getAttribute("type") === "range" ? "input" : key.slice(2);
        node.addEventListener(event, e => { if (typeof callback === "function") callback(e); });
        attributes.push(values => { callback = binding(value, values); });
      } else if (key === "href" && tag === "a") {
        attributes.push(values => {
          const href = safeHref(interpolate(value, values));
          if (href) node.setAttribute("href", href);
          else node.removeAttribute("href");
        });
      } else if (ATTRS.has(key) || /^(?:aria|data)-[a-z0-9-]+$/.test(key)) {
        attributes.push(values => {
          const result = interpolate(value, values);
          if (key === "value" && tag === "input") node.value = result;
          else if (key === "checked" || key === "disabled") node[key] = binding(value, values) ?? (value !== "false");
          else node.setAttribute(key, result);
        });
      }
    }
    const updateChildren = compileChildren(source, node);
    return values => {
      attributes.forEach(update => update(values));
      updateChildren(values);
    };
  }

  class DCLogic {
    state = {};
    constructor(props = {}) { this.props = props; }
    setState(update, after) {
      this.state = { ...this.state, ...(typeof update === "function" ? update(this.state) : update) };
      this.update?.(this.renderVals());
      after?.();
    }
    renderVals() { return {}; }
    componentWillUnmount() {}
  }

  class BudgetsPreview extends DCLogic {
  state = { attn: 64, trust: 72, shownA: 64, shownT: 72, last: 'Nothing has happened yet. Attention refills daily; trust moves only when you respond.' };
  tween() {
    clearInterval(this._t);
    this._t = setInterval(() => {
      const { attn, trust, shownA, shownT } = this.state;
      const na = shownA + (attn - shownA) * 0.12, nt = shownT + (trust - shownT) * 0.12;
      if (Math.abs(na - attn) < 0.3 && Math.abs(nt - trust) < 0.3) { clearInterval(this._t); this.setState({ shownA: attn, shownT: trust }); }
      else this.setState({ shownA: na, shownT: nt });
    }, 30);
  }
  apply(da, dt, last) {
    const c = v => Math.max(0, Math.min(100, v));
    this.setState(s => ({ attn: c(s.attn + da), trust: c(s.trust + dt), last }), () => this.tween());
  }
  componentWillUnmount() { clearInterval(this._t); }
  ring(pct, color) {
    return `conic-gradient(${color} ${pct}%, rgba(18,18,18,.08) ${pct}% 100%)`;
  }
  renderVals() {
    const { shownA, shownT, attn, trust } = this.state;
    return {
      attnRing: this.ring(shownA, shownA < 25 ? '#FF4B2B' : '#121212'),
      trustRing: this.ring(shownT, '#1F4E5F'),
      attnLabel: Math.round(shownA) + '%',
      trustLabel: Math.round(shownT) + '%',
      attnNote: attn < 25 ? 'Nearly spent · gate tightens' : attn < 55 ? 'Draining · fewer moments' : 'Rested · gate open',
      trustNote: trust < 40 ? 'Low · confirm-only' : trust < 70 ? 'Building' : 'High · can act',
      explain: this.state.last,
      onShow: () => this.apply(-12, 0, 'A moment was shown. Each interruption costs attention, whether or not you respond.'),
      onAccept: () => this.apply(0, 6, 'You accepted. Trust rises, and the agent may propose slightly bolder moments.'),
      onDismiss: () => this.apply(-4, -9, 'You dismissed. Trust drops and the gate raises its threshold for this topic.'),
      onQuietDay: () => this.apply(20, 2, 'A quiet day. Attention refills; staying silent earns a little trust too.'),
      onReset: () => { this.setState({ attn: 64, trust: 72, last: 'Reset.' }, () => this.tween()); }
    };
  }
}

class DashboardPreview extends DCLogic {
  state = { who: 'lotte', t: 4, view: 'gate' };
  data = {
    lotte: { name: 'Lotte', threshold: 0.25, balances: ['€2,140', '€2,610', '€3,180', '€3,905', '€4,318', '€4,760'],
      claims: [
        ['Income', 'Bank data', 'Salary €2,410 monthly, Vandenbroucke NV', 0],
        ['Housing', 'You said', 'Saving for a house, target 2028', 0],
        ['Housing', 'Bank data', 'Rents at €890, indexed in May', 1],
        ['Household', 'You said', 'Two adults, no children', 0],
        ['Mobility', 'Bank data', 'Owns a car, insured at €68/mo', 1],
        ['Household', 'Inferred', 'Has a pet, probably a dog', 2],
        ['Income', 'You said', 'Occasional freelance invoices', 3],
        ['Household', 'Inferred', 'Groceries shared with someone', 4]],
      cands: [
        ['Salary pattern detected', 'teal', .4, .9, .2, .05, 0, 'Not actionable'],
        ['Weekend cash withdrawals', 'teal', .2, .9, .2, .05, 0, 'Too small'],
        ['Set up a house goal?', 'coral', .8, .7, .6, .05, 0, '', 'Question · Savings', 'You moved €400 to savings twice. Make it a goal?', 'Create goal'],
        ['Rent increased €40', 'teal', .6, .85, .5, .04, 1, 'Already visible'],
        ['€38 at a new café', 'teal', .2, .9, .3, .12, 1, 'Too small'],
        ['Phone contract renews', 'teal', .4, .6, .4, .08, 1, 'Low value'],
        ['Grocery spending up 30%', 'teal', .6, .64, .8, .03, 2, '', 'Question · Spending', '€612 vs €470 average. New normal or temporary?', 'Answer'],
        ['Move €120 to Huis', 'coral', .6, .77, .8, .06, 2, '', 'Set amount · Savings', 'You have €430 unspent this month.', 'Move €120'],
        ['Recurring charity donation', 'teal', .2, .95, .1, .02, 2, 'Not actionable'],
        ['Cheaper car insurance', 'teal', .7, .58, .4, .28, 3, 'You were busy'],
        ['Mortgage rates dropped', 'teal', .9, .48, .5, .05, 3, 'Low confidence'],
        ['Unknown €1,420 deposit', 'coral', .7, .83, .7, .05, 3, '', 'Voice · Income', 'A deposit came from a new sender. What is it?', 'Answer'],
        ['Energy bill €212 due', 'coral', .7, .91, .8, .05, 4, '', 'Confirm · Payments', 'Due Friday. Balance covers it with €1,840 to spare.', 'Pay €212'],
        ['Duplicate streaming €12', 'teal', .3, .8, .3, .08, 4, 'Too small'],
        ['Holiday spending spike', 'teal', .4, .7, .4, .1, 4, 'Expected'],
        ['Gym unused 6 weeks', 'teal', .4, .55, .3, .15, 4, 'Low trust on habits'],
        ['Fees on savings account', 'teal', .5, .6, .3, .05, 5, 'Low urgency'],
        ['Huis goal at 41%', 'teal', .3, 1, .2, .02, 5, 'Not actionable'],
        ['Tax prepayment reminder', 'coral', .8, .7, .9, .05, 5, '', 'Confirm · Income', 'Freelance income means a prepayment by 10 Oct.', 'Set aside €310'],
        ['Rent due, balance low?', 'coral', .9, .35, .9, .05, 5, 'Low confidence']] },
    marc: { name: 'Marc', threshold: 0.40, balances: ['€18,420', '€18,290', '€19,710', '€19,540', '€34,210', '€33,980'],
      claims: [
        ['Income', 'Bank data', 'Pension €1,980 monthly', 0],
        ['Housing', 'Bank data', 'Owns home, no mortgage', 0],
        ['Household', 'Bank data', 'Term deposit €15,000, matures Aug', 0],
        ['Income', 'You said', 'Ethias supplement €1,420 quarterly', 1],
        ['Housing', 'Bank data', 'Heating on direct debit', 1],
        ['Household', 'Inferred', 'Lives alone', 2],
        ['Household', 'You said', 'Three grandchildren', 2],
        ['Mobility', 'Inferred', 'Owns a car, drives little', 3]],
      cands: [
        ['Pension arrived', 'teal', .3, 1, .2, .02, 0, 'Not actionable'],
        ['Large pharmacy spend', 'teal', .5, .7, .4, .1, 0, 'Sensitive · no nudge'],
        ['Weekly market cash', 'teal', .2, .9, .1, .02, 0, 'Not actionable'],
        ['Set up a savings goal?', 'teal', .3, .4, .3, .05, 0, 'Low confidence'],
        ['Unknown €1,420 deposit', 'teal', .3, .9, .3, .05, 1, 'You said: supplement'],
        ['Heating advance up €60', 'coral', .7, .9, .7, .03, 1, '', 'Confirm · Housing', 'Your supplier raised the monthly advance. Accept or contest?', 'Accept'],
        ['Phone data overage', 'teal', .3, .7, .4, .06, 1, 'Too small'],
        ['Grocery spending up 30%', 'teal', .3, .6, .3, .05, 2, 'Normal variance'],
        ['Transfers to grandchildren', 'teal', .2, .8, .1, .05, 2, 'Not actionable'],
        ['Eating out more often', 'teal', .2, .6, .2, .1, 2, 'None of our business'],
        ['Card used abroad', 'coral', .9, .85, .9, .05, 3, '', 'Confirm · Security', 'Your card was used in Lisbon. Was that you?', 'Yes, me'],
        ['Insurance premium up 8%', 'teal', .5, .9, .4, .05, 3, 'Low urgency'],
        ['Cheaper car insurance', 'teal', .6, .6, .3, .2, 3, 'Drives little'],
        ['Term deposit matures €15k', 'coral', .9, 1, .7, .04, 4, '', 'Question · Savings', '€15,000 lands Thursday. Renew, or keep it available?', 'Renew'],
        ['Streaming trial ended', 'teal', .2, .7, .3, .05, 4, 'Too small'],
        ['Unused subscription', 'teal', .3, .5, .3, .1, 4, 'Low confidence'],
        ['Energy bill €188', 'teal', .4, .95, .3, .03, 5, 'Already on direct debit'],
        ['Gift tax window', 'teal', .6, .5, .5, .06, 5, 'Low confidence'],
        ['Pension indexed +2%', 'teal', .4, 1, .2, .02, 5, 'Not actionable'],
        ['Refund running late', 'coral', .7, .6, .6, .05, 5, 'Below threshold']] }
  };
  months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  renderVals() {
    const { who, t, view } = this.state, d = this.data[who];
    const pill = on => on ? ['#121212', '#F1ECE8'] : ['transparent', '#121212'];
    const [lotteBg, lotteFg] = pill(who === 'lotte'), [marcBg, marcFg] = pill(who === 'marc');
    const [gateBg, gateFg] = pill(view === 'gate'), [splitBg, splitFg] = pill(view === 'split');
    const cands = d.cands.filter(c => c[6] <= t).map(c => {
      const [title, hue, v, cf, u, cost, m, reason, kind, why, cta] = c;
      const score = v * cf * u - cost, pass = score >= d.threshold;
      const bg = hue === 'coral' ? 'radial-gradient(circle,#FF4B2B 0%,#FF8A3D 42%,rgba(255,138,61,0) 72%)' : 'radial-gradient(circle,#1F4E5F 0%,#A9D8DA 50%,rgba(169,216,218,0) 72%)';
      return { title, hue, score: score.toFixed(2), scoreN: score, pass, m, monthLabel: this.months[m], reason, kind, why, cta, conf: Math.round(cf * 100) + '%', bg, size: Math.round(90 + 130 * cf * u) };
    });
    const passing = cands.filter(c => c.pass), silent = cands.filter(c => !c.pass);
    const thisMonth = passing.filter(c => c.m === t).sort((a, b) => b.scoreN - a.scoreN)[0];
    const heldThisMonth = silent.filter(c => c.m === t).length;
    return {
      t, tally: `${passing.length} shown · ${silent.length} silent · ${this.months[t]}`,
      monthLabel: this.months[t], name: d.name, balance: d.balances[t], threshold: d.threshold.toFixed(2),
      lotteBg, lotteFg, marcBg, marcFg, gateBg, gateFg, splitBg, splitFg,
      isGate: view === 'gate', isSplit: view === 'split',
      pickLotte: () => this.setState({ who: 'lotte' }), pickMarc: () => this.setState({ who: 'marc' }),
      viewGate: () => this.setState({ view: 'gate' }), viewSplit: () => this.setState({ view: 'split' }),
      onScrub: e => this.setState({ t: +e.target.value }),
      months: this.months.map((label, i) => ({ label, color: i === t ? '#121212' : (i < t ? '#6B6461' : '#A39B98'), go: () => this.setState({ t: i }) })),
      claims: d.claims.map(([domain, source, text, m]) => ({ domain, source: m <= t ? source : '—', text: m <= t ? text : 'Not yet known', border: m <= t ? 'solid' : 'dashed', opacity: m <= t ? 1 : .45 })),
      knownCount: d.claims.filter(k => k[3] <= t).length,
      candCount: cands.length, passing, silent, silentCount: silent.length,
      hasMoment: !!thisMonth, noMoment: !thisMonth, heldThisMonth,
      momentTitle: thisMonth?.title ?? '', momentReason: thisMonth?.why ?? '', momentKind: thisMonth?.kind ?? '', momentConf: thisMonth?.conf ?? '', momentCta: thisMonth?.cta ?? '',
      momentBg: thisMonth?.bg ?? '', momentSize: thisMonth ? thisMonth.size + 40 : 0
    };
  }
}

const PREVIEW_CLASSES = new Map([["05 Budgets", BudgetsPreview], ["06 Dashboard", DashboardPreview]]);

  function boot() {
    const template = document.querySelector("x-dc");
    if (!template) return;
    for (const helmet of template.querySelectorAll("helmet")) {
      for (const child of helmet.children) {
        if (child.localName === "style") {
          const style = document.createElement("style");
          style.textContent = child.textContent;
          document.head.appendChild(style);
        } else if (child.localName === "link" && child.getAttribute("rel") === "stylesheet" && child.getAttribute("href") === FONT_STYLESHEET) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = FONT_STYLESHEET;
          document.head.appendChild(link);
        }
      }
    }
    let name;
    try { name = decodeURIComponent(location.pathname.split("/").pop() || "").replace(/\.dc\.html$/, ""); }
    catch { name = ""; }
    const Logic = PREVIEW_CLASSES.get(name) || DCLogic;
    const logic = new Logic();
    const root = document.createElement("div");
    root.id = "dc-root";
    logic.update = compileChildren(template, root);
    logic.update(logic.renderVals());
    template.replaceWith(root);
    window.addEventListener("pagehide", () => logic.componentWillUnmount(), { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
