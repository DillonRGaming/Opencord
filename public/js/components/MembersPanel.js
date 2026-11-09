import { stateStore } from '../Store.js';

export class MembersPanel {
  constructor(container) {
    this.container = container; 
  }
  
  render() {
    this.container.innerHTML = `
      <div class="chat-header">
        <h4 style="margin:0; font-size: 14px; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Members</h4>
      </div>
      <div id="members-list" style="flex:1; overflow-y: auto; padding: 16px;">
        <div class="sidebar-cat" style="padding: 0; margin-bottom: 8px;">
          <div class="sidebar-cat-left">
            <span class="sidebar-cat-name" style="font-size: 12px;">ONLINE - 1</span>
          </div>
        </div>
        <div class="channel-item" style="padding: 8px; margin-bottom: 2px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--accent-color); color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0;">U</div>
          <div style="font-weight: 700; font-size: 15px; color: var(--text-primary);" id="member-name">User</div>
        </div>
      </div>
    `;
  }

  updateUI(state) {
    // Simplistic placeholder logic for current user in members panel
    const memberName = this.container.querySelector('#member-name');
    if (memberName) {
        memberName.textContent = state.user ? state.user.username : 'User';
    }
  }
}
