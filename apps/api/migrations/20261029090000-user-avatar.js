'use strict';

const fs = require('fs');
const path = require('path');

exports.up = async function(db) {
  const sql = await fs.promises.readFile(
    path.join(__dirname, 'sqls', '20261029090000-user-avatar-up.sql'),
    'utf8',
  );

  return db.runSql(sql);
};

exports.down = async function(db) {
  const sql = await fs.promises.readFile(
    path.join(__dirname, 'sqls', '20261029090000-user-avatar-down.sql'),
    'utf8',
  );

  return db.runSql(sql);
};

exports._meta = {version: 1};
