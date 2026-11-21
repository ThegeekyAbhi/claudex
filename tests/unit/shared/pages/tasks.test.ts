import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendTasks,
  carryOpenTasks,
  openTaskBlocks,
  pageTasks,
} from '../../../../src/shared/domain/pages/tasks';

test('tasks are read with their state and depth, outside code fences', () => {
  const body = '- [ ] One\n  - [x] Two\n```\n- [ ] Code\n```\n1. [X] Three\n';
  assert.deepEqual(pageTasks(body), [
    { line: 0, text: 'One', done: false, depth: 0 },
    { line: 1, text: 'Two', done: true, depth: 2 },
    { line: 5, text: 'Three', done: true, depth: 0 },
  ]);
});

test('open tasks move with their nested lines; done ones stay', () => {
  const body = '- [ ] Ship\n  notes\n  - [x] sub\n- [x] Done\n- [ ] Call\n';
  assert.deepEqual(
    openTaskBlocks(body).map((block) => block.markdown),
    ['- [ ] Ship\n  notes\n  - [x] sub', '- [ ] Call'],
  );
});

test('carrying moves open tasks under the tasks heading of the target page', () => {
  const from = '---\nicon: 📅\n---\n\n# Mon\n\n- [ ] Ship\n- [x] Done\n';
  const to = '# Tue\n\n## Tasks\n\n- [ ] \n\n## Notes\n\nHi\n';
  const carried = carryOpenTasks(from, to);
  assert.ok(carried);
  assert.equal(carried.count, 1);
  assert.equal(carried.from, '---\nicon: 📅\n---\n\n# Mon\n\n- [x] Done\n');
  assert.equal(carried.to, '# Tue\n\n## Tasks\n\n- [ ] Ship\n\n## Notes\n\nHi\n');
  assert.equal(carryOpenTasks('# Done\n\n- [x] All\n', to), undefined);
});

test('tasks go to the end of a page that has no tasks heading', () => {
  assert.equal(appendTasks('# Page\n\nText\n\n', '- [ ] New'), '# Page\n\nText\n\n- [ ] New\n');
});
