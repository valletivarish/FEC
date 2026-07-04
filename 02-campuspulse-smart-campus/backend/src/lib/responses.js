'use strict';

// Centralised so every handler returns identical CORS headers to the dashboard.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function notFound(message) {
  return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ message }) };
}

function badRequest(message) {
  return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ message }) };
}

function serverError(message) {
  return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ message }) };
}

module.exports = { CORS_HEADERS, ok, notFound, badRequest, serverError };
