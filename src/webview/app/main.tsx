import { lazy, type ReactElement, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PagesOverview } from '../features/pages/list/pages-overview';
import { PagesApp } from '../features/pages/list/pages-sidebar';
import { App } from './app';
import './fonts.css';
// The editor is large, so only a page editor tab loads it.
const PageApp = lazy(() => import('../features/pages/page/page-app'));
const root = document.getElementById('root');
if (!root) throw new Error('The workspace root element is missing.');
createRoot(root).render(renderSurface(document.documentElement.dataset.surface));

function renderSurface(surface: string | undefined): ReactElement {
  let page: ReactElement;
  switch (surface) {
    case 'pages':
      page = <PagesApp />;
      break;
    case 'pagesOverview':
      page = <PagesOverview />;
      break;
    case 'page':
      page = (
        <Suspense fallback={null}>
          <PageApp />
        </Suspense>
      );
      break;
    default:
      return <App />;
  }
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={200}>
      {page}
    </TooltipProvider>
  );
}
