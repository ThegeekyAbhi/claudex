import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rename, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { markBefore, readAppended } from '../../../../src/providers/history/claude-tail';

const line = (record: object) => `${JSON.stringify(record)}\n`;
const user = (uuid: string, text: string, extra: object = {}) =>
  line({
    type: 'user',
    uuid,
    timestamp: '2026-11-07T10:00:00.000Z',
    message: { content: text },
    ...extra,
  });

test('only lines added since the last read are read, and a half-written line waits', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'aw-tail-')), 's.jsonl');
  await writeFile(file, user('u1', 'old'));
  const start = await markBefore(file);
  assert.ok(start);
  await appendFile(
    file,
    `${user('u2', 'new')}${line({ type: 'attachment', uuid: 'x' })}${user('s1', 'sub', { isSidechain: true })}{"type":"user","uu`,
  );
  const first = await readAppended(start);
  assert.ok(first);
  assert.deepEqual(
    first.records.map((record: any) => [record.uuid, record.message.content]),
    [['u2', 'new']],
  );
  // The rest of the half-written line arrives; it's read whole, once.
  await appendFile(
    file,
    `id":"u3","timestamp":"2026-11-07T10:00:01.000Z","message":{"content":"done"}}\n`,
  );
  const second = await readAppended(first.mark);
  assert.deepEqual(
    second?.records.map((record: any) => record.uuid),
    ['u3'],
  );
  assert.deepEqual((await readAppended(second!.mark))?.records, []);
});

test('a position taken mid-line drops that partial line once; later bad lines need a full read', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'aw-tail-')), 's.jsonl');
  await writeFile(file, user('u1', 'first'));
  const whole = await markBefore(file);
  assert.ok(whole);
  // As if the full read's position fell in the middle of the line after it.
  await appendFile(file, user('u2', 'second'));
  const mid = { ...whole, offset: whole.offset + 5 };
  assert.deepEqual(
    (await readAppended(mid))?.records.map((record: any) => record.uuid),
    [],
  );
  await appendFile(file, 'not json\n');
  const aligned = { ...whole, aligned: true };
  assert.equal(await readAppended(aligned), undefined);
});

test('a file that shrank or was replaced is never read from its old position', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aw-tail-'));
  const file = path.join(dir, 's.jsonl');
  await writeFile(file, `${user('u1', 'a')}${user('u2', 'b')}`);
  const mark = await markBefore(file);
  assert.ok(mark);
  await truncate(file, 10);
  assert.equal(await readAppended(mark), undefined);
  await writeFile(
    path.join(dir, 'other.jsonl'),
    `${user('u1', 'a')}${user('u2', 'b')}${user('u3', 'c')}`,
  );
  await rename(path.join(dir, 'other.jsonl'), file);
  assert.equal(await readAppended(mark), undefined);
});

test('positions are counted in bytes, so an unreadable byte or Windows line ending shifts nothing', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'aw-tail-')), 's.jsonl');
  await writeFile(file, '');
  const start = await markBefore(file);
  assert.ok(start);
  // A stray byte inside a string, then a CRLF-ended line.
  const bad = Buffer.concat([
    Buffer.from(
      '{"type":"user","uuid":"u1","timestamp":"2026-11-07T10:00:00.000Z","message":{"content":"a',
    ),
    Buffer.from([0xff]),
    Buffer.from('"}}\n'),
    Buffer.from(user('u2', 'b').replace('\n', '\r\n')),
  ]);
  await appendFile(file, bad);
  const first = await readAppended({ ...start, aligned: true });
  assert.deepEqual(
    first?.records.map((record: any) => record.uuid),
    ['u1', 'u2'],
  );
  assert.equal(first?.mark.offset, bad.length);
  await appendFile(file, user('u3', 'c'));
  assert.deepEqual(
    (await readAppended(first!.mark))?.records.map((record: any) => record.uuid),
    ['u3'],
  );
});
