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
  SECTIONS: ['M1/11', 'M1/12'],
  ALLOW_RETAKE: false,                   // false = one submission per Student ID
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

    if (!CONFIG.ALLOW_RETAKE) {
      var ss = getSpreadsheet_(false);
      var sheet = ensureSheets_(ss).results;
      var found = findStudentRow_(sheet, clean.studentId);
      if (found > 0) {
        var row = sheet.getRange(found, 1, 1, 9).getDisplayValues()[0];
        return {
          ok: true,
          exists: true,
          studentId: clean.studentId,
          previous: {
            timestamp: row[0],
            fullName: row[2],
            section: row[3],
            score: row[4],
            total: row[5]
          }
        };
      }
    }
    return { ok: true, exists: false, studentId: clean.studentId };
  } catch (err) {
    return { ok: false, message: 'Server error: ' + (err && err.message ? err.message : err) };
  }
}

/**
 * "Check answers" - practice check. Returns right/wrong for every
 * circle the student has filled. Nothing is saved.
 * placements = { zoneId: 'Country name', ... }
 */
function checkPlacements(placements) {
  try {
    var cleaned = cleanPlacements_(placements);
    var results = {};
    var correct = 0;
    var placed = 0;
    ZONE_ORDER.forEach(function (zoneId) {
      if (cleaned[zoneId]) {
        placed++;
        var isRight = cleaned[zoneId] === ANSWER_KEY[zoneId];
        results[zoneId] = isRight;
        if (isRight) correct++;
      }
    });
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

    var placements = cleanPlacements_(payload.placements);
    var missing = ZONE_ORDER.filter(function (z) { return !placements[z]; });
    if (missing.length > 0) {
      return { ok: false, message: 'Please place all ' + ZONE_ORDER.length + ' country names before submitting.' };
    }

    var ss = getSpreadsheet_(true);
    var sheets = ensureSheets_(ss);
    var sheet = sheets.results;

    if (!CONFIG.ALLOW_RETAKE && findStudentRow_(sheet, clean.studentId) > 0) {
      return { ok: false, duplicate: true, message: 'This Student ID has already submitted. Ask your teacher if you need to try again.' };
    }

    var results = {};
    var correct = 0;
    var wrongList = [];
    ZONE_ORDER.forEach(function (zoneId) {
      var isRight = placements[zoneId] === ANSWER_KEY[zoneId];
      results[zoneId] = isRight;
      if (isRight) {
        correct++;
      } else {
        wrongList.push(ANSWER_KEY[zoneId] + ' circle <- ' + placements[zoneId]);
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

    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
    sheet.getRange(nextRow, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    SpreadsheetApp.flush();

    return {
      ok: true,
      score: correct,
      total: total,
      percent: percent,
      results: results,
      key: ANSWER_KEY
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
function cleanPlacements_(placements) {
  var allowed = {};
  ZONE_ORDER.forEach(function (z) { allowed[ANSWER_KEY[z]] = true; });

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

  var summary = ss.getSheetByName(CONFIG.SUMMARY_SHEET);
  if (!summary) {
    summary = ss.insertSheet(CONFIG.SUMMARY_SHEET);
    buildSummary_(summary);
  }

  return { results: results, summary: summary };
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