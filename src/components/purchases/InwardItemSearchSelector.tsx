import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Loader2, Package, Search, X } from 'lucide-react';
import { Item } from '../../types';
import {
  formatInwardItemOptionLabel,
  getEffectiveCurrentItemRate,
  searchActiveInventoryItems,
} from '../../utils/inwardItemSearch';

interface InwardItemSearchSelectorProps {
  rowId: string;
  items: Item[];
  loading?: boolean;
  selectedItemId: string;
  duplicateItemIds: ReadonlySet<string>;
  currencySymbol: string;
  onSelectItem: (rowId: string, item: Item | null) => void;
}

interface DropdownCoords {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: 'bottom' | 'top';
}

const MAX_RENDERED_DROPDOWN_ROWS = 200;

export const InwardItemSearchSelector: React.FC<InwardItemSearchSelectorProps> = React.memo(
  ({
    rowId,
    items,
    loading = false,
    selectedItemId,
    duplicateItemIds,
    currencySymbol,
    onSelectItem,
  }) => {
    const selectedItem = useMemo(
      () => items.find((i) => i.id === selectedItemId) || null,
      [items, selectedItemId]
    );

    const [isOpen, setIsOpen] = useState(false);
    const [searchText, setSearchText] = useState(() =>
      selectedItem ? formatInwardItemOptionLabel(selectedItem) : ''
    );
    const [isEditingQuery, setIsEditingQuery] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
    const [dropdownCoords, setDropdownCoords] = useState<DropdownCoords | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const inputWrapperRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    // Sync visible input text when selectedItem changes externally (while not actively typing)
    useEffect(() => {
      if (!isEditingQuery) {
        setSearchText(selectedItem ? formatInwardItemOptionLabel(selectedItem) : '');
      }
    }, [selectedItem, isEditingQuery]);

    // Determine effective query: if dropdown just opened on an already-selected item and user hasn't typed yet, show all items
    const activeQuery = isEditingQuery ? searchText : '';

    // Filter across ALL active inventory items (no category restriction, no truncation before search)
    const matchingItems = useMemo(
      () => searchActiveInventoryItems(items, activeQuery),
      [items, activeQuery]
    );

    const visibleItems = useMemo(
      () =>
        matchingItems.length > MAX_RENDERED_DROPDOWN_ROWS
          ? matchingItems.slice(0, MAX_RENDERED_DROPDOWN_ROWS)
          : matchingItems,
      [matchingItems]
    );

    useEffect(() => {
      setHighlightedIndex(0);
    }, [activeQuery, visibleItems.length]);

    // Compute portal position above or below input based on live visual viewport (handles Android keyboard & modal scroll)
    const updateDropdownPosition = useCallback(() => {
      const anchor = inputWrapperRef.current;
      if (!anchor || typeof window === 'undefined') return;

      const rect = anchor.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewportHeight = vv ? vv.height : window.innerHeight;
      const viewportTop = vv ? vv.offsetTop : 0;
      const viewportWidth = vv ? vv.width : window.innerWidth;

      const spaceBelow = viewportTop + viewportHeight - rect.bottom;
      const spaceAbove = rect.top - viewportTop;

      const preferredMax = 260;
      const minComfortHeight = 170;
      const openAbove = spaceBelow < minComfortHeight && spaceAbove > spaceBelow;

      const horizontalPadding = 8;
      const width = Math.min(Math.max(rect.width, 260), viewportWidth - horizontalPadding * 2);
      const clampedLeft = Math.min(
        Math.max(horizontalPadding, rect.left),
        Math.max(horizontalPadding, viewportWidth - width - horizontalPadding)
      );

      if (openAbove) {
        const maxHeight = Math.max(120, Math.min(preferredMax, spaceAbove - 12));
        setDropdownCoords({
          left: clampedLeft,
          width,
          bottom: window.innerHeight - rect.top + 6,
          maxHeight,
          placement: 'top',
        });
      } else {
        const maxHeight = Math.max(120, Math.min(preferredMax, spaceBelow - 12));
        setDropdownCoords({
          left: clampedLeft,
          width,
          top: rect.bottom + 6,
          maxHeight,
          placement: 'bottom',
        });
      }
    }, []);

    useLayoutEffect(() => {
      if (!isOpen) return;
      updateDropdownPosition();
    }, [isOpen, updateDropdownPosition, visibleItems.length]);

    // Reposition smoothly on scroll (including modal internal scroll), resize, and Android virtual keyboard changes
    useEffect(() => {
      if (!isOpen) return;

      const handleReposition = () => updateDropdownPosition();
      window.addEventListener('scroll', handleReposition, true);
      window.addEventListener('resize', handleReposition);
      window.visualViewport?.addEventListener('resize', handleReposition);
      window.visualViewport?.addEventListener('scroll', handleReposition);

      return () => {
        window.removeEventListener('scroll', handleReposition, true);
        window.removeEventListener('resize', handleReposition);
        window.visualViewport?.removeEventListener('resize', handleReposition);
        window.visualViewport?.removeEventListener('scroll', handleReposition);
      };
    }, [isOpen, updateDropdownPosition]);

    // Close dropdown on outside click/tap (checking both input container and portal dropdown)
    useEffect(() => {
      if (!isOpen) return;

      const handleOutside = (event: MouseEvent | TouchEvent) => {
        const target = event.target as Node | null;
        if (!target) return;
        if (containerRef.current?.contains(target)) return;
        if (dropdownRef.current?.contains(target)) return;

        setIsOpen(false);
        setIsEditingQuery(false);
        setDuplicateNotice(null);
        setSearchText(selectedItem ? formatInwardItemOptionLabel(selectedItem) : '');
      };

      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('touchstart', handleOutside, { passive: true });
      return () => {
        document.removeEventListener('mousedown', handleOutside);
        document.removeEventListener('touchstart', handleOutside);
      };
    }, [isOpen, selectedItem]);

    // Intercept Escape in capture phase while open so it closes ONLY the dropdown (never closes the modal)
    useEffect(() => {
      if (!isOpen) return;

      const handleEscapeCapture = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          setIsOpen(false);
          setIsEditingQuery(false);
          setDuplicateNotice(null);
          setSearchText(selectedItem ? formatInwardItemOptionLabel(selectedItem) : '');
        }
      };

      window.addEventListener('keydown', handleEscapeCapture, true);
      return () => {
        window.removeEventListener('keydown', handleEscapeCapture, true);
      };
    }, [isOpen, selectedItem]);

    const handleChooseItem = (item: Item) => {
      if (duplicateItemIds.has(item.id) && item.id !== selectedItemId) {
        setDuplicateNotice(
          `${formatInwardItemOptionLabel(item)} is already added in another row. Edit its quantity in that row instead.`
        );
        return;
      }
      setDuplicateNotice(null);
      setIsEditingQuery(false);
      setSearchText(formatInwardItemOptionLabel(item));
      setIsOpen(false);
      onSelectItem(rowId, item);
    };

    const handleClear = () => {
      setDuplicateNotice(null);
      setSearchText('');
      setIsEditingQuery(true);
      onSelectItem(rowId, null);
      setIsOpen(true);
      inputRef.current?.focus();
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // Never allow Enter inside item search to submit or reset the Inward Purchase form
        e.preventDefault();
        e.stopPropagation();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }
        const candidate = visibleItems[highlightedIndex];
        if (candidate) {
          handleChooseItem(candidate);
        }
        return;
      }

      if (!isOpen && e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
        return;
      }

      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1 < visibleItems.length ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Tab') {
        setIsOpen(false);
        setIsEditingQuery(false);
        setSearchText(selectedItem ? formatInwardItemOptionLabel(selectedItem) : '');
      }
    };

    const listboxId = `inward-item-listbox-${rowId}`;
    const inputId = `inward-item-search-${rowId}`;

    const dropdownNode =
      isOpen && dropdownCoords && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={dropdownRef}
              id={listboxId}
              role="listbox"
              aria-label="Inventory items"
              style={{
                position: 'fixed',
                left: `${dropdownCoords.left}px`,
                width: `${dropdownCoords.width}px`,
                ...(dropdownCoords.placement === 'top'
                  ? { bottom: `${dropdownCoords.bottom}px` }
                  : { top: `${dropdownCoords.top}px` }),
                maxHeight: `${dropdownCoords.maxHeight}px`,
              }}
              className="z-[90] overflow-y-auto overscroll-contain rounded-xl bg-white border border-stone-200 shadow-2xl ring-1 ring-black/5 divide-y divide-stone-100"
            >
              {duplicateNotice && (
                <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] font-semibold text-amber-900 flex items-start gap-1.5 sticky top-0 z-10">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>{duplicateNotice}</span>
                </div>
              )}

              {loading ? (
                <div className="py-6 px-4 flex items-center justify-center gap-2 text-xs text-stone-500">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                  <span>Loading inventory items...</span>
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="py-6 px-4 text-center text-xs text-stone-500">
                  <Package className="w-5 h-5 mx-auto text-stone-300 mb-1.5" />
                  <p className="font-semibold text-stone-700">No items found</p>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Try another spelling or partial item name.
                  </p>
                </div>
              ) : (
                <>
                  {visibleItems.map((item, idx) => {
                    const isSelected = item.id === selectedItemId;
                    const isDuplicate = duplicateItemIds.has(item.id) && !isSelected;
                    const isHighlighted = idx === highlightedIndex;
                    const currentRate = getEffectiveCurrentItemRate(item);

                    return (
                      <button
                        key={item.id}
                        id={`inward-search-option-${rowId}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={isDuplicate}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        onClick={() => handleChooseItem(item)}
                        className={`w-full text-left px-3.5 py-3 sm:py-2.5 flex items-center justify-between gap-2.5 transition-colors ${
                          isDuplicate
                            ? 'bg-stone-50/80 text-stone-400 cursor-not-allowed'
                            : isSelected
                            ? 'bg-amber-50/80 text-stone-900'
                            : isHighlighted
                            ? 'bg-stone-50 text-stone-900'
                            : 'bg-white hover:bg-stone-50 text-stone-900'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-sm sm:text-xs font-bold truncate ${
                                isDuplicate ? 'text-stone-400' : 'text-stone-900'
                              }`}
                            >
                              {formatInwardItemOptionLabel(item)}
                            </span>
                            {isDuplicate && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                Already added
                              </span>
                            )}
                          </div>
                          {(item.category || currentRate > 0) && (
                            <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                              {item.category || 'Inventory'}
                              {currentRate > 0
                                ? ` · Current rate: ${currencySymbol}${currentRate.toFixed(2)}/${item.unit}`
                                : ''}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-mono text-[10px] font-bold uppercase">
                            {item.unit}
                          </span>
                          {isSelected && <Check className="w-4 h-4 text-amber-600" />}
                        </div>
                      </button>
                    );
                  })}

                  {matchingItems.length > MAX_RENDERED_DROPDOWN_ROWS && (
                    <div className="px-3.5 py-2 bg-stone-50 text-[11px] text-stone-500 text-center">
                      Showing {MAX_RENDERED_DROPDOWN_ROWS} of {matchingItems.length} active items — type to filter all items
                    </div>
                  )}
                </>
              )}
            </div>,
            document.body
          )
        : null;

    return (
      <div ref={containerRef} className="w-full">
        <div ref={inputWrapperRef} className="relative">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls={listboxId}
            placeholder="Search item (e.g. Rice, Oil, Paper Napkin)..."
            value={searchText}
            onFocus={() => {
              setIsOpen(true);
              setDuplicateNotice(null);
            }}
            onClick={() => {
              setIsOpen(true);
              setDuplicateNotice(null);
            }}
            onChange={(e) => {
              const nextVal = e.target.value;
              setSearchText(nextVal);
              setIsEditingQuery(true);
              setDuplicateNotice(null);
              setIsOpen(true);
              if (
                selectedItem &&
                nextVal.trim().toLowerCase() !==
                  formatInwardItemOptionLabel(selectedItem).toLowerCase() &&
                nextVal.trim().toLowerCase() !== selectedItem.name.trim().toLowerCase()
              ) {
                onSelectItem(rowId, null);
              }
            }}
            onKeyDown={handleInputKeyDown}
            className={`w-full min-h-[42px] sm:min-h-[34px] pl-8 pr-8 py-1.5 text-base sm:text-xs font-medium rounded-lg border bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 ${
              selectedItem ? 'border-stone-300' : 'border-amber-300'
            }`}
          />

          {loading ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          ) : searchText ? (
            <button
              type="button"
              aria-label="Clear item search"
              onClick={handleClear}
              className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 absolute right-1.5 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>

        {dropdownNode}
      </div>
    );
  }
);

InwardItemSearchSelector.displayName = 'InwardItemSearchSelector';
