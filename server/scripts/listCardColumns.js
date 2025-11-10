#!/usr/bin/env node
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}
const db = require('../src/database');

(async () => {
  try {
    console.log(`Target DB: ${process.env.DATADB_NAME} on ${process.env.DATADB_SERVER}`);
    const q = "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%Card%' OR COLUMN_NAME LIKE '%CardNo%' OR COLUMN_NAME LIKE '%CARDNO%' ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME";
    const r = await db.query(q);
    if (!r.recordset || r.recordset.length === 0) {
      console.log('No columns with names containing Card/CardNo found in this database.');
    } else {
      console.log('Columns containing Card/CardNo:');
      r.recordset.forEach(row => console.log(` - ${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    }
  } catch (e) {
    console.error('ERR:', e.message || e);
  } finally {
    await db.disconnect().catch(() => {});
  }
})();