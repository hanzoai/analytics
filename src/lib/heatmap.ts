import { z } from 'zod';
import {
  classifyDeviceClass,
  DEVICE_CLASSES,
  type DeviceClass,
  normalizeHostname,
  normalizeRouteTemplate,
} from './funnel';
import {
  hasSensitiveContainerMarker,
  isSensitiveDomElement,
  isSensitiveInputDescriptor,
  isUxCaptureExcludedRoute,
  type SensitiveNodeDescriptor,
} from './privacy';

export const AGGREGATE_HEATMAP_EVENT = '$$heatmap_aggregate' as const;

export const aggregateHeatmapKeySchema = z.object({
  hostname: z.string().min(1).max(255),
  route_template: z.string().min(1).max(500).startsWith('/'),
  release: z.string().min(1).max(128),
  viewport: z.enum(DEVICE_CLASSES),
  control_id: z.string().min(1).max(160),
});

export type AggregateHeatmapKey = z.infer<typeof aggregateHeatmapKeySchema>;

export interface ControlElementDescriptor extends SensitiveNodeDescriptor {
  role?: string;
  textContent?: string;
}

const SEMANTIC_INTERACTIVE_TAGS = new Set(['button', 'a', 'summary']);
const SEMANTIC_INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'switch']);
const DYNAMIC_ID_PATTERN =
  /^(?:[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-|radix-|headlessui-|react-aria-|:r[0-9a-z]+:)/i;

export function isHeatmapEligibleRoute(urlOrPath?: string | null): boolean {
  return !isUxCaptureExcludedRoute(urlOrPath);
}

export function classifyViewportBucket(input: {
  width?: number | null;
  device?: string | null;
  userAgent?: string | null;
}): DeviceClass {
  return classifyDeviceClass(input);
}

function slugifyControlLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function readAttr(el: ControlElementDescriptor, name: string): string {
  const attrs = el.attributes;
  if (!attrs) return '';
  const val = attrs[name] ?? attrs[name.toLowerCase()];
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * Extracts a stable, low-cardinality control identifier from an element using
 * `data-control-id` > `data-testid` > `data-hanzo-control` / `data-hanzo-event` >
 * semantic button/link identifier (`aria-label`, stable `id`, `name`, semantic text).
 * Returns `null` for sensitive elements/inputs so PII/secrets never enter heatmap keys.
 */
export function resolveStableControlId(el: ControlElementDescriptor | unknown): string | null {
  if (!el || typeof el !== 'object') return null;

  if (isSensitiveDomElement(el)) return null;

  const domNode = el as {
    tagName?: string;
    id?: string;
    name?: string;
    type?: string;
    className?: string;
    textContent?: string;
    getAttribute?: (attr: string) => string | null;
    attributes?: Record<string, string | boolean | null | undefined>;
    insideSensitiveContainer?: boolean;
    role?: string;
    ariaLabel?: string;
  };

  const desc: ControlElementDescriptor =
    typeof domNode.getAttribute === 'function'
      ? {
          tagName: domNode.tagName,
          id: domNode.id || domNode.getAttribute('id') || undefined,
          name: domNode.name || domNode.getAttribute('name') || undefined,
          type: domNode.type || domNode.getAttribute('type') || undefined,
          className: typeof domNode.className === 'string' ? domNode.className : undefined,
          role: domNode.getAttribute('role') || undefined,
          ariaLabel: domNode.getAttribute('aria-label') || undefined,
          textContent: domNode.textContent || undefined,
          attributes: {
            'data-control-id': domNode.getAttribute('data-control-id'),
            'data-testid': domNode.getAttribute('data-testid'),
            'data-hanzo-control': domNode.getAttribute('data-hanzo-control'),
            'data-hanzo-event': domNode.getAttribute('data-hanzo-event'),
            'data-hanzo-mask': domNode.getAttribute('data-hanzo-mask'),
            'data-conversation-body': domNode.getAttribute('data-conversation-body'),
            'data-secret': domNode.getAttribute('data-secret'),
            type: domNode.getAttribute('type'),
            name: domNode.getAttribute('name'),
            autocomplete: domNode.getAttribute('autocomplete'),
          },
        }
      : (domNode as ControlElementDescriptor);

  if (hasSensitiveContainerMarker(desc) || isSensitiveInputDescriptor(desc)) {
    return null;
  }

  const explicitControlId = readAttr(desc, 'data-control-id');
  if (explicitControlId) return explicitControlId.slice(0, 160);

  const testId = readAttr(desc, 'data-testid');
  if (testId) return testId.slice(0, 160);

  const hanzoControl = readAttr(desc, 'data-hanzo-control') || readAttr(desc, 'data-hanzo-event');
  if (hanzoControl) return hanzoControl.slice(0, 160);

  const tag = (desc.tagName || '').toLowerCase();
  const role = (desc.role || readAttr(desc, 'role')).toLowerCase();
  const type = (desc.type || readAttr(desc, 'type')).toLowerCase();

  const isSemanticButton =
    SEMANTIC_INTERACTIVE_TAGS.has(tag) ||
    SEMANTIC_INTERACTIVE_ROLES.has(role) ||
    (tag === 'input' && (type === 'submit' || type === 'button'));

  if (!isSemanticButton) return null;

  const prefix = role || tag || 'control';
  const ariaLabel = desc.ariaLabel || readAttr(desc, 'aria-label');
  if (ariaLabel) {
    const slug = slugifyControlLabel(ariaLabel);
    if (slug) return `${prefix}:${slug}`;
  }

  const id = (desc.id || readAttr(desc, 'id')).trim();
  if (id && !DYNAMIC_ID_PATTERN.test(id)) {
    return `${prefix}#${id.slice(0, 120)}`;
  }

  const name = (desc.name || readAttr(desc, 'name')).trim();
  if (name) {
    return `${prefix}[name=${slugifyControlLabel(name) || name.slice(0, 64)}]`;
  }

  if (desc.textContent) {
    const slug = slugifyControlLabel(desc.textContent);
    if (slug) return `${prefix}:${slug}`;
  }

  return null;
}

export interface BuildAggregateHeatmapKeyInput {
  hostname: string;
  urlOrPath: string;
  release?: string | null;
  viewport?: DeviceClass;
  viewportWidth?: number;
  userAgent?: string;
  control_id?: string | null;
  element?: ControlElementDescriptor | unknown;
}

export function buildAggregateHeatmapKey(
  input: BuildAggregateHeatmapKeyInput,
): AggregateHeatmapKey | null {
  if (!isHeatmapEligibleRoute(input.urlOrPath)) {
    return null;
  }

  const controlId =
    (typeof input.control_id === 'string' && input.control_id.trim()) ||
    resolveStableControlId(input.element);

  if (!controlId) {
    return null;
  }

  return aggregateHeatmapKeySchema.parse({
    hostname: normalizeHostname(input.hostname),
    route_template: normalizeRouteTemplate(input.urlOrPath),
    release: (input.release || 'unknown').trim() || 'unknown',
    viewport:
      input.viewport ??
      classifyViewportBucket({
        width: input.viewportWidth,
        userAgent: input.userAgent,
      }),
    control_id: controlId.slice(0, 160),
  });
}

export function serializeAggregateHeatmapKey(key: AggregateHeatmapKey): string {
  return [key.hostname, key.route_template, key.release, key.viewport, key.control_id].join('|');
}

export interface AggregateHeatmapBucket {
  key: AggregateHeatmapKey;
  count: number;
}

export function aggregateHeatmapInteractions(
  samples: BuildAggregateHeatmapKeyInput[],
): AggregateHeatmapBucket[] {
  const buckets = new Map<string, AggregateHeatmapBucket>();

  for (const sample of samples) {
    const key = buildAggregateHeatmapKey(sample);
    if (!key) continue;
    const serialized = serializeAggregateHeatmapKey(key);
    const existing = buckets.get(serialized);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(serialized, { key, count: 1 });
    }
  }

  return Array.from(buckets.values());
}
