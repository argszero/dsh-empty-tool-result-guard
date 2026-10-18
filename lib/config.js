/**
 * Config shape and its defaults.
 *
 * The object is deliberately not exported as the plugin's `Config`: cordis
 * validates `Config` with a `~standard` schema, so an object that is only read
 * here would be asked to validate itself. The loader passes plain data and
 * {@link resolveConfig} normalizes it, which is the same convention the other
 * community plugins on this seam follow.
 *
 * @module @argszero/dsh-empty-tool-result-guard/config
 */
/** The default block text. */
export const DEFAULT_TEXT = 'The tool returned no output.';
const MODES = ['guard', 'observe', 'off'];
/**
 * Apply defaults and reject values that would silently do nothing.
 * @param config - raw loader configuration.
 * @returns the normalized configuration.
 */
export function resolveConfig(config = {}) {
    const mode = config.mode ?? 'guard';
    if (!MODES.includes(mode))
        throw new Error(`empty-tool-result-guard: unknown mode ${JSON.stringify(mode)}`);
    const text = config.text ?? DEFAULT_TEXT;
    // An empty placeholder would be dropped by the same rule that emptied the
    // result, so accepting it would install a guard that repairs nothing.
    if (text.length === 0)
        throw new Error('empty-tool-result-guard: text must not be empty');
    const providers = [...(config.providers ?? [])];
    for (const provider of providers) {
        if (provider.length === 0)
            throw new Error('empty-tool-result-guard: provider names must not be empty');
    }
    return { mode, providers, text, logRepairs: config.logRepairs ?? true };
}
