import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { useAppearance } from '@/hooks/use-appearance';
import { cn } from '@/lib/utils';

const themes = [
    {
        value: 'light',
        icon: Sun,
        label: 'Light',
        description: 'Clean and bright',
    },
    {
        value: 'dark',
        icon: Moon,
        label: 'Dark',
        description: 'Soft on the eyes',
    },
    {
        value: 'system',
        icon: Monitor,
        label: 'System',
        description: 'Match your device',
    },
] as const;

export default function AppearanceToggleTab({
    className = '',
    ...props
}: HTMLAttributes<HTMLDivElement>) {
    const { appearance, updateAppearance } = useAppearance();

    return (
        <div
            role="radiogroup"
            aria-label="Color theme"
            className={cn('grid gap-3 sm:grid-cols-3', className)}
            {...props}
        >
            {themes.map(({ value, icon: Icon, label, description }) => (
                <label key={value} className="relative cursor-pointer">
                    <input
                        type="radio"
                        name="color-theme"
                        value={value}
                        checked={appearance === value}
                        onChange={() => updateAppearance(value)}
                        className="peer sr-only"
                    />
                    <span
                        className={cn(
                            'flex h-full flex-col gap-4 rounded-lg border-2 p-3 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                            appearance === value
                                ? 'border-primary bg-accent/40'
                                : 'border-border hover:border-muted-foreground/50',
                        )}
                    >
                        <span
                            aria-hidden="true"
                            className={cn(
                                'relative flex h-24 overflow-hidden rounded-md border',
                                value === 'dark'
                                    ? 'border-slate-600 bg-slate-900'
                                    : 'border-slate-200 bg-slate-50',
                            )}
                        >
                            {value === 'system' && (
                                <span className="absolute inset-y-0 right-0 w-1/2 bg-slate-900" />
                            )}
                            <span
                                className={cn(
                                    'z-10 flex w-1/4 flex-col gap-2 border-r p-2 pt-4',
                                    value === 'dark'
                                        ? 'border-slate-600 bg-slate-800'
                                        : 'border-slate-200 bg-white',
                                )}
                            >
                                <span className="h-1.5 w-full rounded bg-blue-400" />
                                <span className="h-1.5 w-4/5 rounded bg-slate-300" />
                                <span className="h-1.5 w-full rounded bg-slate-300" />
                            </span>
                            <span className="z-10 flex flex-1 flex-col gap-2 p-4">
                                <span className="h-2 w-2/3 rounded bg-slate-400" />
                                <span className="h-1.5 w-full rounded bg-slate-300" />
                                <span className="h-1.5 w-4/5 rounded bg-slate-300" />
                                <span className="mt-auto h-3 w-8 rounded-sm bg-blue-500" />
                            </span>
                        </span>
                        <span className="flex items-start gap-2">
                            <Icon
                                aria-hidden="true"
                                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="flex-1">
                                <span className="block text-sm font-medium">
                                    {label}
                                </span>
                                <span className="block text-xs leading-5 text-muted-foreground">
                                    {description}
                                </span>
                            </span>
                            {appearance === value && (
                                <Check
                                    aria-hidden="true"
                                    className="mt-0.5 size-4 text-primary"
                                />
                            )}
                        </span>
                    </span>
                </label>
            ))}
        </div>
    );
}
