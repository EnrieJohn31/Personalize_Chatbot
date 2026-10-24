/**
 * Invented reference entries for the first lookup tool (Build Plan task 3.3). None of this describes
 * a real organisation, place or person; it exists so the tool path can be exercised end to end.
 */
export interface ReferenceEntry {
    /** Stable evidence ID, reported with every result that uses the entry. */
    id: string;
    /** The code users and documents refer to. */
    code: string;
    title: string;
    text: string;
    /** Where the entry lives in its (invented) source. */
    locator: string;
    /** When the entry was last checked, as an ISO date. */
    checkedAt: string;
    keywords: string[];
}

export const REFERENCE_ENTRIES: readonly ReferenceEntry[] = [
    {
        id: 'ref-sample-office',
        code: 'SAMPLE-001',
        title: 'Sample office',
        text: 'The sample office is the invented head office used in examples. Its reference code is SAMPLE-001. It is open Monday to Friday, 08:30 to 17:30, and closed on public holidays.',
        locator: 'fixture://reference/offices#SAMPLE-001',
        checkedAt: '2026-10-01',
        keywords: ['office', 'head office', 'opening hours', 'location'],
    },
    {
        id: 'ref-sample-warehouse',
        code: 'SAMPLE-002',
        title: 'Sample warehouse',
        text: 'The sample warehouse is an invented storage site with reference code SAMPLE-002. Deliveries are accepted from 07:00 to 15:00 on weekdays and must be booked one working day in advance.',
        locator: 'fixture://reference/offices#SAMPLE-002',
        checkedAt: '2026-10-01',
        keywords: ['warehouse', 'deliveries', 'storage', 'booking'],
    },
    {
        id: 'ref-support-hours',
        code: 'POLICY-010',
        title: 'Support hours',
        text: 'Invented policy POLICY-010: the help desk answers chat and email from 08:00 to 20:00 on weekdays and 10:00 to 16:00 on Saturdays. Urgent outages are handled around the clock.',
        locator: 'fixture://reference/policies#POLICY-010',
        checkedAt: '2026-09-15',
        keywords: ['support', 'help desk', 'hours', 'outage'],
    },
    {
        id: 'ref-expense-limit',
        code: 'POLICY-020',
        title: 'Travel expense limit',
        text: 'Invented policy POLICY-020: travel expenses up to 150 per day need no prior approval; anything above needs a manager’s approval before booking. Receipts are kept for two years.',
        locator: 'fixture://reference/policies#POLICY-020',
        checkedAt: '2026-09-15',
        keywords: ['expenses', 'travel', 'approval', 'receipts'],
    },
    {
        id: 'ref-guest-wifi',
        code: 'FACILITY-030',
        title: 'Guest Wi-Fi',
        text: 'Invented facility note FACILITY-030: guests use the network "Sample-Guest". Access codes are issued at reception and expire after 24 hours.',
        locator: 'fixture://reference/facilities#FACILITY-030',
        checkedAt: '2026-08-20',
        keywords: ['wifi', 'wi-fi', 'guest', 'network', 'internet'],
    },
];
