import { useEffect, useState } from "react";

type LocalStorageStateOptions = {
  legacyKeys?: string[];
};

export function useLocalStorageState<T>(key: string, initialValue: T, options: LocalStorageStateOptions = {}) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
      for (const legacyKey of options.legacyKeys ?? []) {
        const legacyStored = window.localStorage.getItem(legacyKey);
        if (legacyStored) {
          return JSON.parse(legacyStored) as T;
        }
      }
      return initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures during desktop preview or privacy-restricted sessions.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
