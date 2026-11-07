import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import * as zodMini from 'zod/mini';
import { z as zod3 } from 'zod/v3';
import { z as zod4 } from 'zod/v4';

import {
  getItem,
  listItems,
  listStrings,
} from './generated/fetch/zod-schema-response-mutator-standard-schema/endpoints';
import { customFetch } from './mutators/custom-fetch-standard-schema';

/**
 * `includeZodSchemaInArguments` hands the mutator the generated Zod schema. Zod
 * 3.24+ schemas implement Standard Schema, so a mutator can validate through
 * `~standard` and stay independent of the library behind the schema.
 */
const mockJsonResponse = (body: unknown, status = 200) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const schemas: [string, StandardSchemaV1][] = [
  ['zod 3', zod3.object({ id: zod3.number() })],
  ['zod 4', zod4.object({ id: zod4.number() })],
  ['zod mini', zodMini.object({ id: zodMini.number() })],
];

describe.each(schemas)('standard schema mutator with %s', (_, schema) => {
  it('returns the validated data', async () => {
    mockJsonResponse({ id: 1 });

    await expect(customFetch('/item', { schema })).resolves.toMatchObject({
      data: { id: 1 },
      status: 200,
    });
  });

  it('rejects data the schema does not allow', async () => {
    mockJsonResponse({ id: 'one' });

    await expect(customFetch('/item', { schema })).rejects.toThrow(
      /expected number/i,
    );
  });

  it('does not validate an error response', async () => {
    mockJsonResponse({ message: 'not found' }, 404);

    await expect(customFetch('/item', { schema })).resolves.toMatchObject({
      data: { message: 'not found' },
      status: 404,
    });
  });
});

describe('standard schema mutator with a date-converting schema', () => {
  const schema = zod4
    .custom<{ at: string }>()
    .transform((value) => ({ at: new Date(value.at) }))
    .pipe(zod4.object({ at: zod4.date() }));

  it('validates the converted value', async () => {
    mockJsonResponse({ at: '2026-01-02T00:00:00.000Z' });

    await expect(customFetch('/item', { schema })).resolves.toMatchObject({
      data: { at: new Date('2026-01-02T00:00:00.000Z') },
    });
  });
});

describe('generated client with a standard schema mutator', () => {
  const endpoints = readFileSync(
    path.join(
      import.meta.dirname,
      'generated/fetch/zod-schema-response-mutator-standard-schema/endpoints.ts',
    ),
    'utf8',
  );

  it('passes the schema to the mutator', () => {
    expect(endpoints).toMatch(/schema: Item,/);
    expect(endpoints).toMatch(/schema: Items,/);
    expect(endpoints).toMatch(/schema: zod\.array\(Item\),/);
  });

  it('validates a named response', async () => {
    mockJsonResponse({ id: 1 });
    await expect(getItem()).resolves.toMatchObject({ data: { id: 1 } });

    mockJsonResponse({ id: 'one' });
    await expect(getItem()).rejects.toThrow(/expected number/i);
  });

  it('validates an inline array response', async () => {
    mockJsonResponse([{ id: 1 }]);
    await expect(listItems()).resolves.toMatchObject({ data: [{ id: 1 }] });

    mockJsonResponse([{ id: 'one' }]);
    await expect(listItems()).rejects.toThrow(/expected number/i);
  });

  it('returns a primitive array response without a schema', async () => {
    mockJsonResponse(['a']);
    await expect(listStrings()).resolves.toMatchObject({ data: ['a'] });

    const listStringsSource = endpoints.slice(
      endpoints.indexOf('export const listStrings'),
      endpoints.indexOf('export const getGetItemUrl'),
    );
    expect(listStringsSource).toContain('customFetch');
    expect(listStringsSource).not.toContain('schema:');
  });
});
