/* Tibi 吉祥物：藏狐（SVG + CSS 动画，多状态）。
   风格：圆滚滚的一体身形、大眼睛大瞳孔带高光、饱和暖色、无描边的扁平色块（参考多邻国 Duo 的可爱感，造型原创）。
   藏狐特征：宽而方的大脸、浅色"方下巴"脸颊、半垂的上眼皮（招牌的淡定眼神）、小耳朵、灰色体侧、蓬松尾巴带白尖。
   用法：const f = Fox.mount(el, { state: 'idle', size: 120, interactive: true }); f.set('thinking'); f.pulse('happy', 2000);
   状态：idle 待机 · listening 倾听 · thinking 思考 · reading 阅读 · happy 开心 · sleeping 睡觉 · surprised 惊讶
   prefers-reduced-motion 时停在静态姿势。 */
(() => {
  const STATES = ['idle', 'listening', 'thinking', 'reading', 'happy', 'sleeping', 'surprised'];
  const LABEL = { idle: '待机', listening: '倾听', thinking: '思考', reading: '阅读', happy: '开心', sleeping: '睡觉', surprised: '惊讶' };
  const C = { fur: '#f5a043', furDk: '#e3842a', cream: '#fff4e2', flank: '#cfc3b4', inner: '#ffc7a6', ink: '#2b1f17', blush: '#ff8f7d', tongue: '#f2766a', mouth: '#8a2e24', book: '#3d52e0' };

  const CSS = `
.fox { display: block; overflow: visible; }
.fox * { transform-box: view-box; }
.fox .all { transform-origin: 100px 186px; }
.fox .tail { transform-origin: 130px 168px; animation: fox-tail 3s ease-in-out infinite; }
.fox .body { transform-origin: 100px 182px; animation: fox-breathe 3.4s ease-in-out infinite; }
.fox .head { transform-origin: 100px 140px; animation: fox-bob 3.4s ease-in-out infinite; transition: transform .35s cubic-bezier(.3,1.5,.5,1); }
.fox .ear-l { transform-origin: 66px 46px; transition: transform .3s cubic-bezier(.3,1.6,.5,1); }
.fox .ear-r { transform-origin: 134px 46px; transition: transform .3s cubic-bezier(.3,1.6,.5,1); animation: fox-ear 6.5s infinite; }
.fox .eyes { transform-origin: 100px 86px; animation: fox-blink 4.8s infinite; }
.fox .brows { transition: transform .25s ease; }
.fox[data-state="listening"] .brows, .fox[data-state="surprised"] .brows { transform: translateY(-4px); }
.fox[data-state="listening"] .pupils circle.p { r: 10px; }
.fox[data-state="thinking"] .pupils circle.p, .fox[data-state="reading"] .pupils circle.p { r: 11px; }
.fox .pupils { transition: transform .3s ease; }
.fox .lids { transition: transform .25s ease, opacity .2s; transform-origin: 100px 70px; }
.fox .e-happy, .fox .e-closed, .fox .m-open, .fox .book, .fox .fx > g { display: none; }
@keyframes fox-tail { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }
@keyframes fox-breathe { 50% { transform: scale(1.02, .985); } }
@keyframes fox-bob { 50% { transform: translateY(1.5px); } }
@keyframes fox-blink { 0%, 90%, 100% { transform: scaleY(1); } 92% { transform: scaleY(.1); } 94% { transform: scaleY(1); } }
@keyframes fox-ear { 0%, 86%, 100% { transform: rotate(0); } 89% { transform: rotate(14deg); } 92% { transform: rotate(-4deg); } }
/* 倾听：眼睛睁大（眼皮收起）、耳朵竖、头偏 */
.fox[data-state="listening"] .lids, .fox[data-state="surprised"] .lids { transform: translateY(-14px) scaleY(.2); opacity: 0; }
.fox[data-state="listening"] .ear-l { transform: rotate(-10deg) translateY(-3px); }
.fox[data-state="listening"] .ear-r { transform: rotate(10deg) translateY(-3px); animation: none; }
.fox[data-state="listening"] .head { animation: none; transform: rotate(6deg); }
.fox[data-state="listening"] .pupils { transform: translate(-2px, -1px); }
/* 思考：歪头、看右上、气泡点 */
.fox[data-state="thinking"] .head { animation: none; transform: rotate(-8deg); }
.fox[data-state="thinking"] .pupils { transform: translate(4px, -4px); }
.fox[data-state="thinking"] .lids { transform: translateY(-3px); }
.fox[data-state="thinking"] .fx .think { display: inline; }
.fox .think circle { animation: fox-dot 1.4s ease-in-out infinite; }
.fox .think circle:nth-child(2) { animation-delay: .2s; } .fox .think circle:nth-child(3) { animation-delay: .4s; }
@keyframes fox-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
/* 阅读：捧书、低头、眼睛扫行 */
.fox[data-state="reading"] .book { display: inline; }
.fox[data-state="reading"] .paws { display: none; }
.fox[data-state="reading"] .head { animation: none; transform: translateY(4px); }
.fox[data-state="reading"] .pupils { animation: fox-scan 2.4s ease-in-out infinite; }
.fox .book .page { transform-origin: 100px 150px; animation: fox-flip 3.2s ease-in-out infinite; }
@keyframes fox-scan { 0%, 100% { transform: translate(-3px, 4px); } 45%, 55% { transform: translate(3px, 4px); } }
@keyframes fox-flip { 0%, 70% { transform: scaleX(1); opacity: 1; } 85% { transform: scaleX(-1); opacity: 1; } 100% { transform: scaleX(-1); opacity: 0; } }
/* 开心：^ ^ 笑眼、张嘴、蹦、尾巴快摇、星星 */
.fox[data-state="happy"] .e-open, .fox[data-state="sleeping"] .e-open { display: none; }
.fox[data-state="happy"] .e-happy, .fox[data-state="happy"] .m-open { display: inline; }
.fox[data-state="happy"] .m-shut { display: none; }
.fox[data-state="happy"] .blush { opacity: .8; }
.fox[data-state="happy"] .all { animation: fox-hop .8s cubic-bezier(.3,0,.4,1) infinite; }
.fox[data-state="happy"] .tail { animation-duration: .4s; }
.fox[data-state="happy"] .eyes, .fox[data-state="sleeping"] .eyes, .fox[data-state="surprised"] .eyes { animation: none; }
.fox[data-state="happy"] .fx .spark { display: inline; }
.fox[data-state="happy"] .ear-l { transform: rotate(-8deg); } .fox[data-state="happy"] .ear-r { transform: rotate(8deg); animation: none; }
.fox .spark path { transform-origin: center; transform-box: fill-box; animation: fox-pop 1.6s ease-in-out infinite; }
.fox .spark path:nth-child(2) { animation-delay: .5s; } .fox .spark path:nth-child(3) { animation-delay: 1s; }
@keyframes fox-hop { 0%, 100% { transform: translateY(0) scale(1, 1); } 15% { transform: translateY(0) scale(1.06, .93); } 45% { transform: translateY(-14px) scale(.97, 1.04); } 75% { transform: translateY(0) scale(1.04, .96); } }
@keyframes fox-pop { 0%, 100% { transform: scale(0) rotate(0); opacity: 0; } 30% { transform: scale(1) rotate(20deg); opacity: 1; } 60% { transform: scale(.6) rotate(40deg); opacity: .5; } }
/* 睡觉：闭眼、头歪、慢呼吸、Z */
.fox[data-state="sleeping"] .e-closed { display: inline; }
.fox[data-state="sleeping"] .head { animation: none; transform: translateY(5px) rotate(6deg); }
.fox[data-state="sleeping"] .body { animation-duration: 5.5s; }
.fox[data-state="sleeping"] .tail { animation-duration: 8s; }
.fox[data-state="sleeping"] .ear-l { transform: rotate(14deg); } .fox[data-state="sleeping"] .ear-r { transform: rotate(-14deg); animation: none; }
.fox[data-state="sleeping"] .fx .zz { display: inline; }
.fox .zz text { animation: fox-z 3s ease-in-out infinite; opacity: 0; }
.fox .zz text:nth-child(2) { animation-delay: 1s; } .fox .zz text:nth-child(3) { animation-delay: 2s; }
@keyframes fox-z { 0% { opacity: 0; transform: translate(0, 4px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(10px, -16px); } }
/* 惊讶：眼睛睁圆、瞳孔变小、耳朵竖、弹一下、感叹号 */
.fox[data-state="surprised"] .e-open { transform-origin: 100px 86px; transform: scale(1.1); }
.fox[data-state="surprised"] .pupils { transform: translate(0, 0) ; }
.fox[data-state="surprised"] .pupils circle.p { r: 6px; }
.fox[data-state="surprised"] .ear-l { transform: rotate(-8deg) translateY(-6px) scaleY(1.12); }
.fox[data-state="surprised"] .ear-r { transform: rotate(8deg) translateY(-6px) scaleY(1.12); animation: none; }
.fox[data-state="surprised"] .all { animation: fox-jolt .5s cubic-bezier(.3,1.6,.5,1) 1; }
.fox[data-state="surprised"] .tail { animation: fox-puff .5s ease-out 1 forwards; }
.fox[data-state="surprised"] .fx .bang { display: inline; }
@keyframes fox-jolt { 0% { transform: translateY(0); } 40% { transform: translateY(-10px); } 100% { transform: translateY(0); } }
@keyframes fox-puff { to { transform: rotate(16deg) scale(1.1); } }
.fox .bang text { animation: fox-pop2 .5s cubic-bezier(.3,1.6,.5,1) 1 both; transform-origin: center; transform-box: fill-box; }
@keyframes fox-pop2 { from { transform: scale(0); } to { transform: scale(1); } }
.fox .shadow { transform-origin: 100px 188px; }
.fox[data-state="happy"] .shadow { animation: fox-shadow .8s cubic-bezier(.3,0,.4,1) infinite; }
@keyframes fox-shadow { 45% { transform: scaleX(.75); opacity: .05; } }
@media (prefers-reduced-motion: reduce) { .fox *, .fox .all { animation: none !important; transition: none !important; } .fox .zz text, .fox .think circle { opacity: 1; } }`;

  function svg(state = 'idle', opt = {}) {
    const s = opt.size || 120, label = opt.label || `Tibi 吉祥物藏狐：${LABEL[state] || ''}`;
    return `<svg class="fox" viewBox="0 0 200 200" width="${s}" height="${s}" data-state="${state}" role="img" aria-label="${label}">
  <ellipse class="shadow" cx="100" cy="189" rx="54" ry="7" fill="currentColor" opacity=".1"/>
  <g class="fx">
    <g class="think" fill="${C.flank}"><circle cx="156" cy="40" r="4"/><circle cx="168" cy="27" r="5.5"/><circle cx="182" cy="12" r="7"/></g>
    <g class="zz" fill="${C.flank}" font-family="Geist, system-ui, sans-serif" font-weight="800"><text x="150" y="44" font-size="15">z</text><text x="160" y="31" font-size="19">z</text><text x="172" y="16" font-size="24">Z</text></g>
    <g class="spark" fill="#ffc83d"><path d="M26 60l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><path d="M172 34l2.6 6.4 6.4 2.6-6.4 2.6-2.6 6.4-2.6-6.4-6.4-2.6 6.4-2.6z"/><path d="M180 120l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></g>
    <g class="bang"><text x="156" y="46" font-size="30" font-weight="900" fill="${C.furDk}" font-family="Geist, system-ui, sans-serif">!</text></g>
  </g>
  <g class="all">
    <g class="tail">
      <path d="M128 170c38 6 66-18 60-48-4-16-24-18-27-3-2 10 3 19-1 28-4 10-14 16-32 23z" fill="${C.fur}"/>
      <path d="M161 119c-3-17 22-22 27-3-8 5-18 6-27 3z" fill="${C.cream}"/>
    </g>
    <g class="body">
      <path d="M50 150c0-30 22-48 50-48s50 18 50 48c0 22-18 34-50 34s-50-12-50-34z" fill="${C.fur}"/>
      <path d="M52 158c-4-18 4-34 16-42-4 16-4 36 4 58-10-3-17-8-20-16z" fill="${C.flank}"/>
      <path d="M148 158c4-18-4-34-16-42 4 16 4 36-4 58 10-3 17-8 20-16z" fill="${C.flank}"/>
      <ellipse cx="100" cy="154" rx="30" ry="26" fill="${C.cream}"/>
      <ellipse cx="80" cy="183" rx="15" ry="7" fill="${C.furDk}"/><ellipse cx="120" cy="183" rx="15" ry="7" fill="${C.furDk}"/>
      <g class="paws" fill="${C.furDk}"><ellipse cx="78" cy="146" rx="9" ry="7.5"/><ellipse cx="122" cy="146" rx="9" ry="7.5"/></g>
    </g>
    <g class="book">
      <path d="M62 138l38 8 38-8v30l-38 8-38-8z" fill="${C.book}"/>
      <path d="M66 136l34 7 34-7v28l-34 7-34-7z" fill="#fff"/>
      <path d="M100 143v28" stroke="${C.ink}" stroke-opacity=".25" stroke-width="2"/>
      <path d="M73 146l20 4M73 153l20 4M107 150l20-4M107 157l20-4" stroke="${C.ink}" stroke-opacity=".2" stroke-width="2.4" stroke-linecap="round"/>
      <path class="page" d="M100 143l32-6.6v25.6l-32 6.6z" fill="#fff" stroke="${C.ink}" stroke-opacity=".12" stroke-width="1.2"/>
      <g fill="${C.furDk}"><ellipse cx="66" cy="152" rx="8.5" ry="7.5"/><ellipse cx="134" cy="152" rx="8.5" ry="7.5"/></g>
    </g>
    <g class="head">
      <g class="ear-l"><path d="M48 60c-8-24-4-46 8-50 10-2 24 14 32 32z" fill="${C.fur}"/><path d="M57 50c-4-14-2-28 4-30 6 0 14 10 19 21z" fill="${C.inner}"/></g>
      <g class="ear-r"><path d="M152 60c8-24 4-46-8-50-10-2-24 14-32 32z" fill="${C.fur}"/><path d="M143 50c4-14 2-28-4-30-6 0-14 10-19 21z" fill="${C.inner}"/></g>
      <path d="M100 26C54 26 26 58 24 98c-2 26 28 42 76 42s78-16 76-42c-2-40-30-72-76-72z" fill="${C.fur}"/>
      <path d="M25 104c13-4 25 2 41 2 14 0 22-14 34-14s20 14 34 14c16 0 28-6 41-2 1 22-27 36-75 36s-76-14-75-36z" fill="${C.cream}"/>
      <path d="M25 104c-3 18 13 30 27 33-10-11-14-23-12-35-6-1-11 0-15 2z" fill="${C.flank}"/><path d="M175 104c3 18-13 30-27 33 10-11 14-23 12-35 6-1 11 0 15 2z" fill="${C.flank}"/>
      <ellipse class="blush" cx="53" cy="114" rx="11" ry="6" fill="${C.blush}" opacity=".5"/><ellipse class="blush" cx="147" cy="114" rx="11" ry="6" fill="${C.blush}" opacity=".5"/>
      <path class="brows" d="M58 62q12-6 24-1M118 61q12-5 24 1" stroke="${C.furDk}" stroke-width="3" stroke-linecap="round" fill="none"/>
      <g class="eyes">
        <g class="e-open">
          <circle cx="70" cy="86" r="16" fill="#fff"/><circle cx="130" cy="86" r="16" fill="#fff"/>
          <g class="pupils"><circle class="p" cx="71" cy="87" r="13" fill="${C.ink}"/><circle class="p" cx="129" cy="87" r="13" fill="${C.ink}"/><circle cx="76" cy="84" r="3.4" fill="#fff"/><circle cx="134" cy="84" r="3.4" fill="#fff"/></g>
          <g class="lids"><path d="M54 80a16 16 0 0 1 32 0z" fill="${C.fur}"/><path d="M114 80a16 16 0 0 1 32 0z" fill="${C.fur}"/><path d="M53 80.5q17-1.5 34 0M113 80.5q17-1.5 34 0" stroke="${C.ink}" stroke-width="3.4" stroke-linecap="round" fill="none"/></g>
        </g>
        <g class="e-happy" stroke="${C.ink}" stroke-width="5.5" stroke-linecap="round" fill="none"><path d="M57 91q13-17 26 0"/><path d="M117 91q13-17 26 0"/></g>
        <g class="e-closed" stroke="${C.ink}" stroke-width="4.6" stroke-linecap="round" fill="none"><path d="M57 86q13 11 26 0"/><path d="M117 86q13 11 26 0"/></g>
      </g>
      <path d="M93 103c0-5 14-5 14 0 0 4-4 7-7 7s-7-3-7-7z" fill="${C.ink}"/><ellipse cx="97" cy="102.5" rx="2.2" ry="1.3" fill="#fff" opacity=".6"/>
      <path class="m-shut" d="M100 110v3M100 113c-2 4-8 4-10 1M100 113c2 4 8 4 10 1" stroke="${C.ink}" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      <g class="m-open"><path d="M88 112c3 15 21 15 24 0z" fill="${C.mouth}"/><path d="M93 120c3-3 11-3 14 0-2 4-5 5-7 5s-5-1-7-5z" fill="${C.tongue}"/></g>
    </g>
  </g>
</svg>`;
  }

  function injectCss() { const old = document.getElementById('fox-css'); if (old) return; const st = document.createElement('style'); st.id = 'fox-css'; st.textContent = CSS; document.head.appendChild(st); }

  function mount(el, opt = {}) {
    injectCss();
    let base = opt.state || 'idle', timer = null;
    el.innerHTML = svg(base, opt);
    const node = () => el.querySelector('.fox');
    const apply = st => { const n = node(); if (n && n.getAttribute('data-state') !== st) { n.setAttribute('data-state', st); n.setAttribute('aria-label', `Tibi 吉祥物藏狐：${LABEL[st]}`); } };
    const api = {
      el, get state() { return base; },
      set(st) { if (!STATES.includes(st)) return api; base = st; clearTimeout(timer); timer = null; apply(st); return api; },
      pulse(st, ms = 1800) { clearTimeout(timer); apply(st); timer = setTimeout(() => { timer = null; apply(base); }, ms); return api; },
    };
    if (opt.interactive) {
      el.style.cursor = 'pointer'; el.title = el.title || '戳一下';
      el.addEventListener('click', () => api.pulse(base === 'sleeping' ? 'surprised' : 'happy', 1600));
      el.addEventListener('mouseenter', () => { if (base === 'sleeping' && !timer) api.pulse('listening', 1400); });
    }
    return api;
  }

  window.Fox = { STATES, LABEL, svg, mount, injectCss };
})();
