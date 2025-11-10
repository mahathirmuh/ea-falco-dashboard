#!/usr/bin/env node
// Small helper to preview the first row's CardNo from an Excel file using vaultRegistrar's preview
const path = require('path');
const fs = require('fs');

const registrar = require('../src/vaultRegistrar');

function usage() {
  console.log('Usage: node server/scripts/previewExcelFirstRowCard.js <ExcelPath>');
}

async function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    usage();
    process.exit(1);
  }
  const abs = path.isAbsolute(excelPath) ? excelPath : path.resolve(process.cwd(), excelPath);
  if (!fs.existsSync(abs)) {
    console.error('[previewExcelFirstRowCard] File not found:', abs);
    process.exit(1);
  }
  const preview = registrar.previewUpdateCsvPathToVault({ csvPath: abs });
  const details = preview && preview.details ? preview.details : [];
  const first = details[0] || {};
  const cardNo = first.cardNo || first.CardNo || first.profile && (first.profile.CardNo || first.profile.cardno);
  console.log(JSON.stringify({
    count: details.length,
    firstCardNo: cardNo || null,
    firstProfileKeys: first.profile ? Object.keys(first.profile) : [],
    sample: first,
  }, null, 2));
}

main().catch(err => {
  console.error('[previewExcelFirstRowCard] Error:', err && err.message ? err.message : err);
  process.exit(1);
});