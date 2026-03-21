import { useEffect, useState } from 'react';

const STORAGE_KEY = 'quick_note_content';

export const useNote = () => {
  const [note, setNote] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || '';
  });

  // Automatikus mentés (Debounce logikával)
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, note);
    }, 500); // Fél másodperc türelem írás közben

    return () => clearTimeout(timer);
  }, [note]);

  return { note, setNote };
};
