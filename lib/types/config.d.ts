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
/** How the guard behaves. */
export type Mode = 
/** Repair the request (default). */
'guard'
/** Decide and count exactly as `guard` does, and change nothing. */
 | 'observe'
/** Install no listener. */
 | 'off';
/** Raw plugin configuration. */
export interface Config {
    /** Behaviour; defaults to `guard`. */
    readonly mode?: Mode;
    /** Provider routes to guard; empty (the default) means every route. */
    readonly providers?: readonly string[];
    /** Text prepended to an empty result; defaults to {@link DEFAULT_TEXT}. */
    readonly text?: string;
    /** Emit one log line per repair; defaults to `true`. */
    readonly logRepairs?: boolean;
}
/** The default block text. */
export declare const DEFAULT_TEXT = "The tool returned no output.";
/** Configuration with every default applied. */
export interface ResolvedConfig {
    readonly mode: Mode;
    readonly providers: readonly string[];
    readonly text: string;
    readonly logRepairs: boolean;
}
/**
 * Apply defaults and reject values that would silently do nothing.
 * @param config - raw loader configuration.
 * @returns the normalized configuration.
 */
export declare function resolveConfig(config?: Config): ResolvedConfig;
//# sourceMappingURL=config.d.ts.map