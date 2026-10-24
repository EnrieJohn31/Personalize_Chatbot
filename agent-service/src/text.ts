/** At most `length` UTF-16 units, never splitting a surrogate pair. */
export function safeSlice(text: string, length: number): string {
    if (text.length <= length) {
        return text;
    }
    const code = text.charCodeAt(length - 1);

    return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
}
