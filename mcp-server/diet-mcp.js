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

const DIARY_PATH = process.env.NUTRILOG_DIARY_PATH ||
  join(homedir(), 'Downloads', 'nutrilog-diary.md');

// ── Diary Parsing ─────────────────────────────────────────────────────────────

function readDiary() {
  if (!existsSync(DIARY_PATH)) return null;
  return readFileSync(DIARY_PATH, 'utf-8');
}

function parseNumber(str) {
  if (!str) return 0;
  const n = parseInt(String(str).replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse the exported NutriLog markdown into an array of entry objects.
 * Each entry: { date, time, mealTitle, item, qty, calories, protein, carbs, fat, fiber, notes }
 */
function parseDiary(markdown) {
  const entries = [];
  const lines = markdown.split('\n');

  let currentDate = null;
  let currentTime = null;
  let currentMeal = null;
  let tableHeaders = null;
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // ## 2026-04-15
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      currentDate = trimmed.slice(3).trim();
      currentTime = null;
      currentMeal = null;
      inTable = false;
      tableHeaders = null;
      continue;
    }

    // ### 1:30 PM — Meal: Scrambled eggs...
    if (trimmed.startsWith('### ')) {
      const header = trimmed.slice(4).trim();
      // Extract time if present (e.g. "1:30 PM — ...")
      const timeMatch = header.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[—-]\s*(.+)$/i);
      if (timeMatch) {
        currentTime = timeMatch[1].trim();
        currentMeal = timeMatch[2].replace(/^Meal:\s*/i, '').trim();
      } else {
        currentMeal = header.replace(/^Meal:\s*/i, '').trim();
        currentTime = null;
      }
      inTable = false;
      tableHeaders = null;
      continue;
    }

    // Table header row
    if (trimmed.startsWith('|') && tableHeaders === null && currentDate) {
      const cells = trimmed.split('|').filter(Boolean).map(c => c.trim().toLowerCase());
      // Validate it looks like our nutrition table
      if (cells.includes('item') || cells.includes('cal') || cells.includes('calories')) {
        tableHeaders = cells;
        inTable = true;
      }
      continue;
    }

    // Table separator row
    if (inTable && trimmed.startsWith('|') && trimmed.replace(/[|\-: ]/g, '') === '') {
      continue;
    }

    // Table data row
    if (inTable && trimmed.startsWith('|') && tableHeaders) {
      const cells = trimmed.split('|').filter(Boolean).map(c => c.trim());
      const row = {};
      tableHeaders.forEach((h, i) => { row[h] = cells[i] || ''; });

      // Skip totals row
      if ((row['item'] || '').toLowerCase() === 'total') continue;

      entries.push({
        date: currentDate,
        time: currentTime || '',
        mealTitle: currentMeal || '',
        item: row['item'] || '',
        qty: row['qty'] || row['quantity'] || '',
        calories: parseNumber(row['cal'] || row['calories']),
        protein: parseNumber(row['protein']),
        carbs: parseNumber(row['carbs']),
        fat: parseNumber(row['fat']),
        fiber: parseNumber(row['fiber']),
        notes: row['notes'] || ''
      });
      continue;
    }

    // Blank line or HR resets table state
    if (!trimmed || trimmed === '---') {
      inTable = false;
      tableHeaders = null;
    }
  }

  return entries;
}

function aggregateByDate(entries) {
  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.date]) {
      byDate[e.date] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, items: 0, meals: new Set() };
    }
    byDate[e.date].calories += e.calories;
    byDate[e.date].protein  += e.protein;
    byDate[e.date].carbs    += e.carbs;
    byDate[e.date].fat      += e.fat;
    byDate[e.date].fiber    += e.fiber;
    byDate[e.date].items++;
    if (e.mealTitle) byDate[e.date].meals.add(e.mealTitle);
  }
  // Convert Sets to arrays for JSON serialization
  for (const d of Object.keys(byDate)) {
    byDate[d].meals = Array.from(byDate[d].meals);
  }
  return byDate;
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

function getDiaryEntries(date) {
  const raw = readDiary();
  if (!raw) {
    return {
      error: `Diary file not found at ${DIARY_PATH}. Export your diary from the NutriLog app first (Settings → Download nutrilog-diary.md), then place it at that path.`
    };
  }

  const entries = parseDiary(raw);
  const filtered = date ? entries.filter(e => e.date === date) : entries;

  if (filtered.length === 0) {
    return {
      message: date ? `No entries found for ${date}.` : 'The diary is empty.',
      entries: []
    };
  }

  return { entries: filtered, total: filtered.length };
}

function getNutritionalSummary(startDate, endDate) {
  const raw = readDiary();
  if (!raw) {
    return { error: `Diary file not found at ${DIARY_PATH}.` };
  }

  const entries = parseDiary(raw);
  const filtered = entries.filter(e => {
    if (startDate && e.date < startDate) return false;
    if (endDate   && e.date > endDate)   return false;
    return true;
  });

  if (filtered.length === 0) {
    return { message: 'No entries in the specified date range.', summary_by_date: {} };
  }

  const byDate = aggregateByDate(filtered);
  const dates = Object.keys(byDate).sort();
  const avgCal = dates.length
    ? Math.round(dates.reduce((s, d) => s + byDate[d].calories, 0) / dates.length)
    : 0;

  return {
    summary_by_date: byDate,
    date_range: { start: dates[0], end: dates[dates.length - 1], days: dates.length },
    average_daily_calories: avgCal
  };
}

function searchEntries(query) {
  const raw = readDiary();
  if (!raw) {
    return { error: `Diary file not found at ${DIARY_PATH}.` };
  }

  const q = query.toLowerCase();
  const entries = parseDiary(raw);
  const matches = entries.filter(e =>
    [e.item, e.mealTitle, e.notes, e.qty].some(v => v && v.toLowerCase().includes(q))
  );

  return { query, matches, total: matches.length };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'nutrilog-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_diary_entries',
      description: 'Get food diary entries from the NutriLog diet diary. Returns individual food item rows with nutrition data. Optionally filter by a specific date.',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Optional date filter in YYYY-MM-DD format (e.g. "2026-04-15"). Omit to get all entries.'
          }
        }
      }
    },
    {
      name: 'get_nutritional_summary',
      description: 'Get a daily nutritional summary aggregated by date (total calories, protein, carbs, fat, fiber per day). Optionally filter by date range. Also returns average daily calorie intake.',
      inputSchema: {
        type: 'object',
        properties: {
          start_date: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format (inclusive). Omit for all time.'
          },
          end_date: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format (inclusive). Omit for all time.'
          }
        }
      }
    },
    {
      name: 'search_entries',
      description: 'Search diary entries by food item name, meal title, or notes. Useful for finding when a specific food was eaten (e.g. "chicken", "coffee", "pizza").',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term to look for in food item names, meal titles, or notes.'
          }
        },
        required: ['query']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  let result;
  try {
    switch (name) {
      case 'get_diary_entries':
        result = getDiaryEntries(args.date);
        break;
      case 'get_nutritional_summary':
        result = getNutritionalSummary(args.start_date, args.end_date);
        break;
      case 'search_entries':
        result = searchEntries(args.query);
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
console.error(`NutriLog MCP server started. Reading diary from: ${DIARY_PATH}`);
