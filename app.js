'use strict';

// ── Prompts ──────────────────────────────────────────────────────────────────

const NUTRITION_SYSTEM_PROMPT = `You are a nutrition tracking assistant. The user will describe what they ate or drank in natural language (possibly transcribed from voice, so it may be informal or have minor transcription errors).

Your job is to identify each food/drink item and return a structured markdown entry.

RULES:
- One row per distinct food or drink item
- Use USDA nutritional database estimates
- If quantity is not stated, assume a standard single serving
- Calories = kcal, macros in grams with "g" suffix
- Round all numbers to the nearest whole number
- State any assumptions (portion size, preparation method) in the Notes column
- Output ONLY the markdown block below — no explanation, no preamble, nothing else

OUTPUT FORMAT (output exactly this, nothing else):

### Meal: [brief description of what was eaten]

| Item | Qty | Cal | Protein | Carbs | Fat | Fiber | Notes |
|------|-----|-----|---------|-------|-----|-------|-------|
| [item name] | [qty] | [kcal] | [g] | [g] | [g] | [g] | [assumptions or blank] |

---

EXAMPLE INPUT: two scrambled eggs with a slice of toast and a black coffee

EXAMPLE OUTPUT:

### Meal: Scrambled eggs, toast & coffee

| Item | Qty | Cal | Protein | Carbs | Fat | Fiber | Notes |
|------|-----|-----|---------|-------|-----|-------|-------|
| Scrambled eggs | 2 large | 182 | 12g | 2g | 14g | 0g | Cooked with ~1 tsp butter assumed |
| Whole wheat toast | 1 slice | 80 | 3g | 15g | 1g | 2g | Medium slice assumed |
| Black coffee | 250ml | 2 | 0g | 0g | 0g | 0g | No milk or sugar |`;

const CHAT_SYSTEM_PROMPT = `You are a friendly, knowledgeable diet coach and nutritionist. The user has been logging their food intake using a voice-powered diet tracker app called NutriLog.

Answer questions about their diet, nutritional habits, patterns, and provide actionable suggestions. Be specific and reference their actual logged meals when relevant. When calculating totals, sum the calories and macros from the diary entries.

Be concise, warm, and non-judgmental. Use markdown formatting (bold, bullet lists) to structure longer answers.

If asked about food outside the diary scope, answer from general nutrition knowledge.`;

// ── Storage ───────────────────────────────────────────────────────────────────

const Storage = {
  KEY: 'nutrilog_entries',

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch {
      return [];
    }
  },

  save(entry) {
    const entries = this.getAll();
    entries.unshift(entry);
    localStorage.setItem(this.KEY, JSON.stringify(entries));
  },

  delete(id) {
    const entries = this.getAll().filter(e => e.id !== id);
    localStorage.setItem(this.KEY, JSON.stringify(entries));
  },

  clear() {
    localStorage.removeItem(this.KEY);
  },

  getToday() {
    const today = new Date().toISOString().slice(0, 10);
    return this.getAll().filter(e => e.date === today);
  },

  getLastNDays(n) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - n);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return this.getAll().filter(e => e.date >= cutoffStr);
  },

  exportAsMarkdown() {
    const entries = this.getAll();
    if (entries.length === 0) return '# NutriLog Diet Diary\n\n*No entries yet.*\n';

    const byDate = {};
    entries.forEach(e => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });

    let md = '# NutriLog Diet Diary\n\n';
    Object.keys(byDate).sort().reverse().forEach(date => {
      md += `## ${date}\n\n`;
      byDate[date].forEach(e => {
        md += `### ${e.time} — ${e.mealTitle || 'Meal'}\n\n`;
        md += e.markdown + '\n\n';
      });
    });
    return md;
  },

  downloadMarkdown() {
    const blob = new Blob([this.exportAsMarkdown()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'nutrilog-diary.md'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

// ── Voice Input ───────────────────────────────────────────────────────────────

const VoiceInput = {
  recognition: null,
  active: false,

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  start(onResult, onError) {
    if (!this.isSupported()) {
      onError('not-supported');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    this.active = true;

    this.recognition.onresult = (e) => {
      this.active = false;
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join(' ')
        .trim();
      onResult(transcript);
    };

    this.recognition.onerror = (e) => {
      this.active = false;
      onError(e.error);
    };

    this.recognition.onend = () => {
      if (this.active) {
        // Ended without result (silence timeout)
        this.active = false;
        onError('no-speech');
      }
    };

    try {
      this.recognition.start();
    } catch (err) {
      this.active = false;
      onError('start-failed');
    }
  },

  stop() {
    this.active = false;
    try { this.recognition?.stop(); } catch {}
  }
};

// ── Claude API ────────────────────────────────────────────────────────────────

const ClaudeAPI = {
  MODEL: 'claude-sonnet-4-6',
  BASE: 'https://api.anthropic.com/v1/messages',

  getKey() {
    return localStorage.getItem('nutrilog_api_key') || '';
  },

  headers() {
    return {
      'x-api-key': this.getKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  },

  async extractNutrition(transcript) {
    if (!this.getKey()) throw new Error('No API key. Go to Settings to add your Anthropic key.');

    const resp = await fetch(this.BASE, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.MODEL,
        max_tokens: 1024,
        system: NUTRITION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: transcript }]
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }

    const data = await resp.json();
    return data.content[0].text.trim();
  },

  async chat(messages, diaryContext) {
    if (!this.getKey()) throw new Error('No API key. Go to Settings.');

    const systemPrompt = diaryContext
      ? `${CHAT_SYSTEM_PROMPT}\n\nThe user's recent diet diary (last 7 days):\n\n${diaryContext}`
      : CHAT_SYSTEM_PROMPT;

    const resp = await fetch(this.BASE, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }

    const data = await resp.json();
    return data.content[0].text.trim();
  }
};

// ── Markdown Parser ───────────────────────────────────────────────────────────

const Renderer = {
  // Parse the markdown table rows Claude returns into a nutrition object
  parseNutrition(markdown) {
    const items = [];
    const lines = markdown.split('\n');
    let inTable = false;
    let headers = [];

    for (const line of lines) {
      if (!line.trim().startsWith('|')) {
        inTable = false;
        continue;
      }
      const cells = line.split('|').filter(Boolean).map(c => c.trim());
      if (!inTable) {
        // Header row
        headers = cells.map(h => h.toLowerCase());
        inTable = true;
        continue;
      }
      if (cells.every(c => /^[-: ]+$/.test(c))) continue; // separator

      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] || ''; });

      const cal = parseInt((row['cal'] || row['calories'] || '0').replace(/[^\d]/g, '')) || 0;
      const protein = parseInt((row['protein'] || '0').replace(/[^\d]/g, '')) || 0;
      const carbs = parseInt((row['carbs'] || '0').replace(/[^\d]/g, '')) || 0;
      const fat = parseInt((row['fat'] || '0').replace(/[^\d]/g, '')) || 0;
      const fiber = parseInt((row['fiber'] || '0').replace(/[^\d]/g, '')) || 0;

      items.push({
        item: row['item'] || 'Unknown',
        quantity: row['qty'] || row['quantity'] || '',
        calories: cal,
        protein,
        carbs,
        fat,
        fiber,
        notes: row['notes'] || ''
      });
    }
    return items;
  },

  // Extract meal title from "### Meal: ..." line
  parseMealTitle(markdown) {
    const match = markdown.match(/^###\s+(?:Meal:\s*)?(.+)$/m);
    return match ? match[1].trim() : 'Meal';
  },

  // Render a meal card with its table
  renderMealCard(entry) {
    const items = entry.nutrition || [];
    const totals = items.reduce((acc, it) => {
      acc.cal += it.calories;
      acc.protein += it.protein;
      acc.carbs += it.carbs;
      acc.fat += it.fat;
      acc.fiber += it.fiber;
      return acc;
    }, { cal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

    const rows = items.map(it => `
      <tr>
        <td>${this.esc(it.item)}</td>
        <td>${this.esc(it.quantity)}</td>
        <td>${it.calories}</td>
        <td>${it.protein}g</td>
        <td>${it.carbs}g</td>
        <td>${it.fat}g</td>
        <td>${it.fiber}g</td>
        <td>${this.esc(it.notes)}</td>
      </tr>`).join('');

    const totalsRow = items.length > 1 ? `
      <tr class="totals-row">
        <td>Total</td>
        <td>—</td>
        <td>${totals.cal}</td>
        <td>${totals.protein}g</td>
        <td>${totals.carbs}g</td>
        <td>${totals.fat}g</td>
        <td>${totals.fiber}g</td>
        <td></td>
      </tr>` : '';

    return `
      <div class="meal-card" data-entry-id="${entry.id}">
        <div class="meal-card-header">
          <div>
            <div class="meal-card-title">${this.esc(entry.mealTitle)}</div>
            <div class="meal-card-time">${entry.time} · ${totals.cal} kcal</div>
          </div>
          <button class="meal-card-delete" onclick="App.deleteEntry('${entry.id}')" aria-label="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Qty</th><th>Cal</th>
                <th>Protein</th><th>Carbs</th><th>Fat</th><th>Fiber</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              ${totalsRow}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  // Simple markdown to HTML for chat bubbles
  mdToHtml(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<strong>$1</strong>')
      .replace(/^## (.+)$/gm, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  },

  esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// ── UI Helpers ────────────────────────────────────────────────────────────────

const UI = {
  toastTimer: null,

  toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `show ${type}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.className = ''; }, 3000);
  },

  setVoiceState(state) {
    // states: idle | recording | processing
    const btn = document.getElementById('voice-btn');
    const iconMic = document.getElementById('voice-icon-mic');
    const iconStop = document.getElementById('voice-icon-stop');
    const iconSpinner = document.getElementById('voice-icon-spinner');
    const statusEl = document.getElementById('voice-status');

    btn.className = '';
    iconMic.style.display = 'none';
    iconStop.style.display = 'none';
    iconSpinner.style.display = 'none';

    switch (state) {
      case 'idle':
        iconMic.style.display = '';
        statusEl.textContent = 'Tap to log a meal';
        break;
      case 'recording':
        btn.classList.add('recording');
        iconStop.style.display = '';
        statusEl.textContent = 'Listening… tap to stop';
        break;
      case 'processing':
        btn.classList.add('processing');
        iconSpinner.style.display = 'inline-block';
        statusEl.textContent = 'Analyzing with Claude…';
        break;
    }
  },

  showTextFallback(show) {
    const el = document.getElementById('text-fallback');
    el.classList.toggle('visible', show);
  },

  renderTodayList(entries) {
    const container = document.getElementById('today-list');
    if (entries.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          </svg>
          <p>No meals logged today.<br>Tap the button above to start.</p>
        </div>`;
      return;
    }
    container.innerHTML = entries.map(e => Renderer.renderMealCard(e)).join('');
  },

  renderDiaryList(entries) {
    const container = document.getElementById('diary-list');
    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No diary entries yet.</p></div>';
      return;
    }

    // Group by date
    const byDate = {};
    entries.forEach(e => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });

    const html = Object.keys(byDate).sort().reverse().map(date => {
      const dayEntries = byDate[date];
      const totals = dayEntries.reduce((acc, entry) => {
        (entry.nutrition || []).forEach(it => {
          acc.cal += it.calories;
          acc.protein += it.protein;
          acc.carbs += it.carbs;
          acc.fat += it.fat;
        });
        return acc;
      }, { cal: 0, protein: 0, carbs: 0, fat: 0 });

      const label = this.formatDate(date);
      const cards = dayEntries.map(e => Renderer.renderMealCard(e)).join('');

      return `
        <div class="diary-date-group">
          <div class="diary-date-label"><span>${label}</span></div>
          <div class="day-totals">
            <div class="macro-chip"><span>${totals.cal}</span> kcal</div>
            <div class="macro-chip">P: <span>${totals.protein}g</span></div>
            <div class="macro-chip">C: <span>${totals.carbs}g</span></div>
            <div class="macro-chip">F: <span>${totals.fat}g</span></div>
          </div>
          ${cards}
        </div>`;
    }).join('');

    container.innerHTML = html;
  },

  formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  },

  updateKeyStatus() {
    const key = localStorage.getItem('nutrilog_api_key') || '';
    const dot = document.getElementById('key-status-dot');
    const label = document.getElementById('key-status-label');
    if (key) {
      dot.classList.add('set');
      label.textContent = 'Key saved (' + key.slice(0, 12) + '…)';
    } else {
      dot.classList.remove('set');
      label.textContent = 'No key saved';
    }
  },

  updateDataSummary() {
    const entries = Storage.getAll();
    const el = document.getElementById('data-summary');
    if (!el) return;
    const totalCal = entries.reduce((s, e) =>
      s + (e.nutrition || []).reduce((a, it) => a + it.calories, 0), 0);
    el.textContent = `${entries.length} meal${entries.length !== 1 ? 's' : ''} logged · ${totalCal.toLocaleString()} kcal total`;
  }
};

// ── App ───────────────────────────────────────────────────────────────────────

const App = {
  chatHistory: [],

  init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }

    // Set header date
    document.getElementById('header-date').textContent =
      new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    // Enter on chat input
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.onChatSend();
      }
    });

    // Initial renders
    UI.renderTodayList(Storage.getToday());
    UI.updateKeyStatus();
    UI.updateDataSummary();
  },

  switchTab(name, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    btn.classList.add('active');

    if (name === 'diary') UI.renderDiaryList(Storage.getAll());
    if (name === 'settings') { UI.updateKeyStatus(); UI.updateDataSummary(); }
  },

  // ── Voice ──────────────────────────────────────────────

  onVoiceTap() {
    if (VoiceInput.active) {
      VoiceInput.stop();
      UI.setVoiceState('idle');
      return;
    }

    UI.setVoiceState('recording');
    UI.showTextFallback(false);

    VoiceInput.start(
      (transcript) => this.processTranscript(transcript),
      (error) => this.handleVoiceError(error)
    );
  },

  handleVoiceError(error) {
    UI.setVoiceState('idle');
    switch (error) {
      case 'not-allowed':
        UI.toast('Microphone permission denied', 'error');
        UI.showTextFallback(true);
        break;
      case 'not-supported':
      case 'service-unavailable':
        UI.showTextFallback(true);
        UI.toast('Voice unavailable — type your meal instead', 'info');
        break;
      case 'no-speech':
        UI.toast('No speech detected — try again', 'info');
        break;
      default:
        UI.showTextFallback(true);
        UI.toast('Voice error — type your meal below', 'info');
    }
  },

  onTextSubmit() {
    const input = document.getElementById('text-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this.processTranscript(text);
  },

  async processTranscript(transcript) {
    UI.setVoiceState('processing');

    try {
      const markdown = await ClaudeAPI.extractNutrition(transcript);
      const nutrition = Renderer.parseNutrition(markdown);
      const mealTitle = Renderer.parseMealTitle(markdown);

      const now = new Date();
      const entry = {
        id: crypto.randomUUID(),
        date: now.toISOString().slice(0, 10),
        time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        transcript,
        markdown,
        mealTitle,
        nutrition
      };

      Storage.save(entry);
      UI.renderTodayList(Storage.getToday());
      UI.setVoiceState('idle');
      UI.showTextFallback(false);

      const totalCal = nutrition.reduce((s, it) => s + it.calories, 0);
      UI.toast(`Logged! ${totalCal} kcal`, 'success');

    } catch (err) {
      UI.setVoiceState('idle');
      UI.toast(err.message || 'Something went wrong', 'error');
    }
  },

  deleteEntry(id) {
    Storage.delete(id);
    UI.renderTodayList(Storage.getToday());
    // If diary tab is open, refresh it
    if (document.getElementById('tab-diary').classList.contains('active')) {
      UI.renderDiaryList(Storage.getAll());
    }
    UI.toast('Entry deleted', 'info');
  },

  // ── Chat ───────────────────────────────────────────────

  async onChatSend() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    // Append user bubble
    this.appendChatBubble(text, 'user');
    this.chatHistory.push({ role: 'user', content: text });

    // Clear empty state if present
    const empty = document.querySelector('.chat-empty');
    if (empty) empty.remove();

    // Show thinking bubble
    const thinkingId = 'thinking-' + Date.now();
    this.appendChatBubble('…', 'thinking', thinkingId);

    try {
      const diaryContext = Storage.getLastNDays(7).length > 0
        ? Storage.exportAsMarkdown()
        : null;

      const reply = await ClaudeAPI.chat(this.chatHistory, diaryContext);

      // Remove thinking bubble
      document.getElementById(thinkingId)?.remove();

      this.appendChatBubble(reply, 'assistant');
      this.chatHistory.push({ role: 'assistant', content: reply });

    } catch (err) {
      document.getElementById(thinkingId)?.remove();
      this.appendChatBubble('Error: ' + err.message, 'assistant');
    }
  },

  appendChatBubble(text, role, id) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-bubble ${role}`;
    if (id) div.id = id;

    if (role === 'assistant') {
      div.innerHTML = Renderer.mdToHtml(text);
    } else {
      div.textContent = text;
    }

    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  },

  // ── Settings ───────────────────────────────────────────

  saveKey() {
    const input = document.getElementById('api-key-input');
    const key = input.value.trim();
    if (!key) {
      UI.toast('Please enter an API key', 'error');
      return;
    }
    if (!key.startsWith('sk-ant-')) {
      UI.toast('Invalid key — Anthropic keys start with sk-ant-', 'error');
      return;
    }
    localStorage.setItem('nutrilog_api_key', key);
    UI.updateKeyStatus();
    UI.toast('API key saved', 'success');
  },

  exportDiary() {
    const entries = Storage.getAll();
    if (entries.length === 0) {
      UI.toast('No entries to export yet', 'info');
      return;
    }
    Storage.downloadMarkdown();
    UI.toast('Diary downloaded', 'success');
  },

  clearData() {
    if (!confirm('Delete all diary entries? This cannot be undone.')) return;
    Storage.clear();
    this.chatHistory = [];
    UI.renderTodayList([]);
    UI.updateDataSummary();
    UI.toast('All data cleared', 'info');
  }
};

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => App.init());
