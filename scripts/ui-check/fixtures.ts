export function createFixtures() {
  const catalog = {
    codex: {
      status: 'ready',
      models: [
        {
          id: 'gpt-6.1-sol',
          label: 'GPT-6.1-Sol',
          description: 'Latest workhorse model for coding and everyday work.',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          isDefault: true,
        },
        {
          id: 'gpt-6-luna',
          label: 'GPT-6-Luna',
          description: 'Fast and affordable model for easier tasks.',
          efforts: ['low', 'medium'],
        },
      ],
    },
    claude: {
      status: 'ready',
      models: [
        {
          id: 'opus',
          label: 'Opus 5.5',
          description: 'For complex work and everyday tasks',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          id: 'sonnet',
          label: 'Sonnet 5.5',
          description: 'Most efficient for simpler tasks',
          efforts: ['low', 'medium', 'high'],
        },
        {
          id: 'claude-opus-4-8',
          label: 'Opus 4.8',
          description: 'Best for everyday, complex tasks',
          efforts: ['low', 'medium'],
        },
      ],
    },
    claud2: { status: 'error', models: [], error: 'spawn claud2 ENOENT' },
  };
  const patch =
    '@@ -18,5 +18,6 @@\n const limit = 40;\n-const cache = new Map();\n+const cache = new Map<string, Plan>();\n+const seen = new Set<string>();\n compile(plan);';
  // What the host found: both CLIs, and the old second Claude account because threads use it.
  const agents = {
    profiles: [
      { id: 'claude', label: 'Claude', provider: 'claude', builtin: true, status: 'ready' },
      { id: 'claud2', label: 'Claude 2', provider: 'claude', legacy: true, status: 'ready' },
      { id: 'codex', label: 'Codex', provider: 'codex', builtin: true, status: 'ready' },
    ],
    problems: [],
    suggestions: [],
  } as { profiles: object[]; problems: string[]; suggestions: object[] };
  return { catalog, patch, agents };
}
