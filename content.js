(function () {
  'use strict';

  let isActive = false;
  let pendingTooltip = null;
  let currentTooltip = null;

  browser.storage.local.get('isActive').then((res) => {
    isActive = res.isActive || false;
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isActive) {
      isActive = changes.isActive.newValue;
      if (!isActive) removeTooltip();
    }
  });

  // --- Message Listener ---

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE') {
      isActive = msg.isActive;
      if (!isActive) removeTooltip();
      return Promise.resolve({ success: true });
    }
    if (msg.type === 'LOOKUP_WORD' && msg.word) {
      const context = getSelectedContext();
      tooltipLookup(msg.word, context);
      return Promise.resolve({ success: true });
    }
    if (msg.type === 'GET_SELECTION') {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      const context = getSelectedContext();
      return Promise.resolve({ text, context });
    }
    return undefined;
  });

  function getSelectedContext() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const anchor = sel.anchorNode;
    if (!anchor) return '';

    let element = anchor.parentElement;
    
    // List of inline HTML tags that don't contain full paragraph context
    const inlineTags = new Set([
      'B', 'I', 'STRONG', 'EM', 'SPAN', 'CODE', 'A', 'MARK', 
      'SMALL', 'SUB', 'SUP', 'U', 'VAR', 'LABEL', 'CITE'
    ]);

    // Traverse up the DOM tree until we reach a block element (like <p>, <div>, <li>)
    while (
      element && 
      inlineTags.has(element.tagName) && 
      element.parentElement && 
      element.parentElement.tagName !== 'BODY'
    ) {
      element = element.parentElement;
    }

    // Fallback: If text is too short (< 20 chars), take the parent element's parent text
    if (element && element.innerText.trim().length < 20 && element.parentElement) {
      element = element.parentElement;
    }

    return element ? element.innerText.trim() : sel.toString().trim();
  }

  function cleanWord(raw) {
    return raw.replace(/^[^\w]+|[^\w]+$/g, '').trim();
  }

  // --- Tooltip Rendering ---

  function showTooltip(rect, html) {
    removeTooltip();

    const tooltip = document.createElement('div');
    tooltip.id = 'word-definer-tooltip';
    tooltip.innerHTML = html;

    // Prevent mousedown inside tooltip from clearing text selection
    tooltip.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

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

  async function tooltipLookup(word, context) {
    const cleaned = cleanWord(word);
    if (!cleaned || cleaned.length < 2) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    showTooltip(
      rect,
      `<span class="wd-word">${escapeHTML(cleaned)}</span>
       <span class="wd-loading-text">Looking up…</span>`
    );

    const result = await browser.runtime.sendMessage({ type: 'LOOKUP', word: cleaned });

    if (!currentTooltip) return;

    let html = `<span class="wd-word">${escapeHTML(cleaned)}</span>`;

    if (result && !result.error && result.data && result.data[0]?.defs) {
      const defs = result.data[0].defs.slice(0, 2);
      html += '<ul class="wd-defs">';
      for (const d of defs) {
        const textDef = d.split('\t').pop();
        html += `<li>${escapeHTML(textDef)}</li>`;
      }
      html += '</ul>';
    } else {
      html += `<div class="wd-error">No dictionary definition found.</div>`;
    }

    html += `
      <div class="wd-ai-container">
        <button id="wd-ai-btn" class="wd-ai-btn">🤖 Explain in Context</button>
        <div id="wd-ai-result" class="wd-ai-result hidden"></div>
      </div>
    `;

    showTooltip(rect, html);

    const aiBtn = currentTooltip.querySelector('#wd-ai-btn');
    const aiResultDiv = currentTooltip.querySelector('#wd-ai-result');

    if (aiBtn) {
      aiBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Stop event propagation
        aiBtn.disabled = true;
        aiBtn.innerText = '🤖 Analyzing Context…';
        aiResultDiv.classList.remove('hidden');
        aiResultDiv.innerHTML = '<span class="wd-loading-text">Thinking…</span>';

        const aiResponse = await browser.runtime.sendMessage({
          type: 'AI_EXPLAIN',
          targetText: cleaned,
          surroundingContext: context,
          mode: 'contextual_definition'
        });

        if (aiResponse && !aiResponse.error) {
          aiResultDiv.innerHTML = `<div class="wd-ai-text">${escapeHTML(aiResponse.explanation)}</div>`;
          aiBtn.innerText = '🤖 AI Context Explanation';
        } else {
          aiResultDiv.innerHTML = `<div class="wd-error">${escapeHTML(aiResponse.message)}</div>`;
          aiBtn.disabled = false;
          aiBtn.innerText = '🤖 Retry AI';
        }
      });
    }
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Mouse Selection Listener ---

document.addEventListener('mouseup', (e) => {
    if (!isActive) return;

    // IGNORE mouseup if user clicked inside the active tooltip
    if (currentTooltip && currentTooltip.contains(e.target)) {
      return;
    }

    const sel = window.getSelection();
    // Exit immediately if there's no selection or if it's just a single click (collapsed)
    if (!sel || sel.isCollapsed) return;

    const word = sel.toString().trim();
    if (!word || word.includes(' ') || word.length < 2) return;

    const context = getSelectedContext();
    tooltipLookup(word, context);
  });
})();