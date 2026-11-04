// Everything here is a bonus: the admin is plain forms and links and works with this file off.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const boot = document.querySelector('meta[name="silver-boot"]')?.content;

  // ---------- toasts ----------
  function toast(html, ms = 6000) {
    let box = $('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      document.body.append(box);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    box.append(t);
    setTimeout(() => t.remove(), ms);
  }
  const text = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- unsaved work ----------
  // A form with unsaved text holds off every automatic reload and asks before leaving.
  const isDirty = () => $$('form[data-guard]').some((f) => f.dataset.dirty === '1');
  document.addEventListener('input', (e) => {
    const f = e.target.closest?.('form[data-guard]');
    if (f) f.dataset.dirty = '1';
  });
  document.addEventListener('submit', (e) => {
    if (e.target.matches('form[data-guard]')) delete e.target.dataset.dirty;
  });
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
  const busyTyping = () => isDirty() || ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName) && document.activeElement.value;
  const softReload = () => {
    if (busyTyping() || $('dialog[open]')) return false;
    location.reload();
    return true;
  };

  // ---------- two-step buttons, instead of a modal confirm ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-confirm]');
    if (!b) return;
    if (b.dataset.armed) return; // second click: let it through
    e.preventDefault();
    const label = b.textContent;
    b.dataset.armed = '1';
    b.textContent = b.dataset.confirm;
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = label;
    }, 3500);
  });

  // ---------- play a sketch in place (sandboxed: it never gets this page's powers) ----------
  const liveFrame = (src) => {
    const f = document.createElement('iframe');
    f.title = 'live sketch';
    f.setAttribute('sandbox', 'allow-scripts');
    f.src = src;
    return f;
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-live]');
    if (!b || b.closest('dialog')) return;
    e.preventDefault();
    e.stopPropagation();
    const frame = b.closest('.card').querySelector('.frame');
    frame.replaceChildren(liveFrame(b.dataset.live));
    frame.style.cursor = 'default';
    b.remove();
  });

  // ---------- forms that don't lose your place: the page comes back without a jump ----------
  async function swap(url, init) {
    const res = await fetch(url, init);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const next = doc.querySelector('.main');
    if (!next) return (location.href = res.url);
    const y = scrollY;
    $('.main').replaceWith(next);
    const rail = doc.querySelector('.rail');
    if (rail) $('.rail').replaceWith(rail);
    history.replaceState(null, '', res.url.replace(/([?&])done=[^&#]*&?/, '$1').replace(/[?&]$/, ''));
    scrollTo(0, y);
    document.dispatchEvent(new Event('silver:swapped'));
  }
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.matches('form[data-stay]') || e.defaultPrevented) return;
    e.preventDefault();
    const body = new URLSearchParams(new FormData(form, e.submitter));
    // getAttribute: a field named "action" would shadow form.action.
    swap(form.getAttribute('action'), { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => form.submit());
  });

  document.addEventListener('change', (e) => {
    if (e.target.matches('select[data-autosubmit]')) e.target.form.requestSubmit();
    if (e.target.matches('select[data-go]')) location.href = e.target.value;
  });

  // ---------- the contact sheet: keyboard and lightbox ----------
  function sheet() {
    const cards = $$('.sheet .card');
    if (!cards.length) return null;
    let at = Math.max(0, cards.findIndex((c) => c.id === location.hash.slice(1)));
    const mark = (i, scroll = true) => {
      at = (i + cards.length) % cards.length;
      cards.forEach((c, k) => c.classList.toggle('current', k === at));
      if (scroll) cards[at].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    return { cards, mark, card: () => cards[at] };
  }
  let s = sheet();
  document.addEventListener('silver:swapped', () => (s = sheet()));

  const light = $('dialog.light');
  function show(card) {
    if (!light) return;
    const src = card.querySelector('.frame img')?.src;
    const stage = $('.light-stage', light);
    stage.replaceChildren();
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      stage.append(img);
    }
    $('.light-side', light).innerHTML = '';
    for (const part of card.querySelectorAll('.meta, .making, .note')) $('.light-side', light).append(part.cloneNode(true));
    const live = card.dataset.sketch;
    if (live) {
      const b = document.createElement('p');
      b.innerHTML = `<button type="button" class="quiet" data-light-live="${text(live)}">play it</button> <a class="small muted" href="${text(live)}" target="_blank" rel="noopener">open alone</a>`;
      $('.light-side', light).append(b);
    }
    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.innerHTML = '<kbd>←</kbd> <kbd>→</kbd> move · <kbd>a</kbd> approve · <kbd>x</kbd> veto · <kbd>p</kbd> play · <kbd>esc</kbd> close';
    $('.light-side', light).append(hint);
    if (!light.open) light.showModal();
  }
  document.addEventListener('click', (e) => {
    const lp = e.target.closest('[data-light-live]');
    if (lp) {
      $('.light-stage', light).replaceChildren(liveFrame(lp.dataset.lightLive));
      lp.remove();
      return;
    }
    if (e.target === light) return light.close();
    const f = e.target.closest('.sheet .frame');
    if (!f || f.querySelector('iframe') || !s) return;
    const card = f.closest('.card');
    s.mark(s.cards.indexOf(card), false);
    show(card);
  });

  const decide = (verdict) => {
    const card = s?.card();
    const button = card?.querySelector(`form.decide button[value="${verdict}"]`);
    if (!button) return;
    const id = card.id;
    const wasOpen = light?.open;
    button.click();
    const after = () => {
      document.removeEventListener('silver:swapped', after);
      const i = s?.cards.findIndex((c) => c.id === id) ?? -1;
      if (i < 0) return;
      s.mark(i + 1, !wasOpen);
      if (wasOpen) show(s.card());
    };
    document.addEventListener('silver:swapped', after);
  };

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (!s) return;
    const open = light?.open;
    const moved = (i) => {
      s.mark(i, !open);
      if (open) show(s.card());
    };
    const at = s.cards.indexOf(s.card());
    switch (e.key) {
      case 'j': case 'ArrowRight': moved(s.cards.findIndex((c) => c.classList.contains('current')) === -1 ? 0 : at + 1); break;
      case 'k': case 'ArrowLeft': moved(at - 1); break;
      case 'Enter': case ' ': if (!open && s.cards.some((c) => c.classList.contains('current'))) show(s.card()); else return; break;
      case 'a': decide('approved'); break;
      case 'x': decide('vetoed'); break;
      case 'p': {
        const sketch = s.card().dataset.sketch;
        if (!sketch) return;
        if (open) $('.light-stage', light).replaceChildren(liveFrame(sketch));
        else s.card().querySelector('[data-live]')?.click();
        break;
      }
      case 'n': {
        if (open) return;
        s.card().querySelector('form.decide textarea')?.focus();
        break;
      }
      default: return;
    }
    e.preventDefault();
  });

  // ---------- the wire: floor events, job changes, restarts ----------
  if (window.EventSource && boot) {
    const wire = new EventSource('/events');
    let lost = false;
    wire.addEventListener('hello', (e) => {
      const d = JSON.parse(e.data);
      if (d.boot !== boot) {
        // New code is running. Pick it up, unless you're in the middle of something.
        if (!softReload()) toast('The admin restarted with new code. Reload when you’re done here.', 12000);
      } else if (lost) toast('Back on the wire.', 2500);
      lost = false;
    });
    wire.onerror = () => {
      lost = true;
    };
    wire.addEventListener('floor', (e) => {
      const ev = JSON.parse(e.data);
      const list = $('[data-live-floor]');
      if (list && !list.dataset.frozen) {
        const li = document.createElement('li');
        li.className = ev.cls;
        li.innerHTML = `<span class="t">${text(ev.time)}</span><span class="ty">${text(ev.type)}</span><span>${text(ev.actor)} · ${text(ev.summary)}</span>`;
        list.prepend(li);
      }
    });
    wire.addEventListener('jobs', (e) => {
      const d = JSON.parse(e.data);
      const foot = $('[data-rail-job]');
      if (foot) foot.innerHTML = d.running ? `<span class="pulse"></span>${text(d.running)}` : '';
      for (const ended of d.ended ?? []) {
        toast(`${ended.status === 'done' ? 'Done' : text(ended.status)}: <a href="/jobs/${text(ended.id)}">${text(ended.title)}</a>`);
        if ($('[data-refresh-on-job]')) setTimeout(softReload, 400);
      }
    });
  }

  // ---------- following a job's log ----------
  const log = $('pre[data-log]');
  if (log) {
    let offset = Number(log.dataset.offset);
    const tick = async () => {
      const res = await fetch(`${log.dataset.log}?offset=${offset}`).catch(() => null);
      if (!res?.ok) return setTimeout(tick, 2000);
      const d = await res.json();
      if (d.text) {
        const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
        log.append(d.text);
        if (atEnd) log.scrollTop = log.scrollHeight;
      }
      offset = d.size;
      if (d.ended) return softReload();
      setTimeout(tick, 1000);
    };
    log.scrollTop = log.scrollHeight;
    if (log.dataset.follow) tick();
  }

  // ---------- the soul editor: check as you type, save with cmd-S ----------
  const editor = $('form[data-soul]');
  if (editor) {
    const out = $('.check-result');
    let timer = null;
    const run = async () => {
      const body = new URLSearchParams(new FormData(editor));
      const res = await fetch(editor.dataset.soul, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => null);
      if (!res?.ok) return;
      const d = await res.json();
      out.innerHTML = [...d.errors.map((m) => `<span class="bad">${text(m)}</span>`), ...d.warnings.map((m) => `<span class="warn">${text(m)}</span>`)].join('') || '<span class="fine">Fine. Saving counts from the next call.</span>';
      for (const li of $$('.vars li[data-var]')) li.classList.toggle('unused', !d.used.includes(li.dataset.var));
    };
    editor.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 350);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        delete editor.dataset.dirty;
        editor.requestSubmit($('button[name="action"][value="save"]', editor) ?? undefined);
      }
    });
  }

  // ---------- the matrix sum on the studio page ----------
  const matrix = $('form[data-matrix]');
  if (matrix) {
    const out = $('[data-matrix-out]', matrix);
    const calc = () => {
      const v = (n) => Number(matrix.elements[n]?.value);
      const temps = String(matrix.elements.temperatures?.value ?? '').split(',').map((t) => t.trim()).filter(Boolean).length;
      const cells = v('modelsPerSeries') * temps * v('techniquesPerSeries');
      const variants = v('variants');
      const ok = cells > 0 && variants % cells === 0;
      out.className = ok ? 'small dim' : 'small warn';
      out.textContent = `${v('modelsPerSeries')} models × ${temps} temperatures × ${v('techniquesPerSeries')} techniques = ${cells} combinations. ${ok ? `${variants} variants fits.` : `${variants} variants doesn't divide evenly: use a multiple of ${cells}.`}`;
    };
    matrix.addEventListener('input', calc);
    calc();
  }
})();
