import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Bell, Search, User, X } from 'lucide-react';
import type { Alert, TransactionEdge } from '@tracelayer/aml-engine';
import {
  isMacPlatform,
  isSearchShortcutEvent,
  searchDataset,
  type SearchResultItem,
} from '@tracelayer/aml-engine';

interface SidebarSearchProps {
  edges: TransactionEdge[];
  alerts: Alert[];
  onSelectResult: (item: SearchResultItem) => void;
}

const KIND_LABELS: Record<SearchResultItem['kind'], string> = {
  alert: 'Alert',
  account: 'Account',
  transaction: 'Tx ID',
};

const KIND_ICONS: Record<SearchResultItem['kind'], typeof Bell> = {
  alert: Bell,
  account: User,
  transaction: ArrowLeftRight,
};

export function SidebarSearch({ edges, alerts, onSelectResult }: SidebarSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && isMacPlatform(navigator.platform),
    []
  );
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';

  const searchOutput = useMemo(
    () => searchDataset(query, edges, alerts, 12),
    [query, edges, alerts]
  );

  const hasQuery = query.trim().length > 0;
  const showResults = hasQuery && isOpen;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!isSearchShortcutEvent(event)) return;
      event.preventDefault();
      setIsOpen(true);
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleSelect = (item: SearchResultItem) => {
    setIsOpen(false);
    onSelectResult(item);
  };

  return (
    <div ref={containerRef} className="relative mb-4">
      <label htmlFor="sidebar-dataset-search" className="sr-only">
        Search accounts, transaction IDs, or alert IDs
      </label>
      <div className="relative flex items-center">
        <Search
          className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#93a199]"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id="sidebar-dataset-search"
          type="search"
          value={query}
          aria-keyshortcuts="Control+K Meta+K"
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (isOpen) {
                setIsOpen(false);
              } else {
                inputRef.current?.blur();
              }
              return;
            }
            if (!showResults || searchOutput.results.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((prev) => (prev + 1) % searchOutput.results.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex(
                (prev) => (prev - 1 + searchOutput.results.length) % searchOutput.results.length
              );
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const chosen = searchOutput.results[activeIndex] ?? searchOutput.results[0];
              if (chosen) {
                handleSelect(chosen);
              }
            }
          }}
          placeholder="Search dataset..."
          className={`w-full rounded-lg border border-white/15 bg-[#132019] py-2 pl-8 text-xs text-[#f3f5f4] placeholder:text-[#68776e] focus:border-violet-500/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-500 [&::-webkit-search-cancel-button]:hidden ${
            hasQuery ? 'pr-7' : 'pr-14'
          }`}
        />
        {hasQuery ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear dataset search"
            className="absolute right-2 rounded p-0.5 text-[#93a199] hover:text-white focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 rounded border border-white/12 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] leading-none text-[#93a199]"
          >
            {shortcutLabel}
          </kbd>
        )}
      </div>

      {showResults && (
        <div
          role="region"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-30 mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-[#0b130f]/95 p-1.5 shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-[#93a199]">
            <span>Matches across dataset</span>
            <span className="font-mono tabular-nums">{searchOutput.totalMatches} found</span>
          </div>

          {searchOutput.results.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-[#93a199]">
              No matching accounts, transactions, or alerts.
            </div>
          ) : (
            <div className="space-y-1">
              {searchOutput.results.map((item, idx) => {
                const Icon = KIND_ICONS[item.kind];
                const isHighlighted = idx === activeIndex;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(item)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-violet-500 ${
                      isHighlighted ? 'bg-violet-500/20' : 'hover:bg-violet-500/15'
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        item.kind === 'alert'
                          ? 'text-violet-400'
                          : item.linkedAlertId
                            ? 'text-[#4ade80]'
                            : 'text-[#e6dcc8]'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11.5px] font-semibold text-[#f3f5f4]">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-[#93a199]">
                          {KIND_LABELS[item.kind]}
                        </span>
                      </div>
                      <div className="truncate text-[10.5px] text-[#93a199]">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
