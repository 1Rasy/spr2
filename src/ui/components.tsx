import type { ReactNode } from 'react';

export function PageTitle({ children }: { children: ReactNode }) {
  return <div className="big-store-title">{children}</div>;
}

export function SearchBox({ value, placeholder, onChange, onClear }: { value: string; placeholder: string; onChange: (value: string) => void; onClear: () => void }) {
  return <div className="search-wrapper"><input value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />{value && <button className="search-clear-btn visible" onClick={onClear}>✕</button>}</div>;
}
