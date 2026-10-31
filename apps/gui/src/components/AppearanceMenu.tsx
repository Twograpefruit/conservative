import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore.js';

export function AppearanceMenu() {
  const uiScale = useApp((s) => s.uiScale);
  const setUiScale = useApp((s) => s.setUiScale);
  const textScale = useApp((s) => s.textScale);
  const setTextScale = useApp((s) => s.setTextScale);
  const codeFontSize = useApp((s) => s.codeFontSize);
  const setCodeFontSize = useApp((s) => s.setCodeFontSize);
  const resetAppearance = useApp((s) => s.resetAppearance);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="appearance-menu" ref={wrap}>
      <button className="icon-btn toolbar-symbol" title="外观与字体" aria-label="外观与字体" onClick={() => setOpen((v) => !v)}>
        Aa
      </button>
      {open ? (
        <div className="appearance-popover">
          <div className="appearance-popover-head">
            <strong>外观</strong>
            <button
              className="btn btn-tiny"
              onClick={() => {
                resetAppearance();
                setOpen(false);
              }}
            >
              重置
            </button>
          </div>
          <label className="appearance-field">
            <span>界面大小</span>
            <input type="range" min={0.5} max={2.5} step={0.05} value={uiScale} onChange={(e) => setUiScale(Number(e.target.value))} />
            <input
              className="input scale-number"
              type="number"
              min={50}
              max={250}
              step={5}
              value={Math.round(uiScale * 100)}
              onChange={(e) => Number.isFinite(Number(e.target.value)) && setUiScale(Number(e.target.value) / 100)}
            />
            <span className="unit">%</span>
          </label>
          <label className="appearance-field">
            <span>文字大小</span>
            <input type="range" min={0.6} max={3} step={0.05} value={textScale} onChange={(e) => setTextScale(Number(e.target.value))} />
            <input
              className="input scale-number"
              type="number"
              min={60}
              max={300}
              step={5}
              value={Math.round(textScale * 100)}
              onChange={(e) => Number.isFinite(Number(e.target.value)) && setTextScale(Number(e.target.value) / 100)}
            />
            <span className="unit">%</span>
          </label>
          <label className="appearance-field">
            <span>代码大小</span>
            <input
              type="range"
              min={10}
              max={24}
              step={1}
              value={codeFontSize}
              onChange={(e) => setCodeFontSize(Number(e.target.value))}
            />
            <input
              className="input scale-number"
              type="number"
              min={10}
              max={24}
              step={1}
              value={codeFontSize}
              onChange={(e) => Number.isFinite(Number(e.target.value)) && setCodeFontSize(Number(e.target.value))}
            />
            <span className="unit">px</span>
          </label>
          <div className="muted small">更完整的字体与主题设置在“设置 → 外观与字体”。</div>
        </div>
      ) : null}
    </div>
  );
}
