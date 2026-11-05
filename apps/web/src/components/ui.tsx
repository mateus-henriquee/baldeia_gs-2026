import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function Logo({ negative = false, height = 34 }: { negative?: boolean; height?: number }) {
  return (
    <img src={negative ? "/brand/baldeia-horizontal-negativo.svg" : "/brand/baldeia-horizontal.svg"} alt="Baldeia"
      height={height} style={{ height, width: "auto", display: "block", borderRadius: negative ? 6 : 0 }} />
  );
}

export type SourceKind = "oficial" | "comunidade" | "estimado" | "demo";
const SRC_LABEL: Record<SourceKind, string> = { oficial: "Dado oficial", comunidade: "Comunidade", estimado: "Estimado", demo: "Demonstração" };
export function Source({ kind, children }: { kind: SourceKind; children?: ReactNode }) {
  return <span className={`src src--${kind}`}>{children ?? SRC_LABEL[kind]}</span>;
}

export function Tip({ text, label = "Mais informações" }: { text: string; label?: string }) {
  const id = useId();
  return (
    <span className="tip">
      <button type="button" className="tip__btn" aria-describedby={id} aria-label={label}>?</button>
      <span role="tooltip" id={id} className="tip__bubble">{text}</span>
    </span>
  );
}

export function MetroRule({ stops = 5 }: { stops?: number }) {
  return (
    <div className="metro-rule" aria-hidden="true">
      {Array.from({ length: stops }, (_, i) => <span key={i} style={{ left: `calc(${(i / (stops - 1)) * 100}% - ${(i / (stops - 1)) * 15}px)` }} />)}
    </div>
  );
}

/** Visualização ampliável com zoom (roda/pinça/botões) e arraste. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setView((v) => ({ ...v, s: Math.min(6, v.s * 1.25) }));
      if (e.key === "-") setView((v) => ({ ...v, s: Math.max(0.2, v.s / 1.25) }));
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [onClose]);
  const fit = (img: HTMLImageElement) => {
    const el = stage.current!;
    const s = Math.min(el.clientWidth / img.naturalWidth, el.clientHeight / img.naturalHeight) * 0.96;
    setView({ s, x: (el.clientWidth - img.naturalWidth * s) / 2, y: (el.clientHeight - img.naturalHeight * s) / 2 });
  };
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt}>
      <div className="lightbox__bar">
        <strong>{alt}</strong>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn--small" onClick={() => setView((v) => ({ ...v, s: Math.max(0.2, v.s / 1.25) }))} aria-label="Diminuir zoom">−</button>
          <button className="btn btn--small" onClick={() => setView((v) => ({ ...v, s: Math.min(6, v.s * 1.25) }))} aria-label="Aumentar zoom">+</button>
          <a className="btn btn--small" href={src} download>Baixar SVG</a>
          <button ref={closeRef} className="btn btn--small btn--signal" onClick={onClose}>Fechar (Esc)</button>
        </div>
      </div>
      <div ref={stage} className="lightbox__stage"
        onWheel={(e) => {
          const rect = stage.current!.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          setView((v) => { const s = Math.min(6, Math.max(0.2, v.s * (e.deltaY < 0 ? 1.12 : 0.89)));
            return { s, x: mx - ((mx - v.x) * s) / v.s, y: my - ((my - v.y) * s) / v.s }; });
        }}
        onPointerDown={(e) => { drag.current = { x: e.clientX - view.x, y: e.clientY - view.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setView((v) => ({ ...v, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y })); }}
        onPointerUp={() => { drag.current = null; }}>
        <img src={src} alt={alt} onLoad={(e) => fit(e.currentTarget)} draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
      </div>
    </div>
  );
}

/** Barras de série única: sem legenda (o título nomeia a série), tooltip por barra e tabela acessível. */
export function Bars({ data, label, unit = "" }: { data: { x: string; y: number }[]; label: string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.y));
  return (
    <figure style={{ margin: 0 }}>
      <div className="bars" role="img" aria-label={label}>
        {data.map((d) => (
          <div key={d.x} className="bars__bar" tabIndex={0} data-tip={`${d.x}: ${d.y}${unit}`} style={{ height: `${(d.y / max) * 100}%` }} />
        ))}
      </div>
      <div className="bars__axis" aria-hidden="true">{data.map((d, i) => <span key={d.x}>{i % 2 === 0 || data.length < 12 ? d.x : ""}</span>)}</div>
      <details style={{ marginTop: 6 }}>
        <summary className="small muted">Ver tabela</summary>
        <table className="small" style={{ borderCollapse: "collapse" }}>
          <tbody>{data.map((d) => <tr key={d.x}><th style={{ textAlign: "left", paddingRight: 12, fontWeight: 500 }}>{d.x}</th><td>{d.y}{unit}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} — Baldeia`; }, [title]);
  return <header className="app-head"><h1 className="app-title">{title}</h1>{children}</header>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <div className="muted small">{children}</div>}</div>;
}

export function BackHome() {
  return <Link to="/" className="small">← Voltar ao início</Link>;
}
