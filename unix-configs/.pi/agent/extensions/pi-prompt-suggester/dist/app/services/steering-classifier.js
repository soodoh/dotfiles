function normalizeText(value) {
    return value
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();
}
function tokenSet(value) {
    return new Set(value.split(/[^a-z0-9]+/).filter(Boolean));
}
function jaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 1;
    let intersection = 0;
    for (const value of a)
        if (b.has(value))
            intersection += 1;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : intersection / union;
}
function lcsLength(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            if (a[i - 1] === b[j - 1])
                dp[i][j] = dp[i - 1][j - 1] + 1;
            else
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[a.length][b.length];
}
function sequenceSimilarity(a, b) {
    if (!a && !b)
        return 1;
    const lcs = lcsLength(a, b);
    return (2 * lcs) / Math.max(1, a.length + b.length);
}
export class SteeringClassifier {
    config;
    constructor(config) {
        this.config = config;
    }
    classify(suggestedPrompt, actualUserPrompt) {
        const suggested = normalizeText(suggestedPrompt);
        const actual = normalizeText(actualUserPrompt);
        if (suggested === actual) {
            return {
                classification: "accepted_exact",
                similarity: 1,
            };
        }
        const similarity = (jaccard(tokenSet(suggested), tokenSet(actual)) + sequenceSimilarity(suggested, actual)) / 2;
        return {
            classification: similarity >= this.config.steering.acceptedThreshold ? "accepted_edited" : "changed_course",
            similarity,
        };
    }
}
