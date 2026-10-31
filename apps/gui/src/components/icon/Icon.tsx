import React from 'react';
import { iconSpriteData } from './sprite.js';
import type { IconName } from './icons.js';

const SPRITE_ID = 'conser-icon-sprite';
let injected = false;

function ensureSymbol(name: IconName): void {
  if (typeof document === 'undefined') return;
  if (!injected) {
    let sprite = document.getElementById(SPRITE_ID) as SVGSVGElement | null;
    if (!sprite) {
      const created = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      created.id = SPRITE_ID;
      created.setAttribute('aria-hidden', 'true');
      created.style.display = 'none';
      created.innerHTML = Object.entries(iconSpriteData)
        .map(([key, content]) => `<symbol id="con-${key}" viewBox="0 0 24 24">${content}</symbol>`)
        .join('');
      document.body.insertBefore(created, document.body.firstChild);
      sprite = created;
    }
    injected = true;
  }
  const sprite = document.getElementById(SPRITE_ID) as SVGSVGElement | null;
  if (!sprite || document.getElementById(`con-${name}`)) return;
  const content = iconSpriteData[name];
  if (typeof content !== 'string') return;
  const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
  symbol.id = `con-${name}`;
  symbol.setAttribute('viewBox', '0 0 24 24');
  symbol.innerHTML = content;
  sprite.appendChild(symbol);
}

export function Icon({
  name,
  className = '',
  size,
  ...rest
}: React.ComponentPropsWithoutRef<'svg'> & { name: IconName; size?: number }) {
  ensureSymbol(name);
  return (
    <svg
      viewBox="0 0 24 24"
      className={`oc-icon ${className}`.trim()}
      width={size}
      height={size}
      aria-hidden="true"
      {...rest}
    >
      <use href={`#con-${name}`} />
    </svg>
  );
}
