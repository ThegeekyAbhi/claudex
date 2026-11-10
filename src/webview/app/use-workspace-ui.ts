import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

export function useWorkspaceUI() {
  const [error, setError] = useState('');
  const [skillsOpen, setSkillsOpen] = useState(false);
  return { error, setError, skills: { open: skillsOpen, setOpen: setSkillsOpen } };
}

export function useWorkspaceEffects(
  appearance: string,
  setError: Dispatch<SetStateAction<string>>,
  /** Shows the thread list and focuses its search, however the layout shows it. */
  revealThreads: () => void,
) {
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  const reveal = useRef(revealThreads);
  reveal.current = revealThreads;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        reveal.current();
      }
      if (event.key === 'Escape') setError('');
    };
    const preserveCopy = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'c')
        event.stopPropagation();
    };
    // Keep the browser's native copy behavior without forwarding this key to editor commands.
    document.addEventListener('keydown', preserveCopy);
    window.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', preserveCopy);
      window.removeEventListener('keydown', listener);
    };
  }, [setError]);
}
