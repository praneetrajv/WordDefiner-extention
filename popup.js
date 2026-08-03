(function () {
  'use strict';

  const toggleBtn = document.getElementById('toggle-btn');
  const wordInput = document.getElementById('word-input');
  const lookupBtn = document.getElementById('lookup-btn');
  const resultDiv = document.getElementById('result');

  // --- Toggle state ---

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

  // --- Word lookup (via background script to avoid CORS) ---

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

    for (const meaning of data) {
      const phonetic = (meaning.phonetics || []).find((p) => p.text);
      const audio = (meaning.phonetics || []).find((p) => p.audio);

      html += `<div class="result-block">`;
      html += `<div class="result-word">${escapeHTML(meaning.word)}</div>`;
      if (phonetic) {
        html += `<span class="result-phonetic">${escapeHTML(phonetic.text)}</span>`;
      }
      if (audio) {
        html += `<button class="result-audio" data-url="${escapeHTML(audio.audio)}" title="Play pronunciation">&#127908;</button>`;
      }

      for (const m of meaning.meanings) {
        html += `<div class="result-pos">${escapeHTML(m.partOfSpeech)}</div>`;
        html += '<ol class="result-defs">';
        for (const d of m.definitions.slice(0, 3)) {
          html += `<li>${escapeHTML(d.definition)}</li>`;
        }
        html += '</ol>';
      }
      html += `</div>`;
    }

    resultDiv.innerHTML = html;

    resultDiv.querySelectorAll('.result-audio').forEach((btn) => {
      btn.addEventListener('click', () => new Audio(btn.dataset.url).play());
    });
  }

  // --- Events ---

  lookupBtn.addEventListener('click', () => lookup(wordInput.value));

  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookup(wordInput.value);
  });

  // Pre-fill from current selection
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
