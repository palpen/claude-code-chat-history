use crate::parser::Usage;

/// Per-million-token USD prices from Anthropic's public model pricing.
/// cache_write here is the 1h ephemeral rate — Claude Code uses 1h caches.
/// (5m writes are cheaper; we deliberately pick the higher rate to avoid
/// under-estimating, and we don't get the split from the raw records.)
struct Price {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_creation: f64,
}

fn price_for(model: &str) -> Price {
    let m = model.to_ascii_lowercase();

    // Haiku family
    if m.contains("haiku-4") || m.contains("haiku-4-5") || m.contains("haiku-4.5") {
        return Price { input: 1.00, output: 5.00, cache_read: 0.10, cache_creation: 2.00 };
    }
    if m.contains("haiku-3-5") || m.contains("haiku-3.5") {
        return Price { input: 0.80, output: 4.00, cache_read: 0.08, cache_creation: 1.60 };
    }
    if m.contains("haiku-3") {
        return Price { input: 0.25, output: 1.25, cache_read: 0.03, cache_creation: 0.50 };
    }

    // Opus 4.5 / 4.6 / 4.7 — the "new pricing" tier.
    if m.contains("opus-4-5") || m.contains("opus-4.5")
        || m.contains("opus-4-6") || m.contains("opus-4.6")
        || m.contains("opus-4-7") || m.contains("opus-4.7")
    {
        return Price { input: 5.00, output: 25.00, cache_read: 0.50, cache_creation: 10.00 };
    }
    // Opus 4 / 4.1 / Opus 3 (deprecated) — old Opus pricing.
    if m.contains("opus") {
        return Price { input: 15.00, output: 75.00, cache_read: 1.50, cache_creation: 30.00 };
    }

    // Sonnet family (3.7 deprecated; 4/4.5/4.6 all same price)
    if m.contains("sonnet") {
        return Price { input: 3.00, output: 15.00, cache_read: 0.30, cache_creation: 6.00 };
    }

    // Unknown model — use Sonnet rates as a middle-of-the-road default.
    Price { input: 3.00, output: 15.00, cache_read: 0.30, cache_creation: 6.00 }
}

/// Estimate API cost (hypothetical pay-as-you-go) for a session from
/// aggregated usage. Picks the first model seen as representative —
/// Claude Code sessions mostly use one model end-to-end, so this is accurate
/// when it matters and off by a small factor when a session switched models.
pub fn estimate_cost(usage: &Usage, models: &[String]) -> f64 {
    let price = models
        .iter()
        .find(|m| !m.starts_with("<"))
        .map(|m| price_for(m))
        .unwrap_or_else(|| price_for(""));

    let per = 1_000_000.0;
    (usage.input_tokens as f64) * price.input / per
        + (usage.output_tokens as f64) * price.output / per
        + (usage.cache_read_input_tokens as f64) * price.cache_read / per
        + (usage.cache_creation_input_tokens as f64) * price.cache_creation / per
}
