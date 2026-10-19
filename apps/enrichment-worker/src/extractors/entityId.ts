import { createHash } from 'crypto';

/**
 * Generate a stable, application-owned entity id for a type+surface_form.
 * Deterministic: same inputs -> same id.
 */
export function generateEntityId(type: string, surface_form: string): string {
  const h = createHash('sha256');
  h.update(`${type}:${surface_form}`);
  return h.digest('hex');
}

export default generateEntityId;
