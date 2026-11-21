import { useCallback, useEffect, useRef, useState } from 'react';
import { splitFrontMatter } from '../../../../shared/model';
import type { PageHostMessage, PageViewState } from '../../../../shared/protocol/pages';
import { Icon } from '../../../components/icons';
import { createPageEditor } from '../editor/create-editor';
import type { PageEditor, SelectionState } from '../editor/types';
import { pageFromHref, pageHref, post, useHostMessages } from '../shared/page-bridge';
import { nextRequest } from '../shared/requests';
import { SmallButton } from '../shared/small-button';
import { Banner } from './banner';
import { PageChat } from './chat/page-chat';
import { IconPicker } from './header/icon-picker';
import { MentionMenu } from './mentions/mention-menu';
import { useMentions } from './mentions/use-mentions';
import { Outline } from './outline';
import { PageChooser } from './page-chooser';
import { PlanBar } from './plan-bar';
import { ReviewBar } from './review/review-bar';
import { SelectionBar } from './selection/selection-bar';
import { usePageAsk } from './use-page-ask';
import { usePageImages } from './use-page-images';
import { usePageSync } from './use-page-sync';

type OutlineItem = { text: string; level: number; pos: number };

/**
 * One page in its editor tab: the page itself, its review and selection bars, the `@` menu,
 * and the page's chat. The hooks own the state; this lays it out.
 */
export default function PageApp() {
  const [state, setState] = useState<PageViewState>();
  const [error, setError] = useState<string>();
  const [editorReady, setEditorReady] = useState(false);
  const [selection, setSelection] = useState<SelectionState>();
  const [choosingPage, setChoosingPage] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [hideCarry, setHideCarry] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<PageEditor>(undefined);
  const askBox = useRef<HTMLTextAreaElement>(null);
  /** Column widths kept for this file, for the editor when it starts. */
  const tableWidths = useRef<NonNullable<PageViewState['tableWidths']>>([]);
  /** Path checks sent to the host, by request. */
  const pathChecks = useRef(new Map<string, string[]>());

  const sync = usePageSync(
    editor,
    useCallback((instance: PageEditor) => setOutline(instance.outline()), []),
  );
  const images = usePageImages(setError);
  const mentions = useMentions(state, editor);
  const asking = usePageAsk(state, sync.flush);

  const { external, start } = sync;
  const receive = useCallback(
    (message: PageHostMessage) => {
      images.receive(message);
      mentions.receive(message);
      if (message.type === 'error') setError(message.text);
      if (message.type === 'pageText') external(message.text);
      if (message.type === 'pageInsertImage') editor.current?.insertImage(message.src, message.alt);
      if (message.type === 'pagePathsResolved') {
        const asked = pathChecks.current.get(message.requestId);
        pathChecks.current.delete(message.requestId);
        if (asked) editor.current?.resolvedPaths(asked, message.paths);
      }
      if (message.type === 'page') {
        const widths = message.state.tableWidths ?? [];
        tableWidths.current = widths;
        setState(message.state);
        if (editor.current) {
          external(message.state.text);
          editor.current.setTableWidths(widths);
        } else start(message.state.text);
      }
    },
    [images.receive, mentions.receive, external, start],
  );
  useHostMessages(receive);

  // The editor starts once the page's text has arrived. Its callbacks are stable, so it starts
  // once per page.
  const ready = Boolean(state);
  const { changed, started, flush } = sync;
  useEffect(() => {
    if (!ready || !host.current || editor.current) return;
    let cancelled = false;
    const body = start('');
    void createPageEditor(
      host.current,
      body,
      {
        change: (markdown) => {
          changed(markdown);
          if (editor.current) setOutline(editor.current.outline());
        },
        mention: mentions.track,
        mentionKey: mentions.key,
        choosePage: () => setChoosingPage(true),
        upload: images.upload,
        imageUrl: images.imageUrl,
        selection: setSelection,
        resolvePaths: (paths) => {
          const requestId = nextRequest();
          pathChecks.current.set(requestId, paths);
          post({ type: 'pageResolvePaths', requestId, paths });
        },
        review: (key, accept) => {
          const at = key.lastIndexOf(':');
          flush();
          post({
            type: 'pageSuggestion',
            id: key.slice(0, at),
            accept,
            index: Number(key.slice(at + 1)),
          });
        },
        link: (href) => {
          const target = pageFromHref(state?.id, href);
          if (target) post({ type: 'pageOpen', id: target });
          else post({ type: 'link', href });
        },
        tableWidths: (widths) => post({ type: 'pageTableWidths', widths }),
      },
      tableWidths.current,
    ).then((instance) => {
      if (cancelled) {
        void instance.destroy();
        return;
      }
      editor.current = instance;
      started(instance, body);
      setOutline(instance.outline());
      setEditorReady(true);
      // A new page starts in its title; any other page where you left it.
      if (!body.replace(/^#\s*$/m, '').trim()) instance.focus();
    });
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    state?.id,
    start,
    changed,
    started,
    flush,
    mentions.track,
    mentions.key,
    images.upload,
    images.imageUrl,
  ]);

  // Suggested edits show where they apply.
  const suggestionList = state?.suggestions;
  const { setSuggestions } = sync;
  useEffect(() => {
    setSuggestions(suggestionList ?? [], editorReady);
  }, [suggestionList, editorReady, setSuggestions]);

  const text = state ? sync.hostText() || state.text : '';
  const { meta } = splitFrontMatter(text);
  const suggestions = state?.suggestions ?? [];
  const { mention } = mentions;

  return (
    <div
      className="page-app relative flex h-full flex-col bg-canvas text-foreground"
      data-width={state?.width ?? 'normal'}
    >
      <main
        onScroll={() => setSelection(undefined)}
        className="page-scroll relative min-h-0 flex-1 overflow-y-auto"
      >
        <Outline items={outline} onPick={(pos) => editor.current?.reveal(pos)} />
        {state ? (
          <button
            type="button"
            className="absolute top-3 left-3 z-30 flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-faint hover:bg-muted hover:text-foreground"
            title="All pages"
            onClick={() => post({ type: 'pageAllPages' })}
          >
            <Icon name="chevronLeft" size={13} />
            All pages
          </button>
        ) : null}
        {state ? (
          <button
            type="button"
            className="page-width-toggle absolute top-3 right-3 z-30 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title={state.width === 'full' ? 'Normal width' : 'Full width'}
            aria-label={state.width === 'full' ? 'Normal width' : 'Full width'}
            aria-pressed={state.width === 'full'}
            onClick={() =>
              post({ type: 'pageWidth', width: state.width === 'full' ? 'normal' : 'full' })
            }
          >
            <Icon name={state.width === 'full' ? 'shrink' : 'expand'} size={14} />
          </button>
        ) : null}
        <div className="page-column mx-auto w-full px-14 pt-12 pb-48 max-[640px]:px-5 max-[640px]:pt-8">
          {state?.plan ? <PlanBar plan={state.plan} flush={flush} /> : null}
          <IconPicker icon={meta.icon} editable={Boolean(state)} />
          {state?.carry && !hideCarry ? (
            <Banner
              icon="tasks"
              actions={
                <>
                  <SmallButton strong onClick={() => post({ type: 'pageCarry' })}>
                    Bring them here
                  </SmallButton>
                  <SmallButton onClick={() => setHideCarry(true)}>Not now</SmallButton>
                </>
              }
            >
              {state.carry.count} unfinished {state.carry.count === 1 ? 'task' : 'tasks'} on{' '}
              <button
                type="button"
                className="underline decoration-faint underline-offset-2 hover:text-foreground"
                onClick={() => state.carry && post({ type: 'pageOpen', id: state.carry.from })}
              >
                {state.carry.title}
              </button>
            </Banner>
          ) : null}
          {suggestions.length ? (
            <ReviewBar
              suggestions={suggestions}
              text={text}
              onShow={(key) => editor.current?.showChange(key)}
              onAll={(accept) => {
                flush();
                for (const suggestion of suggestions)
                  post({ type: 'pageSuggestion', id: suggestion.id, accept });
              }}
            />
          ) : null}
          <div ref={host} className="page-editor" />
        </div>
      </main>
      {mention && mentions.open && editor.current ? (
        <MentionMenu
          mention={mention}
          editor={editor.current}
          groups={mentions.groups}
          flat={mentions.flat}
          index={mentions.index}
          setIndex={mentions.setIndex}
        />
      ) : null}
      {choosingPage && state ? (
        <PageChooser
          state={state}
          onClose={() => setChoosingPage(false)}
          onPick={(page) => {
            setChoosingPage(false);
            editor.current?.insertLink(page.title, pageHref(state.id, page.id));
          }}
        />
      ) : null}
      {selection && !mention ? (
        <SelectionBar
          selection={selection}
          trusted={Boolean(state?.trusted)}
          onMark={(kind) => editor.current?.mark(kind)}
          onLink={(href) => editor.current?.link(href)}
          onTurnInto={(kind) => editor.current?.turnInto(kind)}
          onAsk={(instruction) => {
            asking.askAbout(instruction, selection.text);
            setSelection(undefined);
          }}
        />
      ) : null}
      <PageChat
        state={state}
        prompt={asking.prompt}
        setPrompt={asking.setPrompt}
        box={askBox}
        profile={asking.chosen}
        setProfile={asking.setProfile}
        mode={asking.mode}
        setMode={asking.setMode}
        onAsk={() => asking.ask()}
        reveal={asking.reveal}
      />
      {error ? (
        <output className="absolute bottom-4 left-4 z-30 flex max-w-[420px] items-start gap-2 rounded-lg border border-strong bg-overlay px-3 py-2 text-[12px] shadow-md">
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(undefined)}>
            <Icon name="close" size={12} />
          </button>
        </output>
      ) : null}
    </div>
  );
}
