(function () {
  'use strict';

  const toggleBtn = document.getElementById('toggle-btn');
  const wordInput = document.getElementById('word-input');
  const lookupBtn = document.getElementById('lookup-btn');
  const resultDiv = document.getElementById('result');

  function updateToggleUI(isActive) {
    toggleBtn.textContent = isActive ? 'ON' : 'OFF';
    toggleBtn.className = isActive ? 'toggle-on' : 'toggle-off';
  }

  browser.storage.local.get('isActive').then((res) => {
    updateToggleUI(res.isActive || false);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isActive) {
      updateToggleUI(changes.isActive.newValue);
    }
  });

  toggleBtn.addEventListener('click', async () => {
    const res = await browser.storage.local.get('isActive');
    const isActive = !res.isActive;
    await browser.storage.local.set({ isActive });
  });

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function lookup(word) {
    const cleaned = word.replace(/^[^\w]+|[^\w]+$/g, '').trim();
    if (!cleaned || cleaned.length < 2) {
      resultDiv.innerHTML = '<p class="error">Please enter a valid word (2+ letters).</p>';
      resultDiv.classList.remove('hidden');
      return;
    }

    resultDiv.innerHTML = '<p class="loading">Looking up\u2026</p>';
    resultDiv.classList.remove('hidden');

    try {
      const result = await browser.runtime.sendMessage({ type: 'LOOKUP', word: cleaned });

      if (!result || result.error) {
        const msg = result ? result.message : 'Lookup failed. Please try again.';
        resultDiv.innerHTML = `<p class="error">${escapeHTML(msg)}</p>`;
        return;
      }

      renderResult(result.data);
    } catch (err) {
      console.error('Word Definer popup error:', err);
      resultDiv.innerHTML = '<p class="error">Could not reach dictionary service.</p>';
    }
  }

  function renderResult(data) {
    let html = '';

    for (const item of data) {
      const defs = (item.defs || []).slice(0, 4);

      html += `<div class="result-block">`;
      html += `<div class="result-word">${escapeHTML(item.word)}</div>`;
      html += '<ol class="result-defs">';
      for (const d of defs) {
        const parts = d.split('\t');
        const textDef = parts[parts.length - 1];
        html += `<li>${escapeHTML(textDef)}</li>`;
      }
      html += '</ol>';
      html += `</div>`;
    }

    resultDiv.innerHTML = html;
  }

  lookupBtn.addEventListener('click', () => lookup(wordInput.value));

  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookup(wordInput.value);
  });

  browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
    try {
      const response = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_SELECTION' });
      if (response && response.text) {
        wordInput.value = response.text;
        wordInput.select();
      }
    } catch {
      // Content script not available
    }
  });

})();