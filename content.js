(function () {
  'use strict';

  let isActive = false;
  let pendingTooltip = null;
  let currentTooltip = null;

  // --- State management ---

  browser.storage.local.get('isActive').then((res) => {
    isActive = res.isActive || false;
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isActive) {
      isActive = changes.isActive.newValue;
      if (!isActive) removeTooltip();
    }
  });

  // --- Messages from background / popup / sidebar ---

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE') {
      isActive = msg.isActive;
      if (!isActive) removeTooltip();
      return Promise.resolve({ success: true });
    }
    if (msg.type === 'LOOKUP_WORD' && msg.word) {
      tooltipLookup(msg.word);
      return Promise.resolve({ success: true });
    }
    if (msg.type === 'GET_SELECTION') {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      return Promise.resolve({ text });
    }
    return undefined;
  });

  function cleanWord(raw) {
    return raw.replace(/^[^\w]+|[^\w]+$/g, '').trim();
  }

  async function apiLookup(word) {
    const cleaned = cleanWord(word);
    if (!cleaned || cleaned.length < 2) return null;

    try {
      return await browser.runtime.sendMessage({ type: 'LOOKUP', word: cleaned });
    } catch (err) {
      console.error('Word Definer: lookup failed', err);
      return { error: 'network', message: 'Could not reach dictionary service.' };
    }
  }

  // --- Tooltip rendering ---

  function buildTooltipHTML(word, data) {
    const item = data[0];
    const defs = (item.defs || []).slice(0, 3);

    let html = '';
    html += `<span class="wd-word">${escapeHTML(word)}</span>`;
    html += '<ul class="wd-defs">';
    for (const d of defs) {
      const parts = d.split('\t');
      const textDef = parts[parts.length - 1];
      html += `<li>${escapeHTML(textDef)}</li>`;
    }
    html += '</ul>';

    return html;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

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

  function showTooltip(rect, html, isLoading) {
    removeTooltip();

    const tooltip = document.createElement('div');
    tooltip.id = 'word-definer-tooltip';
    tooltip.innerHTML = html;
    if (isLoading) tooltip.classList.add('wd-loading');

    currentTooltip = tooltip;
    positionTooltip(tooltip, rect);

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

  async function tooltipLookup(word) {
    const cleaned = cleanWord(word);
    if (!cleaned || cleaned.length < 2) return;

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

    if (!currentTooltip) return;
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    if (!result || result.error) {
      const msg = result ? result.message : 'Lookup failed.';
      showTooltip(rect, `<span class="wd-word">${escapeHTML(cleaned)}</span><span class="wd-error">${escapeHTML(msg)}</span>`, false);
      return;
    }

    showTooltip(rect, buildTooltipHTML(cleaned, result.data), false);
  }

  // --- Selection listener ---

  document.addEventListener('mouseup', () => {
    if (!isActive) return;

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

      tooltipLookup(word);
    }, 150);
  });

})();