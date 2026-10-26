import type { InertiaLinkProps } from '@inertiajs/react';
import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function toUrl(url: NonNullable<InertiaLinkProps['href']>): string {
    return typeof url === 'string' ? url : url.url;
}

/** Hours and minutes of an ISO timestamp in the viewer's locale. */
export function formatTime(iso: string | null): string {
    return iso === null
        ? 'unknown'
        : new Date(iso).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
          });
}

/** Date and time of an ISO timestamp in the viewer's locale. */
export function formatDateTime(iso: string | null): string {
    return iso === null
        ? 'unknown'
        : new Date(iso).toLocaleString([], {
              dateStyle: 'medium',
              timeStyle: 'short',
          });
}
