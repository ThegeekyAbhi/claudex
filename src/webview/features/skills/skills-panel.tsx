import { useEffect, useState } from 'react';
import {
  type AgentKind,
  agentTarget,
  CAPABILITIES,
  missingSkills,
  profileLabel,
  profileProvider,
  runnableProfiles,
  SKILL_SOURCE_LABELS,
  type SkillCatalogs,
  searchSkills,
  skillsFor,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';

/** Every skill each CLI reports. Installing skills belongs to the CLIs, not this panel. */
export function SkillsPanel({
  catalogs,
  initialAgent,
  onClose,
}: {
  catalogs: SkillCatalogs;
  initialAgent: AgentKind;
  onClose: () => void;
}) {
  const [agent, setAgent] = useState(initialAgent);
  const [search, setSearch] = useState('');
  const catalog = skillsFor(catalogs, agent);
  useEffect(() => send({ type: 'refreshSkills', agent }), [agent]);
  // Other profiles of the same CLI, so what this one is missing can be shown.
  const siblings = runnableProfiles().filter(
    (profile) => profile.id !== agent && profile.provider === profileProvider(agent),
  );
  const siblingIds = siblings.map((profile) => profile.id).join(' ');
  useEffect(() => {
    for (const id of siblingIds.split(' ').filter(Boolean))
      send({ type: 'refreshSkills', agent: id });
  }, [siblingIds]);
  const gaps = siblings
    .map((profile) => ({
      profile,
      missing: missingSkills(skillsFor(catalogs, profile.id), skillsFor(catalogs, agent)),
    }))
    .filter((gap) => gap.missing.length);
  const canToggle = CAPABILITIES[agentTarget(agent).provider].skillToggle;
  const needle = search.toLowerCase();
  const rows = catalog.skills.filter((skill) =>
    needle ? searchSkills([{ ...skill, enabled: true }], needle).length > 0 : true,
  );
  return (
    <Dialog modal={false} open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // The composer can take focus back as this opens. Only Esc or a click closes it.
        onFocusOutside={(event) => event.preventDefault()}
        className="flex max-h-[80vh] w-[calc(100%-32px)] max-w-[560px] flex-col gap-2 border border-[var(--border-strong)] bg-[var(--surface)] p-3 text-xs shadow-lg"
      >
        <DialogTitle className="text-[13px] font-semibold">Skills</DialogTitle>
        <div role="tablist" aria-label="Agent" className="flex gap-1">
          {runnableProfiles()
            .map((profile) => profile.id)
            .map((item) => (
              <Button
                key={item}
                role="tab"
                aria-selected={item === agent}
                variant={item === agent ? 'secondary' : 'ghost'}
                size="xs"
                className="cursor-pointer"
                onClick={() => setAgent(item)}
              >
                <AgentMark agent={item} /> {profileLabel(item)}
              </Button>
            ))}
        </div>
        {gaps.map(({ profile, missing }) => (
          <div
            key={profile.id}
            role="note"
            className="flex items-start gap-2 rounded-md border border-[var(--border)] px-2 py-1.5 text-[11.5px] text-muted-foreground"
          >
            <span className="min-w-0 flex-1 whitespace-normal">
              {missing.length} {missing.length === 1 ? 'skill' : 'skills'} in {profile.label}{' '}
              {missing.length === 1 ? 'isn’t' : 'aren’t'} in {profileLabel(agent)}:{' '}
              <span className="text-foreground">
                {missing
                  .slice(0, 6)
                  .map((skill) => skill.name)
                  .join(', ')}
                {missing.length > 6 ? `, and ${missing.length - 6} more` : ''}
              </span>
              . Each profile has its own skills folder; copy or link the ones you want.
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 cursor-pointer"
              title={`Show ${profileLabel(agent)}’s skills folder`}
              onClick={() => send({ type: 'openProfileFolder', id: agent, folder: 'skills' })}
            >
              Open folder
            </Button>
          </div>
        ))}
        <input
          aria-label="Search skills"
          placeholder="Search skills…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-7 rounded-md border border-[var(--border)] bg-transparent px-2 text-xs focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
        />
        <div className="min-h-24 flex-1 overflow-y-auto">
          {rows.map((skill) => (
            <div
              key={skill.path ?? skill.name}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
            >
              <div className={`min-w-0 flex-1 ${skill.enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-medium text-foreground">{skill.name}</span>
                  {skill.source ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {SKILL_SOURCE_LABELS[skill.source]}
                    </span>
                  ) : null}
                </div>
                {skill.description ? (
                  <p className="m-0 line-clamp-2 text-[11px] leading-[1.45] text-muted-foreground">
                    {skill.description}
                  </p>
                ) : null}
              </div>
              {skill.path ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="cursor-pointer"
                  onClick={() =>
                    send({ type: 'openSkill', agent, name: skill.name, path: skill.path ?? '' })
                  }
                >
                  Open
                </Button>
              ) : null}
              {canToggle && skill.path ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="cursor-pointer"
                  aria-label={`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`}
                  onClick={() =>
                    send({
                      type: 'setSkillEnabled',
                      agent,
                      name: skill.name,
                      path: skill.path ?? '',
                      enabled: !skill.enabled,
                    })
                  }
                >
                  {skill.enabled ? 'Turn off' : 'Turn on'}
                </Button>
              ) : null}
            </div>
          ))}
          {!rows.length ? (
            <p className="m-0 p-2 text-muted-foreground">
              {catalog.status === 'error'
                ? (catalog.error ?? 'Couldn’t read this agent’s skills.')
                : catalog.status === 'ready'
                  ? 'No skills found.'
                  : 'Looking for skills…'}
            </p>
          ) : null}
          {catalog.problems.map((problem) => (
            <p key={problem} className="m-0 px-2 py-1 text-[11px] text-[var(--warning)]">
              {problem}
            </p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
