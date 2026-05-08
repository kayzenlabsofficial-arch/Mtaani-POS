import React from 'react';

export type SearchableSelectOption<T extends string = string> = {
  value: T;
  label: string;
  keywords?: string; // optional extra searchable text
  disabled?: boolean;
};

type Size = 'sm' | 'md';

export function SearchableSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No matches found',
  disabled,
  required,
  className = '',
  buttonClassName = '',
  valueTextClassName = '',
  placeholderTextClassName = '',
  searchInputClassName = '',
  menuClassName = '',
  maxResults = 60,
  size = 'md',
  id,
  name,
  autoFocus,
}: {
  value: T | '';
  onChange: (value: T | '') => void;
  options: SearchableSelectOption<T>[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  buttonClassName?: string;
  valueTextClassName?: string;
  placeholderTextClassName?: string;
  searchInputClassName?: string;
  menuClassName?: string;
  maxResults?: number;
  size?: Size;
  id?: string;
  name?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const listId = React.useId();

  const selected = React.useMemo(
    () => options.find(o => o.value === value) || null,
    [options, value]
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = React.useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter(o => {
      const hay = `${o.label} ${o.keywords || ''}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [options, normalizedQuery]);

  const visible = React.useMemo(() => filtered.slice(0, maxResults), [filtered, maxResults]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  React.useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [close]);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const selectValue = React.useCallback(
    (v: T | '') => {
      onChange(v);
      close();
      buttonRef.current?.focus();
    },
    [close, onChange]
  );

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(0, visible.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const opt = visible[activeIndex];
      if (opt && !opt.disabled) selectValue(opt.value);
      return;
    }
    if (e.key === 'Tab') {
      close();
      return;
    }
  };

  const baseButton =
    size === 'sm'
      ? 'rounded-xl px-4 py-2.5 text-[11px]'
      : 'rounded-xl px-4 py-3 text-sm';

  const baseInput =
    size === 'sm'
      ? 'rounded-lg px-3 py-2 text-[11px]'
      : 'rounded-lg px-3 py-2 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Hidden native input so forms still submit value */}
      <input type="hidden" id={id} name={name} value={value} required={required} />

      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`w-full bg-slate-50 border border-slate-200 ${baseButton} font-semibold text-left focus:outline-none focus:border-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${buttonClassName}`}
      >
        <span
          className={
            selected
              ? `text-slate-900 ${valueTextClassName}`
              : `text-slate-400 ${placeholderTextClassName}`
          }
        >
          {selected ? selected.label : placeholder}
        </span>
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden ${menuClassName}`}
        >
          <div className="p-2 border-b border-slate-100 bg-white">
            <input
              ref={inputRef}
              autoFocus={autoFocus}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={searchPlaceholder}
              className={`w-full border border-slate-200 bg-slate-50 ${baseInput} font-semibold focus:outline-none focus:border-blue-500 ${searchInputClassName}`}
            />
          </div>

          <div
            id={listId}
            role="listbox"
            aria-activedescendant={visible[activeIndex]?.value ? `${listId}-${visible[activeIndex]!.value}` : undefined}
            className="max-h-56 overflow-y-auto"
          >
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              onClick={() => selectValue('')}
              className={`w-full text-left px-3 py-2 text-sm font-semibold border-b border-slate-50 hover:bg-slate-50 ${
                value === '' ? 'text-blue-700 bg-blue-50/40' : 'text-slate-500'
              }`}
            >
              {placeholder}
            </button>

            {visible.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-400 italic">{emptyText}</div>
            ) : (
              visible.map((opt, idx) => {
                const isActive = idx === activeIndex;
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    id={`${listId}-${opt.value}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={!!opt.disabled}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => !opt.disabled && selectValue(opt.value)}
                    className={`w-full text-left px-3 py-2 text-sm font-semibold border-b border-slate-50 ${
                      opt.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'
                    } ${isActive ? 'bg-slate-50' : ''} ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}
                  >
                    {opt.label}
                  </button>
                );
              })
            )}

            {filtered.length > maxResults && (
              <div className="px-3 py-2 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100">
                Showing first {maxResults} results. Refine your search to narrow down.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

