import { Sessions } from '../src/application/sessions/session-manager';
import type { Message } from '../src/shared/model';

const samples: number[] = [];
for (let run = 0; run < 25; run++) {
  let reached = 0;
  const manager = new Sessions('/nonexistent', () => ({
    send: async () => {
      reached = performance.now();
    },
    interrupt: async () => {},
    dispose() {},
  }));
  // The benchmark performs no persistence writes or provider requests.
  manager.flush = async () => {};
  const session = manager.create('codex', '/nonexistent', '/nonexistent', 'Benchmark');
  session.messages.push(
    ...Array.from(
      { length: 5000 },
      (_, index): Message => ({
        id: `m${index}`,
        role: 'assistant',
        text: 'word '.repeat(200),
      }),
    ),
  );
  const start = performance.now();
  await manager.send(session.id, 'hi');
  if (!reached) throw new Error('Provider dispatch did not occur');
  samples.push(reached - start);
  await manager.dispose();
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      messages: 5000,
      runs: samples.length,
      minMs: samples[0],
      medianMs: samples[Math.floor(samples.length / 2)],
      p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
      maxMs: samples.at(-1),
    },
    null,
    2,
  ),
);
