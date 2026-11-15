import { v7 as uuidv7 } from 'uuid';
import type { Id } from './model/primitives';

/** Neue, zeitlich sortierbare ID (UUID v7). */
export const newId = (): Id => uuidv7();
