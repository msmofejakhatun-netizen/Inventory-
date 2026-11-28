import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Package, Search, X } from 'lucide-react';
import { Item } from '../../types';
import {
  formatQty,
  getEffectiveItemWacRate,
  searchInventoryItemsForIssue,
} from '../../utils/issueManagement';

interface SearchableItemSelectorProps {
  items: Item[];
  loading?: boolean;
  selectedItemId: string;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  addedItemIds?: Set<string>;
  currencySymbol: string;
  onSelectItem: (item: Item | null) => void;
}

export const SearchableItemSelector: React.FC<SearchableItemSelectorProps> = ({
  items,
  loading = false,
  selectedItemId,
  searchQuery,
  onSearchQueryChange,
  addedItemIds,
  currencySymbol,
  onSelectItem,
}) => {
  const [internalQuery, setInternalQuery] = useState('');
  const isControlledQuery = typeof searchQuery === 'string' && typeof onSearchQueryChange === 'function';
  const query = isControlledQuery ? searchQuery : internalQuery;
  const setQuery = (next: string) => {
    if (isControlledQuery) {
      onSearchQueryChange(next);
    } else {
      setInternalQuery(next);
    }
  };

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) || null,
    [items, selectedItemId]
  );

  // For uncontrolled mode only: sync input display when parent clears selection
  useEffect(() => {
    if (!isControlledQuery && !selectedItemId) {
      setInternalQuery('');
    }
  }, [selectedItemId, isControlledQuery]);

  // Close dropdown on outside tap/click
  useEffect(() => {
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

  const filteredItems = useMemo(
    () => searchInventoryItemsForIssue(items, query),
    [items, query]
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, filteredItems.length]);

  const handleChoose = (item: Item) => {
    onSelectItem(item);
    setQuery(item.name);
    setIsOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    onSelectItem(null);
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setIsOpen(true);
      return;
    }
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[highlightedIndex]) {
        handleChoose(filteredItems[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
    }
  };

  const selectedWac = selectedItem ? getEffectiveItemWacRate(selectedItem) : 0;

  return (
    <div ref={containerRef} className="space-y-2.5">
      <div className="relative">
        <label
          htmlFor="issue-item-search-input"
          className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider mb-1.5"
        >
          Search Inventory Item *
        </label>

        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            id="issue-item-search-input"
            type="text"
            autoComplete="off"
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls="issue-item-search-listbox"
            placeholder="Type item name (e.g. Tadka Mirch, Onion, Paper Napkin)..."
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              setIsOpen(true);
              if (selectedItem && next.trim().toLowerCase() !== selectedItem.name.trim().toLowerCase()) {
                onSelectItem(null);
              }
            }}
            onKeyDown={handleKeyDown}
            className="w-full pl-9 pr-10 py-2.5 text-sm sm:text-xs font-medium text-stone-900 border border-stone-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/25 focus:border-[#FF5A1F]"
          />

          {loading ? (
            <Loader2 className="w-4 h-4 text-[#FF5A1F] animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
          ) : query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={handleClear}
              className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {/* Search Results Dropdown */}
        {isOpen && (
          <div
            id="issue-item-search-listbox"
            role="listbox"
            className="absolute left-0 right-0 z-30 mt-1.5 max-h-64 overflow-y-auto rounded-xl bg-white border border-stone-200 shadow-xl divide-y divide-stone-100"
          >
            {loading ? (
              <div className="py-6 px-4 flex items-center justify-center gap-2 text-xs text-stone-500">
                <Loader2 className="w-4 h-4 animate-spin text-[#FF5A1F]" />
                <span>Loading inventory items...</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-stone-500">
                <Package className="w-5 h-5 mx-auto text-stone-300 mb-1.5" />
                <p className="font-semibold text-stone-700">No items found</p>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  Try a different spelling or partial item name.
                </p>
              </div>
            ) : (
              filteredItems.map((item, idx) => {
                const isSelected = item.id === selectedItemId;
                const isAlreadyInCart = Boolean(addedItemIds?.has(item.id));
                const isOutOfStock = Number(item.currentStock || 0) <= 0;
                const isHighlighted = idx === highlightedIndex;

                return (
                  <button
                    key={item.id}
                    id={`issue-search-option-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => handleChoose(item)}
                    className={`w-full text-left px-3.5 py-3 sm:py-2.5 flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-[#0D2149]/5'
                        : isHighlighted
                        ? 'bg-stone-50'
                        : 'bg-white hover:bg-stone-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-stone-900 truncate">
                          {item.name}
                        </span>
                        {isAlreadyInCart && (
                          <span className="px-1.5 py-0.5 rounded bg-[#FF5A1F]/10 text-[#FF5A1F] text-[10px] font-bold">
                            In Session
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        Available:{' '}
                        <span
                          className={`font-mono font-bold ${
                            isOutOfStock ? 'text-rose-600' : 'text-[#0D2149]'
                          }`}
                        >
                          {formatQty(item.currentStock || 0)} {item.unit}
                        </span>
                        {item.category ? ` • ${item.category}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isOutOfStock
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {formatQty(item.currentStock || 0)} {item.unit}
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-[#0D2149]" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Selected Item Live Stock, UOM, and Weighted Average Cost Panel */}
      {selectedItem && (
        <div
          id="selected-issue-item-details"
          className="rounded-xl border border-[#0D2149]/15 bg-[#0D2149]/[0.03] p-3 grid grid-cols-3 gap-2 text-xs"
        >
          <div>
            <span className="text-[10px] uppercase font-bold text-stone-400 block">
              Available Stock
            </span>
            <span
              className={`font-mono font-extrabold text-sm mt-0.5 block ${
                Number(selectedItem.currentStock || 0) <= 0 ? 'text-rose-600' : 'text-[#0D2149]'
              }`}
            >
              {formatQty(selectedItem.currentStock || 0)} {selectedItem.unit}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-stone-400 block">
              Unit of Measure
            </span>
            <span className="font-bold text-stone-800 text-sm mt-0.5 block">
              {selectedItem.unit}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-stone-400 block">
              Weighted Avg Cost
            </span>
            <span className="font-mono font-bold text-stone-900 text-sm mt-0.5 block">
              {currencySymbol}
              {selectedWac.toFixed(2)} / {selectedItem.unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
