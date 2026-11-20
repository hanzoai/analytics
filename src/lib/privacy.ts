export const EXCLUDED_UX_CAPTURE_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/auth\/callback(?:\/|$)/i,
  /^\/oauth\/callback(?:\/|$)/i,
  /^\/login\/callback(?:\/|$)/i,
  /^\/pay\/confirm(?:\/|$)/i,
  /^\/pay\/card(?:\/|$)/i,
  /^\/checkout\/payment(?:\/|$)/i,
];

export const AUTH_CALLBACK_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/auth\/callback(?:\/|$)/i,
  /^\/oauth\/callback(?:\/|$)/i,
  /^\/login\/callback(?:\/|$)/i,
];

export const SENSITIVE_ELEMENT_SELECTORS: readonly string[] = [
  'input[type="password"]',
  '[data-hanzo-mask]',
  '[data-conversation-body]',
  '.conversation-body',
  '[data-secret]',
];

export const SENSITIVE_MASK_TEXT_SELECTOR =
  '[data-hanzo-mask], [data-conversation-body], .conversation-body, [data-secret]';

export const SENSITIVE_INPUT_FIELD_PATTERN =
  /(password|passcode|passwd|card|cc[-_]?num|cc[-_]?exp|cc[-_]?csc|credit[-_]?card|cardnumber|\bpan\b|cvv|cvc|csc|security[-_]?code|iban|routing|bank[-_]?account|account[-_]?num|swift|bic|secret|api[-_]?key|apikey|access[-_]?key|private[-_]?key|client[-_]?secret|auth[-_]?token|bearer)/i;

export const SENSITIVE_URL_PARAMS: readonly string[] = [
  'code',
  'state',
  'id_token',
  'access_token',
  'refresh_token',
  'token',
  'session_state',
  'client_secret',
  'api_key',
  'apikey',
  'password',
  'secret',
  'card',
  'cvv',
  'cvc',
  'iban',
];

export const MASKED_PLACEHOLDER = '********';

export interface SensitiveNodeDescriptor {
  tagName?: string;
  type?: string;
  name?: string;
  id?: string;
  className?: string;
  autocomplete?: string;
  placeholder?: string;
  ariaLabel?: string;
  attributes?: Record<string, string | boolean | undefined | null>;
  insideSensitiveContainer?: boolean;
}

export function extractPathname(urlOrPath?: string | null): string {
  if (!urlOrPath) return '/';
  const trimmed = String(urlOrPath).trim();
  if (!trimmed) return '/';

  try {
    const parsed = new URL(trimmed, 'https://hanzo.ai');
    const collapsed = parsed.pathname.replace(/\/{2,}/g, '/');
    if (collapsed.length > 1 && collapsed.endsWith('/')) {
      return collapsed.slice(0, -1);
    }
    return collapsed || '/';
  } catch {
    const noQuery = trimmed.split(/[?#]/)[0] || '/';
    const normalized = noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
    const collapsed = normalized.replace(/\/{2,}/g, '/');
    return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
  }
}

export function isAuthCallbackRoute(urlOrPath?: string | null): boolean {
  const pathname = extractPathname(urlOrPath);
  return AUTH_CALLBACK_ROUTE_PATTERNS.some(pattern => pattern.test(pathname));
}

export function isUxCaptureExcludedRoute(urlOrPath?: string | null): boolean {
  const pathname = extractPathname(urlOrPath);
  return EXCLUDED_UX_CAPTURE_ROUTE_PATTERNS.some(pattern => pattern.test(pathname));
}

export type RouteTelemetryChannel = 'auth_operational' | 'payment_excluded' | 'ux_eligible';

export function classifyRouteTelemetry(urlOrPath?: string | null): RouteTelemetryChannel {
  if (isAuthCallbackRoute(urlOrPath)) {
    return 'auth_operational';
  }
  if (isUxCaptureExcludedRoute(urlOrPath)) {
    return 'payment_excluded';
  }
  return 'ux_eligible';
}

export function stripSensitiveUrlParams(urlOrPath: string): string {
  if (!urlOrPath) return urlOrPath;
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(urlOrPath);
    const parsed = new URL(urlOrPath, 'https://hanzo.ai');
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_URL_PARAMS.includes(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    if (hasScheme) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return urlOrPath.split('?')[0] || urlOrPath;
  }
}

function getAttr(desc: SensitiveNodeDescriptor, key: string): string {
  const attrs = desc.attributes;
  if (!attrs) return '';
  const direct = attrs[key] ?? attrs[key.toLowerCase()];
  if (direct === null || direct === undefined || direct === false) return '';
  return direct === true ? 'true' : String(direct);
}

function hasAttr(desc: SensitiveNodeDescriptor, key: string): boolean {
  const attrs = desc.attributes;
  if (!attrs) return false;
  return Object.hasOwn(attrs, key) || Object.hasOwn(attrs, key.toLowerCase());
}

export function hasSensitiveContainerMarker(desc: SensitiveNodeDescriptor): boolean {
  if (desc.insideSensitiveContainer) return true;
  if (
    hasAttr(desc, 'data-hanzo-mask') ||
    hasAttr(desc, 'data-conversation-body') ||
    hasAttr(desc, 'data-secret')
  ) {
    return true;
  }
  const className = (desc.className ?? getAttr(desc, 'class')).trim();
  if (className && /(?:^|\s)conversation-body(?:\s|$)/i.test(className)) {
    return true;
  }
  return false;
}

export function isSensitiveInputDescriptor(desc: SensitiveNodeDescriptor): boolean {
  if (hasSensitiveContainerMarker(desc)) {
    return true;
  }

  const tag = (desc.tagName || '').toLowerCase();
  const type = (desc.type ?? getAttr(desc, 'type')).toLowerCase();

  if (type === 'password') {
    return true;
  }

  if (tag && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
    return false;
  }

  const candidates = [
    desc.name,
    desc.id,
    desc.autocomplete,
    desc.placeholder,
    desc.ariaLabel,
    desc.className,
    getAttr(desc, 'name'),
    getAttr(desc, 'id'),
    getAttr(desc, 'autocomplete'),
    getAttr(desc, 'placeholder'),
    getAttr(desc, 'aria-label'),
    getAttr(desc, 'data-testid'),
    getAttr(desc, 'data-control-id'),
    getAttr(desc, 'data-field'),
  ].filter(Boolean);

  return candidates.some(candidate => SENSITIVE_INPUT_FIELD_PATTERN.test(String(candidate)));
}

export function isSensitiveDomElement(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as {
    tagName?: string;
    type?: string;
    name?: string;
    id?: string;
    className?: string;
    getAttribute?: (name: string) => string | null;
    hasAttribute?: (name: string) => boolean;
    closest?: (selector: string) => unknown;
  };

  if (typeof node.closest === 'function') {
    try {
      if (node.closest(SENSITIVE_MASK_TEXT_SELECTOR)) {
        return true;
      }
    } catch {
      // ignore selector errors on non-standard nodes
    }
  }

  const attributes: Record<string, string | null> = {};
  const attrNames = [
    'type',
    'name',
    'id',
    'class',
    'autocomplete',
    'placeholder',
    'aria-label',
    'data-testid',
    'data-control-id',
    'data-field',
    'data-hanzo-mask',
    'data-conversation-body',
    'data-secret',
  ];

  for (const attr of attrNames) {
    if (typeof node.hasAttribute === 'function' && node.hasAttribute(attr)) {
      attributes[attr] = node.getAttribute?.(attr) ?? '';
    } else if (typeof node.getAttribute === 'function') {
      const val = node.getAttribute(attr);
      if (val !== null) {
        attributes[attr] = val;
      }
    }
  }

  const desc: SensitiveNodeDescriptor = {
    tagName: node.tagName,
    type: node.type,
    name: node.name,
    id: node.id,
    className: typeof node.className === 'string' ? node.className : undefined,
    attributes,
  };

  return hasSensitiveContainerMarker(desc) || isSensitiveInputDescriptor(desc);
}

export function maskInputBeforeCapture(
  value: string,
  elementOrDescriptor?: SensitiveNodeDescriptor | unknown,
  maskAllInputs = true,
): string {
  if (!value) return value;
  if (maskAllInputs) {
    return MASKED_PLACEHOLDER;
  }
  if (!elementOrDescriptor) {
    return value;
  }
  if (
    isSensitiveDomElement(elementOrDescriptor) ||
    isSensitiveInputDescriptor(elementOrDescriptor as SensitiveNodeDescriptor)
  ) {
    return MASKED_PLACEHOLDER;
  }
  return value;
}

export function maskTextBeforeCapture(
  text: string,
  elementOrDescriptor?: SensitiveNodeDescriptor | unknown,
): string {
  if (!text) return text;
  if (!elementOrDescriptor) {
    return text;
  }
  if (
    isSensitiveDomElement(elementOrDescriptor) ||
    hasSensitiveContainerMarker(elementOrDescriptor as SensitiveNodeDescriptor) ||
    isSensitiveInputDescriptor(elementOrDescriptor as SensitiveNodeDescriptor)
  ) {
    return MASKED_PLACEHOLDER;
  }
  return text;
}

export function buildPreCaptureMaskingConfig(maskLevel = 'moderate', blockSelector = '') {
  const baseTextSelector = maskLevel === 'strict' ? '*' : SENSITIVE_MASK_TEXT_SELECTOR;

  return {
    maskAllInputs: true,
    maskTextSelector: baseTextSelector,
    maskInputOptions: {
      password: true,
      text: true,
      textarea: true,
      email: true,
      tel: true,
      number: true,
      search: true,
      url: true,
      select: true,
    },
    maskInputFn: (value: string, element?: unknown) => maskInputBeforeCapture(value, element, true),
    maskTextFn: (text: string, element?: unknown) =>
      maskLevel === 'strict' ? MASKED_PLACEHOLDER : maskTextBeforeCapture(text, element),
    ...(blockSelector ? { blockSelector } : {}),
  };
}

function scrubSerializedDomNode(node: any, inheritedSensitive = false): any {
  if (!node || typeof node !== 'object') return node;

  const attributes =
    node.attributes && typeof node.attributes === 'object' ? { ...node.attributes } : undefined;

  const desc: SensitiveNodeDescriptor = {
    tagName: node.tagName,
    attributes,
    insideSensitiveContainer: inheritedSensitive,
  };

  const isContainerSensitive = hasSensitiveContainerMarker(desc);
  const isInputSensitive = isSensitiveInputDescriptor(desc);
  const sensitive = inheritedSensitive || isContainerSensitive || isInputSensitive;

  const cloned: any = { ...node };
  if (attributes) {
    cloned.attributes = attributes;
    if (
      (isInputSensitive || sensitive) &&
      typeof attributes.value === 'string' &&
      attributes.value
    ) {
      cloned.attributes.value = MASKED_PLACEHOLDER;
    }
  }

  // rrweb text nodes have type === 3 and textContent
  if (sensitive && typeof cloned.textContent === 'string' && cloned.textContent.trim().length > 0) {
    cloned.textContent = MASKED_PLACEHOLDER;
  }

  if (Array.isArray(cloned.childNodes)) {
    cloned.childNodes = cloned.childNodes.map((child: any) =>
      scrubSerializedDomNode(child, sensitive),
    );
  }

  return cloned;
}

export interface ReplaySanitizationResult {
  dropped: boolean;
  reason?: 'excluded_route';
  events: any[];
}

export function sanitizeReplayChunkBeforeStorage(
  events: any[],
  routeUrl?: string | null,
): ReplaySanitizationResult {
  if (routeUrl && isUxCaptureExcludedRoute(routeUrl)) {
    return { dropped: true, reason: 'excluded_route', events: [] };
  }

  if (!Array.isArray(events) || events.length === 0) {
    return { dropped: false, events: [] };
  }

  // Check if any Meta (type 4) or URL-bearing custom event belongs to an excluded route
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const href =
      event.data?.href || event.data?.payload?.href || event.data?.payload?.url || event.data?.url;
    if (typeof href === 'string' && isUxCaptureExcludedRoute(href)) {
      return { dropped: true, reason: 'excluded_route', events: [] };
    }
  }

  const sanitized = events.map(event => {
    if (!event || typeof event !== 'object') return event;
    const copy = { ...event };

    // Meta event: strip sensitive query params from href
    if (copy.type === 4 && copy.data && typeof copy.data.href === 'string') {
      copy.data = {
        ...copy.data,
        href: stripSensitiveUrlParams(copy.data.href),
      };
    }

    // FullSnapshot (type 2): scrub serialized DOM tree
    if (copy.type === 2 && copy.data?.node) {
      copy.data = {
        ...copy.data,
        node: scrubSerializedDomNode(copy.data.node, false),
      };
    }

    // IncrementalSnapshot (type 3): scrub input values (source 5) and mutation adds (source 0)
    if (copy.type === 3 && copy.data) {
      if (
        copy.data.source === 5 &&
        typeof copy.data.text === 'string' &&
        copy.data.text.length > 0
      ) {
        copy.data = {
          ...copy.data,
          text: MASKED_PLACEHOLDER,
        };
      } else if (copy.data.source === 0 && Array.isArray(copy.data.adds)) {
        copy.data = {
          ...copy.data,
          adds: copy.data.adds.map((add: any) =>
            add?.node ? { ...add, node: scrubSerializedDomNode(add.node, false) } : add,
          ),
        };
      }
    }

    return copy;
  });

  return { dropped: false, events: sanitized };
}
