// Thin Postgres client wrapper (Vercel Postgres / Neon), matching the shape of the Notion data
// sources in this repo (lib/notion-crm.js, lib/notion-projects.js): every money-layer data
// function checks isDbConfigured() first and returns { connected: false, reason } when
// POSTGRES_URL hasn't been set yet, so api/*.js never needs its own env check and the frontend
// gets the same { status: 'not_connected', reason } shape it already handles for Notion.
//
// Uses the Neon serverless driver over HTTP (no persistent TCP connection), which is the right
// fit for Vercel serverless functions. Swapping to Supabase later is a POSTGRES_URL value change
// only, since Supabase's connection string works the same way here.
const { neon } = require('@neondatabase/serverless');

let cachedSql = null;
let cachedConnectionString = null;

function isDbConfigured() {
  return !!process.env.POSTGRES_URL;
}

// Returns a tagged-template SQL function: sql`SELECT * FROM invoices WHERE id = ${id}`.
// Caches the client as long as the connection string doesn't change between calls.
function getSql() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) return null;
  if (!cachedSql || cachedConnectionString !== connectionString) {
    cachedSql = neon(connectionString);
    cachedConnectionString = connectionString;
  }
  return cachedSql;
}

module.exports = { isDbConfigured, getSql };
