import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Config ────────────────────────────────────────────────────────────────────

const LOG_PATH = process.env.FLOW_LOG_PATH ||
  join(homedir(), 'Downloads', 'flow-log.md');

// ── Markdown Parser ───────────────────────────────────────────────────────────

function readLog() {
  if (!existsSync(LOG_PATH)) return null;
  return readFileSync(LOG_PATH, 'utf-8');
}

/**
 * Parse the exported FLOW markdown into structured WorkBlock objects.
 *
 * Expected format per block:
 *   ### 10:30 AM — Write 5 headline options
 *   **Done means:** criterion 1; criterion 2
 *   **Output:** what actually happened
 *   **Focus:** 8/10  **Clarity:** 7/10  **Drift:** 2/10  **Bloat:** 1/10
 *   **Drift type:** research
 *   **Next action:** Write 2 more headlines
 */
function parseLog(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');

  let currentDate = null;
  let currentBlock = null;
  let inSetup = false;
  let setupData = {};

  const flushBlock = () => {
    if (currentBlock && currentBlock.objective) {
      blocks.push({ ...currentBlock });
    }
    currentBlock = null;
  };

  const parseScore = (line, key) => {
    const re = new RegExp(`\\*\\*${key}:\\*\\*\\s*(\\d+)/10`, 'i');
    const m  = line.match(re);
    return m ? parseInt(m[1], 10) : null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // ## 2026-05-13  (date header)
    if (/^## \d{4}-\d{2}-\d{2}/.test(trimmed)) {
      flushBlock();
      currentDate = trimmed.slice(3).trim();
      inSetup     = false;
      setupData   = {};
      continue;
    }

    // ### Morning Intent
    if (/^### Morning Intent/.test(trimmed)) {
      flushBlock();
      inSetup = true;
      continue;
    }

    // ### 10:30 AM — Objective  (block header)
    if (/^### /.test(trimmed) && !inSetup) {
      flushBlock();
      inSetup = false;
      const header   = trimmed.slice(4).trim();
      const timeSplit = header.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*[—\-]\s*(.+)$/i);
      currentBlock = {
        date:             currentDate,
        time:             timeSplit ? timeSplit[1].trim() : null,
        objective:        timeSplit ? timeSplit[2].trim() : header,
        definitionOfDone: null,
        actualOutput:     null,
        focus:            null,
        clarity:          null,
        drift:            null,
        bloat:            null,
        driftType:        null,
        nextAction:       null
      };
      continue;
    }

    // Morning setup fields
    if (inSetup) {
      const mainWin = trimmed.match(/^\*\*Main win:\*\*\s*(.+)/i);
      if (mainWin) { setupData.mainWin = mainWin[1].trim(); }
      const strategy = trimmed.match(/^\*\*Strategy:\*\*\s*(.+)/i);
      if (strategy) { setupData.strategy = strategy[1].trim(); }
      if (trimmed === '---') { inSetup = false; }
      continue;
    }

    // Block fields
    if (currentBlock) {
      const dod = trimmed.match(/^\*\*Done means:\*\*\s*(.+)/i);
      if (dod) { currentBlock.definitionOfDone = dod[1].trim(); continue; }

      const output = trimmed.match(/^\*\*Output:\*\*\s*(.+)/i);
      if (output) { currentBlock.actualOutput = output[1].trim(); continue; }

      const next = trimmed.match(/^\*\*Next action:\*\*\s*(.+)/i);
      if (next) { currentBlock.nextAction = next[1].trim(); continue; }

      const dtype = trimmed.match(/^\*\*Drift type:\*\*\s*(.+)/i);
      if (dtype) { currentBlock.driftType = dtype[1].trim(); continue; }

      // Score line: **Focus:** 8/10  **Clarity:** 7/10  ...
      if (/\*\*Focus:\*\*/.test(trimmed)) {
        currentBlock.focus   = parseScore(trimmed, 'Focus');
        currentBlock.clarity = parseScore(trimmed, 'Clarity');
        currentBlock.drift   = parseScore(trimmed, 'Drift');
        currentBlock.bloat   = parseScore(trimmed, 'Bloat');
        continue;
      }
    }
  }

  flushBlock();
  return blocks;
}

// ── Score Calculations ────────────────────────────────────────────────────────

function calcDailyScores(blocks) {
  const done = blocks.filter(b => b.focus !== null);
  if (!done.length) return null;

  const avg = key => done.reduce((s, b) => s + (b[key] || 0), 0) / done.length;

  const focus    = Math.round(avg('focus')   * 10);
  const clarity  = Math.round(avg('clarity') * 10);
  const bloat    = Math.round(avg('bloat')   * 10);
  const drift    = Math.round(done.filter(b => (b.drift || 0) > 3).length / done.length * 100);

  let momentum = 0, cur = 0;
  done.forEach(b => {
    if ((b.focus || 0) > 6) { cur++; momentum = Math.max(momentum, cur); }
    else cur = 0;
  });

  const avgDiff   = done.reduce((s, b) => s + (10 - (b.focus || 5)), 0) / done.length;
  const driftCnt  = done.filter(b => (b.drift || 0) > 3).length;
  const strain    = Math.min(100, Math.round(avgDiff * 10 + (driftCnt / done.length) * 20));

  const driftTypes = done.filter(b => b.driftType && b.driftType !== 'none').map(b => b.driftType);
  const topDrift   = driftTypes.length
    ? Object.entries(driftTypes.reduce((m, d) => { m[d] = (m[d] || 0) + 1; return m; }, {}))
        .sort((a, b) => b[1] - a[1])[0][0]
    : 'none';

  return { focus, clarity, bloat, drift, momentum, strain, blocksCompleted: done.length, topDriftType: topDrift };
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

function getWorkBlocks(date, startDate, endDate) {
  const raw = readLog();
  if (!raw) {
    return {
      error: `Flow log not found at ${LOG_PATH}. Export your log from the FLOW app first (Settings → Download flow-log.md), then place it at that path or set the FLOW_LOG_PATH env variable.`
    };
  }

  const blocks = parseLog(raw);
  const filtered = blocks.filter(b => {
    if (!b.date) return false;
    if (date      && b.date !== date)         return false;
    if (startDate && b.date < startDate)      return false;
    if (endDate   && b.date > endDate)        return false;
    return true;
  });

  if (!filtered.length) {
    return { message: 'No work blocks found for the specified filter.', blocks: [] };
  }

  return { blocks: filtered, total: filtered.length };
}

function getDailyScores(date, startDate, endDate) {
  const raw = readLog();
  if (!raw) return { error: `Flow log not found at ${LOG_PATH}.` };

  const allBlocks = parseLog(raw);

  // Group by date
  const byDate = {};
  allBlocks.forEach(b => {
    if (!b.date) return;
    if (date      && b.date !== date)    return;
    if (startDate && b.date < startDate) return;
    if (endDate   && b.date > endDate)   return;
    if (!byDate[b.date]) byDate[b.date] = [];
    byDate[b.date].push(b);
  });

  if (!Object.keys(byDate).length) {
    return { message: 'No scored blocks found for the specified filter.', scores: {} };
  }

  const scores = {};
  for (const [d, blocks] of Object.entries(byDate)) {
    scores[d] = calcDailyScores(blocks);
  }

  return { scores, dates: Object.keys(scores).sort() };
}

function getDailySummary(date) {
  const raw = readLog();
  if (!raw) return { error: `Flow log not found at ${LOG_PATH}.` };

  const targetDate = date || new Date().toISOString().slice(0, 10);
  const blocks     = parseLog(raw).filter(b => b.date === targetDate);

  if (!blocks.length) {
    return { message: `No blocks found for ${targetDate}.`, date: targetDate };
  }

  const scored = blocks.filter(b => b.focus !== null);
  const scores = calcDailyScores(blocks);

  const driftBlocks  = scored.filter(b => (b.drift || 0) > 3);
  const bloatBlocks  = scored.filter(b => (b.bloat || 0) > 3);
  const bestBlock    = scored.sort((a, b) => (b.focus || 0) - (a.focus || 0))[0] || null;
  const worstBlock   = scored.sort((a, b) => (a.focus || 0) - (b.focus || 0))[0] || null;

  return {
    date: targetDate,
    scores,
    totalBlocks:     blocks.length,
    scoredBlocks:    scored.length,
    driftBlocks:     driftBlocks.length,
    bloatBlocks:     bloatBlocks.length,
    bestBlock:       bestBlock   ? { time: bestBlock.time,   objective: bestBlock.objective,   focus: bestBlock.focus   } : null,
    worstBlock:      worstBlock  ? { time: worstBlock.time,  objective: worstBlock.objective,  focus: worstBlock.focus  } : null,
    allObjectives:   blocks.map(b => `${b.time || '?'}: ${b.objective}`),
    nextActions:     scored.filter(b => b.nextAction).map(b => b.nextAction)
  };
}

function searchBlocks(query) {
  const raw = readLog();
  if (!raw) return { error: `Flow log not found at ${LOG_PATH}.` };

  const q       = query.toLowerCase();
  const blocks  = parseLog(raw);
  const matches = blocks.filter(b =>
    [b.objective, b.actualOutput, b.nextAction, b.driftType].some(v => v && v.toLowerCase().includes(q))
  );

  return { query, matches, total: matches.length };
}

function getWeeklyPatterns(weeksBack) {
  const raw = readLog();
  if (!raw) return { error: `Flow log not found at ${LOG_PATH}.` };

  const blocks   = parseLog(raw);
  const today    = new Date();
  const cutoff   = new Date(today);
  cutoff.setDate(today.getDate() - (weeksBack || 1) * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filtered = blocks.filter(b => b.date && b.date >= cutoffStr);
  if (!filtered.length) {
    return { message: `No blocks found in the last ${weeksBack || 1} week(s).` };
  }

  const scored = filtered.filter(b => b.focus !== null);

  // Best focus hour
  const byHour = {};
  filtered.forEach(b => {
    if (!b.time || b.focus === null) return;
    const h = parseInt(b.time);
    if (isNaN(h)) return;
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(b.focus);
  });
  const bestHour = Object.entries(byHour)
    .map(([h, scores]) => ({ hour: parseInt(h), avgFocus: scores.reduce((s,v) => s+v,0) / scores.length }))
    .sort((a,b) => b.avgFocus - a.avgFocus)[0];

  // Drift type breakdown
  const driftTypes = scored.filter(b => b.driftType && b.driftType !== 'none').map(b => b.driftType);
  const driftBreakdown = driftTypes.reduce((m, d) => { m[d] = (m[d] || 0) + 1; return m; }, {});

  // Average scores
  const avgScores = scored.length ? calcDailyScores(scored) : null;

  // High-drift objectives (what types of tasks tend to drift)
  const driftObjectives = scored
    .filter(b => (b.drift || 0) > 5)
    .map(b => b.objective)
    .slice(0, 5);

  return {
    period:           `Last ${weeksBack || 1} week(s)`,
    totalBlocks:      filtered.length,
    scoredBlocks:     scored.length,
    averageScores:    avgScores,
    bestFocusHour:    bestHour ? `${bestHour.hour}:00 (avg focus ${bestHour.avgFocus.toFixed(1)}/10)` : null,
    driftTypeBreakdown: driftBreakdown,
    highDriftObjectives: driftObjectives
  };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'flow-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_work_blocks',
      description: 'Get work blocks from the FLOW productivity log. Returns individual block records with objectives, scores (focus/clarity/drift/bloat), outputs, and next actions. Filter by date or date range.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Exact date filter in YYYY-MM-DD format. Omit to get all blocks.'
          },
          start_date: {
            type: 'string',
            description: 'Start of date range in YYYY-MM-DD format (inclusive).'
          },
          end_date: {
            type: 'string',
            description: 'End of date range in YYYY-MM-DD format (inclusive).'
          }
        }
      }
    },
    {
      name: 'get_daily_scores',
      description: 'Get cognitive biometric scores aggregated by day: Focus (0-100), Clarity (0-100), Drift (0-100, lower is better), Bloat (0-100, lower is better), Momentum (streak count), Strain (0-100). Optionally filter by date or range.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Single date in YYYY-MM-DD format. Omit for all dates.'
          },
          start_date: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format (inclusive).'
          },
          end_date: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format (inclusive).'
          }
        }
      }
    },
    {
      name: 'get_daily_summary',
      description: 'Get a comprehensive summary for a single day: total blocks, scores, best/worst block, all objectives, next actions, drift/bloat counts.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format. Defaults to today.'
          }
        }
      }
    },
    {
      name: 'search_blocks',
      description: 'Search work blocks by keyword — matches against objective, actual output, next action, or drift type. Useful for finding all blocks on a topic (e.g. "positioning", "homepage", "investor").',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term to match against block fields.'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'get_weekly_patterns',
      description: 'Analyse productivity patterns over the past N weeks: average scores, best focus hour of day, drift type breakdown, tasks most likely to drift. Good for "what patterns show up in my work?"',
      inputSchema: {
        type: 'object',
        properties: {
          weeks_back: {
            type: 'number',
            description: 'How many weeks back to analyse. Defaults to 1.'
          }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  let result;
  try {
    switch (name) {
      case 'get_work_blocks':
        result = getWorkBlocks(args.date, args.start_date, args.end_date);
        break;
      case 'get_daily_scores':
        result = getDailyScores(args.date, args.start_date, args.end_date);
        break;
      case 'get_daily_summary':
        result = getDailySummary(args.date);
        break;
      case 'search_blocks':
        result = searchBlocks(args.query);
        break;
      case 'get_weekly_patterns':
        result = getWeeklyPatterns(args.weeks_back);
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`FLOW MCP server started. Reading log from: ${LOG_PATH}`);
