import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';

export function useWorkspaceUI() {
  const [error, setError] = useState('');
  const [skillsOpen, setSkillsOpen] = useState(false);
  return { error, setError, skills: { open: skillsOpen, setOpen: setSkillsOpen } };
}

export function useWorkspaceEffects(
  appearance: string,
  setError: Dispatch<SetStateAction<string>>,
  setHistoryOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setHistoryOpen(true);
        requestAnimationFrame(() => document.getElementById('thread-search')?.focus());
      }
      if (event.key === 'Escape') setError('');
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [setError, setHistoryOpen]);
}
