import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  agentKind,
  agentLabel,
  canBuildPlan,
  continuationLinks,
  emptySkills,
  noAgentInstalled,
  profileLabel,
  runnableProfiles,
  setupRows,
  showSetupCard,
  threadTitle,
} from '../../shared/model';
import { Icon } from '../components/icons';
import { AccountsPanel } from '../features/accounts/accounts-panel';
import { AccountsNavigation } from '../features/accounts/navigation';
import { SidePanel } from '../features/changes/documents-panel';
import { Composer } from '../features/composer/composer';
import { TerminalStrip } from '../features/composer/terminal-strip';
import { Conversation } from '../features/conversation/conversation';
import { ImageBase } from '../features/images/image-view';
import { SetupCard } from '../features/onboarding/setup-card';
import { BuildContext, PlanOptions } from '../features/plan/plan-options';
import { QuestionCard } from '../features/questions/question-card';
import { SidePopover } from '../features/side-question/side-popover';
import { SkillsPanel } from '../features/skills/skills-panel';
import { ThreadSidebar } from '../features/threads/thread-list';
import { AppHeader } from './app-header';
import { api, emptyCatalog, send } from './bridge';
import { RecentThreads } from './recent-threads';
import { useAppState } from './state';
import { WorkspacePanes } from './workspace-panes';

export function App() {
  const {
    host,
    drafts,
    compose,
    tabs,
    threads,
    changes,
    turns,
    side,
    ui,
    conversation,
    layout,
    revealThreads,
  } = useAppState();
  const { snapshot } = host;
  const { session, parent, draftKey } = tabs.current;
  const asides = side.items(session?.id);
  // Cmd/Ctrl+; starts a side question, as in Claude Code.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== ';' || !session || session.observed)
        return;
      event.preventDefault();
      drafts.setTexts((current) =>
        (current[session.id] ?? '').startsWith('/btw')
          ? current
          : { ...current, [session.id]: `/btw ${current[session.id] ?? ''}` },
      );
      document.querySelector<HTMLElement>('[aria-label="Message your agent"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, drafts.setTexts]);
  // Branching and editing wait for a quiet thread; quoting and carrying context never do.
  const settled = Boolean(
    session &&
      !session.observed &&
      !session.inTerminal &&
      !session.transition &&
      !turns.running &&
      !turns.submitted,
  );
  const messageActions =
    session && !session.observed
      ? {
          quote: (text: string) => turns.quote(session, text),
          ...(settled
            ? {
                fork: (message: { id: string }) =>
                  send({ type: 'fork', id: session.id, messageId: message.id }),
                ...(!session.inTerminal
                  ? {
                      edit: (message: Parameters<typeof turns.edit>[1]) =>
                        turns.edit(session, message),
                    }
                  : {}),
              }
            : {}),
          newChat: (message: Parameters<typeof turns.newChatFrom>[1], agent: string) =>
            turns.newChatFrom(session, message, agent),
          agents: [
            agentKind(session),
            ...runnableProfiles()
              .map((profile) => profile.id)
              .filter((id) => id !== agentKind(session)),
          ].map((id) => ({ id, label: profileLabel(id) })),
        }
      : undefined;
  const draft = drafts.texts[draftKey] ?? '';
  const attached = drafts.attachments[draftKey] ?? [];
  const catalog = snapshot.catalog ?? emptyCatalog;
  const setup = setupRows(snapshot.agents);
  const workspaceClass = `workspace h-dvh overflow-hidden border-l border-strong [[data-surface=view]_&]:border-l-0 ${changes.panel ? `panel-${changes.panel}` : 'hide-documents'} ${tabs.history.open ? 'show-history' : ''}`;
  const mainPane = (
    <main className="main min-w-0 min-h-0 flex flex-col relative">
      <AppHeader
        host={host}
        tabs={tabs}
        threads={threads}
        changes={changes}
        turns={turns}
        ui={ui}
        threadsPane={layout.wide ? layout.threads : undefined}
      />
      {tabs.accounts.present ? (
        <div
          className="min-h-0 flex-1 flex flex-col"
          style={{ display: tabs.accounts.active ? undefined : 'none' }}
        >
          <AccountsPanel
            agents={snapshot.agents}
            intent={tabs.accounts.intent}
            onChat={() =>
              session
                ? tabs.select(session)
                : tabs.strip.activate({ kind: 'draft', key: draftKey, text: draft })
            }
          />
        </div>
      ) : null}
      {!tabs.accounts.active ? (
        <>
          {parent ? (
            <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-subtle text-[11.5px] text-muted-foreground">
              <span>Subagent of</span>
              <button
                type="button"
                className="min-w-0 px-1 py-px text-muted-foreground block truncate"
                title={parent.title}
                onClick={() => tabs.select(parent)}
              >
                {threadTitle(parent.title)}
              </button>
            </div>
          ) : null}
          {session && !parent && continuationLinks(session, snapshot.sessions).length ? (
            <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-subtle text-[11.5px] text-muted-foreground min-w-0 overflow-hidden">
              <Icon name="swap" size={12} />
              {continuationLinks(session, snapshot.sessions).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="min-w-0 px-1 py-px text-muted-foreground block truncate"
                  title={item.title}
                  onClick={() => tabs.select(item)}
                >
                  {item.id === session.continuedFrom ? 'Continued from' : 'Continued in'}{' '}
                  {agentLabel(item)}: {threadTitle(item.title)}
                </button>
              ))}
            </div>
          ) : null}
          {!snapshot.trusted ? (
            <div className="text-[12px] px-4 py-2 bg-surface border-b border-subtle wrap-anywhere">
              Trust this folder in VS Code to start local agents and view project documents.
            </div>
          ) : null}
          {!api ? (
            <div className="text-[12px] px-4 py-2 bg-surface border-b border-subtle wrap-anywhere text-warning">
              Design preview · agent execution is available inside VS Code
            </div>
          ) : null}
          {ui.error ? (
            <div
              className="text-[12px] px-4 py-2 bg-surface border-b border-subtle wrap-anywhere flex items-center text-error justify-between gap-2"
              role="alert"
            >
              <span>{ui.error}</span>
              <button type="button" aria-label="Dismiss error" onClick={() => ui.setError('')}>
                <Icon name="close" />
              </button>
            </div>
          ) : null}
          {session ? (
            <Conversation
              session={session}
              sessions={snapshot.sessions}
              scroll={threads.scroll.current}
              onScroll={(id, top) => {
                threads.scroll.current[id] = top;
              }}
              onOpenThread={tabs.select}
              actions={messageActions}
              onUseResult={(text) =>
                drafts.setTexts((current) => ({
                  ...current,
                  [session.id]: `${text}${current[session.id] ?? ''}`,
                }))
              }
            />
          ) : null}
          {conversation.asking ? (
            <QuestionCard
              key={conversation.asking.approval.id}
              approval={conversation.asking.approval}
              sessionId={conversation.asking.sessionId}
              from={conversation.asking.from}
            />
          ) : null}
          {session && canBuildPlan(session) && !session.observed && !session.inTerminal ? (
            <PlanOptions
              key={session.id + session.plan?.updatedAt}
              session={session}
              notes={draft}
              onNotesUsed={() => drafts.setTexts((current) => ({ ...current, [draftKey]: '' }))}
            />
          ) : null}
          {session?.observed ? (
            <div className="flex items-center justify-center gap-2 border-t border-subtle p-3 text-[12px] text-muted-foreground flex-wrap">
              <Icon name="branch" />
              {agentLabel(session)} manages this worker from its lead thread.
              {parent ? (
                <button type="button" onClick={() => tabs.select(parent)}>
                  Open lead thread →
                </button>
              ) : null}
            </div>
          ) : session?.inTerminal ? (
            <TerminalStrip id={session.id} label={agentLabel(session)} />
          ) : (
            <>
              {session && asides.length > 0 && side.isOpen(session.id) ? (
                <SidePopover
                  items={asides}
                  agent={agentLabel(session)}
                  provider={session.provider}
                  onStop={side.stop}
                  onRetry={(requestId) => side.retry(session, requestId)}
                  onAskInThread={(question) =>
                    drafts.setTexts((current) => ({ ...current, [session.id]: question }))
                  }
                  onClose={() => side.setOpen(undefined)}
                  onClear={() => side.clear(session.id)}
                />
              ) : session && asides.length > 0 ? (
                <button
                  type="button"
                  className="side-reopen self-center mb-1 gap-1 rounded-full border border-subtle bg-overlay px-2.5 py-0.5 text-[11px] text-muted-foreground enabled:hover:text-foreground"
                  onClick={() => side.setOpen(session.id)}
                >
                  <Icon name="aside" size={12} />
                  Side questions ({asides.length})
                </button>
              ) : null}
              {turns.editing ? (
                <div
                  className="edit-banner flex items-start gap-2 mx-6 mt-2 -mb-1 max-w-[780px] self-center w-[calc(100%-48px)] rounded-md border border-warning/40 bg-surface px-3 py-2 text-[12px] text-muted-foreground max-[900px]:mx-3"
                  aria-live="polite"
                >
                  <Icon name="edit" size={13} />
                  <span className="flex-1">
                    Editing an earlier message. Sending replaces it and every turn after it; the
                    agent continues from the turn before. Files it changed are not reverted.
                  </span>
                  <button
                    type="button"
                    className="shrink-0 px-1.5 text-[12px] text-muted-foreground enabled:hover:text-foreground"
                    onClick={turns.cancelEdit}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <Composer
                preferences={snapshot.preferences}
                catalog={catalog}
                skills={snapshot.skills ?? emptySkills}
                onManageSkills={() => ui.skills.setOpen(true)}
                session={session}
                sessions={snapshot.sessions}
                project={snapshot.project}
                choice={compose.choice}
                onMode={compose.rememberMode}
                dismissedNudges={compose.dismissedNudges}
                onDismissNudge={(key) => compose.setDismissedNudges((current) => [...current, key])}
                draft={draft}
                attachments={attached}
                draftKey={draftKey}
                top={!session}
                contextResults={host.contextResults}
                onAttachments={(next) =>
                  drafts.setAttachments((current) => ({ ...current, [draftKey]: next }))
                }
                onError={ui.setError}
                busy={Boolean(
                  session?.transition ||
                    (turns.running && session?.approval?.kind !== 'plan') ||
                    (session && turns.submitted),
                )}
                trusted={snapshot.trusted}
                focusKey={draftKey}
                onDraft={(text) => drafts.setTexts((current) => ({ ...current, [draftKey]: text }))}
                onChoice={(next, carry) => {
                  if (carry && session?.messages.length && !session.observed)
                    turns.continueIn(session, next);
                  else if (carry) {
                    tabs.compose(next, draft);
                    drafts.setTexts((current) => ({ ...current, [draftKey]: '' }));
                  } else compose.setChoice(next);
                }}
                onSubmit={turns.submit}
              />
            </>
          )}
          {!session ? (
            <div className="flex-1 min-h-0 overflow-y-auto pt-2 px-6 pb-4 max-[900px]:pt-1 max-[900px]:px-3 max-[900px]:pb-3">
              {conversation.linkedTo ? (
                <p className="max-w-[780px] mx-auto mb-2 text-[12px] text-muted-foreground">
                  Linked to <strong>{conversation.linkedTo.title}</strong>
                </p>
              ) : null}
              {showSetupCard({
                threads: snapshot.sessions.length,
                dismissed: Boolean(snapshot.onboardingDismissed),
                rows: setup,
              }) ? (
                <SetupCard
                  rows={setup}
                  dismissible={!noAgentInstalled(setup)}
                  onPrompt={(text) =>
                    drafts.setTexts((current) => ({ ...current, [draftKey]: text }))
                  }
                />
              ) : null}
              <RecentThreads
                sessions={snapshot.sessions}
                onSelect={tabs.select}
                onViewAll={revealThreads}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
  const sidePane = changes.panel ? (
    <SidePanel
      snapshot={snapshot}
      session={session}
      tab={changes.panel}
      onTab={changes.setPanel}
      onClose={() => changes.setPanel(null)}
      changes={changes.result}
      changesLoading={changes.loading}
      onRefreshChanges={changes.refresh}
      onLinkThread={() => {
        if (session) tabs.compose({ agent: agentKind(session), parentId: session.id });
      }}
    />
  ) : null;
  const threadsPane = (
    <ThreadSidebar
      snapshot={snapshot}
      selectedId={session?.id}
      onSelect={tabs.select}
      seen={threads.seen}
      view={threads.threadView}
      onView={threads.setThreadView}
    />
  );
  return (
    <AccountsNavigation.Provider value={tabs.accounts.open}>
      <BuildContext.Provider
        value={{
          catalog: snapshot.catalog ?? emptyCatalog,
          sessions: snapshot.sessions,
          approvals: compose.buildApprovals,
          onApprovals: compose.setBuildApprovals,
        }}
      >
        <ImageBase.Provider value={host.imageBase}>
          <TooltipProvider delayDuration={350} skipDelayDuration={200}>
            <WorkspacePanes
              className={workspaceClass}
              layout={layout}
              main={mainPane}
              side={sidePane}
              sideKind={changes.panel}
              threads={threadsPane}
            />
            {ui.skills.open ? (
              <SkillsPanel
                catalogs={snapshot.skills ?? emptySkills}
                initialAgent={session ? agentKind(session) : compose.choice.agent}
                onClose={() => ui.skills.setOpen(false)}
              />
            ) : null}
          </TooltipProvider>
        </ImageBase.Provider>
      </BuildContext.Provider>
    </AccountsNavigation.Provider>
  );
}
