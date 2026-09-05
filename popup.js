(function () {
  'use strict';

  const toggleBtn = document.getElementById('toggle-btn');
  const wordInput = document.getElementById('word-input');
  const contextInput = document.getElementById('context-input'); // Added context element
  const lookupBtn = document.getElementById('lookup-btn');
  const resultDiv = document.getElementById('result');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const keyStatus = document.getElementById('key-status');

  let currentContext = "";

  function updateToggleUI(isActive) {
    toggleBtn.textContent = isActive ? 'ON' : 'OFF';
    toggleBtn.className = isActive ? 'toggle-on' : 'toggle-off';
  }

  // Load active state and saved API key on startup
  browser.storage.local.get(['isActive', 'geminiApiKey']).then((res) => {
    updateToggleUI(res.isActive || false);
    if (res.geminiApiKey) {
      apiKeyInput.value = res.geminiApiKey;
    }
  });

  // Save API key to local extension storage
  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    await browser.storage.local.set({ geminiApiKey: key });
    keyStatus.style.display = 'block';
    setTimeout(() => { keyStatus.style.display = 'none'; }, 2000);
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
    
    // Grab manual context if provided in the textarea
    const manualContext = contextInput ? contextInput.value.trim() : "";
    if (manualContext) {
      currentContext = manualContext;
    } else if (currentContext && !currentContext.includes(cleaned)) {
      currentContext = "";
    }

    if (!cleaned || cleaned.length < 2) {
      resultDiv.innerHTML = '<p class="error">Please enter a valid word (2+ letters).</p>';
      resultDiv.classList.remove('hidden');
      return;
    }

    resultDiv.innerHTML = '<p class="loading">Looking up…</p>';
    resultDiv.classList.remove('hidden');

    try {
      const result = await browser.runtime.sendMessage({ type: 'LOOKUP', word: cleaned });

      if (!result || result.error) {
        const msg = result ? result.message : 'Lookup failed. Please try again.';
        resultDiv.innerHTML = `<p class="error">${escapeHTML(msg)}</p>`;
      } else {
        renderResult(result.data, cleaned);
      }
    } catch (err) {
      console.error('Word Definer popup error:', err);
      resultDiv.innerHTML = '<p class="error">Could not reach dictionary service.</p>';
    }
  }

  function renderResult(data, word) {
    let html = '';

    for (const item of data) {
      const defs = (item.defs || []).slice(0, 4);
      html += `<div class="result-block">`;
      html += `<div class="result-word">${escapeHTML(item.word)}</div>`;
      html += '<ol class="result-defs">';
      for (const d of defs) {
        const textDef = d.split('\t').pop();
        html += `<li>${escapeHTML(textDef)}</li>`;
      }
      html += '</ol>';
      html += `</div>`;
    }

    html += `
      <div class="wd-ai-container" style="margin-top: 15px; border-top: 1px solid #45475a; padding-top: 10px;">
        <button id="popup-ai-btn" class="wd-ai-btn">🤖 Explain in Context</button>
        <div id="popup-ai-result" class="wd-ai-result hidden" style="margin-top: 10px; padding: 10px; background: #181825; border-radius: 6px; border: 1px solid #45475a; color: #a6e3a1; font-size: 13px;"></div>
      </div>
    `;

    resultDiv.innerHTML = html;

    const aiBtn = document.getElementById('popup-ai-btn');
    const aiResultDiv = document.getElementById('popup-ai-result');

    if (aiBtn) {
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true;
        aiBtn.innerText = '🤖 Analyzing Context…';
        aiResultDiv.classList.remove('hidden');
        aiResultDiv.innerHTML = '<span class="loading">Thinking…</span>';

        // Read manual input context if present, otherwise fall back to word
        const manualContext = contextInput ? contextInput.value.trim() : "";
        const contextToUse = manualContext || currentContext || word;

        try {
          // Delegate to background script messaging instead of fetching directly
          const response = await browser.runtime.sendMessage({
            type: 'AI_EXPLAIN',
            targetText: word,
            surroundingContext: contextToUse,
            mode: 'contextual_definition'
          });

          if (response.error) {
            throw new Error(response.message || 'Failed to generate explanation.');
          }

          aiResultDiv.innerHTML = `<div>${escapeHTML(response.explanation)}</div>`;
          aiBtn.innerText = '🤖 AI Context Explanation';
        } catch (error) {
          aiResultDiv.innerHTML = `<div class="error">${escapeHTML(error.message || 'Failed to generate explanation. Check API Key or Backend.')}</div>`;
          aiBtn.disabled = false;
          aiBtn.innerText = '🤖 Retry AI';
        }
      });
    }
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
        currentContext = response.context || response.text;
        if (contextInput && response.context) {
          contextInput.value = response.context;
        }
        wordInput.select();
        lookup(response.text);
      }
    } catch {
      // Content script not active
    }
  });
})();