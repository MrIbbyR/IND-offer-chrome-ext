// run-history.js — IndexedDB persistence for run history.
// Loaded by background.js (importScripts) and popup.html (<script>).
// Content scripts cannot access the extension's IDB origin; they send
// a srSaveRunHistory message to background instead.

var RUN_HISTORY_DB_NAME    = "niiq-ta-helper";
var RUN_HISTORY_DB_VERSION = 1;
var RUN_HISTORY_STORE      = "runs";
var RUN_HISTORY_MAX        = 100;   // trim oldest records beyond this cap

function openRunHistoryDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(RUN_HISTORY_DB_NAME, RUN_HISTORY_DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(RUN_HISTORY_STORE)) {
        var store = db.createObjectStore(RUN_HISTORY_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("by_type",       "type",       { unique: false });
        store.createIndex("by_finishedAt", "finishedAt", { unique: false });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror   = function (e) { reject(e.target.error); };
  });
}

function _trimRunHistory(db) {
  var tx    = db.transaction(RUN_HISTORY_STORE, "readwrite");
  var store = tx.objectStore(RUN_HISTORY_STORE);
  var countReq = store.count();
  countReq.onsuccess = function () {
    var excess = countReq.result - RUN_HISTORY_MAX;
    if (excess <= 0) return;
    // Primary keys are autoIncrement integers; ascending cursor = oldest-first.
    var toDelete = excess;
    var cursorReq = store.openCursor();
    cursorReq.onsuccess = function (e) {
      var cursor = e.target.result;
      if (!cursor || toDelete === 0) return;
      cursor.delete();
      toDelete--;
      cursor.continue();
    };
  };
}

/**
 * Persist a completed run record to IndexedDB. Fire-and-forget.
 * @param {"keyword"|"salary"} type
 * @param {object} data  — { finishedAt, results, log?, parallel? }
 */
function saveRunRecord(type, data) {
  openRunHistoryDb().then(function (db) {
    var record = Object.assign({ type: type }, data);
    var tx    = db.transaction(RUN_HISTORY_STORE, "readwrite");
    var store = tx.objectStore(RUN_HISTORY_STORE);
    store.add(record);
    tx.oncomplete = function () { _trimRunHistory(db); };
  }).catch(function () {});
}

/**
 * Retrieve the most recently saved run of the given type.
 * Resolves to null if no record exists or IDB is unavailable.
 * @param {"keyword"|"salary"} type
 * @returns {Promise<object|null>}
 */
function getLatestRunRecord(type) {
  return openRunHistoryDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx    = db.transaction(RUN_HISTORY_STORE, "readonly");
      var store = tx.objectStore(RUN_HISTORY_STORE);
      var index = store.index("by_type");
      // "prev" direction within a unique-key range iterates by descending primary key,
      // so the first cursor position is the most recently inserted record of this type.
      var req = index.openCursor(IDBKeyRange.only(type), "prev");
      req.onsuccess = function (e) {
        resolve(e.target.result ? e.target.result.value : null);
      };
      req.onerror = function () { resolve(null); };
    });
  }).catch(function () { return null; });
}
