// Client-side Router to handle View unmounting and DOM updates cleanly

export class Router {
  constructor(routes, rootElement) {
    this.routes = routes;
    this.rootElement = rootElement;
    this.currentView = null;
    
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  navigate(path) {
    window.location.hash = path;
  }

  handleRoute() {
    const path = window.location.hash.slice(1) || '/';
    let ViewClass = this.routes['/404']; // Assuming a 404 route is provided, or undefined
    
    // Find matching route
    for (const [routePath, view] of Object.entries(this.routes)) {
      if (path === routePath || (routePath !== '/' && path.startsWith(routePath))) {
        ViewClass = view;
        break;
      }
    }

    if (!ViewClass) {
      console.error(`No route found for path: ${path}`);
      return;
    }

    // Clean up old view
    if (this.currentView && typeof this.currentView.destroy === 'function') {
      this.currentView.destroy();
    }

    this.rootElement.innerHTML = '';
    
    // Instantiate new view and render
    this.currentView = new ViewClass(this.rootElement);
    this.currentView.render();
  }
}
