// Captured translucent DOM command palette inside `<Surface.HTML>` (`FrontierCmdk.tsx`).

import type { FormEvent, KeyboardEvent, Ref } from 'react'
import { CMDK_LENSES, type CmdkLensId } from './frontierCmdkNodes'

export type CmdIconKind = 'prism' | 'quartz' | 'folio' | 'sun' | 'note'

export interface CommandItem {
  readonly id: string
  readonly icon: CmdIconKind
  readonly label: string
  readonly meta: string
  readonly keyGlyph: string
}

export const CMDK_COMMANDS: readonly CommandItem[] = [
  {
    id: 'lens-flint',
    icon: 'prism',
    label: 'Switch lens to Flint Prism',
    meta: 'n = 1.68 dispersion',
    keyGlyph: 'P',
  },
  {
    id: 'lens-smoked',
    icon: 'quartz',
    label: 'Switch lens to Smoked Quartz',
    meta: 'Obsidian ND crystal',
    keyGlyph: 'D',
  },
  {
    id: 'toggle-ground',
    icon: 'folio',
    label: 'Toggle Dark Studio & Editorial Folio',
    meta: 'Scene-borrowed rim',
    keyGlyph: 'G',
  },
  {
    id: 'sweep-lamp',
    icon: 'sun',
    label: 'Sweep studio keylight across bezel',
    meta: 'Specular arc',
    keyGlyph: 'L',
  },
  {
    id: 'insert-note',
    icon: 'note',
    label: 'Append live note to HTML folio below',
    meta: 'Mutates native DOM',
    keyGlyph: 'N',
  },
]

function CommandIcon({ kind }: { readonly kind: CmdIconKind }) {
  switch (kind) {
    case 'prism':
      return (
        <svg className="cmdk-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2.2 13.8 13H2.2L8 2.2Z" />
          <path d="M8 7.5 13.5 10" />
        </svg>
      )
    case 'quartz':
      return (
        <svg className="cmdk-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="3.2" />
          <path d="M5.2 10.8 10.8 5.2" />
        </svg>
      )
    case 'folio':
      return (
        <svg className="cmdk-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M6 3v10M10 3v10" />
        </svg>
      )
    case 'sun':
      return (
        <svg className="cmdk-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="2.8" />
          <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.15 1.15M11.25 11.25l1.15 1.15M12.4 3.6l-1.15 1.15M4.75 11.25l-1.15 1.15" />
        </svg>
      )
    case 'note':
      return (
        <svg className="cmdk-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4h10M3 8h7M3 12h5" />
          <path d="M11.5 9.5v4M9.5 11.5h4" />
        </svg>
      )
  }
}

export function FrontierCmdkDialog({
  dialogRef,
  listRef,
  inputId,
  listboxId,
  open,
  supported,
  lens,
  docTheme,
  dragHover,
  query,
  activeIdx,
  filtered,
  onChangeQuery,
  onInputKeyDown,
  onFormSubmit,
  onClose,
  onHoverIdx,
  onExecuteIdx,
}: {
  readonly dialogRef: Ref<HTMLDialogElement>
  readonly listRef: Ref<HTMLUListElement>
  readonly inputId: string
  readonly listboxId: string
  readonly open: boolean
  readonly supported: boolean
  readonly lens: CmdkLensId
  readonly docTheme: 'folio' | 'studio'
  readonly dragHover: boolean
  readonly query: string
  readonly activeIdx: number
  readonly filtered: readonly CommandItem[]
  readonly onChangeQuery: (next: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  readonly onFormSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onClose: () => void
  readonly onHoverIdx: (idx: number) => void
  readonly onExecuteIdx: (idx: number, item: CommandItem) => void
}) {
  const activeItem = filtered[activeIdx]
  const activeOptionId = activeItem ? `${listboxId}-${activeItem.id}` : undefined
  const rootClass = [
    'cmdk-root',
    lens === 'smoked' ? 'cmdk-root--smoked' : '',
    !supported ? 'cmdk-root--fallback' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const isEngaged = (id: string): boolean => {
    if (id === 'lens-flint') return lens === 'flint'
    if (id === 'lens-smoked') return lens === 'smoked'
    if (id === 'toggle-ground') return docTheme === 'studio'
    return false
  }

  return (
    <div className={rootClass}>
      <dialog ref={dialogRef} className="cmdk-dialog" aria-label="Optical command palette">
        <div className="cmdk-drag-zone" aria-hidden="true">
          <span className={dragHover ? 'cmdk-drag-pill cmdk-drag-pill--hover' : 'cmdk-drag-pill'} />
        </div>

        <form className="cmdk-search-row" onSubmit={onFormSubmit}>
          <span className="cmdk-search-icon-col" aria-hidden="true">
            <svg
              className="cmdk-search-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="4.6" />
              <path d="m10.5 10.5 3.3 3.3" />
            </svg>
          </span>

          <label htmlFor={inputId} className="frontier-sr-only">
            Search commands
          </label>
          <input
            id={inputId}
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            className="cmdk-input"
            placeholder="Search optical lenses, grounds, or actions…"
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />

          {query.trim().length > 0 && (
            <span className="cmdk-match-count">{filtered.length} found</span>
          )}

          <button
            type="button"
            className="cmdk-esc-btn"
            aria-label="Close command palette"
            onClick={onClose}
          >
            ESC
          </button>
        </form>

        <ul
          ref={listRef}
          id={listboxId}
          className="cmdk-list"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <li role="option" aria-selected={false} aria-disabled="true" className="cmdk-empty">
              No matching commands for “{query}”
            </li>
          ) : (
            filtered.map((item, idx) => {
              const selected = idx === activeIdx
              const engaged = isEngaged(item.id)
              return (
                <li
                  key={item.id}
                  id={`${listboxId}-${item.id}`}
                  role="option"
                  aria-selected={selected}
                  className="cmdk-option"
                  data-selected={selected || undefined}
                  onPointerEnter={() => onHoverIdx(idx)}
                  onClick={() => onExecuteIdx(idx, item)}
                >
                  <span className="cmdk-icon-tile">
                    <CommandIcon kind={item.icon} />
                  </span>
                  <span className="cmdk-opt-label">{item.label}</span>
                  <span className="cmdk-opt-meta">
                    {engaged && <span className="cmdk-active-pip" aria-hidden="true" />}
                    <span>{item.meta}</span>
                  </span>
                  <kbd className="cmdk-kbd">
                    <span>⌘</span>
                    <span>{item.keyGlyph}</span>
                  </kbd>
                </li>
              )
            })
          )}
        </ul>

        <footer className="cmdk-footer">
          <span className="cmdk-footer-spec">
            <span className="cmdk-spec-dot" aria-hidden="true" />
            <span>{CMDK_LENSES[lens].specReadout}</span>
          </span>
          <span className="cmdk-footer-hints">
            <span>↑↓ Select</span>
            <span aria-hidden="true">·</span>
            <span>↵ Run</span>
            <span aria-hidden="true">·</span>
            <span>Drag top bar</span>
          </span>
        </footer>
      </dialog>
    </div>
  )
}
