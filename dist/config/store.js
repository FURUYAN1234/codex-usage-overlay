import Store from 'electron-store';
const defaults = {
    logPath: 'auto',
    pricingModel: {
        inputPerMillion: 1.25,
        outputPerMillion: 10
    },
    api: {
        enabled: false,
        endpoint: '',
        apiKeyEnv: 'OPENAI_ADMIN_KEY',
        pollIntervalMs: 30_000
    },
    ui: {
        position: 'top-right',
        opacity: 1,
        mode: 'compact',
        clickThrough: false,
        bounds: {
            width: 450,
            height: 276
        }
    },
    thresholds: {
        spikeTokens: 1500,
        costWarningUsd: 3,
        idleAfterMs: 45_000
    },
    performance: {
        updateThrottleMs: 500,
        scanIntervalMs: 10_000,
        historyWindowSeconds: 60
    },
    autostart: false
};
export const configStore = new Store({
    name: 'codex-usage-overlay',
    defaults
});
export function getConfig() {
    const merged = {
        ...defaults,
        ...configStore.store,
        pricingModel: {
            ...defaults.pricingModel,
            ...configStore.get('pricingModel')
        },
        api: {
            ...defaults.api,
            ...configStore.get('api')
        },
        ui: {
            ...defaults.ui,
            ...configStore.get('ui'),
            bounds: {
                ...defaults.ui.bounds,
                ...(configStore.get('ui')?.bounds ?? {})
            }
        },
        thresholds: {
            ...defaults.thresholds,
            ...configStore.get('thresholds')
        },
        performance: {
            ...defaults.performance,
            ...configStore.get('performance')
        }
    };
    const minimumByMode = {
        compact: { width: 450, height: 276 },
        detailed: { width: 450, height: 276 },
        'graph-only': { width: 450, height: 276 }
    };
    const minimum = minimumByMode[merged.ui.mode] ?? minimumByMode.compact;
    return {
        ...merged,
        ui: {
            ...merged.ui,
            position: 'top-right',
            opacity: 1,
            mode: 'compact',
            clickThrough: false,
            bounds: {
                width: Math.max(merged.ui.bounds.width, minimum.width),
                height: Math.max(merged.ui.bounds.height, minimum.height)
            }
        }
    };
}
export function updateConfig(patch) {
    const current = getConfig();
    const next = {
        ...current,
        ...patch,
        pricingModel: {
            ...current.pricingModel,
            ...patch.pricingModel
        },
        api: {
            ...current.api,
            ...patch.api
        },
        ui: {
            ...current.ui,
            ...patch.ui,
            bounds: {
                ...current.ui.bounds,
                ...(patch.ui?.bounds ?? {})
            }
        },
        thresholds: {
            ...current.thresholds,
            ...patch.thresholds
        },
        performance: {
            ...current.performance,
            ...patch.performance
        }
    };
    configStore.set(next);
    return next;
}
//# sourceMappingURL=store.js.map
