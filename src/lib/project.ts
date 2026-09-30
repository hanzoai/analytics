/**
 * A website IS a cloud project. Cloud's /v1/projects is the one registry: a project
 * is (org, slug) with a publishable key, and the website, its pixel, its insights
 * project and its error project all hang off it. Nothing here keeps a second copy
 * of that registry; a website row is the project's projection into analytics.
 *
 * The website id is derived from (org, slug), both immutable, so every surface that
 * holds a project — platform's project page, the bus consumer, this app — names the
 * same website without asking anyone.
 */
import { v5 } from 'uuid';

/** The namespace every project-derived website id is minted in. */
export const PROJECT_NAMESPACE = 'b8b6b4a2-3f0c-5d1e-9a7b-6c5d4e3f2a1b';

/** The website id of a cloud project. */
export function websiteIdOf(org: string, slug: string): string {
  return v5(`${org}/${slug}`, PROJECT_NAMESPACE);
}

/** Where cloud answers /v1/projects and the ingest that serves each project's pixel. */
export const CLOUD_URL = (process.env.CLOUD_API_URL || 'https://api.hanzo.ai').replace(/\/+$/, '');

/** A project's default pixel: its publishable key in an image address on the one ingest. */
export function pixelOf(key: string): string {
  return `${CLOUD_URL}/v1/event/pixel/${encodeURIComponent(key)}.gif`;
}
