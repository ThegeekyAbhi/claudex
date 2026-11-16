import assert from 'node:assert/strict';
import type { Session } from '../../../src/shared/model';
import type { UiCheckContext } from '../context';

export async function checkSkills(ctx: UiCheckContext): Promise<void> {
  // Uses the empty new-chat draft and Auto mode left by new-chat-modes.
  const { page, snapshot, box, sentOf, update, pickAgent } = ctx;
  // Skills: / opens a searchable menu, a pick becomes a chip, and a chip is only a request.

  (snapshot as any).skills = {
    codex: {
      status: 'ready',
      cwd: '/project',
      skills: [
        {
          name: 'review',
          description: 'Reviews the current diff for bugs',
          source: 'project',
          path: '/skills/review/SKILL.md',
          enabled: true,
          evidence: 'native',
        },
        {
          name: 'release',
          description: 'Cuts a release',
          source: 'personal',
          path: '/skills/release/SKILL.md',
          enabled: true,
          global: true,
          evidence: 'native',
        },
        {
          name: 'off',
          description: 'Turned off',
          source: 'system',
          path: '/skills/off/SKILL.md',
          enabled: false,
          evidence: 'native',
        },
      ],
      problems: ['bad/SKILL.md is missing a description'],
    },
    claude: {
      status: 'ready',
      cwd: '/project',
      skills: [
        { name: 'deploy', description: 'Deploys the app', enabled: true },
        {
          name: 'polish',
          description: 'Polishes an interface',
          source: 'personal',
          path: '/claude/skills/polish/SKILL.md',
          enabled: null,
          evidence: 'disk',
        },
      ],
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
  // Searching also finds other accounts' skills, which go along as borrowed instructions.
  const refreshesBefore = (await sentOf('refreshSkills')).length;
  await box.fill('/pol');
  await skillMenu.waitFor();
  const others = skillMenu.getByRole('group', { name: /Other accounts/ });
  await others.getByText('polish', { exact: true }).waitFor();
  assert.ok(
    (await sentOf('refreshSkills'))
      .slice(refreshesBefore)
      .some((item: { agent?: string }) => item.agent === 'claude'),
    'the / menu rescans other accounts too',
  );
  const hint = skillMenu.locator('output');
  await hint.waitFor();
  assert.equal(
    await hint.evaluate((item) => getComputedStyle(item).whiteSpace),
    'nowrap',
    'the highlighted skill’s description stays one line, so it never covers the list',
  );
  const manage = skillMenu.getByText('Manage skills…');
  assert.equal(
    await manage.evaluate((item) => getComputedStyle(item.closest('.sticky') as Element).position),
    'sticky',
    'Manage skills stays pinned at the bottom of the menu',
  );
  await page.screenshot({ path: 'test-results/screenshots/skills-menu-borrow.png' });
  await box.press('Enter');
  const borrowed = page.locator('.composer .attachment-chip', { hasText: 'polish · from Claude' });
  await borrowed.waitFor();
  assert.equal(
    await page.getByText('Codex doesn’t have polish.').count(),
    0,
    'a borrowed skill is not missing',
  );
  await borrowed.getByRole('button', { name: /^Remove/ }).click();
  // The Skills page lists each CLI's skills, and only offers what that CLI can do.
  await box.fill('/');
  await skillMenu.getByText('Manage skills…').dispatchEvent('pointerdown');
  const panel = page.getByRole('region', { name: 'Skills' });
  await panel.waitFor();
  assert.equal(
    await page.getByRole('dialog', { name: 'Skills' }).count(),
    0,
    'a page, not a popup',
  );
  assert.equal(
    await panel.getByRole('button', { name: /^Codex,/ }).getAttribute('aria-pressed'),
    'true',
    'opens on the current account',
  );
  await panel.getByRole('button', { name: 'Turn off review' }).click();
  assert.deepEqual((await sentOf('setSkillEnabled')).at(-1), {
    type: 'setSkillEnabled',
    agent: 'codex',
    name: 'review',
    path: '/skills/review/SKILL.md',
    enabled: false,
  });
  await panel.getByRole('button', { name: 'Open review' }).click();
  assert.equal((await sentOf('openSkill')).at(-1).name, 'review');
  await panel.getByPlaceholder('Search skills…').fill('cut');
  await panel.getByText('release', { exact: true }).waitFor();
  assert.equal(await panel.getByText('review', { exact: true }).count(), 0);
  await panel.getByRole('button', { name: /^Claude,/ }).click();
  await panel.getByPlaceholder('Search skills…').fill('');
  await panel.getByText('deploy', { exact: true }).waitFor();
  // All accounts shows every skill once, with who has it, and offers copies where it's missing.
  await panel.getByRole('button', { name: /^All accounts,/ }).click();
  await panel.getByText('release', { exact: true }).waitFor();
  // One button makes a personal skill global; there are no per-account copy buttons.
  assert.equal(await panel.getByRole('button', { name: /^Copy/ }).count(), 0);
  await panel.getByRole('button', { name: 'Make polish global' }).click();
  assert.deepEqual((await sentOf('makeSkillsGlobal')).at(-1), {
    type: 'makeSkillsGlobal',
    skills: [{ agent: 'claude', name: 'polish', path: '/claude/skills/polish/SKILL.md' }],
  });
  // Several at once: select all, then one action for the selection.
  await panel.getByRole('checkbox', { name: 'Select polish' }).check();
  await panel.getByText('1 selected', { exact: true }).waitFor();
  assert.equal(
    await panel
      .getByRole('checkbox', { name: 'Select all 2 skills that can be made global' })
      .evaluate((box) => (box as HTMLInputElement).indeterminate),
    true,
    'a partial selection shows as mixed',
  );
  await panel
    .getByRole('checkbox', { name: 'Select all 2 skills that can be made global' })
    .check();
  await panel.getByRole('button', { name: 'Make 2 global' }).click();
  assert.deepEqual(
    (await sentOf('makeSkillsGlobal'))
      .at(-1)
      .skills.map((item: { name: string }) => item.name)
      .sort(),
    ['polish', 'release'],
  );
  await panel.getByText('5 skills', { exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('checkbox', { name: 'Select review' }).count(),
    0,
    'project skills can’t be picked',
  );
  await page.screenshot({ path: 'test-results/screenshots/skills-select.png' });
  assert.equal(
    await panel.getByRole('button', { name: 'Make review global' }).count(),
    0,
    'project skills stay with their repository',
  );
  await panel.getByText('Global', { exact: true }).first().waitFor();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 720 });
  // Let layout settle after the resize before looking at it.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.screenshot({ path: 'test-results/screenshots/skills-page-narrow.png' });
  const clipped = await panel
    .getByRole('button', { name: 'release', exact: true })
    .evaluate((button) => {
      const name = button.querySelector('span:last-child') as HTMLElement;
      return name.scrollWidth > name.clientWidth;
    });
  assert.equal(clipped, false, 'a skill name stays readable at 320px');
  const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth);
  assert.equal(overflow, false, 'nothing runs off a 320px panel');
  if (viewport) await page.setViewportSize(viewport);
  await panel.getByRole('button', { name: /^Claude,/ }).click();
  assert.equal(
    await panel.getByRole('button', { name: /Turn off/ }).count(),
    0,
    'Claude has no toggle',
  );
  await panel.getByRole('button', { name: /^Codex,/ }).click();
  (snapshot as any).skills.codex.skills = [
    {
      name: 'local-skill',
      description: 'Found without native startup',
      source: 'project',
      path: '/project/.agents/skills/local-skill/SKILL.md',
      enabled: null,
      evidence: 'disk',
    },
  ];
  (snapshot as any).skills.codex.problems = [];
  await update(undefined);
  await panel.getByRole('button', { name: 'local-skill', exact: true }).click();
  assert.equal(
    await panel
      .getByRole('button', { name: 'local-skill', exact: true })
      .getAttribute('aria-expanded'),
    'true',
  );
  await panel.getByText('Found on disk · availability unverified', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: /Turn off|Turn on/ }).count(), 0);
  await panel.getByRole('button', { name: 'Rescan', exact: true }).click();
  assert.equal((await sentOf('refreshSkills')).at(-1).force, true);
  const verifyCount = (await sentOf('verifySkills')).length;
  await panel.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Verify Codex with the agent/ }).click();
  assert.equal((await sentOf('verifySkills')).length, verifyCount + 1);
  await panel.getByRole('tab', { name: 'Configuration', exact: true }).click();
  await panel.getByRole('heading', { name: 'Effective configuration' }).waitFor();
  const inspectionRequest = (await sentOf('inspectConfiguration')).at(-1);
  assert.equal(inspectionRequest.agent, 'codex');
  assert.equal(
    (await sentOf('verifySkills')).length,
    verifyCount + 1,
    'configuration inspection never requests native startup',
  );
  const inspection = {
    provider: 'codex',
    cwd: '/project',
    observedAt: '2026-11-15T12:00:00Z',
    host: 'local extension host',
    sources: [
      {
        id: 'user',
        path: '/profiles/codex/config.toml',
        scope: 'user',
        status: 'partial',
        managed: false,
      },
      {
        id: 'project',
        path: '/project/.codex/config.toml',
        scope: 'project',
        status: 'partial',
        managed: false,
      },
      {
        id: 'managed',
        path: '/etc/codex/requirements.toml',
        scope: 'managed',
        status: 'partial',
        managed: true,
      },
    ],
    declarations: [
      {
        sourceId: 'user',
        key: 'features.plugins',
        value: 'true',
        category: 'setting',
        resolution: 'overridden',
      },
      {
        sourceId: 'project',
        key: 'features.plugins',
        value: 'false',
        category: 'setting',
        resolution: 'localWinner',
      },
      {
        sourceId: 'managed',
        key: 'features.hooks',
        value: 'false',
        category: 'policy',
        resolution: 'constraint',
      },
      {
        sourceId: 'user',
        key: 'mcp_servers.github.bearer_token_env_var',
        value: 'GITHUB_TOKEN',
        category: 'credentialReference',
        resolution: 'declarationOnly',
      },
    ],
    limitations: ['Native trust and cloud policy remain unresolved.'],
  };
  await page.evaluate(
    ({ requestId, inspection }) =>
      window.postMessage(
        { type: 'configurationResult', requestId, agent: 'codex', inspection },
        '*',
      ),
    { requestId: inspectionRequest.requestId, inspection },
  );
  await panel.getByText('Local winner · estimated · project', { exact: true }).waitFor();
  await panel.getByText('GITHUB_TOKEN', { exact: true }).waitFor();
  await panel.getByText('No session observations for this profile.', { exact: false }).waitFor();
  // Sources are a compact, always-visible table; managed ones say they're read only.
  await panel.getByRole('heading', { name: 'Configuration sources (3)' }).waitFor();
  await panel.getByText('Partly read · read only', { exact: true }).waitFor();
  await panel.getByText('What this can’t tell you (1)').click();
  await panel.getByText('Native trust and cloud policy remain unresolved.').waitFor();
  await panel.getByRole('button', { name: 'Refresh configuration' }).click();
  const nextInspection = (await sentOf('inspectConfiguration')).at(-1);
  assert.notEqual(nextInspection.requestId, inspectionRequest.requestId);
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        {
          type: 'configurationResult',
          requestId,
          agent: 'codex',
          inspection: {
            cwd: '/project',
            declarations: [],
            sources: [],
            limitations: [],
            observedAt: '2026-11-15',
          },
        },
        '*',
      ),
    inspectionRequest.requestId,
  );
  await panel.getByText('Inspecting configuration files…', { exact: true }).waitFor();
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        { type: 'configurationResult', requestId, agent: 'codex', error: 'Fixture unreadable.' },
        '*',
      ),
    nextInspection.requestId,
  );
  await panel.getByRole('alert').filter({ hasText: 'Fixture unreadable.' }).waitFor();
  await panel.getByText(/previous results, possibly stale/).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/configuration-inspector.png' });
  await panel.getByRole('button', { name: 'Claude', exact: true }).click();
  await panel.getByText('Inspecting configuration files…', { exact: true }).waitFor();
  await page.evaluate(
    ({ requestId, inspection }) =>
      window.postMessage(
        { type: 'configurationResult', requestId, agent: 'codex', inspection },
        '*',
      ),
    { requestId: nextInspection.requestId, inspection },
  );
  assert.equal(
    await panel.getByText('GITHUB_TOKEN', { exact: true }).count(),
    0,
    'a late response cannot populate another profile',
  );
  await panel.getByRole('button', { name: 'Codex', exact: true }).click();
  const selectedSession = snapshot.sessions.find((item) => item.id === 'codex-one') as unknown as
    | Session
    | undefined;
  assert.ok(selectedSession);
  const oldRuntime = selectedSession.runtime;
  const oldSettings = selectedSession.nativeSettings;
  selectedSession.runtime = {
    observedAt: Date.now(),
    mcpServers: [{ name: 'fixture-server', status: 'failed' }],
  };
  selectedSession.nativeSettings = {
    approvalPolicy: 'on-request',
    sandbox: { type: 'workspaceWrite', hiddenCredential: 'CANARY_DO_NOT_RENDER' },
  };
  // The Skills page stays in front, so the thread's own tab never shows as selected here.
  await page.evaluate(
    (next) =>
      window.postMessage(
        { type: 'snapshot', snapshot: next, selectedId: 'codex-one', imageBase: '/fixture-images' },
        '*',
      ),
    snapshot,
  );
  await panel.getByText('on-request', { exact: true }).waitFor();
  await panel.getByText('workspaceWrite', { exact: true }).waitFor();
  assert.ok(
    !(await panel.innerText()).includes('CANARY_DO_NOT_RENDER'),
    'runtime inspection never dumps opaque native settings',
  );
  selectedSession.runtime = oldRuntime;
  selectedSession.nativeSettings = oldSettings;
  await update(undefined);
  await panel.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.screenshot({ path: 'test-results/screenshots/skills-page.png' });
  await page.getByRole('button', { name: 'Close Skills' }).click();
  await panel.waitFor({ state: 'hidden' });
}
