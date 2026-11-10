import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkSkills(ctx: UiCheckContext): Promise<void> {
  // Uses the empty new-chat draft and Auto mode left by new-chat-modes.
  const { page, snapshot, box, sentOf, update, pickAgent } = ctx;
  // Skills: / opens a searchable menu, a pick becomes a chip, and a chip is only a request.

  (snapshot as any).skills = {
    codex: {
      status: 'ready',
      skills: [
        {
          name: 'review',
          description: 'Reviews the current diff for bugs',
          source: 'project',
          path: '/skills/review/SKILL.md',
          enabled: true,
        },
        {
          name: 'release',
          description: 'Cuts a release',
          source: 'personal',
          path: '/skills/release/SKILL.md',
          enabled: true,
        },
        {
          name: 'off',
          description: 'Turned off',
          source: 'system',
          path: '/skills/off/SKILL.md',
          enabled: false,
        },
      ],
      problems: ['bad/SKILL.md is missing a description'],
    },
    claude: {
      status: 'ready',
      skills: [{ name: 'deploy', description: 'Deploys the app', enabled: true }],
      problems: [],
    },
    claud2: { status: 'ready', skills: [], problems: [] },
  };
  await update(undefined);
  await pickAgent('Codex', 'GPT-6.1-Sol');
  await box.fill('/');
  const skillMenu = page.getByRole('listbox', { name: 'Skills' });
  await skillMenu.waitFor();
  assert.ok((await sentOf('refreshSkills')).length > 0, 'opening the menu refreshes behind it');
  assert.equal(await skillMenu.getByText('off', { exact: true }).count(), 0, 'off stays out');
  await skillMenu.getByText('1 skill couldn’t be read.').waitFor();
  await box.pressSequentially('rev');
  await skillMenu.getByText('review', { exact: true }).waitFor();
  assert.equal(await skillMenu.getByText('release', { exact: true }).count(), 0);
  await page.screenshot({ path: 'test-results/screenshots/skills-menu.png' });
  await box.press('Enter');
  assert.equal(
    await box.getAttribute('data-value'),
    '',
    'the search text goes when the skill is picked',
  );
  const chip = page.locator('.composer .attachment-chip', { hasText: 'review' });
  await chip.waitFor();
  assert.equal(await page.getByText('Used skill').count(), 0, 'a selection is not use');
  // Another agent without this skill mutes the chip and says so, rather than sending it.
  await pickAgent('Claude', 'Sonnet 5.5');
  await page.getByText('Claude doesn’t have review.').waitFor();
  await box.fill('Check this');
  await box.press('Enter');
  const startsBefore = (await sentOf('start')).length;
  await box.press('Enter');
  assert.equal((await sentOf('start')).length, startsBefore, 'a missing skill blocks the send');
  await pickAgent('Codex', 'GPT-6.1-Sol');
  await box.focus();
  await box.press('Enter');
  const skillStart = (await sentOf('start')).at(-1);
  assert.deepEqual(skillStart.attachments, [
    { kind: 'skill', name: 'review', path: '/skills/review/SKILL.md' },
  ]);
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Check this' }, '*'),
    skillStart.draftKey,
  );
  // The panel lists each CLI's skills, and only offers what that CLI can do.
  await box.fill('/');
  await skillMenu.getByText('Manage skills…').dispatchEvent('pointerdown');
  const panel = page.getByRole('dialog', { name: 'Skills' });
  await panel.waitFor();
  await panel.getByRole('button', { name: 'Turn off review' }).click();
  assert.deepEqual((await sentOf('setSkillEnabled')).at(-1), {
    type: 'setSkillEnabled',
    agent: 'codex',
    name: 'review',
    path: '/skills/review/SKILL.md',
    enabled: false,
  });
  await panel.getByRole('button', { name: 'Open' }).first().click();
  assert.equal((await sentOf('openSkill')).at(-1).name, 'review');
  await panel.getByPlaceholder('Search skills…').fill('cut');
  await panel.getByText('release', { exact: true }).waitFor();
  assert.equal(await panel.getByText('review', { exact: true }).count(), 0);
  await panel.getByRole('tab', { name: /^Claude$/ }).click();
  await panel.getByPlaceholder('Search skills…').fill('');
  await panel.getByText('deploy', { exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('button', { name: /Turn off/ }).count(),
    0,
    'Claude has no toggle',
  );
  await page.screenshot({ path: 'test-results/screenshots/skills-panel.png' });
  await page.keyboard.press('Escape');
}
