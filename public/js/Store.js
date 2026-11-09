// Centralized state store implementation using PubSub pattern

export class Store {
  constructor(initialState = {}) {
    this.state = initialState;
    this.listeners = {};
  }

  subscribe(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  publish(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => callback(data));
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.publish('stateChange', this.state);
  }

  getState() {
    return this.state;
  }
}

// Global instance for the application
export const stateStore = new Store({
  user: null,          // Current logged-in user
  activeServerId: null,
  activeChannelId: null,
  middlePanel: 'chat', // 'chat' or 'settings'
  servers: [],         // User's servers
  channels: [],        // Channels for active server
  messages: []         // Messages for active channel
});
