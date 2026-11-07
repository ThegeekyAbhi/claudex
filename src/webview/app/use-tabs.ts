import { useEffect, useRef, useState } from 'react';
import type { Attachment, Session } from '../../shared/model';
import {
  ACCOUNTS_TAB,
  DRAFT_TAB,
  isDraftTab,
  reconcileTabs,
  tabAfterClosing,
} from '../features/threads/tab-state';
import type { TabItem } from '../features/threads/thread-tabs';
import { type ComposeChoice, send, type ViewState } from './bridge';
import type { useComposeChoice } from './use-compose-choice';
import type { useDrafts } from './use-drafts';

export function useTabs(
  saved: ViewState | undefined,
  sessions: Session[],
  drafts: ReturnType<typeof useDrafts>,
  composeChoice: ReturnType<typeof useComposeChoice>,
  reportError: (text: string) => void,
) {
  const [accountsActive, setAccountsActive] = useState(Boolean(saved?.accountsActive));
  const [accountsIntent, setAccountsIntent] = useState<{
    profile?: string;
    create?: boolean;
    key: number;
  }>({ key: 0 });
  const [selectedId, setSelectedId] = useState(saved?.selectedId);
  const [tabs, setTabs] = useState<string[]>(saved?.tabs ?? []);
  const [activeDraft, setActiveDraft] = useState(saved?.activeDraft ?? DRAFT_TAB);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Tabs just closed, until the host confirms it has moved on from them. */
  const closing = useRef(new Set<string>());
  /** The draft whose first message is on its way, so its thread can take over its tab. */
  const startedDraft = useRef<string | undefined>(undefined);
  const draftCount = useRef(0);
  const session = sessions.find((item) => item.id === selectedId);
  const parent = session?.parentId
    ? sessions.find((item) => item.id === session.parentId)
    : undefined;
  const draftKey = session?.id ?? activeDraft;
  function select(item: Session) {
    setAccountsActive(false);
    closing.current.delete(item.id);
    setHistoryOpen(false);
    setSelectedId(item.id);
    reportError('');
    send({ type: 'select', id: item.id });
  }
  const known = new Set(sessions.map((item) => item.id));
  const activeKey = accountsActive ? ACCOUNTS_TAB : (session?.id ?? activeDraft);
  const openKeys = reconcileTabs(
    tabs,
    activeKey,
    known,
    session ? startedDraft.current : undefined,
  );
  const tabItems = openKeys.flatMap((key): TabItem[] => {
    if (key === ACCOUNTS_TAB) return [{ kind: 'accounts', key }];
    if (isDraftTab(key)) return [{ kind: 'draft', key, text: drafts.texts[key] ?? '' }];
    const item = sessions.find((other) => other.id === key);
    return item ? [{ kind: 'thread', key, session: item }] : [];
  });
  const openList = openKeys.join('\n');
  // Sessions are empty until the first snapshot, which must not read as every tab being closed.
  const loaded = sessions.length > 0;
  useEffect(() => {
    if (loaded || session) setTabs(openList ? openList.split('\n') : []);
    if (session) startedDraft.current = undefined;
  }, [openList, loaded, session]);
  function activate(item: TabItem) {
    if (item.kind === 'accounts') openAccounts();
    else if (item.kind === 'thread') select(item.session);
    else openDraft(item.key);
  }
  function openDraft(key: string) {
    setAccountsActive(false);
    setHistoryOpen(false);
    reportError('');
    setSelectedId(undefined);
    setActiveDraft(key);
    send({ type: 'compose' });
  }
  function openAccounts(profile?: string, create?: boolean) {
    setAccountsActive(true);
    setHistoryOpen(false);
    setTabs((current) => (current.includes(ACCOUNTS_TAB) ? current : [...openKeys, ACCOUNTS_TAB]));
    if (profile || create)
      setAccountsIntent((current) => ({ profile, create, key: current.key + 1 }));
  }
  function closeTab(item: TabItem) {
    const rest = openKeys.filter((key) => key !== item.key);
    setTabs(rest);
    if (item.kind === 'draft') {
      drafts.setTexts(({ [item.key]: _closed, ...current }) => current);
      drafts.setAttachments(({ [item.key]: _closed, ...current }) => current);
    }
    if (item.key !== activeKey) return;
    if (item.kind === 'thread') closing.current.add(item.key);
    const next = tabItems.find((tab) => tab.key === tabAfterClosing(openKeys, item.key));
    if (next) activate(next);
    else compose();
  }
  /** Always a new tab: whatever you've typed elsewhere stays in its own tab, sent or not. */
  function compose(next?: Partial<ComposeChoice>, carry?: string, attach?: Attachment[]) {
    const key = `${DRAFT_TAB}:${Date.now()}-${++draftCount.current}`;
    setTabs([...openKeys, key]);
    composeChoice.setChoice((current) => ({
      ...current,
      parentId: undefined,
      worktree: false,
      ...next,
    }));
    if (carry !== undefined) drafts.setTexts((current) => ({ ...current, [key]: carry }));
    if (attach?.length) drafts.setAttachments((current) => ({ ...current, [key]: attach }));
    openDraft(key);
  }

  function snapshot(selected: string | undefined) {
    // A snapshot sent before you closed a tab must not reopen it.
    if (!selected || !closing.current.has(selected)) {
      closing.current.clear();
      setSelectedId(selected);
    }
  }
  function starting(key: string | undefined) {
    startedDraft.current = key;
  }
  return {
    current: { session, parent, draftKey },
    strip: { items: tabItems, activeKey, activate, close: closeTab },
    select,
    compose,
    history: { open: historyOpen, setOpen: setHistoryOpen },
    accounts: {
      active: accountsActive,
      open: openAccounts,
      intent: accountsIntent,
      present: openKeys.includes(ACCOUNTS_TAB),
    },
    saved: { selectedId, tabs, activeDraft, accountsActive },
    snapshot,
    starting,
  };
}
