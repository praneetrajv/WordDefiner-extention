(function () {
  'use strict';

  const IS_FILE = location.protocol === 'file:';

  let isActive = false;
  let pendingTooltip = null;
  let currentTooltip = null;

  // --- State management ---

  function loadState() {
    browser.storage.local.get('isActive').then((res) => {
      isActive = res.isActive || false;
      if (IS_FILE) syncPanelVisibility();
    });
  }

  loadState();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isActive) {
      isActive = changes.isActive.newValue;
      if (!isActive) {
        removeTooltip();
        syncPanelVisibility();
      } else if (IS_FILE) {
        syncPanelVisibility();
      }
    }
  });

  // --- Messages from background / popup ---

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE') {
      isActive = msg.isActive;
      if (!isActive) removeTooltip();
      if (IS_FILE) syncPanelVisibility();
      return Promise.resolve({ success: true });
    }
    if (msg.type === 'LOOKUP_WORD' && msg.word) {
      if (IS_FILE) {
        panelLookup(msg.word);
      } else {
        tooltipLookup(msg.word);
      }
      return Promise.resolve({ success: true });
    }
    if (msg.type === 'GET_SELECTION') {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      return Promise.resolve({ text });
    }
    return undefined;
  });

  // --- Word cleaning ---

  function cleanWord(raw) {
    return raw.replace(/^[^\w]+|[^\w]+$/g, '').trim();
  }

  // --- API lookup via background script (avoids CORS issues) ---

  async function apiLookup(word) {
    const cleaned = cleanWord(word);
    if (!cleaned || cleaned.length < 2) return null;

    try {
      const result = await browser.runtime.sendMessage({ type: 'LOOKUP', word: cleaned });
      return result;
    } catch (err) {
      console.error('Word Definer: lookup failed', err);
      return { error: 'network', message: 'Could not reach dictionary service.' };
    }
  }

  // ===========================================================
  //  TOOLTIP (web pages — double-click to look up)
  // ===========================================================

function buildTooltipHTML(word, data) {
  const entry = data[0];
  const firstMeaning = entry.meanings[0]; // Drill down into meanings array
  const pos = firstMeaning.partOfSpeech;
  const defs = firstMeaning.definitions.slice(0, 3);

  let html = '';
  html += `<span class="wd-word">${escapeHTML(word)}</span>`;
  html += `<span class="wd-pos">${escapeHTML(pos)}</span>`;
  html += '<ul class="wd-defs">';
  for (const d of defs) {
    html += `<li>${escapeHTML(d.definition)}</li>`;
  }
  html += '</ul>';

  // Safely handle missing phonetics array
  const audio = (entry.phonetics || []).find((p) => p.audio);
  if (audio) {
    html += `<button class="wd-audio" data-url="${escapeHTML(audio.audio)}" title="Play pronunciation">&#127908;</button>`;
  }

  return html;
}

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Tooltip positioning ---

  function positionTooltip(el, rect) {
    const MARGIN = 8;
    const PAD = 10;

    let x = rect.left + window.scrollX;
    let y = rect.bottom + window.scrollY + MARGIN;

    document.body.appendChild(el);
    const tipW = el.offsetWidth;
    const tipH = el.offsetHeight;

    if (y + tipH > window.innerHeight + window.scrollY - PAD) {
      y = rect.top + window.scrollY - tipH - MARGIN;
    }
    if (x + tipW > window.innerWidth + window.scrollX - PAD) {
      x = window.innerWidth + window.scrollX - tipW - PAD;
    }
    if (x < window.scrollX + PAD) x = window.scrollX + PAD;

    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // --- Show / remove tooltip ---

  function showTooltip(rect, html, isLoading) {
    removeTooltip();

    const tooltip = document.createElement('div');
    tooltip.id = 'word-definer-tooltip';
    tooltip.innerHTML = html;
    if (isLoading) tooltip.classList.add('wd-loading');

    currentTooltip = tooltip;
    positionTooltip(tooltip, rect);

    const audioBtn = tooltip.querySelector('.wd-audio');
    if (audioBtn) {
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        new Audio(audioBtn.dataset.url).play();
      });
    }

    document.addEventListener('mousedown', handleOutsideClick, true);
  }

  function removeTooltip() {
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
    document.removeEventListener('mousedown', handleOutsideClick, true);
  }

  function handleOutsideClick(e) {
    if (currentTooltip && !currentTooltip.contains(e.target)) {
      removeTooltip();
    }
  }

  // --- Tooltip lookup ---

  async function tooltipLookup(word) {
    const cleaned = cleanWord(word);
    if (!cleaned || cleaned.length < 2) return;

    // Show loading at current selection
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showTooltip(
        rect,
        `<span class="wd-word">${escapeHTML(cleaned)}</span><span class="wd-loading-text">Looking up\u2026</span>`,
        true
      );
    }

    const result = await apiLookup(cleaned);

    if (!currentTooltip) return; // dismissed while loading

    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    if (!result || result.error) {
      const msg = result ? result.message : 'Lookup failed.';
      showTooltip(rect, `<span class="wd-word">${escapeHTML(cleaned)}</span><span class="wd-error">${escapeHTML(msg)}</span>`, false);
      return;
    }

    showTooltip(rect, buildTooltipHTML(cleaned, result.data), false);
  }

  // --- Selection handler (web pages only) ---

  if (!IS_FILE) {
    document.addEventListener('mouseup', (e) => {
      if (!isActive) return;
      if (currentTooltip && currentTooltip.contains(e.target)) return;

      if (pendingTooltip) {
        clearTimeout(pendingTooltip);
        pendingTooltip = null;
      }

      pendingTooltip = setTimeout(() => {
        pendingTooltip = null;
        const sel = window.getSelection();
        if (!sel) return;

        const word = sel.toString().trim();
        if (!word || word.includes(' ') || word.length < 2) return;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        tooltipLookup(word);
      }, 150);
    });
  }

  // ===========================================================
  //  FLOATING PANEL (file:// pages — persistent dictionary)
  // ===========================================================

  let panelEl = null;
  let panelMinimized = false;

  function createPanel() {
    if (panelEl) return;

    panelEl = document.createElement('div');
    panelEl.id = 'wd-panel';
    panelEl.innerHTML = `
      <div class="wd-panel-bar">
        <span class="wd-panel-title">Word Definer</span>
        <div class="wd-panel-buttons">
          <button class="wd-panel-btn wd-minimize" title="Minimize">&#8722;</button>
          <button class="wd-panel-btn wd-close" title="Close panel">&times;</button>
        </div>
      </div>
      <div class="wd-panel-body">
        <div class="wd-panel-input-row">
          <input type="text" class="wd-panel-input" placeholder="Type a word\u2026" spellcheck="false" autocomplete="off">
          <button class="wd-panel-define">Define</button>
        </div>
        <div class="wd-panel-result"></div>
      </div>
    `;

    document.body.appendChild(panelEl);

    // --- Drag ---
    const bar = panelEl.querySelector('.wd-panel-bar');
    makeDraggable(panelEl, bar);

    // --- Minimize ---
    panelEl.querySelector('.wd-minimize').addEventListener('click', () => {
      panelMinimized = !panelMinimized;
      panelEl.classList.toggle('wd-panel-minimized', panelMinimized);
      const btn = panelEl.querySelector('.wd-minimize');
      btn.innerHTML = panelMinimized ? '&#43;' : '&#8722;';
      btn.title = panelMinimized ? 'Expand' : 'Minimize';
    });

    // --- Close ---
    panelEl.querySelector('.wd-close').addEventListener('click', () => {
      panelEl.classList.add('wd-panel-hidden');
    });

    // --- Define button ---
    const input = panelEl.querySelector('.wd-panel-input');
    const defineBtn = panelEl.querySelector('.wd-panel-define');

    defineBtn.addEventListener('click', () => panelLookup(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') panelLookup(input.value);
    });
  }

  function syncPanelVisibility() {
    createPanel();
    if (isActive) {
      panelEl.classList.remove('wd-panel-hidden');
    } else {
      panelEl.classList.add('wd-panel-hidden');
      removeTooltip();
    }
  }

  // --- Panel lookup ---

  async function panelLookup(word) {
    const cleaned = cleanWord(word);
    if (!cleaned || cleaned.length < 2) return;

    const resultEl = panelEl.querySelector('.wd-panel-result');
    const input = panelEl.querySelector('.wd-panel-input');

    resultEl.innerHTML = '<p class="wd-panel-loading">Looking up\u2026</p>';
    input.value = cleaned;

    // Expand if minimized
    if (panelMinimized) {
      panelMinimized = false;
      panelEl.classList.remove('wd-panel-minimized');
      panelEl.querySelector('.wd-minimize').innerHTML = '&#8722;';
    }

    const result = await apiLookup(cleaned);

    if (!result || result.error) {
      const msg = result ? result.message : 'Lookup failed.';
      resultEl.innerHTML = `<p class="wd-panel-error">${escapeHTML(msg)}</p>`;
      return;
    }

    renderPanelResult(cleaned, result.data);
  }

  function renderPanelResult(word, data) {
    const resultEl = panelEl.querySelector('.wd-panel-result');
    let html = '';

    for (const meaning of data) {
      html += `<div class="wd-panel-block">`;
      html += `<div class="wd-panel-word">${escapeHTML(meaning.word)}</div>`;

      const phonetic = (meaning.phonetics || []).find((p) => p.text);
      if (phonetic) {
        html += `<span class="wd-panel-phonetic">${escapeHTML(phonetic.text)}</span>`;
      }

      const audio = (meaning.phonetics || []).find((p) => p.audio);
      if (audio) {
        html += `<button class="wd-panel-audio" data-url="${escapeHTML(audio.audio)}" title="Play pronunciation">&#127908;</button>`;
      }

      for (const m of meaning.meanings) {
        html += `<div class="wd-panel-pos">${escapeHTML(m.partOfSpeech)}</div>`;
        html += '<ol class="wd-panel-defs">';
        for (const d of m.definitions.slice(0, 3)) {
          html += `<li>${escapeHTML(d.definition)}</li>`;
        }
        html += '</ol>';
      }
      html += `</div>`;
    }

    resultEl.innerHTML = html;

    resultEl.querySelectorAll('.wd-panel-audio').forEach((btn) => {
      btn.addEventListener('click', () => new Audio(btn.dataset.url).play());
    });
  }

  // --- Auto-lookup selection on file:// pages ---

  if (IS_FILE) {
    document.addEventListener('mouseup', (e) => {
      if (!isActive || !panelEl) return;
      if (panelEl.contains(e.target)) return;

      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel) return;
        const word = sel.toString().trim();
        if (!word || word.includes(' ') || word.length < 2) return;
        panelLookup(word);
      }, 150);
    });
  }

  // --- Drag helper ---

  function makeDraggable(el, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.wd-panel-btn')) return;
      dragging = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = (e.clientX - offsetX) + 'px';
      el.style.top = (e.clientY - offsetY) + 'px';
      el.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

})();
