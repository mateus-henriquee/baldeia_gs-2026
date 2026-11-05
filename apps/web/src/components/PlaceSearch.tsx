import { useEffect, useId, useState } from "react";
import { api, type Place } from "../lib/api";
import { useDebounced } from "../lib/hooks";
import { MODE_LABEL } from "../lib/format";

/** Combobox acessível (ARIA 1.2) de estações e pontos. */
export function PlaceSearch({ label, value, onChange, placeholder, quick }: {
  label: string; value: Place | null; onChange: (p: Place | null) => void; placeholder?: string;
  quick?: { label: string; place: Place }[];
}) {
  const id = useId();
  const [q, setQ] = useState(value?.nome ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState("");
  const dq = useDebounced(q, 200);

  useEffect(() => { setQ(value?.nome ?? ""); }, [value]);
  useEffect(() => {
    if (!open || dq.trim().length < 2 || dq === value?.nome) { setItems([]); return; }
    const ctrl = new AbortController();
    api<{ locais: Place[] }>(`/public/places?q=${encodeURIComponent(dq)}`, { signal: ctrl.signal })
      .then((r) => { setItems(r.locais); setActive(0); setErr(""); })
      .catch((e) => { if (e.name !== "AbortError") setErr("Busca indisponível (API offline?)"); });
    return () => ctrl.abort();
  }, [dq, open, value]);

  const choose = (p: Place) => { onChange(p); setQ(p.nome); setOpen(false); };
  return (
    <div className="field place-search">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: "relative" }}>
        <input id={id} className="input" role="combobox" aria-expanded={open && items.length > 0} aria-controls={`${id}-list`}
          aria-autocomplete="list" aria-activedescendant={open && items[active] ? `${id}-o${active}` : undefined}
          value={q} placeholder={placeholder ?? "Digite uma estação ou endereço do ponto"} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onChange(null); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter" && open && items[active]) { e.preventDefault(); choose(items[active]); }
            if (e.key === "Escape") setOpen(false);
          }} />
        {open && items.length > 0 && (
          <ul id={`${id}-list`} role="listbox" className="combo-list">
            {items.map((p, i) => (
              <li key={p.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setActive(i)}>
                <span className={`combo-dot combo-dot--${p.tipo}`} aria-hidden="true" />
                <span><strong>{p.nome}</strong><br /><small className="muted">{p.tipo === "estacao" ? "Estação" : "Ponto de ônibus"} · {p.modos.map((m) => MODE_LABEL[m] ?? m).join(", ")}</small></span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err && <span className="error">{err}</span>}
      {quick && quick.length > 0 && (
        <div className="chips" aria-label={`Atalhos para ${label.toLowerCase()}`}>
          {quick.map((f) => <button key={f.label} type="button" className="chip" onClick={() => choose(f.place)}>{f.label}</button>)}
        </div>
      )}
    </div>
  );
}
