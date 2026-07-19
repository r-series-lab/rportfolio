import type { KeyboardEvent } from "react";

const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);
const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);

export function nextTabIndex(currentIndex: number, tabCount: number, key: string): number | null {
  if (tabCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (PREVIOUS_KEYS.has(key)) return (currentIndex - 1 + tabCount) % tabCount;
  if (NEXT_KEYS.has(key)) return (currentIndex + 1) % tabCount;
  return null;
}

export function handleTabListKeyDown(event: KeyboardEvent<HTMLElement>) {
  const currentTab = (event.target as HTMLElement).closest<HTMLElement>("[role='tab']");
  if (!currentTab || !event.currentTarget.contains(currentTab)) return;

  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']:not(:disabled):not([aria-disabled='true'])"),
  );
  const currentIndex = tabs.indexOf(currentTab);
  if (currentIndex < 0) return;

  const nextIndex = nextTabIndex(currentIndex, tabs.length, event.key);
  if (nextIndex === null) return;

  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}
