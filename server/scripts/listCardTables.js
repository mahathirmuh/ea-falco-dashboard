#!/usr/bin/env node
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}
const db = require('../src/database');

(async () => {
  try {
    const q = "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND (TABLE_NAME LIKE '%card%' OR TABLE_NAME LIKE '%Card%') ORDER BY TABLE_SCHEMA, TABLE_NAME";
    const r = await db.query(q);
    console.log('Tables with "card" in name:');
    r.recordset.forEach(row => console.log(` - ${row.TABLE_SCHEMA}.${row.TABLE_NAME}`));
  } catch (e) {
    console.error('ERR:', e.message || e);
  } finally {
    await db.disconnect().catch(() => {});
  }
})();