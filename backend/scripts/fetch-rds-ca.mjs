/**
 * Download Amazon's RDS certificate bundle.
 *
 * The database client sets `rejectUnauthorized: true`, and RDS presents a
 * certificate from Amazon's own CA rather than one in Node's bundled trust
 * store, so verification needs this file. It is not committed: it is a
 * ~200 KB blob that AWS rotates on its own schedule, and a stale copy in git
 * is worse than a fresh copy fetched at build time.
 *
 * The deployed function has no internet access, so this runs at build time and
 * the result is bundled into the artifact — never fetched at runtime.
 *
 *   node scripts/fetch-rds-ca.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The all-regions bundle. One file that verifies RDS anywhere. */
const SOURCE =
  'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem';

const here = dirname(fileURLToPath(import.meta.url));
const destination = join(here, '..', 'certs', 'rds-global-bundle.pem');

const response = await fetch(SOURCE);

if (!response.ok) {
  throw new Error(
    `Could not download the RDS CA bundle: ${response.status} ${response.statusText}`,
  );
}

const bundle = await response.text();

// A truncated or redirected download that still returned 200 would otherwise
// be written out and fail much later, during a TLS handshake, with an error
// that says nothing about its cause.
if (!bundle.includes('-----BEGIN CERTIFICATE-----')) {
  throw new Error(
    'Downloaded file does not look like a PEM bundle; refusing to write it.',
  );
}

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, bundle, 'utf8');

const count = bundle.split('-----BEGIN CERTIFICATE-----').length - 1;
console.log(`Wrote ${count} certificates to ${destination}`);
