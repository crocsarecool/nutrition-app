'use strict';

// ── Storage Keys ──────────────────────────────────────────────────────────────
const KEYS = {
  API_KEY:     'flow_api_key',
  BLOCKS:      'flow_blocks',
  SETUPS:      'flow_setups',
  CURRENT:     'flow_current',
  TIMER_START: 'flow_timer_start'
};

// ── AI System Prompts ─────────────────────────────────────────────────────────
const PROMPTS = {

  CLARIFIER: `You are a precision task coach. The user will give you a vague or broad work task. Your job is to make it specific, time-bounded, and executable in 30 minutes.

Return ONLY valid JSON — no markdown fences, no explanation. Format:
{
  "refinedObjective": "One specific, actionable task that fits in 30 minutes",
  "definitionOfDone": ["criterion 1", "criterion 2", "criterion 3"],
  "avoidList": ["thing to avoid 1", "thing to avoid 2", "thing to avoid 3"],
  "clarityScore": 8
}

Rules:
- refinedObjective must start with a verb and specify visible output (e.g. "Write 5 rough headline options for the hero section")
- definitionOfDone: 2-3 concrete completion criteria, not vague ("done means 5 lines exist" not "feel satisfied")
- avoidList: 3-5 specific rabbit holes relevant to this task
- clarityScore: 1-10 rating of the original task clarity (before your rewrite)`,

  CHECKIN: `You are a cognitive work coach doing a 30-minute block debrief. Analyse the user's work block and return structured feedback.

Return ONLY valid JSON — no markdown fences, no explanation. Format:
{
  "focusScore": 7,
  "clarityScore": 8,
  "bloatScore": 3,
  "driftScore": 2,
  "driftType": "none",
  "nextAction": "Write the remaining 2 headline options using the angle you discovered",
  "redirect": "You partially drifted into strategy. The next action keeps you in execution mode.",
  "markdown": "## 10:30 AM Check-In\\n**Goal:** Write 5 headlines\\n**Output:** 3 headlines written\\n**Drift:** None\\n**Next:** Write 2 more headlines"
}

Rules:
- focusScore 1-10: how focused vs distracted the block was
- clarityScore 1-10: how clear the original task was
- bloatScore 0-10: how much the task scope expanded beyond original (0 = stayed tight)
- driftScore 0-10: how much mental drift occurred (0 = none)
- driftType: one of "research", "strategy", "tooling", "social", "perfectionism", "emotional", "none"
- nextAction: single smallest useful next action, specific and concrete
- redirect: 1-2 sentences of honest coaching. Only mention drift/bloat if they actually occurred.
- markdown: structured markdown entry for the work log (use \\n for newlines)`,

  MORNING: `You are a productivity strategist helping a founder start their workday with intention. Given their goals and likely failure modes, create a sharp daily strategy.

Return ONLY valid JSON — no markdown fences, no explanation. Format:
{
  "strategy": "Start with writing before any research. Your main risk today is turning the positioning task into a research project. Fix the output format first — write bad versions fast.",
  "avoidList": ["Opening competitor websites before writing", "Slack before 12pm", "Deck editing", "Pricing discussions"],
  "markdown": "# Daily Work Log\\n## Morning Intent\\n**Main win:** ...\\n**Top tasks:**\\n1. ...\\n**Likely drift:** ...\\n**Strategy:** ..."
}

Rules:
- strategy: 2-4 sentences, specific to their stated tasks and drift pattern
- avoidList: 3-6 specific things to avoid today
- markdown: a properly structured daily log header (use \\n for newlines, include actual content not placeholders)`,

  INSIGHTS: `You are a cognitive performance analyst. Analyse the user's work blocks from today and identify patterns, strengths, and failure modes.

The user will send you JSON of their work blocks. Return ONLY markdown — no JSON, no code fences. Structure your response exactly like this:

## Today's Pattern

[2-3 sentences identifying the dominant pattern in how they worked today]

## Best Block
**[time] — [objective]**
[Why this block worked well — be specific]

## Drift Pattern
[What type of drift appeared most and what triggers it for this person]

## Tomorrow's Recommendation
- [Specific, actionable recommendation 1]
- [Specific, actionable recommendation 2]
- [Specific, actionable recommendation 3]

## The Core Insight
[One sharp, honest observation about how this person works — the thing they most need to hear]

Be direct and specific. Reference actual block data. Avoid generic productivity advice.`
};

// ── Storage ───────────────────────────────────────────────────────────────────
const Storage = {
  getBlocks() {
    try { return JSON.parse(localStorage.getItem(KEYS.BLOCKS) || '[]'); }
    catch { return []; }
  },

  saveBlock(block) {
    const blocks = this.getBlocks();
    const idx = blocks.findIndex(b => b.id === block.id);
    if (idx >= 0) blocks[idx] = block;
    else blocks.push(block);
    localStorage.setItem(KEYS.BLOCKS, JSON.stringify(blocks));
  },

  deleteBlock(id) {
    const blocks = this.getBlocks().filter(b => b.id !== id);
    localStorage.setItem(KEYS.BLOCKS, JSON.stringify(blocks));
  },

  getBlocksForDate(date) {
    return this.getBlocks().filter(b => b.date === date);
  },

  getCompletedBlocksForDate(date) {
    return this.getBlocksForDate(date).filter(b => b.endTime && b.focus != null);
  },

  getSetups() {
    try { return JSON.parse(localStorage.getItem(KEYS.SETUPS) || '[]'); }
    catch { return []; }
  },

  saveSetup(setup) {
    const setups = this.getSetups();
    const idx = setups.findIndex(s => s.date === setup.date);
    if (idx >= 0) setups[idx] = setup;
    else setups.push(setup);
    localStorage.setItem(KEYS.SETUPS, JSON.stringify(setups));
  },

  getSetupForDate(date) {
    return this.getSetups().find(s => s.date === date) || null;
  },

  getCurrentId()      { return localStorage.getItem(KEYS.CURRENT) || null; },
  setCurrentId(id)    { localStorage.setItem(KEYS.CURRENT, id); },
  clearCurrentId()    { localStorage.removeItem(KEYS.CURRENT); },

  getCurrentBlock() {
    const id = this.getCurrentId();
    if (!id) return null;
    return this.getBlocks().find(b => b.id === id) || null;
  },

  getTimerStart()     { return localStorage.getItem(KEYS.TIMER_START) || null; },
  setTimerStart(ts)   { localStorage.setItem(KEYS.TIMER_START, ts); },
  clearTimerStart()   { localStorage.removeItem(KEYS.TIMER_START); },

  getApiKey()         { return localStorage.getItem(KEYS.API_KEY) || ''; },
  setApiKey(key)      { localStorage.setItem(KEYS.API_KEY, key); },

  exportAsMarkdown() {
    const blocks = this.getBlocks();
    if (!blocks.length) return '# FLOW Work Log\n\n_No blocks logged yet._\n';

    const byDate = {};
    blocks.forEach(b => {
      if (!byDate[b.date]) byDate[b.date] = [];
      byDate[b.date].push(b);
    });

    let md = '# FLOW Work Log\n\n';
    Object.keys(byDate).sort().reverse().forEach(date => {
      const setup = this.getSetupForDate(date);
      md += `## ${date}\n\n`;
      if (setup) {
        md += `### Morning Intent\n`;
        md += `**Main win:** ${setup.mainWin || '—'}\n`;
        if (setup.topTasks?.length) {
          md += `**Top tasks:**\n${setup.topTasks.filter(Boolean).map((t, i) => `${i+1}. ${t}`).join('\n')}\n`;
        }
        if (setup.likelyDrift) md += `**Likely drift:** ${setup.likelyDrift}\n`;
        if (setup.strategy)    md += `**Strategy:** ${setup.strategy}\n`;
        md += '\n---\n\n';
      }
      byDate[date].forEach(b => {
        md += `### ${UI.formatTime(b.startTime)} — ${b.objective}\n`;
        if (b.definitionOfDone) {
          const dod = Array.isArray(b.definitionOfDone) ? b.definitionOfDone : [b.definitionOfDone];
          md += `**Done means:** ${dod.join('; ')}\n`;
        }
        if (b.actualOutput)  md += `**Output:** ${b.actualOutput}\n`;
        if (b.focus != null) md += `**Focus:** ${b.focus}/10  **Clarity:** ${b.clarity}/10  **Drift:** ${b.drift}/10  **Bloat:** ${b.bloat}/10\n`;
        if (b.driftType && b.driftType !== 'none') md += `**Drift type:** ${b.driftType}\n`;
        if (b.nextAction)    md += `**Next action:** ${b.nextAction}\n`;
        md += '\n';
      });
    });
    return md;
  },

  downloadMarkdown() {
    const md   = this.exportAsMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'flow-log.md' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  clearAll() {
    [KEYS.BLOCKS, KEYS.SETUPS, KEYS.CURRENT, KEYS.TIMER_START].forEach(k => localStorage.removeItem(k));
  }
};

// ── Scores ────────────────────────────────────────────────────────────────────
const Scores = {
  calculate(blocks) {
    const done = blocks.filter(b => b.endTime && b.focus != null);
    if (!done.length) return { focus: 0, clarity: 0, bloat: 0, drift: 0, momentum: 0, strain: 0 };

    const avg = key => done.reduce((s, b) => s + (b[key] || 0), 0) / done.length;

    const focus   = Math.round(avg('focus')   * 10);
    const clarity = Math.round(avg('clarity') * 10);
    const bloat   = Math.round(avg('bloat')   * 10);
    const drift   = Math.round(done.filter(b => (b.drift || 0) > 3).length / done.length * 100);

    // Momentum: longest consecutive streak of focus > 6
    let momentum = 0, cur = 0;
    done.forEach(b => {
      if ((b.focus || 0) > 6) { cur++; momentum = Math.max(momentum, cur); }
      else cur = 0;
    });

    // Strain: avg difficulty + drift penalty
    const avgDifficulty = done.reduce((s, b) => s + (10 - (b.focus || 5)), 0) / done.length;
    const driftCount    = done.filter(b => (b.drift || 0) > 3).length;
    const switchPenalty = (driftCount / done.length) * 20;
    const strain        = Math.min(100, Math.round(avgDifficulty * 10 + switchPenalty));

    return { focus, clarity, bloat, drift, momentum, strain };
  }
};

// ── Voice Input ───────────────────────────────────────────────────────────────
const VoiceInput = {
  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  start(onResult, onError) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { onError('not-supported'); return; }
    this.recognition = new SR();
    this.recognition.continuous     = false;
    this.recognition.interimResults = false;
    this.recognition.lang           = 'en-US';
    this.active = true;

    this.recognition.onresult = e => {
      this.active = false;
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
      onResult(transcript);
    };
    this.recognition.onerror = e => { this.active = false; onError(e.error); };
    this.recognition.onend   = () => { if (this.active) { this.active = false; onError('no-speech'); } };

    try { this.recognition.start(); }
    catch (err) { this.active = false; onError('start-failed'); }
  },

  stop() {
    this.active = false;
    try { this.recognition?.stop(); } catch {}
  }
};

// ── Claude API ────────────────────────────────────────────────────────────────
const ClaudeAPI = {
  MODEL: 'claude-sonnet-4-5',
  BASE:  'https://api.anthropic.com/v1/messages',

  getKey()  { return Storage.getApiKey(); },

  headers() {
    return {
      'x-api-key':                               this.getKey(),
      'anthropic-version':                        '2023-06-01',
      'content-type':                             'application/json',
      'anthropic-dangerous-direct-browser-access':'true'
    };
  },

  async callRaw(systemPrompt, userMessage, maxTokens = 1024) {
    if (!this.getKey()) throw new Error('No API key saved. Add it in Settings.');
    const resp = await fetch(this.BASE, {
      method:  'POST',
      headers: this.headers(),
      body:    JSON.stringify({
        model:      this.MODEL,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }
    const data = await resp.json();
    return data.content[0].text.trim();
  },

  async callJSON(systemPrompt, userMessage, maxTokens = 1024) {
    const text  = await this.callRaw(systemPrompt, userMessage, maxTokens);
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    try { return JSON.parse(clean); }
    catch { throw new Error('AI returned unexpected format — please try again'); }
  },

  async callMarkdown(systemPrompt, userMessage, maxTokens = 2048) {
    return this.callRaw(systemPrompt, userMessage, maxTokens);
  },

  async clarifyTask(rawObjective)  { return this.callJSON(PROMPTS.CLARIFIER, rawObjective); },

  async analyzeMorning(data) {
    const msg = `Main win: ${data.mainWin}\nTop tasks: ${data.topTasks.filter(Boolean).join(', ')}\nLikely drift: ${data.likelyDrift}`;
    return this.callJSON(PROMPTS.MORNING, msg);
  },

  async analyzeCheckin(data) {
    const msg = `Original goal: ${data.objective}
Definition of done: ${JSON.stringify(data.definitionOfDone)}
What happened: ${data.whatHappened}
Drift level (0-10): ${data.driftLevel}
Bloat level (0-10): ${data.bloatLevel}`;
    return this.callJSON(PROMPTS.CHECKIN, msg);
  },

  async minePatterns(blocksJson) {
    return this.callMarkdown(PROMPTS.INSIGHTS, `Today's work blocks:\n${blocksJson}`, 2048);
  }
};

// ── Timer ─────────────────────────────────────────────────────────────────────
const TIMER_DURATION = 30 * 60 * 1000; // 30 min in ms

const Timer = {
  _interval:     null,
  _notifTimeout: null,
  CIRC:          263.89, // 2π × 42

  start() {
    const ts = new Date().toISOString();
    Storage.setTimerStart(ts);
    this._run(ts);
    this._scheduleNotification(TIMER_DURATION);
  },

  stop() {
    clearInterval(this._interval);
    clearTimeout(this._notifTimeout);
    this._interval = null;
    this._notifTimeout = null;
    Storage.clearTimerStart();
  },

  resume() {
    const ts = Storage.getTimerStart();
    if (!ts) return;
    const elapsed   = Date.now() - new Date(ts).getTime();
    const remaining = TIMER_DURATION - elapsed;
    if (remaining <= 0) {
      // Already overdue
      this._updateDisplay(0);
      setTimeout(() => this._onExpired(), 200);
    } else {
      this._run(ts);
      this._scheduleNotification(remaining);
    }
  },

  isRunning()    { return !!Storage.getTimerStart(); },

  getRemaining() {
    const ts = Storage.getTimerStart();
    if (!ts) return 0;
    return Math.max(0, TIMER_DURATION - (Date.now() - new Date(ts).getTime()));
  },

  _run(startTs) {
    clearInterval(this._interval);
    // Immediate tick
    const initElapsed = Date.now() - new Date(startTs).getTime();
    this._updateDisplay(Math.max(0, TIMER_DURATION - initElapsed));

    this._interval = setInterval(() => {
      const elapsed   = Date.now() - new Date(startTs).getTime();
      const remaining = Math.max(0, TIMER_DURATION - elapsed);
      this._updateDisplay(remaining);
      if (remaining <= 0) {
        clearInterval(this._interval);
        this._interval = null;
        this._onExpired();
      }
    }, 1000);
  },

  _updateDisplay(remainingMs) {
    const totalSec = Math.ceil(remainingMs / 1000);
    const mins  = Math.floor(totalSec / 60);
    const secs  = totalSec % 60;
    const label = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

    const timeEl = document.getElementById('timer-text-active');
    const arcEl  = document.getElementById('timer-arc-active');
    const subEl  = document.getElementById('timer-sublabel');

    if (timeEl) {
      timeEl.textContent = label;
      const urgent = remainingMs < 5 * 60 * 1000 && remainingMs > 0;
      timeEl.classList.toggle('pulsing', urgent);
    }
    if (arcEl) {
      const fraction = remainingMs / TIMER_DURATION;
      arcEl.style.strokeDashoffset = String(this.CIRC * (1 - fraction));
      arcEl.classList.toggle('urgent', remainingMs < 5 * 60 * 1000 && remainingMs > 0);
    }
    if (subEl) subEl.textContent = remainingMs <= 0 ? 'check in now' : 'remaining';
  },

  _onExpired() {
    this._updateDisplay(0);
    // Switch buttons
    const dueBtn     = document.getElementById('btn-checkin-due');
    const runningRow = document.getElementById('btn-row-running');
    if (dueBtn)     dueBtn.style.display     = '';
    if (runningRow) runningRow.style.display = 'none';
    // Auto-open if NOW tab is active
    const nowTab = document.getElementById('tab-now');
    if (nowTab?.classList.contains('active')) {
      setTimeout(() => Modals.openCheckin(), 500);
    }
  },

  _scheduleNotification(delayMs) {
    clearTimeout(this._notifTimeout);
    this._notifTimeout = setTimeout(() => {
      if (Notification.permission === 'granted') {
        try {
          new Notification('FLOW — Time to check in', {
            body: 'Your 30-minute block is done. What happened?',
            icon: '/icons/icon-192.png',
            tag:  'flow-checkin'
          });
        } catch {}
      }
    }, delayMs);
  },

  async requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
  }
};

// ── UI ────────────────────────────────────────────────────────────────────────
const UI = {
  toastTimer: null,

  toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `show ${type}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.className = ''; }, 3200);
  },

  formatTime(isoOrStr) {
    if (!isoOrStr) return '';
    const d = new Date(isoOrStr);
    if (isNaN(d.getTime())) return isoOrStr;
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  },

  formatDate(dateStr) {
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today)     return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  },

  esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  mdToHtml(text) {
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/^### (.+)$/gm,   '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,    '<h2>$1</h2>')
      .replace(/^- (.+)$/gm,     '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  },

  setLoading(btn, loading, text) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn._origHtml = btn.innerHTML;
      const isSecondary = btn.classList.contains('btn-secondary');
      btn.innerHTML = `<span class="spinner${isSecondary ? ' light' : ''}"></span> ${text || 'Working…'}`;
    } else {
      btn.innerHTML = btn._origHtml || text || '';
    }
  },

  today()    { return new Date().toISOString().slice(0, 10); },

  greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  },

  // ── NOW tab ────────────────────────────────────────────────────────────────
  renderNow() {
    const current   = Storage.getCurrentBlock();
    const idleDiv   = document.getElementById('now-idle');
    const activeDiv = document.getElementById('now-active');
    const banner    = document.getElementById('setup-banner');
    const greetEl   = document.getElementById('now-greeting');
    const dateLine  = document.getElementById('now-date-line');

    const today = this.today();
    const setup = Storage.getSetupForDate(today);

    if (banner)   banner.style.display   = setup ? 'none' : '';
    if (greetEl)  greetEl.textContent    = this.greeting();
    if (dateLine) dateLine.textContent   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    if (!current) {
      if (idleDiv)   idleDiv.style.display   = '';
      if (activeDiv) activeDiv.style.display = 'none';
    } else {
      if (idleDiv)   idleDiv.style.display   = 'none';
      if (activeDiv) activeDiv.style.display = '';

      const objEl  = document.getElementById('active-objective');
      const dodEl  = document.getElementById('active-dod');
      const avdEl  = document.getElementById('active-avoid');
      const avdLbl = document.getElementById('active-avoid-label');

      if (objEl) objEl.textContent = current.objective;

      if (dodEl) {
        const dod = Array.isArray(current.definitionOfDone) ? current.definitionOfDone : [current.definitionOfDone];
        dodEl.innerHTML = dod.filter(Boolean).map(d => `<div class="bsc-dod-item">${this.esc(d)}</div>`).join('');
      }

      if (avdEl && current.avoidList?.length) {
        avdEl.innerHTML = current.avoidList.map(a => `<span class="avoid-tag">${this.esc(a)}</span>`).join('');
        if (avdLbl) avdLbl.style.display = '';
      } else if (avdLbl) {
        avdLbl.style.display = 'none';
      }

      // Timer CTA state
      const remaining  = Timer.getRemaining();
      const dueBtn     = document.getElementById('btn-checkin-due');
      const runningRow = document.getElementById('btn-row-running');
      if (remaining <= 0) {
        if (dueBtn)     dueBtn.style.display     = '';
        if (runningRow) runningRow.style.display = 'none';
      } else {
        if (dueBtn)     dueBtn.style.display     = 'none';
        if (runningRow) runningRow.style.display = '';
      }
    }
  },

  // ── LOG tab ────────────────────────────────────────────────────────────────
  renderLog() {
    const container = document.getElementById('log-container');
    if (!container) return;

    const blocks = Storage.getBlocks();
    if (!blocks.length) {
      container.innerHTML = `<div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <p>No blocks yet.<br>Start your first block on the Now tab.</p>
      </div>`;
      return;
    }

    // Group by date newest-first
    const byDate = {};
    [...blocks].reverse().forEach(b => {
      if (!byDate[b.date]) byDate[b.date] = [];
      byDate[b.date].push(b);
    });

    const today = this.today();
    let html = '';
    Object.keys(byDate).sort().reverse().forEach(date => {
      const label   = this.formatDate(date);
      const isToday = date === today;
      html += `<div class="date-group">
        <div class="date-group-label">${isToday ? `<span>${label}</span>` : label}</div>
        ${byDate[date].map(b => this.renderBlockCard(b)).join('')}
      </div>`;
    });
    container.innerHTML = html;
  },

  renderBlockCard(b) {
    const time = this.formatTime(b.startTime);

    let scoresHtml = '';
    if (b.focus != null) {
      scoresHtml = `<div class="block-scores">
        <span class="score-chip focus">Focus ${b.focus}/10</span>
        <span class="score-chip clarity">Clarity ${b.clarity}/10</span>
        ${(b.drift || 0) > 3 ? `<span class="score-chip drift">Drift ${b.drift}/10</span>` : ''}
        ${(b.bloat || 0) > 3 ? `<span class="score-chip bloat">Bloat ${b.bloat}/10</span>` : ''}
      </div>`;
    }

    const driftBadge = (b.driftType && b.driftType !== 'none')
      ? `<span class="drift-badge">↗ ${this.esc(b.driftType)} drift</span> `
      : '';

    const summaryHtml = b.actualOutput
      ? `<div class="block-summary">${driftBadge}${this.esc(b.actualOutput)}</div>` : '';

    const nextHtml = b.nextAction
      ? `<div class="block-next">${this.esc(b.nextAction)}</div>` : '';

    return `<div class="block-card">
      <div class="block-card-header">
        <div class="block-card-obj">${this.esc(b.objective)}</div>
        <div class="block-card-time">${time}</div>
      </div>
      ${scoresHtml}
      ${summaryHtml}
      ${nextHtml}
    </div>`;
  },

  // ── SCORES tab ─────────────────────────────────────────────────────────────
  renderScores() {
    const grid = document.getElementById('scores-grid');
    if (!grid) return;

    const today  = this.today();
    const blocks = Storage.getCompletedBlocksForDate(today);
    const s      = Scores.calculate(blocks);

    const rings = [
      { label:'Focus',    value: s.focus,    color:'var(--teal)',   sub: `${blocks.length} block${blocks.length!==1?'s':''}` },
      { label:'Clarity',  value: s.clarity,  color:'var(--teal)',   sub: 'avg task clarity' },
      { label:'Drift',    value: s.drift,     color:'var(--purple)', sub: 'lower is better' },
      { label:'Bloat',    value: s.bloat,     color:'var(--orange)', sub: 'lower is better' },
      { label:'Momentum', value: Math.min(s.momentum * 10, 100), color:'var(--amber)',  sub: `${s.momentum}-block streak`, raw: s.momentum },
      { label:'Strain',   value: s.strain,    color:'var(--orange)', sub: 'cognitive load' }
    ];

    const CIRC = 219.9; // 2π × 35

    grid.innerHTML = rings.map((r, i) => {
      const displayVal = r.raw != null ? r.raw : r.value;
      const fillPct    = Math.min(r.value, 100);
      return `<div class="score-ring-card">
        <div class="ring-svg-wrap">
          <svg viewBox="0 0 80 80">
            <circle class="ring-track" cx="40" cy="40" r="35"/>
            <circle class="ring-fill" cx="40" cy="40" r="35"
              stroke="${r.color}"
              stroke-dasharray="${CIRC}"
              stroke-dashoffset="${CIRC}"
              data-target="${CIRC * (1 - fillPct / 100)}"/>
          </svg>
          <div class="ring-val" style="color:${r.color}">${displayVal}</div>
        </div>
        <div class="ring-meta">
          <div class="ring-label">${r.label}</div>
          <div class="ring-sublabel">${r.sub}</div>
        </div>
      </div>`;
    }).join('');

    // Animate: double-rAF so CSS transition fires after initial paint
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('.ring-fill[data-target]').forEach(el => {
        el.style.strokeDashoffset = el.dataset.target;
      });
    }));
  },

  // ── SETTINGS tab ───────────────────────────────────────────────────────────
  updateKeyStatus() {
    const key   = Storage.getApiKey();
    const dot   = document.getElementById('key-status-dot');
    const label = document.getElementById('key-status-label');
    const input = document.getElementById('api-key-input');
    if (dot)   dot.className     = 'key-status-dot' + (key ? ' set' : '');
    if (label) label.textContent = key ? `Key saved (${key.slice(0,16)}…)` : 'No key saved';
    if (input) input.value       = '';
  },

  updateDataSummary() {
    const el = document.getElementById('data-summary');
    if (!el) return;
    const blocks     = Storage.getBlocks();
    const today      = this.today();
    const todayCount = Storage.getBlocksForDate(today).length;
    const streak     = this._calcStreak();
    el.textContent   = `${blocks.length} block${blocks.length!==1?'s':''} total · ${todayCount} today · ${streak} day streak`;
  },

  _calcStreak() {
    let streak = 0;
    const check = new Date();
    check.setHours(0, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      const d = check.toISOString().slice(0, 10);
      const hasData = Storage.getSetupForDate(d) || Storage.getBlocksForDate(d).length > 0;
      if (hasData) {
        streak++;
        check.setDate(check.getDate() - 1);
      } else if (i === 0) {
        // Today can be missing — skip to yesterday
        check.setDate(check.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }
};

// ── Modals ────────────────────────────────────────────────────────────────────
const Modals = {
  open(id) {
    const el = document.getElementById('modal-' + id);
    if (el) el.classList.remove('hidden');
  },

  close(id) {
    const el = document.getElementById('modal-' + id);
    if (el) el.classList.add('hidden');
  },

  // ── Morning Setup ──────────────────────────────────────────────────────────
  initMorningSetup() {
    document.getElementById('btn-setup-skip').addEventListener('click', () => {
      this.close('morning');
    });

    document.getElementById('btn-setup-submit').addEventListener('click', async () => {
      await this._onMorningSubmit();
    });

    document.getElementById('setup-banner').addEventListener('click', () => {
      this.open('morning');
    });
  },

  async _onMorningSubmit() {
    const btn       = document.getElementById('btn-setup-submit');
    const resultDiv = document.getElementById('setup-ai-result');
    const mainWin   = document.getElementById('setup-main-win').value.trim();

    if (!mainWin) { UI.toast('Add your main win first', 'error'); return; }

    // Second click → save and close
    if (btn._confirmed && btn._setupData) {
      Storage.saveSetup(btn._setupData);
      this.close('morning');
      UI.renderNow();
      UI.toast('Morning intent saved ✓', 'success');
      // Reset state
      btn._confirmed = false;
      btn._setupData = null;
      resultDiv.style.display = 'none';
      resultDiv.innerHTML     = '';
      UI.setLoading(btn, false, 'Get Strategy →');
      return;
    }

    const topTasks = [
      document.getElementById('setup-task-1').value.trim(),
      document.getElementById('setup-task-2').value.trim(),
      document.getElementById('setup-task-3').value.trim()
    ];
    const likelyDrift = document.getElementById('setup-drift').value.trim();

    UI.setLoading(btn, true, 'Thinking…');
    try {
      const result = await ClaudeAPI.analyzeMorning({ mainWin, topTasks, likelyDrift });

      const setup = {
        date: UI.today(), mainWin, topTasks, likelyDrift,
        strategy:  result.strategy  || '',
        avoidList: result.avoidList || [],
        markdown:  result.markdown  || ''
      };

      resultDiv.innerHTML = `<div class="clarifier-result">
        <div class="cr-section-label">Today's Strategy</div>
        <div class="cr-strategy">${UI.esc(result.strategy || '')}</div>
        ${result.avoidList?.length ? `
          <div class="cr-section-label">Avoid Today</div>
          <div>${result.avoidList.map(a => `<span class="avoid-tag">${UI.esc(a)}</span>`).join('')}</div>
        ` : ''}
      </div>`;
      resultDiv.style.display = '';

      btn._confirmed = true;
      btn._setupData = setup;
      UI.setLoading(btn, false, 'Save & Start Day →');
    } catch (err) {
      UI.toast(err.message, 'error');
      UI.setLoading(btn, false, 'Get Strategy →');
    }
  },

  // ── Start Block ────────────────────────────────────────────────────────────
  initStartBlock() {
    document.getElementById('btn-start-block').addEventListener('click', () => {
      this._resetStartModal();
      this.open('start');
    });

    document.getElementById('btn-start-cancel').addEventListener('click', () => {
      VoiceInput.stop();
      this.close('start');
    });

    document.getElementById('btn-start-action').addEventListener('click', async () => {
      await this._onStartAction();
    });

    document.getElementById('voice-btn-start').addEventListener('click', () => {
      this._toggleVoice(document.getElementById('voice-btn-start'), 'block-obj-input');
    });
  },

  _resetStartModal() {
    const btn       = document.getElementById('btn-start-action');
    const resultDiv = document.getElementById('start-ai-result');
    const input     = document.getElementById('block-obj-input');
    if (input)     input.value             = '';
    if (resultDiv) { resultDiv.style.display = 'none'; resultDiv.innerHTML = ''; }
    if (btn)       { btn._confirmed = false; btn._clarified = null; }
    UI.setLoading(btn, false, 'Clarify with AI →');
  },

  async _onStartAction() {
    const btn       = document.getElementById('btn-start-action');
    const resultDiv = document.getElementById('start-ai-result');
    const rawText   = document.getElementById('block-obj-input')?.value.trim();

    // Second click → start the block
    if (btn._confirmed && btn._clarified) {
      await this._startBlock(btn._clarified);
      return;
    }

    if (!rawText) { UI.toast('Describe what you\'re working on', 'error'); return; }

    UI.setLoading(btn, true, 'Clarifying…');
    try {
      const result = await ClaudeAPI.clarifyTask(rawText);
      const dod    = Array.isArray(result.definitionOfDone) ? result.definitionOfDone : [result.definitionOfDone];
      const avoid  = Array.isArray(result.avoidList)        ? result.avoidList        : [];

      resultDiv.innerHTML = `<div class="clarifier-result">
        <div class="cr-section-label">Refined Objective</div>
        <div class="cr-refined">${UI.esc(result.refinedObjective)}</div>
        <div class="cr-section-label">Done means</div>
        ${dod.map(d => `<div class="cr-dod-item">${UI.esc(d)}</div>`).join('')}
        ${avoid.length ? `
          <div class="cr-section-label">Avoid</div>
          <div>${avoid.map(a => `<span class="avoid-tag">${UI.esc(a)}</span>`).join('')}</div>
        ` : ''}
      </div>`;
      resultDiv.style.display = '';

      btn._confirmed = true;
      btn._clarified = result;
      UI.setLoading(btn, false, '▶ Start 30-Min Block');
    } catch (err) {
      UI.toast(err.message, 'error');
      UI.setLoading(btn, false, 'Clarify with AI →');
    }
  },

  async _startBlock(clarified) {
    const id    = (crypto.randomUUID || (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`))(  );
    const block = {
      id,
      date:             UI.today(),
      startTime:        new Date().toISOString(),
      endTime:          null,
      type:             'block',
      objective:        clarified.refinedObjective,
      definitionOfDone: Array.isArray(clarified.definitionOfDone) ? clarified.definitionOfDone : [clarified.definitionOfDone],
      avoidList:        Array.isArray(clarified.avoidList)        ? clarified.avoidList        : [],
      actualOutput:     null,
      nextAction:       null,
      clarity:          clarified.clarityScore || 7,
      focus:            null,
      bloat:            null,
      drift:            null,
      driftType:        null,
      aiAnalysis:       null
    };

    Storage.saveBlock(block);
    Storage.setCurrentId(id);
    Timer.start();
    await Timer.requestNotificationPermission();
    this.close('start');
    UI.renderNow();
    UI.toast('Block started — 30-min timer running ⏱', 'success');
  },

  // ── Check-In ───────────────────────────────────────────────────────────────
  initCheckin() {
    document.getElementById('btn-checkin-early').addEventListener('click', () => this.openCheckin());
    document.getElementById('btn-checkin-due').addEventListener('click',  () => this.openCheckin());

    document.getElementById('btn-end-block').addEventListener('click', () => {
      if (!confirm('End this block without a check-in?')) return;
      const block = Storage.getCurrentBlock();
      if (block) { block.endTime = new Date().toISOString(); Storage.saveBlock(block); }
      Storage.clearCurrentId();
      Timer.stop();
      UI.renderNow();
      UI.toast('Block ended');
    });

    document.getElementById('btn-checkin-cancel').addEventListener('click', () => {
      VoiceInput.stop();
      this.close('checkin');
    });

    document.getElementById('btn-checkin-submit').addEventListener('click', async () => {
      await this._onCheckinSubmit();
    });

    // Toggle groups
    document.querySelectorAll('#drift-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#drift-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    document.querySelectorAll('#bloat-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#bloat-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('voice-btn-checkin').addEventListener('click', () => {
      this._toggleVoice(document.getElementById('voice-btn-checkin'), 'checkin-output');
    });
  },

  openCheckin() {
    const block = Storage.getCurrentBlock();
    if (!block) { UI.toast('No active block', 'error'); return; }

    const recap = document.getElementById('checkin-goal-recap');
    if (recap) {
      const dod = Array.isArray(block.definitionOfDone) ? block.definitionOfDone : [block.definitionOfDone];
      recap.innerHTML = `
        <div class="bsc-label">Goal</div>
        <div class="bsc-objective">${UI.esc(block.objective)}</div>
        ${dod.filter(Boolean).map(d => `<div class="bsc-dod-item">${UI.esc(d)}</div>`).join('')}
      `;
    }

    // Reset form
    const output    = document.getElementById('checkin-output');
    const resultDiv = document.getElementById('checkin-ai-result');
    const submitBtn = document.getElementById('btn-checkin-submit');
    if (output)    output.value             = '';
    if (resultDiv) { resultDiv.style.display = 'none'; resultDiv.innerHTML = ''; }
    if (submitBtn) { submitBtn._confirmed = false; submitBtn._result = null; }
    UI.setLoading(submitBtn, false, 'Analyse Block →');

    // Reset toggles
    document.querySelector('#drift-toggle .toggle-btn')?.click();
    document.querySelector('#bloat-toggle .toggle-btn')?.click();

    this.open('checkin');
  },

  async _onCheckinSubmit() {
    const btn       = document.getElementById('btn-checkin-submit');
    const resultDiv = document.getElementById('checkin-ai-result');
    const block     = Storage.getCurrentBlock();
    if (!block) { UI.toast('No active block found', 'error'); return; }

    // Second click → commit
    if (btn._confirmed && btn._result) {
      const r        = btn._result;
      block.endTime      = new Date().toISOString();
      block.actualOutput = document.getElementById('checkin-output').value.trim();
      block.focus        = r.focusScore;
      block.clarity      = r.clarityScore;
      block.bloat        = r.bloatScore;
      block.drift        = r.driftScore;
      block.driftType    = r.driftType || 'none';
      block.nextAction   = r.nextAction;
      block.aiAnalysis   = r.redirect  || '';
      Storage.saveBlock(block);
      Storage.clearCurrentId();
      Timer.stop();
      this.close('checkin');
      UI.renderNow();
      UI.toast(`Block done · Focus ${r.focusScore}/10 ✓`, 'success');
      return;
    }

    const whatHappened = document.getElementById('checkin-output').value.trim();
    if (!whatHappened) { UI.toast('Describe what happened first', 'error'); return; }

    const driftLevel = parseInt(document.querySelector('#drift-toggle .toggle-btn.active')?.dataset.value || '0');
    const bloatLevel = parseInt(document.querySelector('#bloat-toggle .toggle-btn.active')?.dataset.value || '0');

    UI.setLoading(btn, true, 'Analysing…');
    try {
      const result = await ClaudeAPI.analyzeCheckin({
        objective:        block.objective,
        definitionOfDone: block.definitionOfDone,
        whatHappened,
        driftLevel,
        bloatLevel
      });

      const driftBadge = (result.driftType && result.driftType !== 'none')
        ? `<span class="score-mini dc">↗ ${UI.esc(result.driftType)} drift</span>` : '';

      resultDiv.innerHTML = `<div class="checkin-result">
        <div class="cr-next-action">→ ${UI.esc(result.nextAction)}</div>
        ${result.redirect ? `<div class="cr-redirect">${UI.esc(result.redirect)}</div>` : ''}
        <div class="score-mini-row">
          <span class="score-mini fc">Focus ${result.focusScore}/10</span>
          <span class="score-mini fc">Clarity ${result.clarityScore}/10</span>
          ${(result.bloatScore||0) > 3 ? `<span class="score-mini bc">Bloat ${result.bloatScore}/10</span>` : ''}
          ${driftBadge}
        </div>
      </div>`;
      resultDiv.style.display = '';

      btn._confirmed = true;
      btn._result    = result;
      UI.setLoading(btn, false, 'Save Block ✓');
    } catch (err) {
      UI.toast(err.message, 'error');
      UI.setLoading(btn, false, 'Analyse Block →');
    }
  },

  // ── Shared voice toggle ────────────────────────────────────────────────────
  _toggleVoice(btn, targetId) {
    VoiceInput.stop();

    if (btn._recording) {
      btn._recording = false;
      btn.classList.remove('recording');
      return;
    }

    if (!VoiceInput.isSupported()) {
      UI.toast('Voice not supported in this browser — type instead', 'error');
      return;
    }

    btn._recording = true;
    btn.classList.add('recording');

    VoiceInput.start(
      transcript => {
        btn._recording = false;
        btn.classList.remove('recording');
        const ta = document.getElementById(targetId);
        if (ta) ta.value = (ta.value ? ta.value + ' ' : '') + transcript;
      },
      err => {
        btn._recording = false;
        btn.classList.remove('recording');
        if (err !== 'no-speech') UI.toast(`Voice: ${err}`, 'error');
      }
    );
  }
};

// ── App ───────────────────────────────────────────────────────────────────────
const App = {
  init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }

    // Header date
    const hd = document.getElementById('header-date');
    if (hd) hd.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Bottom nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab, btn));
    });

    // Init modals
    Modals.initMorningSetup();
    Modals.initStartBlock();
    Modals.initCheckin();

    // Settings buttons
    document.getElementById('btn-save-key').addEventListener('click',     () => this.saveKey());
    document.getElementById('btn-export-md').addEventListener('click',    () => Storage.downloadMarkdown());
    document.getElementById('btn-clear-data').addEventListener('click',   () => this.clearData());
    document.getElementById('btn-mine-patterns').addEventListener('click',() => this.minePatterns());
    document.getElementById('btn-end-day').addEventListener('click',      () => this.endDay());

    // Page visibility — resume timer on foreground
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Timer.isRunning()) {
        Timer.resume();
        UI.renderNow();
      }
    });

    // Initial render
    UI.renderNow();
    UI.updateKeyStatus();
    UI.updateDataSummary();

    // Resume timer if block was active when page was last closed
    if (Storage.getCurrentId() && Storage.getTimerStart()) {
      Timer.resume();
    }

    // Auto-open morning setup after 700ms if today's setup not done
    if (!Storage.getSetupForDate(UI.today())) {
      setTimeout(() => Modals.open('morning'), 700);
    }
  },

  switchTab(name, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    const tab = document.getElementById('tab-' + name);
    if (tab) tab.classList.add('active');
    if (btn) btn.classList.add('active');

    if (name === 'log')      UI.renderLog();
    if (name === 'scores')   UI.renderScores();
    if (name === 'settings') { UI.updateKeyStatus(); UI.updateDataSummary(); }
  },

  saveKey() {
    const input = document.getElementById('api-key-input');
    const key   = input?.value.trim();
    if (!key)                    { UI.toast('Enter a key first', 'error'); return; }
    if (!key.startsWith('sk-ant-')) { UI.toast('Invalid key — Anthropic keys start with sk-ant-', 'error'); return; }
    Storage.setApiKey(key);
    UI.updateKeyStatus();
    UI.toast('API key saved ✓', 'success');
  },

  clearData() {
    if (!confirm('Clear ALL FLOW data? This cannot be undone.')) return;
    Timer.stop();
    Storage.clearAll();
    UI.renderNow();
    UI.renderLog();
    UI.updateDataSummary();
    const insightsEl = document.getElementById('insights-body');
    if (insightsEl) insightsEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.83rem">Complete at least one work block to see AI-generated insights.</p>';
    const scoresGrid = document.getElementById('scores-grid');
    if (scoresGrid) scoresGrid.innerHTML = '';
    UI.toast('All data cleared', 'success');
  },

  async minePatterns() {
    const today  = UI.today();
    const blocks = Storage.getCompletedBlocksForDate(today);
    if (!blocks.length) { UI.toast('No completed blocks today yet', 'error'); return; }

    const btn = document.getElementById('btn-mine-patterns');
    UI.setLoading(btn, true, 'Analysing patterns…');
    try {
      const md         = await ClaudeAPI.minePatterns(JSON.stringify(blocks, null, 2));
      const insightsEl = document.getElementById('insights-body');
      if (insightsEl) insightsEl.innerHTML = UI.mdToHtml(md);
      UI.toast('Patterns mined ✓', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      UI.setLoading(btn, false, 'Mine Today\'s Patterns');
    }
  },

  async endDay() {
    const today  = UI.today();
    const blocks = Storage.getCompletedBlocksForDate(today);
    if (!blocks.length) { UI.toast('No completed blocks today', 'error'); return; }
    if (!confirm(`Generate end-of-day summary for ${blocks.length} block${blocks.length!==1?'s':''}?`)) return;

    const btn = document.getElementById('btn-end-day');
    UI.setLoading(btn, true, 'Generating summary…');
    try {
      const md         = await ClaudeAPI.minePatterns(JSON.stringify(blocks, null, 2));
      const insightsEl = document.getElementById('insights-body');
      if (insightsEl) insightsEl.innerHTML = UI.mdToHtml(md);
      // Switch to Scores tab to show insights
      const scoresBtn = document.querySelector('.nav-btn[data-tab="scores"]');
      this.switchTab('scores', scoresBtn);
      UI.toast('Day summary ready ✓', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      UI.setLoading(btn, false, 'End Day & Get Summary');
    }
  }
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
