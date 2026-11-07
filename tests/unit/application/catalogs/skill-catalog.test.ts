import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseClaudeCommands,
  parseCodexSkills,
} from '../../../../src/application/catalogs/skill-catalog';
import { resolveAttachments } from '../../../../src/extension/attachments';
import { claudeSkillText } from '../../../../src/providers/claude/adapter';
import { codexSkillInputs } from '../../../../src/providers/codex/adapter';
import { describeClaudeTool } from '../../../../src/providers/tool-format';
import {
  attachmentSchema,
  type Skill,
  sameSkill,
  searchSkills,
} from '../../../../src/shared/model';

test('Claude: its own commands are left out, and no source is invented', () => {
  const { skills, problems } = parseClaudeCommands([
    { name: 'compact', description: 'Built in', argumentHint: '', builtin: true },
    { name: 'deploy', description: 'Deploys', argumentHint: '<env>' },
    { description: 'no name' },
    null,
  ]);
  assert.deepEqual(skills, [
    { name: 'deploy', description: 'Deploys', argumentHint: '<env>', enabled: true },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(parseClaudeCommands(undefined).skills, []);
});

test('Codex: scopes become sources, and malformed entries become problems', () => {
  const { skills, problems } = parseCodexSkills({
    data: [
      {
        cwd: '/w',
        skills: [
          {
            name: 'a',
            description: 'long',
            shortDescription: 'short',
            path: '/a',
            scope: 'repo',
            enabled: true,
          },
          { name: 'b', description: 'd', path: '/b', scope: 'user', enabled: false },
          {
            name: 'c',
            description: 'd',
            path: '/c',
            scope: 'system',
            enabled: true,
            pluginId: 'p',
          },
          { name: 'no-path', description: 'd', scope: 'repo' },
        ],
        errors: [{ path: '/bad', message: 'bad front matter' }],
      },
    ],
  });
  assert.deepEqual(
    skills.map((item) => [item.name, item.description, item.source, item.enabled]),
    [
      ['a', 'short', 'project', true],
      ['b', 'd', 'personal', false],
      ['c', 'd', 'plugin', true],
    ],
  );
  assert.deepEqual(problems, ['Codex returned a skill with no name or path.', 'bad front matter']);
  assert.deepEqual(parseCodexSkills({}), { skills: [], problems: [] });
});

test('search hides disabled skills and ranks names above descriptions', () => {
  const skills: Skill[] = [
    { name: 'zeta', description: 'review helper', enabled: true },
    { name: 'review', description: '', enabled: true },
    { name: 'review-off', description: '', enabled: false },
    { name: 'prereview', description: '', enabled: true },
  ];
  assert.deepEqual(
    searchSkills(skills, 'REVIEW').map((item) => item.name),
    ['review', 'prereview', 'zeta'],
  );
  assert.equal(searchSkills(skills, '').length, 3);
  assert.deepEqual(searchSkills(skills, 'nothing'), []);
});

test('two skills with one name from different files are different', () => {
  assert.ok(!sameSkill({ name: 'x', path: '/a' }, { name: 'x', path: '/b' }));
  assert.ok(sameSkill({ name: 'x' }, { name: 'x' }));
});

test('Claude invocation: one slash command, the others by name', () => {
  assert.equal(claudeSkillText('go'), 'go');
  assert.equal(claudeSkillText('go', [{ name: 'a' }]), '/a go');
  assert.equal(
    claudeSkillText('go', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
    '/a go\n\nAlso use these skills: b, c.',
  );
});

test('Codex invocation: native skill inputs', () => {
  assert.deepEqual(codexSkillInputs([{ name: 'a', path: '/a' }, { name: 'no-file' }]), [
    { type: 'skill', name: 'a', path: '/a' },
  ]);
  assert.deepEqual(codexSkillInputs(), []);
});

test('a chip is a request: resolved into the turn without touching its text', async () => {
  const input = await resolveAttachments([{ kind: 'skill', name: 'a', path: '/a' }], {
    root: '/tmp',
    store: {} as never,
    sessions: [],
  });
  assert.deepEqual(input.skills, [{ name: 'a', path: '/a' }]);
  assert.equal(input.context, undefined);
});

test('only a real Skill tool call reads as used', () => {
  assert.equal(describeClaudeTool('Skill', { skill: 'deploy' }).kind, 'skill');
  assert.equal(describeClaudeTool('Skill', { skill: 'deploy' }).skill?.phase, 'invoke');
  assert.notEqual(describeClaudeTool('Read', { file_path: 'x' }).title, 'Used skill x');
});

test('skill attachments are validated like any other message', () => {
  assert.ok(attachmentSchema.safeParse({ kind: 'skill', name: 'a' }).success);
  assert.ok(!attachmentSchema.safeParse({ kind: 'skill', name: '' }).success);
  assert.ok(!attachmentSchema.safeParse({ kind: 'skill', name: 'a'.repeat(201) }).success);
});
