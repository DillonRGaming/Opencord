export class ContextMenu {
  static init() {
    this.menuElement = document.createElement('div');
    this.menuElement.className = 'context-menu';
    this.menuElement.style.cssText = `
      position: fixed;
      background: var(--bg-panel);
      border: 2px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 8px 16px rgba(0,0,0,0.1);
      display: none;
      z-index: 1000;
      min-width: 180px;
      padding: 8px;
    `;
    document.body.appendChild(this.menuElement);

    document.addEventListener('click', () => this.hide());
  }

  static show(x, y, items) {
    if (!this.menuElement) this.init();
    
    this.menuElement.innerHTML = items.map(item => `
      <div class="context-item" style="padding: 10px 12px; font-size: 14px; font-weight: 800; cursor: pointer; color: ${item.danger ? '#ff4b4b' : 'var(--text-primary)'}; border-radius: var(--radius-sm); transition: 0.1s; display: flex; align-items: center;">
        <i class="${item.icon}" style="margin-right: 12px; width: 16px; text-align: center;"></i>
        ${item.label}
      </div>
    `).join('');

    const itemEls = this.menuElement.querySelectorAll('.context-item');
    itemEls.forEach((el, idx) => {
      el.addEventListener('click', (e) => {
        items[idx].action();
      });
      el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
      el.addEventListener('mouseleave', () => el.style.background = 'transparent');
    });

    this.menuElement.style.display = 'block';
    
    let renderX = x;
    let renderY = y;
    if (x + this.menuElement.offsetWidth > window.innerWidth) {
      renderX = window.innerWidth - this.menuElement.offsetWidth - 8;
    }
    if (y + this.menuElement.offsetHeight > window.innerHeight) {
      renderY = window.innerHeight - this.menuElement.offsetHeight - 8;
    }

    this.menuElement.style.left = `${renderX}px`;
    this.menuElement.style.top = `${renderY}px`;
  }

  static hide() {
    if (this.menuElement) {
      this.menuElement.style.display = 'none';
    }
  }
}
