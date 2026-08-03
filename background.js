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

// --- Centralized dictionary API lookup ---

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

async function lookupWord(word) {
  const cleaned = word.replace(/^[^\w]+|[^\w]+$/g, '').trim();
  if (!cleaned || cleaned.length < 2) {
    return { error: 'invalid', message: 'Please enter a valid word (2+ letters).' };
  }

  let response = await fetch(`${API_BASE}/${encodeURIComponent(cleaned)}`);

  // Smart Fallback: Attempt multiple root variations if the exact word fails
  if (!response.ok) {
    let variations = [];
    const lowerCleaned = cleaned.toLowerCase();

    if (lowerCleaned.endsWith('ies')) {
      variations.push(lowerCleaned.slice(0, -3) + 'y'); // flies -> fly
    } else if (lowerCleaned.endsWith('ied')) {
      variations.push(lowerCleaned.slice(0, -3) + 'y'); // spied -> spy
    } else if (lowerCleaned.endsWith('ed')) {
      variations.push(lowerCleaned.slice(0, -1)); // doted -> dote
      variations.push(lowerCleaned.slice(0, -2)); // angered -> anger
      
      // Handle double consonants: mapped -> map
      if (lowerCleaned.length > 3 && lowerCleaned[lowerCleaned.length-3] === lowerCleaned[lowerCleaned.length-4]) {
         variations.push(lowerCleaned.slice(0, -3)); 
      }
    } else if (lowerCleaned.endsWith('ing')) {
      variations.push(lowerCleaned.slice(0, -3)); // angering -> anger
      variations.push(lowerCleaned.slice(0, -3) + 'e'); // doting -> dote
      
      // Handle double consonants: running -> run
      if (lowerCleaned.length > 4 && lowerCleaned[lowerCleaned.length-4] === lowerCleaned[lowerCleaned.length-5]) {
         variations.push(lowerCleaned.slice(0, -4)); 
      }
    } else if (lowerCleaned.endsWith('s') && !lowerCleaned.endsWith('ss')) {
      variations.push(lowerCleaned.slice(0, -1)); // cats -> cat
      if (lowerCleaned.endsWith('es')) {
        variations.push(lowerCleaned.slice(0, -2)); // catches -> catch
      }
    }

    // Try fetching the variations one by one until a match is found
    for (const variant of variations) {
      response = await fetch(`${API_BASE}/${encodeURIComponent(variant)}`);
      if (response.ok) break; 
    }
  }

  if (!response.ok) {
    return { error: 'not_found', message: `No definition found for "${cleaned}".` };
  }

  const data = await response.json();
  return { error: null, data };
}

// Listen for lookup requests from content scripts, popup, etc.
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOOKUP' && msg.word) {
    return lookupWord(msg.word); // Return Promise directly (Firefox pattern)
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

  // Send to content script to show tooltip
  try {
    const res = await browser.tabs.sendMessage(tab.id, { type: 'LOOKUP_WORD', word });
    if (res && res.success) return;
  } catch {
    // Content script not available
  }
});
