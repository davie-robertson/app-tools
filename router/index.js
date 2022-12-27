class RouteEvent extends Event {
  /**
   * @param {Context} context 
   */
  constructor(context) {
    super('route-changed');
    this.context = context;
  }
}

/**
 * @typedef {{
 *  shouldNavigate?: (context: Context) => {
 *   condition: () => boolean | (() => Promise<boolean>),
 *   redirect: string
 *  },
 *  beforeNavigation?: (context: Context) => void,
 *  afterNavigation?: (context: Context) => void,
 * }} Plugin
 * @typedef {{
 *  title?: string,
 *  query: Object,
 *  params: Object,
 *  url: URL
 * }} Context
 * @typedef {{
 *  path: string,
 *  title: string | ((context: Context) => string),
 *  render?: <RenderResult>(context: Context) => RenderResult
 *  plugins?: Plugin[]
 * }} RouteDefinition
 * @typedef {RouteDefinition & {
 *  urlPattern?: any,
 * }} Route
 */

export class Router extends EventTarget {
  context = {
    params: {},
    query: {},
    title: '',
    url: new URL(window.location.href)
  }

  /**
   * @param {{
   *   fallback?: string,
   *   plugins?: Plugin[],
   *   routes: RouteDefinition[]
   * }} config 
   */
  constructor(config) {
    super();
    this.config = config;

    /** @type {Route[]} */
    this.routes = config.routes.map((route) => {
      const r = /** @type {unknown} */ ({
        ...route,
        urlPattern: new URLPattern({
          pathname: route.path,
          /** @TODO figure out base url */
          baseURL: window.location.href,
          search: '*',
          hash: '*',
        }),
      });
      return /** @type {Route} */ (r);
    });

    queueMicrotask(() => {
      this.navigate(new URL(window.location.href));
    });
    window.addEventListener('popstate', this._onPopState);
    window.addEventListener('click', this._onAnchorClick);
  }

  get url() {
    return new URL(window.location.href);
  }

  get fallback() {
    return new URL(this.config?.fallback || '/' , this.baseUrl)
  }

  get baseUrl() {
    return new URL('./', document.baseURI);
  }

  render() {
    const { params, query, url, title } = this.context;
    return this.route?.render({
      params,
      query,
      url,
      title
    });
  }

  /**
   * @param {URL} url 
   * @returns {Route | null}
   */
  _matchRoute(url) {
    for (const route of this.routes) {
      const match = route.urlPattern.exec(url);
      if (match) {
        const { title } = route;
        const query = Object.fromEntries(new URLSearchParams(url.search)); 
        const params = match?.pathname?.groups ?? {};
        this.context = {
          url,
          title: typeof title === 'function' ? title({params, query, url}) : title,
          params,
          query,
        }
        return route;
      }
    }
    return null;
  }
  
  _notifyUrlChanged() {
    this.dispatchEvent(new RouteEvent(this.context));
  }

  _onPopState = () => {
    this.route = this._matchRoute(new URL(window.location.href));
    this._notifyUrlChanged();
  }

  _onAnchorClick = (e) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey
    ) {
      return;
    }

    const a = e.composedPath().find((el) => el.tagName === 'A');
    if (!a || !a.href) return;

    const url = new URL(a.href);

    if (this.url.href === url.href) return;
    if (a.hasAttribute('download') || a.href.includes('mailto:')) return;

    const target = a.getAttribute('target');
    if (target && target !== '' && target !== '_self') return;
    
    e.preventDefault();
    this.navigate(url);
  }

  /**
   * @param {string | URL} url 
   */
  async navigate(url) {
    if (typeof url === 'string') {
      url = new URL(url, this.baseUrl);
    }

    this.route = this._matchRoute(url) || this._matchRoute(this.fallback);
    const plugins = [
      ...(this.config?.plugins ?? []), 
      ...(this.route?.plugins ?? []), 
    ];

    for (const plugin of plugins) {
      const result = await plugin?.shouldNavigate?.(this.context);
      if (result) {
        const condition = await result.condition();
        if (!condition) {
          url = new URL(result.redirect, this.baseUrl);
          this.route = this._matchRoute(url) || this._matchRoute(this.fallback);
        }
      }
    }

    if (!this.route) {
      throw new Error(`[ROUTER] No route or fallback matched for url ${url}`);
    }

    for (const plugin of plugins) {
      await plugin?.beforeNavigation?.(this.context);
    }

    window.history.pushState(null, '', `${url.pathname}${url.search}`);
    document.title = this.context.title;
    this._notifyUrlChanged();

    for (const plugin of plugins) {
      await plugin?.afterNavigation?.(this.context);
    }
  }
}