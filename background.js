// --- Badge / toggle state ---

browser.storage.local.get('isActive').then((res) => {
  if (res.isActive === undefined) {
    browser.storage.local.set({ isActive: false });
  }
  updateBadge(res.isActive || false);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.isActive) {
    updateBadge(changes.isActive.newValue);
  }
});

function updateBadge(isActive) {
  browser.action.setBadgeText({ text: isActive ? 'ON' : 'OFF' });
  browser.action.setBadgeBackgroundColor({ color: isActive ? '#22c55e' : '#ef4444' });
}

// --- Datamuse API lookup with Fallback ---

const API_BASE = 'https://api.datamuse.com/words';

async function lookupWord(word) {
  const cleaned = word.replace(/^[^\w]+|[^\w]+$/g, '').trim();
  if (!cleaned || cleaned.length < 2) {
    return { error: 'invalid', message: 'Please enter a valid word (2+ letters).' };
  }

  // Helper function to call Datamuse
  const fetchDatamuse = async (queryStr) => {
    const response = await fetch(`${API_BASE}?sp=${encodeURIComponent(queryStr)}&md=d&max=1`);
    if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0 && data[0].defs) {
            return { error: null, data };
        }
    }
    return null;
  };

  // 1. Initial Attempt
  let result = await fetchDatamuse(cleaned);
  if (result) return result;

  // 2. Smart Fallback: Attempt root variations
  let variations = [];
  const lowerCleaned = cleaned.toLowerCase();

  if (lowerCleaned.endsWith('ies')) {
    variations.push(lowerCleaned.slice(0, -3) + 'y');
  } else if (lowerCleaned.endsWith('ied')) {
    variations.push(lowerCleaned.slice(0, -3) + 'y');
  } else if (lowerCleaned.endsWith('ed')) {
    variations.push(lowerCleaned.slice(0, -1));
    variations.push(lowerCleaned.slice(0, -2));
    if (lowerCleaned.length > 3 && lowerCleaned[lowerCleaned.length-3] === lowerCleaned[lowerCleaned.length-4]) {
       variations.push(lowerCleaned.slice(0, -3)); 
    }
  } else if (lowerCleaned.endsWith('ing')) {
    variations.push(lowerCleaned.slice(0, -3));
    variations.push(lowerCleaned.slice(0, -3) + 'e');
    if (lowerCleaned.length > 4 && lowerCleaned[lowerCleaned.length-4] === lowerCleaned[lowerCleaned.length-5]) {
       variations.push(lowerCleaned.slice(0, -4)); 
    }
  } else if (lowerCleaned.endsWith('s') && !lowerCleaned.endsWith('ss')) {
    variations.push(lowerCleaned.slice(0, -1));
    if (lowerCleaned.endsWith('es')) {
      variations.push(lowerCleaned.slice(0, -2));
    }
  }

  // Try fetching variations one by one
  for (const variant of variations) {
    result = await fetchDatamuse(variant);
    if (result) return result; 
  }

  // 3. Final failure if no variations matched
  return { error: 'not_found', message: `No definition found for "${cleaned}".` };
}

// Listen for lookup requests from content scripts, sidebar/popup
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOOKUP' && msg.word) {
    return lookupWord(msg.word);
  }
});

// --- Context menu: "Define Word" ---

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'word-definer-lookup',
    title: 'Define "%s"',
    contexts: ['selection']
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'word-definer-lookup') return;
  const word = info.selectionText.trim();
  if (!word) return;

  try {
    await browser.tabs.sendMessage(tab.id, { type: 'LOOKUP_WORD', word });
  } catch {
    // Content script not available
  }
});