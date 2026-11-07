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
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [setError]);
}
