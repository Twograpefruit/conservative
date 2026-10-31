import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore.js';

export function AppearanceMenu() {
  const uiScale = useApp((s) => s.uiScale);
  const setUiScale = useApp((s) => s.setUiScale);
  const textScale = useApp((s) => s.textScale);
  const setTextScale = useApp((s) => s.setTextScale);
  const codeFontSize = useApp((s) => s.codeFontSize);
  const setCodeFontSize = useApp((s) => s.setCodeFontSize);
  const locale = useApp((s) => s.locale);
  const customLocale = useApp((s) => s.customLocale);
  const setLocale = useApp((s) => s.setLocale);
  const languageFile = useRef<HTMLInputElement | null>(null);
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
          <div className="appearance-language">
            <span>语言</span>
            <select className="input" value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
              {customLocale ? <option value="custom">{customLocale.label}</option> : null}
            </select>
            <button className="btn btn-small" onClick={() => languageFile.current?.click()}>
              加载语言文件
            </button>
            <input
              ref={languageFile}
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const data = JSON.parse(await file.text()) as { label?: string; strings?: Record<string, string> };
                  if (!data.strings || typeof data.strings !== 'object') throw new Error('缺少 strings 对象');
                  setLocale('custom', { label: data.label || file.name.replace(/\.json$/i, ''), strings: data.strings });
                } catch (err) {
                  alert(err instanceof Error ? err.message : '语言文件格式错误');
                }
              }}
            />
          </div>
          <div className="muted small">更完整的字体与主题设置在“设置 → 外观与字体”。</div>
        </div>
      ) : null}
    </div>
  );
}
