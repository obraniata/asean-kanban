/**
 * ============================================================
 *  SOUTHEAST ASIA MAP CHALLENGE  -  Code.gs
 *  Social Studies, Matayom 1  (Sections M1/11 and M1/12)
 *  Topic: The Development of Southeast Asian Nations
 * ------------------------------------------------------------
 *  Files in this project (4):
 *    1. Code.gs          (this file - server side)
 *    2. index.html       (page structure)
 *    3. stylesheet.html  (all CSS, wrapped in <style>)
 *    4. script.html      (all client JS, wrapped in <script>)
 *
 *  DATA SHEET
 *    Leave SPREADSHEET_ID empty and the app will use the
 *    spreadsheet this script is bound to. If the script is
 *    standalone, it creates one spreadsheet automatically the
 *    first time it is needed and remembers it. To log into a
 *    spreadsheet you already have, paste its ID between the
 *    quotes below.
 *
 *  DEPLOY
 *    Deploy > New deployment > Web app
 *    Execute as: Me      Who has access: Anyone
 *    (After any code change: Deploy > Manage deployments >
 *     Edit > New version, otherwise students see the old code.)
 * ============================================================
 */

var CONFIG = {
  APP_TITLE: 'Southeast Asia Map Challenge',
  SPREADSHEET_ID: '',                    // optional - see notes above
  SPREADSHEET_NAME: 'Southeast Asia Map Challenge - Results',
  RESULTS_SHEET: 'Results',
  SUMMARY_SHEET: 'Summary',
  ATTEMPTS_SHEET: 'Attempts',            // every Check/Submit, one row per circle
  ANALYTICS_SHEET: 'Analytics',          // hardest countries + students needing help
  HIGH_RISK_BELOW: 50,                   // first-try % below this = "Needs reinforcement"
  WATCH_BELOW: 70,                       // first-try % below this = "Watch"
  SECTIONS: ['M1/11', 'M1/12'],
  ALLOW_RETAKE: true,                    // true = many attempts per Student ID (averaged in Analytics)
  MAX_NAME_LENGTH: 80,
  ID_PATTERN: /^[0-9A-Za-z]{4,10}$/
};

/**
 * Answer key. Zone IDs are opaque on purpose: the student's browser
 * never receives country names for the map circles, so the key cannot
 * be read from the page. All checking and scoring happens here.
 */
var ANSWER_KEY = {
  z1: 'Myanmar',
  z2: 'Thailand',
  z3: 'Laos',
  z4: 'Vietnam',
  z5: 'Cambodia',
  z6: 'Malaysia',
  z7: 'Singapore',
  z8: 'Brunei',
  z9: 'Indonesia',
  z10: 'Philippines',
  z11: 'Timor-Leste'
};

var ZONE_ORDER = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'z8', 'z9', 'z10', 'z11'];

/**
 * 5 levels x 11 circles = 55 points. Level 1 = where is each country (ANSWER_KEY).
 * Levels 2-5 reuse the same circles, which show the country name once Level 1
 * has been submitted. Edit the answers here (the browser never receives these maps).
 * Note: Level 4 (flags) is keyed by country, the flag image is the item.
 */
var LEVELS = [
  { id: 1, name: 'Countries', key: ANSWER_KEY },
  { id: 2, name: 'Capitals', key: { z1: 'Naypyidaw', z2: 'Bangkok', z3: 'Vientiane', z4: 'Hanoi', z5: 'Phnom Penh',
      z6: 'Kuala Lumpur', z7: 'Singapore', z8: 'Bandar Seri Begawan', z9: 'Jakarta', z10: 'Manila', z11: 'Dili' } },
  { id: 3, name: 'Languages', key: { z1: 'Burmese', z2: 'Thai', z3: 'Lao', z4: 'Vietnamese', z5: 'Khmer',
      z6: 'Bahasa Malaysia', z7: 'English', z8: 'Malay (Bahasa Melayu)', z9: 'Bahasa Indonesia', z10: 'Filipino', z11: 'Tetum' } },
  { id: 4, name: 'Flags', key: ANSWER_KEY },
  { id: 5, name: 'Currency', key: { z1: 'Kyat', z2: 'Baht', z3: 'Kip', z4: 'Dong', z5: 'Riel', z6: 'Ringgit',
      z7: 'Singapore Dollar', z8: 'Brunei Dollar', z9: 'Rupiah', z10: 'Philippine Peso', z11: 'US Dollar' } }
];

function levelKey_(level) {
  var lv = LEVELS[(parseInt(level, 10) || 0) - 1];
  return lv ? lv.key : null;
}

/** Best score per level for a Student ID (blank Level column = Level 1, from older rows). */
function getProgress_(sheet, id) {
  var best = {}, last = sheet.getLastRow();
  if (last < 2) return { best: best };
  var cols = Math.min(22, sheet.getMaxColumns());
  sheet.getRange(2, 1, last - 1, cols).getValues().forEach(function (r) {
    if (String(r[1]).toLowerCase() !== String(id).toLowerCase()) return;
    var lv = parseInt(r[21], 10) || 1, sc = Number(r[4]) || 0;
    if (best[lv] === undefined || sc > best[lv]) best[lv] = sc;
  });
  return { best: best };
}

/* ------------------------------------------------------------
 *  WEB APP ENTRY POINT
 * ------------------------------------------------------------ */

function doGet() {
  var template = HtmlService.createTemplateFromFile('index');
  return template
    .evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Lets index.html pull in stylesheet.html and script.html. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ------------------------------------------------------------
 *  CALLED FROM THE BROWSER
 * ------------------------------------------------------------ */

/** Basic settings the page needs on load. */
function getInitData() {
  return {
    title: CONFIG.APP_TITLE,
    sections: CONFIG.SECTIONS,
    total: ZONE_ORDER.length,
    allowRetake: CONFIG.ALLOW_RETAKE
  };
}

/** URL of the Data Sheet (creates the spreadsheet on first use). */
function getSheetUrl() {
  try {
    var ss = getSpreadsheet_(false);
    ensureSheets_(ss);
    return { ok: true, url: ss.getUrl() };
  } catch (err) {
    return { ok: false, url: '', message: String(err && err.message ? err.message : err) };
  }
}

/**
 * Called when a student presses Start.
 * Validates the details and tells the page whether this ID has
 * already submitted.
 */
function verifyStudent(studentId, fullName, section) {
  try {
    var clean = validateStudent_(studentId, fullName, section);
    if (!clean.ok) return clean;
    var sheet = ensureSheets_(getSpreadsheet_(false)).results;
    var best = getProgress_(sheet, clean.studentId).best;
    return { ok: true, exists: false, studentId: clean.studentId, best: best,
             labels: best[1] !== undefined ? ANSWER_KEY : null };
  } catch (err) {
    return { ok: false, message: 'Server error: ' + (err && err.message ? err.message : err) };
  }
}

/**
 * "Check answers" - practice check. Returns right/wrong for every
 * circle the student has filled. Nothing is saved.
 * placements = { zoneId: 'Country name', ... }
 */
function checkPlacements(placements, student, attemptId, fresh, level) {
  try {
    level = parseInt(level, 10) || 1;
    var key = levelKey_(level) || ANSWER_KEY;
    var cleaned = cleanPlacements_(placements, level);
    var results = {};
    var correct = 0;
    var placed = 0;
    ZONE_ORDER.forEach(function (zoneId) {
      if (cleaned[zoneId]) {
        placed++;
        var isRight = cleaned[zoneId] === key[zoneId];
        results[zoneId] = isRight;
        if (isRight) correct++;
      }
    });
    logAttempts_('check', student, attemptId, cleaned, Array.isArray(fresh) ? fresh : [], level);
    return { ok: true, results: results, correct: correct, placed: placed, total: ZONE_ORDER.length };
  } catch (err) {
    return { ok: false, message: 'Server error: ' + (err && err.message ? err.message : err) };
  }
}

/**
 * Final submission. The score is calculated here from the
 * placements - the browser cannot send a made-up score.
 * payload = { studentId, fullName, section, placements, checks, seconds }
 */
function submitResult(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return { ok: false, message: 'The server is busy. Please wait a few seconds and press Submit again.' };
  }

  try {
    payload = payload || {};
    var clean = validateStudent_(payload.studentId, payload.fullName, payload.section);
    if (!clean.ok) return clean;

    var level = parseInt(payload.level, 10) || 1;
    var key = levelKey_(level);
    if (!key) return { ok: false, message: 'Unknown level.' };
    var placements = cleanPlacements_(payload.placements, level);
    var missing = ZONE_ORDER.filter(function (z) { return !placements[z]; });
    if (missing.length > 0) {
      return { ok: false, message: 'Please place all ' + ZONE_ORDER.length + ' country names before submitting.' };
    }

    var ss = getSpreadsheet_(true);
    var sheets = ensureSheets_(ss);
    var sheet = sheets.results;

    if (!CONFIG.ALLOW_RETAKE && getProgress_(sheet, clean.studentId).best[level] !== undefined) {
      return { ok: false, duplicate: true, message: 'This Student ID has already submitted. Ask your teacher if you need to try again.' };
    }

    var results = {};
    var correct = 0;
    var wrongList = [];
    ZONE_ORDER.forEach(function (zoneId) {
      var isRight = placements[zoneId] === key[zoneId];
      results[zoneId] = isRight;
      if (isRight) {
        correct++;
      } else {
        wrongList.push('L' + level + ' ' + ANSWER_KEY[zoneId] + ' circle <- ' + placements[zoneId]);
      }
    });

    var total = ZONE_ORDER.length;
    var percent = Math.round((correct / total) * 1000) / 10;
    var checks = Math.max(0, Math.min(999, parseInt(payload.checks, 10) || 0));
    var seconds = Math.max(0, Math.min(86400, parseInt(payload.seconds, 10) || 0));

    var row = [
      new Date(),
      clean.studentId,
      clean.fullName,
      clean.section,
      correct,
      total,
      percent,
      checks,
      seconds,
      wrongList.length ? wrongList.join(' | ') : 'None'
    ];
    ZONE_ORDER.forEach(function (zoneId) {
      row.push(placements[zoneId]);
    });
    row.push(level);

    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
    sheet.getRange(nextRow, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    SpreadsheetApp.flush();

    try {
      appendAttemptRows_(sheets.attempts, 'submit', clean, payload.attemptId, placements, ZONE_ORDER, level);
      refreshAnalytics_(sheets);
    } catch (logErr) { /* analytics must never block a submission */ }

    return {
      ok: true,
      score: correct,
      total: total,
      percent: percent,
      results: results,
      key: key,
      level: level,
      best: getProgress_(sheet, clean.studentId).best,
      labels: ANSWER_KEY
    };
  } catch (err) {
    return { ok: false, message: 'Server error: ' + (err && err.message ? err.message : err) };
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }
}

/* ------------------------------------------------------------
 *  VALIDATION HELPERS
 * ------------------------------------------------------------ */

function validateStudent_(studentId, fullName, section) {
  var id = String(studentId == null ? '' : studentId).replace(/\s+/g, '');
  var name = String(fullName == null ? '' : fullName).replace(/\s+/g, ' ').trim();
  var sec = String(section == null ? '' : section).trim();

  if (!CONFIG.ID_PATTERN.test(id)) {
    return { ok: false, message: 'Please enter a valid Student ID (4 to 10 letters or numbers, no spaces).' };
  }
  if (name.length < 2) {
    return { ok: false, message: 'Please enter your full name.' };
  }
  if (name.length > CONFIG.MAX_NAME_LENGTH) {
    return { ok: false, message: 'That name is too long. Please use at most ' + CONFIG.MAX_NAME_LENGTH + ' characters.' };
  }
  if (CONFIG.SECTIONS.indexOf(sec) === -1) {
    return { ok: false, message: 'Please choose your section (' + CONFIG.SECTIONS.join(' or ') + ').' };
  }
  return { ok: true, studentId: safeCell_(id), fullName: safeCell_(name), section: sec };
}

/** Keeps only known zone IDs and known country names, one name per circle. */
function cleanPlacements_(placements, level) {
  var key = levelKey_(level) || ANSWER_KEY;
  var allowed = {};
  ZONE_ORDER.forEach(function (z) { allowed[key[z]] = true; });

  var out = {};
  var usedNames = {};
  if (!placements || typeof placements !== 'object') return out;

  ZONE_ORDER.forEach(function (zoneId) {
    var value = placements[zoneId];
    if (typeof value === 'string' && allowed[value] && !usedNames[value]) {
      out[zoneId] = value;
      usedNames[value] = true;
    }
  });
  return out;
}

/** Stops a cell that starts with = + - @ from being read as a formula. */
function safeCell_(text) {
  var s = String(text);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/* ------------------------------------------------------------
 *  SPREADSHEET HELPERS
 * ------------------------------------------------------------ */

function getSpreadsheet_(haveLock) {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }

  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('SPREADSHEET_ID');
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {
      // The saved spreadsheet was deleted or is not reachable - fall through.
    }
  }

  var bound = null;
  try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (e2) { bound = null; }
  if (bound) {
    props.setProperty('SPREADSHEET_ID', bound.getId());
    return bound;
  }

  var lock = null;
  if (!haveLock) {
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
  }
  try {
    var again = props.getProperty('SPREADSHEET_ID');
    if (again) {
      try { return SpreadsheetApp.openById(again); } catch (e3) { /* create a new one */ }
    }
    var created = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
    props.setProperty('SPREADSHEET_ID', created.getId());
    return created;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (e4) { /* ignore */ }
    }
  }
}

function buildHeaders_() {
  var headers = [
    'Timestamp',
    'Student ID',
    'Full Name',
    'Section',
    'Score',
    'Total',
    'Percent',
    'Checks Used',
    'Time (sec)',
    'Wrong Placements'
  ];
  ZONE_ORDER.forEach(function (zoneId) {
    headers.push('Circle: ' + ANSWER_KEY[zoneId]);
  });
  headers.push('Level');
  return headers;
}

/** Makes sure the Results and Summary sheets exist. */
function ensureSheets_(ss) {
  var results = ss.getSheetByName(CONFIG.RESULTS_SHEET);
  if (!results) {
    var sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0 && sheets[0].getLastColumn() === 0) {
      results = sheets[0];
      results.setName(CONFIG.RESULTS_SHEET);
    } else {
      results = ss.insertSheet(CONFIG.RESULTS_SHEET);
    }
  }

  var headers = buildHeaders_();
  if (results.getLastRow() === 0) {
    results.getRange(1, 1, 1, headers.length).setValues([headers]);
    results.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#0e2f44')
      .setFontColor('#ffffff')
      .setWrap(true)
      .setVerticalAlignment('middle');
    results.setFrozenRows(1);
    results.getRange('B:B').setNumberFormat('@');
    results.getRange('D:D').setNumberFormat('@');
    results.setColumnWidth(1, 150);
    results.setColumnWidth(2, 90);
    results.setColumnWidth(3, 200);
    results.setColumnWidth(4, 70);
    results.setColumnWidth(10, 320);
  }
  if (results.getLastRow() > 0 && results.getRange(1, 22).getValue() === '') {
    results.getRange(1, 22).setValue('Level').setFontWeight('bold').setBackground('#0e2f44').setFontColor('#ffffff');
  }

  var summary = ss.getSheetByName(CONFIG.SUMMARY_SHEET);
  if (!summary) {
    summary = ss.insertSheet(CONFIG.SUMMARY_SHEET);
    buildSummary_(summary);
  }

  var attempts = ss.getSheetByName(CONFIG.ATTEMPTS_SHEET);
  if (!attempts) {
    attempts = ss.insertSheet(CONFIG.ATTEMPTS_SHEET);
    attempts.getRange(1, 1, 1, 10).setValues([['Timestamp', 'Attempt ID', 'Student ID', 'Full Name', 'Section',
      'Event', 'Circle (correct country)', 'Name placed', 'Right?', 'Level']])
      .setFontWeight('bold').setBackground('#0e2f44').setFontColor('#ffffff');
    attempts.setFrozenRows(1);
    attempts.getRange('C:E').setNumberFormat('@');
  }
  if (attempts.getLastRow() > 0 && attempts.getRange(1, 10).getValue() === '') {
    attempts.getRange(1, 10).setValue('Level').setFontWeight('bold').setBackground('#0e2f44').setFontColor('#ffffff');
  }
  var analytics = ss.getSheetByName(CONFIG.ANALYTICS_SHEET);
  if (!analytics) analytics = ss.insertSheet(CONFIG.ANALYTICS_SHEET);

  return { results: results, summary: summary, attempts: attempts, analytics: analytics };
}

/** Section-by-section summary driven by formulas, so it updates itself. */
function buildSummary_(summary) {
  var rn = CONFIG.RESULTS_SHEET;
  var total = ZONE_ORDER.length;

  summary.getRange(1, 1, 1, 6).setValues([[
    'Section', 'Students', 'Average Score', 'Perfect Scores', 'Average Time (min)', 'Average Checks'
  ]]);
  summary.getRange(1, 1, 1, 6)
    .setFontWeight('bold')
    .setBackground('#0e2f44')
    .setFontColor('#ffffff');

  var r = 2;
  CONFIG.SECTIONS.forEach(function (sec) {
    summary.getRange(r, 1).setNumberFormat('@').setValue(sec);
    summary.getRange(r, 2).setFormula("=COUNTIF('" + rn + "'!D:D,A" + r + ")");
    summary.getRange(r, 3).setFormula("=IFERROR(ROUND(AVERAGEIF('" + rn + "'!D:D,A" + r + ",'" + rn + "'!E:E),2),0)");
    summary.getRange(r, 4).setFormula("=COUNTIFS('" + rn + "'!D:D,A" + r + ",'" + rn + "'!E:E," + total + ")");
    summary.getRange(r, 5).setFormula("=IFERROR(ROUND(AVERAGEIF('" + rn + "'!D:D,A" + r + ",'" + rn + "'!I:I)/60,1),0)");
    summary.getRange(r, 6).setFormula("=IFERROR(ROUND(AVERAGEIF('" + rn + "'!D:D,A" + r + ",'" + rn + "'!H:H),1),0)");
    r++;
  });

  summary.getRange(r, 1).setValue('All sections');
  summary.getRange(r, 2).setFormula("=COUNTA('" + rn + "'!B2:B)");
  summary.getRange(r, 3).setFormula("=IFERROR(ROUND(AVERAGE('" + rn + "'!E2:E),2),0)");
  summary.getRange(r, 4).setFormula("=COUNTIF('" + rn + "'!E2:E," + total + ")");
  summary.getRange(r, 5).setFormula("=IFERROR(ROUND(AVERAGE('" + rn + "'!I2:I)/60,1),0)");
  summary.getRange(r, 6).setFormula("=IFERROR(ROUND(AVERAGE('" + rn + "'!H2:H),1),0)");
  summary.getRange(r, 1, 1, 6).setFontWeight('bold').setBackground('#e8f1f6');

  summary.setColumnWidth(1, 120);
  summary.setColumnWidths(2, 5, 130);
  summary.setFrozenRows(1);
}

/** Row number of a Student ID in the Results sheet, or 0 if not found. */
function findStudentRow_(sheet, studentId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var finder = sheet
    .getRange(2, 2, last - 1, 1)
    .createTextFinder(String(studentId))
    .matchEntireCell(true)
    .matchCase(false);
  var hit = finder.findNext();
  return hit ? hit.getRow() : 0;
}

/* ------------------------------------------------------------
 *  ATTEMPT LOG + ANALYTICS
 * ------------------------------------------------------------ */

/** Logs one "Check answers" press. Only circles that were not already locked (fresh) are logged. */
function logAttempts_(event, student, attemptId, placements, fresh, level) {
  var lock = LockService.getScriptLock();
  try {
    if (!student || !fresh.length) return;
    var clean = validateStudent_(student.id, student.name, student.section);
    if (!clean.ok) return;
    lock.waitLock(8000);
    var sheet = ensureSheets_(getSpreadsheet_(true)).attempts;
    appendAttemptRows_(sheet, event, clean, attemptId, placements, fresh, level);
  } catch (e) {
    /* logging is best effort: the student's check still works */
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ignore */ }
  }
}

function appendAttemptRows_(sheet, event, clean, attemptId, placements, zoneIds, level) {
  level = parseInt(level, 10) || 1;
  var key = levelKey_(level) || ANSWER_KEY;
  var now = new Date();
  var aid = String(parseInt(attemptId, 10) || 0);
  var rows = [];
  zoneIds.forEach(function (z) {
    if (!ANSWER_KEY[z] || !placements[z]) return;
    rows.push([now, aid, clean.studentId, clean.fullName, clean.section, event,
               ANSWER_KEY[z], placements[z], placements[z] === key[z], level]);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 10).setValues(rows);
}

/** Teacher can also run this from the editor to rebuild the Analytics sheet. */
function refreshAnalytics() {
  var ss = getSpreadsheet_(false);
  refreshAnalytics_(ensureSheets_(ss));
}

/**
 * Rebuilds the Analytics sheet from FIRST TRY data: the first name a student
 * put on a circle in an attempt (Check or Submit), per level. Final scores are
 * usually full marks after practice checks, so first-try shows who really knows it.
 */
function refreshAnalytics_(sheets) {
  var aSheet = sheets.attempts, rSheet = sheets.results, out = sheets.analytics;
  var NL = LEVELS.length, PER = ZONE_ORDER.length;
  var names = LEVELS.map(function (l) { return l.name; });
  var aRows = aSheet.getLastRow() > 1 ? aSheet.getRange(2, 1, aSheet.getLastRow() - 1, 10).getValues() : [];
  var rRows = rSheet.getLastRow() > 1 ? rSheet.getRange(2, 1, rSheet.getLastRow() - 1, 22).getValues() : [];
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : ''; }
  function asc(i) { return function (a, b) { return (a[i] === '' ? 101 : a[i]) - (b[i] === '' ? 101 : b[i]); }; }

  var seen = {}, firsts = [];
  aRows.forEach(function (r) {
    var lv = parseInt(r[9], 10) || 1, k = r[2] + '|' + r[1] + '|' + lv + '|' + r[6];
    if (seen[k]) return;
    seen[k] = true;
    firsts.push({ id: String(r[2]), name: r[3], sec: r[4], lv: lv, country: r[6], placed: r[7], ok: r[8] === true });
  });

  // Country x level
  var C = {}, conf = {};
  ZONE_ORDER.forEach(function (z) { C[ANSWER_KEY[z]] = { lv: {}, n: 0, ok: 0, sec: {} }; });
  firsts.forEach(function (f) {
    var c = C[f.country]; if (!c) return;
    var l = c.lv[f.lv] || (c.lv[f.lv] = { n: 0, ok: 0 });
    var s = c.sec[f.sec] || (c.sec[f.sec] = { n: 0, ok: 0 });
    l.n++; c.n++; s.n++;
    if (f.ok) { l.ok++; c.ok++; s.ok++; }
    else { var k = f.lv + '|' + f.country + '|' + f.placed; conf[k] = (conf[k] || 0) + 1; }
  });
  var cRows = Object.keys(C).map(function (name) {
    var c = C[name], row = [name];
    for (var l = 1; l <= NL; l++) row.push(c.lv[l] ? pct(c.lv[l].ok, c.lv[l].n) : '');
    row.push(pct(c.ok, c.n));
    CONFIG.SECTIONS.forEach(function (sec) { row.push(c.sec[sec] ? pct(c.sec[sec].ok, c.sec[sec].n) : ''); });
    return row;
  }).sort(asc(NL + 1));
  var mix = Object.keys(conf).map(function (k) {
    var p = k.split('|'); return [names[p[0] - 1], p[1], p[2], conf[k]];
  }).sort(function (a, b) { return b[3] - a[3]; }).slice(0, 12);

  // Students
  var S = {};
  function stu(id, name, sec) { return S[id] || (S[id] = { id: id, name: name, sec: sec, n: 0, ok: 0, best: {}, sub: 0, pct: 0, checks: 0, wrong: {} }); }
  firsts.forEach(function (f) {
    var s = stu(f.id, f.name, f.sec);
    s.n++;
    if (f.ok) s.ok++; else { var k = f.country + ' (' + names[f.lv - 1] + ')'; s.wrong[k] = (s.wrong[k] || 0) + 1; }
  });
  rRows.forEach(function (r) {
    var s = stu(String(r[1]), r[2], r[3]), lv = parseInt(r[21], 10) || 1, sc = Number(r[4]) || 0;
    s.sub++; s.pct += Number(r[6]) || 0; s.checks += Number(r[7]) || 0;
    if (s.best[lv] === undefined || sc > s.best[lv]) s.best[lv] = sc;
  });
  var sRows = Object.keys(S).map(function (id) {
    var s = S[id], done = Object.keys(s.best), sum = 0;
    done.forEach(function (k) { sum += s.best[k]; });
    var ft = pct(s.ok, s.n), avg = s.sub ? Math.round(s.pct / s.sub * 10) / 10 : '', basis = ft !== '' ? ft : avg;
    var weak = Object.keys(s.wrong).sort(function (a, b) { return s.wrong[b] - s.wrong[a]; }).slice(0, 3).join(', ');
    var flag = basis === '' ? '' : basis < CONFIG.HIGH_RISK_BELOW ? 'Needs reinforcement' : basis < CONFIG.WATCH_BELOW ? 'Watch' : 'OK';
    return [s.id, s.name, s.sec, done.length, sum, avg, ft, s.sub ? Math.round(s.checks / s.sub * 10) / 10 : '', weak || '-', flag];
  }).sort(asc(6));

  // Write
  out.clear();
  function put(row, title, hdr, rows) {
    out.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(13);
    out.getRange(row + 1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#0e2f44').setFontColor('#ffffff');
    if (rows.length) out.getRange(row + 2, 1, rows.length, hdr.length).setValues(rows);
    return row + 2 + rows.length + 2;
  }
  var h1 = ['Country'].concat(names.map(function (n) { return n + ' %'; }), ['Overall %'],
                              CONFIG.SECTIONS.map(function (x) { return x + ' %'; }));
  var r = put(1, 'Hardest countries (first-try %, hardest first)', h1, cRows);
  r = put(r, 'Most common mix-ups (all levels)', ['Level', 'Circle (correct country)', 'Name placed instead', 'Times'], mix);
  out.getRange(r + 2, 1, Math.max(1, sRows.length), 1).setNumberFormat('@');
  var h2 = ['Student ID', 'Name', 'Section', 'Levels done', 'Points (best per level, of ' + NL * PER + ')',
            'Average score %', 'First-try %', 'Avg checks used', 'Weakest (country, level)', 'Status'];
  put(r, 'Students (lowest first-try % first). Needs reinforcement below ' + CONFIG.HIGH_RISK_BELOW + '%, Watch below ' + CONFIG.WATCH_BELOW + '%', h2, sRows);
  if (sRows.length) {
    out.getRange(r + 2, 10, sRows.length, 1).setBackgrounds(sRows.map(function (x) {
      return [x[9] === 'Needs reinforcement' ? '#fee2e2' : x[9] === 'Watch' ? '#fff3cf' : x[9] === 'OK' ? '#dcfce7' : '#ffffff'];
    }));
  }
  out.getRange(r + 3 + sRows.length, 1).setValue('Updated ' + new Date()).setFontColor('#6d8798');
  out.setColumnWidth(1, 120); out.setColumnWidth(2, 200); out.setColumnWidth(5, 170); out.setColumnWidth(9, 280); out.setColumnWidth(10, 150);
  out.setFrozenRows(2);
}
